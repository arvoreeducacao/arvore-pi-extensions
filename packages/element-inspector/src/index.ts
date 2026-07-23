import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { WebSocketServer, type WebSocket } from "ws";
import { basename } from "node:path";

interface ElementData {
  tag: string;
  id?: string;
  classes?: string[];
  text?: string;
  component?: string;
  filePath?: string;
  line?: number;
  props?: Record<string, unknown>;
  computedStyles?: Record<string, string>;
  boundingBox?: { width: number; height: number };
}

interface SessionState {
  lastActivityAt: number;
  taskPreview: string;
}

const PREVIEW_MAX_LENGTH = 40;

function toPreview(text: string): string {
  const firstLine = text.split("\n")[0].trim();
  if (firstLine.length <= PREVIEW_MAX_LENGTH) return firstLine;
  return firstLine.slice(0, PREVIEW_MAX_LENGTH).trimEnd() + "…";
}

const PORT_RANGE_START = 9876;
const PORT_RANGE_END = 9880;

function formatElement(data: ElementData): string {
  const lines: string[] = [];

  let selector = data.tag;
  if (data.id) selector += `#${data.id}`;
  if (data.classes?.length) selector += `.${data.classes.slice(0, 5).join(".")}`;

  if (data.component) {
    lines.push(`<${data.component}> (${selector})`);
  } else {
    lines.push(selector);
  }

  if (data.filePath) {
    lines.push(data.line ? `${data.filePath}:${data.line}` : data.filePath);
  }

  if (data.text) {
    const truncated = data.text.length > 60 ? data.text.slice(0, 60) + "..." : data.text;
    lines.push(`text: "${truncated}"`);
  }

  if (data.boundingBox) {
    lines.push(`${data.boundingBox.width} x ${data.boundingBox.height}px`);
  }

  if (data.props && Object.keys(data.props).length > 0) {
    const propsStr = Object.entries(data.props)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(" ");
    lines.push(`props: ${propsStr}`);
  }

  if (data.computedStyles && Object.keys(data.computedStyles).length > 0) {
    const stylesStr = Object.entries(data.computedStyles)
      .map(([k, v]) => `${k}: ${v}`)
      .join("; ");
    lines.push(`styles: ${stylesStr}`);
  }

  return lines.join("\n");
}

function sessionLabel(pi: ExtensionAPI): string {
  return pi.getSessionName() || basename(process.cwd());
}

function handshakeMessage(pi: ExtensionAPI, port: number | null, state: SessionState): string {
  return JSON.stringify({
    type: "session",
    name: sessionLabel(pi),
    cwd: process.cwd(),
    port,
    lastActivityAt: state.lastActivityAt,
    taskPreview: state.taskPreview,
  });
}

function broadcast(clients: Set<WebSocket>, payload: string): void {
  for (const client of clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

export default function (pi: ExtensionAPI) {
  let wss: WebSocketServer | null = null;
  const clients: Set<WebSocket> = new Set();
  let boundPort: number | null = null;
  const state: SessionState = { lastActivityAt: Date.now(), taskPreview: "" };

  pi.on("session_start", async (_event, ctx) => {
    if (wss) return;

    for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
      try {
        wss = await startServer(port, pi, ctx, clients, state);
        boundPort = port;
        break;
      } catch {}
    }

    if (!wss) {
      ctx.ui.notify("Element Inspector: no available port", "warning");
    }
  });

  pi.on("input", (event) => {
    if (event.text?.trim()) {
      state.taskPreview = toPreview(event.text);
      state.lastActivityAt = Date.now();
      broadcast(clients, handshakeMessage(pi, boundPort, state));
    }
  });

  pi.on("turn_start", (event) => {
    state.lastActivityAt = event.timestamp ?? Date.now();
    broadcast(clients, handshakeMessage(pi, boundPort, state));
  });

  pi.on("session_info_changed", () => {
    broadcast(clients, handshakeMessage(pi, boundPort, state));
  });

  pi.on("session_shutdown", async () => {
    for (const client of clients) client.close();
    clients.clear();
    wss?.close();
    wss = null;
    boundPort = null;
  });
}

function startServer(
  port: number,
  pi: ExtensionAPI,
  ctx: any,
  clients: Set<WebSocket>,
  state: SessionState,
): Promise<WebSocketServer> {
  return new Promise((resolve, reject) => {
    const server = new WebSocketServer({ port, host: "127.0.0.1" });

    server.on("listening", () => {
      server.on("connection", (ws) => {
        clients.add(ws);

        ws.send(handshakeMessage(pi, port, state));

        ws.on("close", () => clients.delete(ws));

        ws.on("message", (raw) => {
          try {
            const msg = JSON.parse(raw.toString());

            if (msg.type === "inspect") {
              const parts: string[] = [];

              if (msg.prompt) {
                parts.push(msg.prompt);
                parts.push("");
              }

              const elements: ElementData[] = msg.elements || [];
              for (const data of elements) {
                parts.push(formatElement(data));
                parts.push("");
              }

              ctx.ui.pasteToEditor(parts.join("\n"));
              ctx.ui.notify(`${elements.length} element(s) received`, "info");
            } else {
              const formatted = formatElement(msg as ElementData);
              ctx.ui.pasteToEditor(formatted + "\n\n");
            }
          } catch {}
        });
      });

      resolve(server);
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") reject(err);
      else reject(err);
    });
  });
}
