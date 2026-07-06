import { SlackClient, type ResolvedTarget, type SlackMessage } from "./slack.js";

export interface WatchFilter {
  keywords?: string[];
  mentionsOnly?: boolean;
  questionsOnly?: boolean;
}

export interface WatchConfig {
  id: string;
  target: string;
  filter?: WatchFilter;
  pollIntervalMs: number;
}

export interface InboundEvent {
  watchId: string;
  label: string;
  author: string;
  text: string;
  ts: string;
  channel: string;
  threadTs?: string;
  permalink?: string;
}

export interface WatchInfo {
  id: string;
  target: string;
  label: string;
  channel: string;
  threadTs?: string;
  startedAt: number;
  delivered: number;
  seen: number;
  filter?: WatchFilter;
}

type EventHandler = (event: InboundEvent) => void;

interface ActiveWatch {
  config: WatchConfig;
  resolved: ResolvedTarget;
  lastTs: string;
  timer: NodeJS.Timeout;
  startedAt: number;
  delivered: number;
  seen: number;
  polling: boolean;
}

const watches = new Map<string, ActiveWatch>();
let client: SlackClient | undefined;
let selfUserId: string | undefined;

export function initClient(token: string): SlackClient {
  if (!client) client = new SlackClient(token);
  return client;
}

export async function startWatch(
  config: WatchConfig,
  onEvent: EventHandler,
): Promise<WatchInfo> {
  if (!client) throw new Error("Slack client não inicializado (token ausente).");
  if (watches.has(config.id)) {
    throw new Error(`Já existe um watch com id "${config.id}". Pare-o antes ou use outro id.`);
  }

  const resolved = await client.resolveTarget(config.target);
  if (selfUserId === undefined) selfUserId = (await client.authUserId()) ?? "";

  const lastTs = await client.latestTs(resolved);

  const active: ActiveWatch = {
    config,
    resolved,
    lastTs,
    startedAt: Date.now(),
    delivered: 0,
    seen: 0,
    polling: false,
    timer: undefined as unknown as NodeJS.Timeout,
  };

  const poll = async () => {
    if (active.polling) return;
    active.polling = true;
    try {
      const messages = await client!.fetchNew(active.resolved, active.lastTs);
      for (const msg of messages) {
        active.lastTs = msg.ts;
        active.seen++;
        if (msg.botId) continue;
        if (selfUserId && msg.userId === selfUserId) continue;
        if (!passesFilter(msg, config.filter)) continue;
        const author = msg.userId
          ? await client!.resolveUserName(msg.userId)
          : (msg.username ?? "desconhecido");
        active.delivered++;
        onEvent({
          watchId: config.id,
          label: resolved.label,
          author,
          text: msg.text,
          ts: msg.ts,
          channel: resolved.channel,
          threadTs: msg.threadTs ?? resolved.threadTs,
        });
      }
    } catch {
      // erros transitórios de rede/rate-limit: ignora e tenta no próximo ciclo
    } finally {
      active.polling = false;
    }
  };

  active.timer = setInterval(poll, config.pollIntervalMs);
  watches.set(config.id, active);
  return toInfo(active);
}

function passesFilter(msg: SlackMessage, filter?: WatchFilter): boolean {
  if (!filter) return true;
  const text = msg.text.toLowerCase();
  if (filter.mentionsOnly && !/<@[A-Z0-9]+>/.test(msg.text)) return false;
  if (filter.questionsOnly && !text.includes("?")) return false;
  if (filter.keywords && filter.keywords.length > 0) {
    const hit = filter.keywords.some((kw) => text.includes(kw.toLowerCase()));
    if (!hit) return false;
  }
  return true;
}

export function stopWatch(id: string): boolean {
  const active = watches.get(id);
  if (!active) return false;
  clearInterval(active.timer);
  watches.delete(id);
  return true;
}

export function stopAllWatches(): number {
  const count = watches.size;
  for (const active of watches.values()) clearInterval(active.timer);
  watches.clear();
  return count;
}

export function listWatches(): WatchInfo[] {
  return Array.from(watches.values()).map(toInfo);
}

function toInfo(active: ActiveWatch): WatchInfo {
  return {
    id: active.config.id,
    target: active.config.target,
    label: active.resolved.label,
    channel: active.resolved.channel,
    threadTs: active.resolved.threadTs,
    startedAt: active.startedAt,
    delivered: active.delivered,
    seen: active.seen,
    filter: active.config.filter,
  };
}
