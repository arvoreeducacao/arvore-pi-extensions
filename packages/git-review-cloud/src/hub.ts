import type { WebSocket } from "ws";
import type { SessionClaims } from "./session.js";

export interface BridgeSession {
  sessionId: string;
  sessionName: string;
  repos: string[];
  socket: WebSocket;
}

interface UserPeers {
  bridges: Map<string, BridgeSession>;
  browsers: Set<WebSocket>;
}

const peers = new Map<string, UserPeers>();

function peersFor(userId: string): UserPeers {
  let entry = peers.get(userId);
  if (!entry) {
    entry = { bridges: new Map(), browsers: new Set() };
    peers.set(userId, entry);
  }
  return entry;
}

function cleanup(userId: string): void {
  const entry = peers.get(userId);
  if (entry && entry.bridges.size === 0 && entry.browsers.size === 0) {
    peers.delete(userId);
  }
}

export function sessionsFor(userId: string): Array<{ sessionId: string; sessionName: string; repos: string[] }> {
  const entry = peers.get(userId);
  if (!entry) return [];
  return [...entry.bridges.values()].map((b) => ({
    sessionId: b.sessionId,
    sessionName: b.sessionName,
    repos: b.repos,
  }));
}

function broadcastSessions(userId: string): void {
  const entry = peers.get(userId);
  if (!entry) return;
  const payload = JSON.stringify({ type: "sessions", sessions: sessionsFor(userId) });
  for (const ws of entry.browsers) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}

function routeReview(
  userId: string,
  sessionId: string | undefined,
  payload: Record<string, unknown>,
): number {
  const entry = peers.get(userId);
  if (!entry) return 0;
  const targets = sessionId
    ? [entry.bridges.get(sessionId)].filter((b): b is BridgeSession => Boolean(b))
    : [...entry.bridges.values()];
  const message = JSON.stringify({ type: "review", payload });
  let delivered = 0;
  for (const bridge of targets) {
    if (bridge.socket.readyState === bridge.socket.OPEN) {
      bridge.socket.send(message);
      delivered += 1;
    }
  }
  return delivered;
}

const REVIEW_TYPES = new Set(["comment", "comment_thread", "comment_batch", "pr_context"]);

export function attachBridge(socket: WebSocket, claims: SessionClaims): void {
  const userId = claims.sub;
  const entry = peersFor(userId);

  socket.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as {
        type?: string;
        sessionId?: string;
        sessionName?: string;
        repos?: string[];
      };
      if (msg.type === "register" && msg.sessionId) {
        entry.bridges.set(msg.sessionId, {
          sessionId: msg.sessionId,
          sessionName: msg.sessionName || "pi",
          repos: Array.isArray(msg.repos) ? msg.repos : [],
          socket,
        });
        broadcastSessions(userId);
      }
    } catch {}
  });

  socket.on("close", () => {
    for (const [id, bridge] of entry.bridges) {
      if (bridge.socket === socket) entry.bridges.delete(id);
    }
    broadcastSessions(userId);
    cleanup(userId);
  });

  socket.send(JSON.stringify({ type: "hello", login: claims.login }));
}

export function attachBrowser(socket: WebSocket, claims: SessionClaims): void {
  const userId = claims.sub;
  const entry = peersFor(userId);
  entry.browsers.add(socket);

  socket.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as Record<string, unknown> & {
        type?: string;
        sessionId?: string;
      };
      if (msg.type && REVIEW_TYPES.has(msg.type)) {
        const sessionId = typeof msg.sessionId === "string" ? msg.sessionId : undefined;
        const delivered = routeReview(userId, sessionId, msg);
        socket.send(JSON.stringify({ type: "ack", delivered }));
      }
    } catch {}
  });

  socket.on("close", () => {
    entry.browsers.delete(socket);
    cleanup(userId);
  });

  socket.send(JSON.stringify({ type: "sessions", sessions: sessionsFor(userId) }));
}
