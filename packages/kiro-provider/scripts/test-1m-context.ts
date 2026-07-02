#!/usr/bin/env npx tsx
/**
 * Diagnostic: Send a known-size payload to both the regular and 1m model variants,
 * then compare the contextUsagePercentage returned by the API.
 *
 * If the 1m model is actually using a 1M backend, the percentage should be ~5x lower
 * than the regular model for the same payload.
 *
 * Usage: npx tsx scripts/test-1m-context.ts
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function getAccessToken(): string {
  const dbPath = join(homedir(), "Library", "Application Support", "kiro-cli", "data.sqlite3");
  if (!existsSync(dbPath)) throw new Error("kiro-cli DB not found");

  for (const key of ["kirocli:odic:token", "kirocli:social:token"]) {
    try {
      const result = execSync(`sqlite3 -json "${dbPath}" "SELECT value FROM auth_kv WHERE key = '${key}'"`, {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      if (!result) continue;
      const rows = JSON.parse(result) as Array<{ value: string }>;
      if (!rows[0]?.value) continue;
      const tokenData = JSON.parse(rows[0].value);
      if (tokenData.access_token) return tokenData.access_token;
    } catch {}
  }
  throw new Error("No valid kiro-cli credentials found");
}

interface KiroStreamEvent {
  type: string;
  data: any;
}

function parseEvents(text: string): KiroStreamEvent[] {
  const events: KiroStreamEvent[] = [];
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj.contextUsagePercentage !== undefined) {
        events.push({ type: "contextUsage", data: { contextUsagePercentage: obj.contextUsagePercentage } });
      } else if (obj.assistantResponseEvent?.content !== undefined) {
        events.push({ type: "content", data: obj.assistantResponseEvent.content });
      }
    } catch {}
  }
  return events;
}

async function sendRequest(
  accessToken: string,
  modelId: string,
  content: string,
): Promise<{ contextUsagePercentage: number | null; responseSnippet: string }> {
  const endpoint = "https://q.us-east-1.amazonaws.com/generateAssistantResponse";
  const mid = crypto.randomUUID().replace(/-/g, "");
  const ua = `aws-sdk-js/1.0.0 ua/2.1 os/nodejs lang/js api/codewhispererruntime#1.0.0 m/E KiroIDE-${mid}`;

  const request = {
    conversationState: {
      chatTriggerType: "MANUAL",
      conversationId: crypto.randomUUID(),
      currentMessage: {
        userInputMessage: {
          content,
          modelId,
          origin: "AI_EDITOR",
        },
      },
    },
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "amz-sdk-invocation-id": crypto.randomUUID(),
      "amz-sdk-request": "attempt=1; max=1",
      "x-amzn-kiro-agent-mode": "vibe",
      "x-amz-user-agent": ua,
      "user-agent": ua,
      Connection: "close",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API error ${response.status}: ${errText}`);
  }

  const body = await response.text();
  const events = parseEvents(body);

  let contextUsagePercentage: number | null = null;
  let responseSnippet = "";

  for (const event of events) {
    if (event.type === "contextUsage") {
      contextUsagePercentage = event.data.contextUsagePercentage;
    } else if (event.type === "content") {
      responseSnippet += event.data;
    }
  }

  return { contextUsagePercentage, responseSnippet: responseSnippet.slice(0, 100) };
}

async function main() {
  const accessToken = getAccessToken();
  console.log("Got access token from kiro-cli\n");

  // Generate a payload of ~50k tokens (~200k chars)
  // This should be ~25% of 200k context, but only ~5% of 1M context
  const padding = "The quick brown fox jumps over the lazy dog. ".repeat(4500);
  const content = `${padding}\n\nRespond with exactly: "ACKNOWLEDGED". Nothing else.`;
  const approxTokens = Math.round(content.length / 4);
  console.log(`Payload size: ${content.length} chars (~${approxTokens} tokens)\n`);

  const models = [
    { id: "claude-sonnet-4.5", label: "Sonnet 4.5 (200k)", expectedWindow: 200_000 },
    { id: "claude-sonnet-4.5-1m", label: "Sonnet 4.5 1M", expectedWindow: 1_000_000 },
  ];

  for (const model of models) {
    console.log(`--- ${model.label} (${model.id}) ---`);
    try {
      const result = await sendRequest(accessToken, model.id, content);
      const pct = result.contextUsagePercentage;
      console.log(`  contextUsagePercentage: ${pct}%`);

      if (pct !== null) {
        // Back-calculate what context window the API thinks it has
        const impliedWindow = Math.round(approxTokens / (pct / 100));
        console.log(`  Implied context window: ~${(impliedWindow / 1000).toFixed(0)}k tokens`);
        console.log(`  Expected context window: ${(model.expectedWindow / 1000).toFixed(0)}k tokens`);

        const ratio = impliedWindow / model.expectedWindow;
        if (ratio < 0.5 || ratio > 2.0) {
          console.log(`  ⚠️  MISMATCH — implied window is ${ratio.toFixed(1)}x expected`);
        } else {
          console.log(`  ✅ Looks correct`);
        }
      }
      console.log(`  Response: "${result.responseSnippet}..."\n`);
    } catch (err) {
      console.log(`  ❌ Error: ${err instanceof Error ? err.message : err}\n`);
    }
  }
}

main().catch(console.error);
