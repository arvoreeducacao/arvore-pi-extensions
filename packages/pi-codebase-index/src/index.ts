import { exec } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { clearCredentials, getCredentials, saveCredentials } from "./auth.js";
import { getConfig } from "./config.js";
import { registerCodebaseTools } from "./tools.js";
import { search } from "./api.js";
import { runSync } from "./sync.js";

const LOGIN_TIMEOUT_MS = 60_000;
const HIDDEN_STATE_ENTRY = "codebase-hidden-state";

let hidden = false;
let syncing = false;

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd);
}

function login(): Promise<{
  token: string;
  refreshToken: string | null;
  username: string;
  expiresIn: number;
}> {
  return new Promise((resolve, reject) => {
    let boundPort = 0;

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "", `http://localhost:${boundPort || 0}`);
      const token = url.searchParams.get("token");
      const refreshToken = url.searchParams.get("refresh_token");

      if (!token) {
        res.writeHead(400);
        res.end("Missing token");
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body><h2>Login successful! You can close this tab.</h2></body></html>");
      server.close();

      try {
        const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
        resolve({
          token,
          refreshToken,
          username: payload.username,
          expiresIn: (payload.exp - payload.iat) * 1000,
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Invalid token payload"));
      }
    });

    server.listen(0, () => {
      const address = server.address() as AddressInfo | null;
      if (!address) {
        server.close();
        reject(new Error("Failed to bind login server"));
        return;
      }
      boundPort = address.port;
      const config = getConfig();
      const loginUrl = `${config.apiUrl}/auth/${config.authProvider}/start?redirect_url=http://localhost:${boundPort}`;
      openBrowser(loginUrl);
    });

    server.on("error", reject);
    setTimeout(() => {
      server.close();
      reject(new Error("Login timed out (60s)"));
    }, LOGIN_TIMEOUT_MS);
  });
}

function safeSetStatus(ctx: { ui: { setStatus: (key: string, text: string) => void } }, text: string): void {
  try {
    ctx.ui.setStatus("codebase", text);
  } catch {
    // ctx went stale after a session resume/replace/reload; ignore.
  }
}

function restoreHiddenState(entries: unknown[]): void {
  for (const entry of entries) {
    const typed = entry as { type?: string; customType?: string; data?: { hidden?: boolean } };
    if (typed.type === "custom" && typed.customType === HIDDEN_STATE_ENTRY && typed.data) {
      if (typeof typed.data.hidden === "boolean") {
        hidden = typed.data.hidden;
      }
    }
  }
}

async function triggerSync(pi: ExtensionAPI, cwd: string, setStatus: (text: string) => void): Promise<void> {
  if (syncing) return;
  const creds = await getCredentials();
  if (!creds) return;

  syncing = true;
  const status = hidden ? () => {} : setStatus;
  try {
    await runSync(cwd, status);
  } catch (error) {
    if (!hidden) {
      setStatus(`codebase: sync failed`);
    }
    void error;
  } finally {
    syncing = false;
  }
}

export default function piCodebaseIndexExtension(pi: ExtensionAPI): void {
  registerCodebaseTools(pi);

  pi.on("session_start", async (_event, ctx) => {
    restoreHiddenState(ctx.sessionManager.getEntries());

    const creds = await getCredentials();
    if (!hidden) {
      safeSetStatus(
        ctx,
        creds ? "codebase: starting sync…" : "codebase: not logged in"
      );
    }

    if (creds) {
      void triggerSync(pi, ctx.cwd, (text) => safeSetStatus(ctx, text));
    }
  });

  pi.registerCommand("codebase-login", {
    description: "Authenticate with the codebase index backend",
    handler: async (_args, ctx) => {
      try {
        const result = await login();
        await saveCredentials({
          token: result.token,
          refreshToken: result.refreshToken ?? undefined,
          username: result.username,
          expiresAt: Date.now() + result.expiresIn,
        });
        ctx.ui.setStatus("codebase", `codebase: ${result.username}`);
        ctx.ui.notify(`Logged in as ${result.username}`, "info");
        void triggerSync(pi, ctx.cwd, (text) => safeSetStatus(ctx, text));
      } catch (error) {
        ctx.ui.notify(
          `Login failed: ${error instanceof Error ? error.message : String(error)}`,
          "error"
        );
      }
    },
  });

  pi.registerCommand("codebase-logout", {
    description: "Clear codebase index credentials",
    handler: async (_args, ctx) => {
      await clearCredentials();
      ctx.ui.setStatus("codebase", "codebase: logged out");
      ctx.ui.notify("Logged out from codebase index", "info");
    },
  });

  pi.registerCommand("codebase-search", {
    description: "Search the codebase index: /codebase-search <query>",
    handler: async (args, ctx) => {
      const query = args?.trim();
      if (!query) {
        ctx.ui.notify("Usage: /codebase-search <query>", "warning");
        return;
      }
      try {
        const results = await search(query, { limit: 10 });
        if (results.length === 0) {
          ctx.ui.notify("No matching code found.", "info");
          return;
        }
        const text = results
          .map((r, i) => `${i + 1}. [${r.repo}] ${r.path}:${r.lineStart ?? "?"} — ${r.symbol}`)
          .join("\n");
        ctx.ui.notify(text, "info");
      } catch (error) {
        ctx.ui.notify(
          `Search failed: ${error instanceof Error ? error.message : String(error)}`,
          "error"
        );
      }
    },
  });

  pi.registerCommand("codebase-reindex", {
    description: "Force a fresh sync of the workspace into the codebase index",
    handler: async (_args, ctx) => {
      ctx.ui.notify("Re-syncing codebase index…", "info");
      await triggerSync(pi, ctx.cwd, (text) => safeSetStatus(ctx, text));
    },
  });

  pi.registerCommand("codebase-hide", {
    description: "Hide the codebase index status widget",
    handler: async (_args, ctx) => {
      hidden = true;
      pi.appendEntry(HIDDEN_STATE_ENTRY, { hidden: true });
      ctx.ui.setStatus("codebase", "");
      ctx.ui.notify("Codebase widget hidden (sync still runs).", "info");
    },
  });

  pi.registerCommand("codebase-show", {
    description: "Show the codebase index status widget",
    handler: async (_args, ctx) => {
      hidden = false;
      pi.appendEntry(HIDDEN_STATE_ENTRY, { hidden: false });
      const creds = await getCredentials();
      ctx.ui.setStatus(
        "codebase",
        creds ? `codebase: ${creds.username}` : "codebase: not logged in"
      );
      ctx.ui.notify("Codebase widget shown.", "info");
    },
  });
}
