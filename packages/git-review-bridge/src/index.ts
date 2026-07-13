import { randomUUID } from "node:crypto";
import { platform } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import WebSocket from "ws";
import { loadConfig, saveConfig, type BridgeConfig } from "./config.js";
import { formatReviewPayload, type ReviewPayload } from "./format.js";

const RECONNECT_MIN_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;

function openBrowser(pi: ExtensionAPI, url: string): void {
  const opener = platform() === "darwin" ? "open" : platform() === "win32" ? "cmd" : "xdg-open";
  const args = platform() === "win32" ? ["/c", "start", "", url] : [url];
  pi.exec(opener, args).catch(() => {});
}

async function discoverRepoSlugs(pi: ExtensionAPI): Promise<string[]> {
  const slugs = new Set<string>();
  try {
    const { stdout } = await pi.exec("find", [
      ".",
      "-maxdepth",
      "4",
      "-name",
      "node_modules",
      "-prune",
      "-o",
      "-name",
      ".git",
      "-print",
    ]);
    const dirs = stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((p) => p.replace(/\/\.git$/, ""))
      .map((p) => p.replace(/^\.\//, "") || ".");
    const unique = [...new Set(dirs.length ? dirs : ["."])];
    await Promise.all(
      unique.map(async (dir) => {
        try {
          const { stdout: remote } = await pi.exec("git", ["-C", dir, "remote", "get-url", "origin"]);
          const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(remote.trim());
          if (m) slugs.add(`${m[1]}/${m[2]}`);
        } catch {}
      }),
    );
  } catch {}
  return [...slugs];
}

interface DeviceStartResponse {
  handle: string;
  userCode: string;
  verificationUri: string;
  interval: number;
  expiresIn: number;
}

interface DevicePollResponse {
  status: "pending" | "slow_down" | "done";
  bridgeToken?: string;
  login?: string;
  error?: string;
}

async function runDeviceLogin(
  cloudUrl: string,
  notify: (m: string, t?: "info" | "warning" | "error") => void,
  pi: ExtensionAPI,
): Promise<{ bridgeToken: string; login: string } | null> {
  const startRes = await fetch(`${cloudUrl}/auth/device/start`, { method: "POST" });
  if (!startRes.ok) {
    notify(`git-review-cloud: device start failed (${startRes.status})`, "error");
    return null;
  }
  const start = (await startRes.json()) as DeviceStartResponse;
  notify(
    `git-review-cloud: open ${start.verificationUri} and enter code ${start.userCode}`,
    "info",
  );
  openBrowser(pi, start.verificationUri);

  const deadline = Date.now() + start.expiresIn * 1000;
  let interval = Math.max(start.interval, 1) * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    const pollRes = await fetch(`${cloudUrl}/auth/device/poll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle: start.handle }),
    });
    const poll = (await pollRes.json()) as DevicePollResponse;
    if (poll.status === "done" && poll.bridgeToken) {
      return { bridgeToken: poll.bridgeToken, login: poll.login || "" };
    }
    if (poll.status === "slow_down") interval += 5_000;
    if (poll.error) {
      notify(`git-review-cloud: login failed (${poll.error})`, "error");
      return null;
    }
  }
  notify("git-review-cloud: login timed out", "warning");
  return null;
}

export default function (pi: ExtensionAPI) {
  const sessionId = randomUUID();
  let ws: WebSocket | null = null;
  let reconnectDelay = RECONNECT_MIN_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let repos: string[] = [];
  let isIdle: () => boolean = () => true;
  let config: BridgeConfig | null = null;

  function deliver(payload: ReviewPayload): void {
    const message = formatReviewPayload(payload);
    pi.sendUserMessage(message, isIdle() ? undefined : { deliverAs: "steer" });
  }

  function scheduleReconnect(): void {
    if (closed || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect().catch(() => {});
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  async function connect(): Promise<void> {
    if (closed) return;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    config = config || (await loadConfig());
    if (!config.bridgeToken) return;

    const wsUrl = config.cloudUrl.replace(/^http/, "ws") + `/ws/bridge?token=${config.bridgeToken}`;
    const socket = new WebSocket(wsUrl);
    ws = socket;

    socket.on("open", () => {
      reconnectDelay = RECONNECT_MIN_MS;
      socket.send(
        JSON.stringify({
          type: "register",
          sessionId,
          sessionName: pi.getSessionName() || "pi",
          repos,
        }),
      );
    });

    socket.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type?: string; payload?: ReviewPayload };
        if (msg.type === "review" && msg.payload) deliver(msg.payload);
      } catch {}
    });

    socket.on("close", () => {
      if (ws !== socket) return;
      ws = null;
      scheduleReconnect();
    });
    socket.on("error", () => {
      socket.close();
    });
  }

  pi.registerCommand("review-cloud-login", {
    description: "Authenticate this machine with git-review-cloud (GitHub device flow)",
    handler: async (_args, ctx) => {
      config = await loadConfig();
      const result = await runDeviceLogin(config.cloudUrl, ctx.ui.notify, pi);
      if (!result) return;
      config = { ...config, bridgeToken: result.bridgeToken, login: result.login };
      await saveConfig(config);
      ctx.ui.notify(`git-review-cloud: logged in as ${result.login}`, "info");
      if (ws) ws.close();
      await connect();
    },
  });

  pi.registerCommand("review-cloud", {
    description: "Open the cloud PR reviewer in the browser (comments arrive in this terminal)",
    handler: async (_args, ctx) => {
      isIdle = () => ctx.isIdle();
      config = await loadConfig();
      if (!config.bridgeToken) {
        ctx.ui.notify("git-review-cloud: run /review-cloud-login first", "warning");
        return;
      }
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        await connect();
      }
      openBrowser(pi, `${config.cloudUrl}/?mode=prs`);
      ctx.ui.notify(
        `git-review-cloud open at ${config.cloudUrl} — comments arrive in this terminal.`,
        "info",
      );
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    isIdle = () => ctx.isIdle();
    repos = await discoverRepoSlugs(pi);
    config = await loadConfig();
    if (config.bridgeToken) await connect();
  });

  pi.on("session_shutdown", async () => {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
    ws = null;
  });
}
