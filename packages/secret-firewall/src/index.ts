import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TextContent, ImageContent } from "@earendil-works/pi-ai";
import { discoverSecrets, type SecretEntry } from "./secrets.js";
import { createRedactor } from "./redact.js";

type ContentBlock = TextContent | ImageContent;

function shellVarName(placeholder: string): string {
  return placeholder.replace(/^\$/, "");
}

export default function (pi: ExtensionAPI) {
  let enabled = true;
  let entries: SecretEntry[] = [];
  const redactor = createRedactor([]);
  let exportedNames: string[] = [];
  const stats = { redactedHits: 0, lastScan: 0 };

  function exportToShell(list: SecretEntry[]): void {
    for (const name of exportedNames) {
      if (!list.some((e) => shellVarName(e.placeholder) === name)) {
        delete process.env[name];
      }
    }
    exportedNames = [];
    for (const e of list) {
      const varName = shellVarName(e.placeholder);
      process.env[varName] = e.value;
      exportedNames.push(varName);
    }
  }

  function rescan(cwd: string): void {
    entries = discoverSecrets(cwd);
    redactor.refresh(entries);
    exportToShell(entries);
    stats.lastScan = entries.length;
  }

  function redactBlocks(content: ContentBlock[]): ContentBlock[] | undefined {
    let changed = false;
    const next = content.map((block) => {
      if (block.type !== "text") return block;
      const { text, hits } = redactor.redactString(block.text);
      if (hits > 0) {
        changed = true;
        stats.redactedHits += hits;
        return { ...block, text };
      }
      return block;
    });
    return changed ? next : undefined;
  }

  function redactMessageContent(content: unknown): unknown {
    if (typeof content === "string") {
      const { text, hits } = redactor.redactString(content);
      if (hits > 0) stats.redactedHits += hits;
      return text;
    }
    if (Array.isArray(content)) {
      return content.map((block) => {
        if (block && typeof block === "object") {
          const b = block as Record<string, unknown>;
          if (b.type === "text" && typeof b.text === "string") {
            const { text, hits } = redactor.redactString(b.text);
            if (hits > 0) stats.redactedHits += hits;
            return { ...b, text };
          }
          if (b.type === "thinking" && typeof b.thinking === "string") {
            const { text, hits } = redactor.redactString(b.thinking);
            if (hits > 0) stats.redactedHits += hits;
            return { ...b, thinking: text };
          }
          if (b.type === "toolCall" && b.arguments && typeof b.arguments === "object") {
            return { ...b, arguments: redactArguments(b.arguments as Record<string, unknown>) };
          }
        }
        return block;
      });
    }
    return content;
  }

  function redactArguments(args: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) {
      if (typeof v === "string") {
        const { text, hits } = redactor.redactString(v);
        if (hits > 0) stats.redactedHits += hits;
        out[k] = text;
      } else if (Array.isArray(v)) {
        out[k] = v.map((item) =>
          typeof item === "string" ? redactor.redactString(item).text : item,
        );
      } else if (v && typeof v === "object") {
        out[k] = redactArguments(v as Record<string, unknown>);
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  pi.on("session_start", async (_event, ctx) => {
    rescan(ctx.cwd);
  });

  pi.on("context", async (event, _ctx) => {
    if (!enabled || entries.length === 0) return;
    let changed = false;
    const messages = (event.messages as unknown[]).map((msg) => {
      const m = msg as Record<string, unknown>;
      if (!("content" in m)) return msg;
      const before = m.content;
      const after = redactMessageContent(before);
      if (after !== before) {
        changed = true;
        return { ...m, content: after };
      }
      return msg;
    });
    if (changed) return { messages } as never;
  });

  pi.on("tool_result", async (event) => {
    if (!enabled || entries.length === 0) return;
    const redacted = redactBlocks(event.content as ContentBlock[]);
    if (redacted) return { content: redacted } as never;
  });

  pi.registerCommand("secret-firewall", {
    description: "Show secret-firewall status (protected secrets, redaction count)",
    handler: async (_args, ctx) => {
      rescan(ctx.cwd);
      const names = entries.map((e) => e.placeholder).join(", ") || "(none)";
      ctx.ui.notify(
        `secret-firewall [${enabled ? "on" : "off"}] | protecting ${entries.length} secret(s) | ` +
          `redacted ${stats.redactedHits} value(s) so far\nReferenceable as shell env: ${names}`,
        "info",
      );
    },
  });

  pi.registerCommand("secret-firewall-toggle", {
    description: "Enable or disable secret-firewall redaction",
    handler: async (_args, ctx) => {
      enabled = !enabled;
      ctx.ui.notify(`secret-firewall ${enabled ? "enabled" : "disabled"}`, "info");
    },
  });

  pi.registerCommand("secret-firewall-rescan", {
    description: "Re-scan environment and .env files for secrets",
    handler: async (_args, ctx) => {
      rescan(ctx.cwd);
      ctx.ui.notify(`secret-firewall re-scanned: ${entries.length} secret(s) protected`, "info");
    },
  });
}
