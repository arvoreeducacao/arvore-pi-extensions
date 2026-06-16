import { createServer } from "node:http";
import { exec } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getConfig } from "./config.js";
import { getCredentials, saveCredentials, clearCredentials } from "./auth.js";
import { chunkSession } from "./chunker.js";
import { embed, embedSingle } from "./embeddings.js";
import { ingest, search } from "./api.js";
import type { IngestChunk } from "./api.js";

let incognito = false;
let sessionId = "";

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd);
}

function extractMessagesFromEntries(entries: any[]): { role: string; content: any }[] {
  return entries
    .filter((e: any) => e.type === "message" && e.message)
    .map((e: any) => e.message)
    .filter((m: any) => m.role === "user" || m.role === "assistant");
}

function extractTextFromMessage(msg: any): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((c: any) => c.type === "text" && c.text)
      .map((c: any) => c.text)
      .join(" ");
  }
  return "";
}

async function startLoginFlow(): Promise<{ token: string; username: string; expiresIn: number }> {
  return new Promise((resolve, reject) => {
    const port = 9876;

    const server = createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:${port}`);
      const token = url.searchParams.get("token");

      if (!token) {
        res.writeHead(400);
        res.end("Missing token");
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body><h2>Login successful! You can close this tab.</h2></body></html>");

      server.close();

      const payload = JSON.parse(
        Buffer.from(token.split(".")[1], "base64url").toString(),
      );

      resolve({
        token,
        username: payload.username,
        expiresIn: (payload.exp - payload.iat) * 1000,
      });
    });

    server.listen(port, () => {
      const config = getConfig();
      const loginUrl = `${config.apiUrl}/auth/github/start?redirect_url=http://localhost:${port}`;
      openBrowser(loginUrl);
    });

    server.on("error", reject);
    setTimeout(() => {
      server.close();
      reject(new Error("Login timed out (60s)"));
    }, 60_000);
  });
}

export default function piMemoryExtension(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    sessionId = crypto.randomUUID();

    const creds = await getCredentials();
    if (!creds) {
      ctx.ui.setStatus("memory", "memory: not logged in");
      return;
    }

    ctx.ui.setStatus("memory", `memory: ${creds.username}`);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (incognito) return;

    const creds = await getCredentials();
    if (!creds) return;

    try {
      const entries = ctx.sessionManager.getEntries();
      const messages = extractMessagesFromEntries(entries);
      const firstUserMsg = messages.find((m) => m.role === "user");
      if (!firstUserMsg) return;

      const text = extractTextFromMessage(firstUserMsg);
      if (!text || text.length < 10) return;

      const queryVector = await embedSingle(text.slice(0, 500));
      const results = await search(queryVector, { limit: 10, score_threshold: 0.75 });

      if (results.length === 0) return;

      const memoryBlock = [
        "## Relevant Context from Previous Sessions",
        "",
        ...results.map((r) => `- ${r.content}`),
      ].join("\n");

      return { systemPrompt: `${event.systemPrompt}\n\n${memoryBlock}` };
    } catch {
      return;
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (incognito) return;

    const creds = await getCredentials();
    if (!creds) return;

    try {
      const entries = ctx.sessionManager.getEntries();
      const messages = extractMessagesFromEntries(entries);
      if (messages.length < 2) return;

      const chunks = chunkSession(messages as any);
      if (chunks.length === 0) return;

      ctx.ui.setStatus("memory", `memory: saving ${chunks.length} chunks...`);

      const batchSize = 20;
      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const vectors = await embed(batch.map((c) => c.content));

        const ingestChunks: IngestChunk[] = batch.map((chunk, idx) => ({
          id: chunk.id,
          content: chunk.content,
          vector: vectors[idx],
          metadata: {
            session_id: sessionId,
            timestamp: Date.now(),
            turn_index: chunk.turnIndex,
          },
        }));

        await ingest(ingestChunks);
      }

      ctx.ui.setStatus("memory", `memory: saved ${chunks.length} chunks`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[pi-memory] Save failed: ${msg}`);
    }
  });

  pi.registerCommand("memory-login", {
    description: "Login to Pi Memory via GitHub OAuth",
    handler: async (_args, ctx) => {
      ctx.ui.notify("Opening browser for GitHub login...", "info");

      try {
        const result = await startLoginFlow();

        await saveCredentials({
          token: result.token,
          username: result.username,
          expiresAt: Date.now() + result.expiresIn,
        });

        ctx.ui.setStatus("memory", `memory: ${result.username}`);
        ctx.ui.notify(`Logged in as ${result.username}`, "info");
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Login failed: ${msg}`, "error");
      }
    },
  });

  pi.registerCommand("memory-logout", {
    description: "Logout from Pi Memory",
    handler: async (_args, ctx) => {
      await clearCredentials();
      ctx.ui.setStatus("memory", "memory: logged out");
      ctx.ui.notify("Logged out from Pi Memory", "info");
    },
  });

  pi.registerCommand("memory-incognito", {
    description: "Toggle incognito mode (session not saved)",
    handler: async (_args, ctx) => {
      incognito = !incognito;
      const status = incognito ? "ON" : "OFF";
      ctx.ui.setStatus("memory", `memory: incognito ${status}`);
      ctx.ui.notify(`Incognito mode: ${status}`, "info");
    },
  });

  pi.registerCommand("memory-status", {
    description: "Show Pi Memory status",
    handler: async (_args, ctx) => {
      const creds = await getCredentials();
      const lines = [
        `Authenticated: ${creds ? `yes (${creds.username})` : "no"}`,
        `Incognito: ${incognito ? "ON" : "OFF"}`,
        `Session ID: ${sessionId || "none"}`,
        `API: ${getConfig().apiUrl}`,
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("memory-search", {
    description: "Search memory manually: /memory-search <query>",
    handler: async (args, ctx) => {
      if (!args?.trim()) {
        ctx.ui.notify("Usage: /memory-search <query>", "warning");
        return;
      }

      const creds = await getCredentials();
      if (!creds) {
        ctx.ui.notify("Not authenticated. Run /memory-login first.", "error");
        return;
      }

      try {
        const vector = await embedSingle(args.trim());
        const results = await search(vector, { limit: 10 });

        if (results.length === 0) {
          ctx.ui.notify("No results found.", "info");
          return;
        }

        const lines = results.map(
          (r, i) => `${i + 1}. [${(r.score * 100).toFixed(0)}%] ${r.content.slice(0, 120)}`,
        );
        ctx.ui.notify(lines.join("\n"), "info");
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Search failed: ${msg}`, "error");
      }
    },
  });
}
