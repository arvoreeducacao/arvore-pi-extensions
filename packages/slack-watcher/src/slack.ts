export interface SlackMessage {
  ts: string;
  userId: string;
  text: string;
  threadTs?: string;
  botId?: string;
  username?: string;
}

export interface ResolvedTarget {
  channel: string;
  threadTs?: string;
  label: string;
}

interface SlackApiResponse {
  ok: boolean;
  error?: string;
  messages?: RawMessage[];
  channel?: { id?: string; name?: string; is_im?: boolean; user?: string };
  user?: { id?: string; name?: string; real_name?: string; profile?: { display_name?: string } };
  channels?: { id: string; name: string }[];
  response_metadata?: { next_cursor?: string };
}

interface RawMessage {
  ts?: string;
  user?: string;
  text?: string;
  thread_ts?: string;
  bot_id?: string;
  username?: string;
  subtype?: string;
}

const SLACK_API = "https://slack.com/api";

export function loadToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const token = (env.SLACK_WATCHER_TOKEN ?? env.SLACK_USER_TOKEN ?? "").trim();
  return token || undefined;
}

export class SlackClient {
  private readonly token: string;
  private readonly userCache = new Map<string, string>();

  constructor(token: string) {
    this.token = token;
  }

  private async call(method: string, params: Record<string, string>): Promise<SlackApiResponse> {
    const url = new URL(`${SLACK_API}/${method}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, value);
    }
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    const data = (await res.json()) as SlackApiResponse;
    if (!data.ok) throw new Error(data.error ?? "slack_api_error");
    return data;
  }

  async resolveTarget(target: string): Promise<ResolvedTarget> {
    const trimmed = target.trim();

    const link = this.parseArchivesLink(trimmed);
    if (link) {
      const label = await this.describeChannel(link.channel, link.threadTs);
      return { ...link, label };
    }

    if (trimmed.startsWith("#") || trimmed.startsWith("@")) {
      const channel = await this.resolveName(trimmed);
      const label = await this.describeChannel(channel);
      return { channel, label };
    }

    if (/^[CDGW][A-Z0-9]{6,}$/.test(trimmed)) {
      const label = await this.describeChannel(trimmed);
      return { channel: trimmed, label };
    }

    throw new Error(
      `Alvo não reconhecido: "${target}". Use um link de mensagem do Slack, #canal, @usuario, ou um ID (C…/D…/G…).`,
    );
  }

  private parseArchivesLink(value: string): { channel: string; threadTs?: string } | undefined {
    const match = value.match(/archives\/([A-Z0-9]+)\/p(\d+)/);
    if (!match) return undefined;
    const channel = match[1];
    const raw = match[2];
    const ts = `${raw.slice(0, raw.length - 6)}.${raw.slice(raw.length - 6)}`;
    const url = new URL(value.startsWith("http") ? value : `https://x.slack.com/${value}`);
    const threadParam = url.searchParams.get("thread_ts");
    if (threadParam) return { channel, threadTs: threadParam };
    return { channel, threadTs: ts };
  }

  private async resolveName(name: string): Promise<string> {
    const clean = name.replace(/^[#@]/, "").toLowerCase();
    let cursor = "";
    for (let page = 0; page < 20; page++) {
      const data = await this.call("conversations.list", {
        types: "public_channel,private_channel",
        limit: "1000",
        exclude_archived: "true",
        cursor,
      });
      const found = data.channels?.find((c) => c.name.toLowerCase() === clean);
      if (found) return found.id;
      cursor = data.response_metadata?.next_cursor ?? "";
      if (!cursor) break;
    }
    throw new Error(`Canal "${name}" não encontrado (ou o bot/usuário não tem acesso).`);
  }

  private async describeChannel(channel: string, threadTs?: string): Promise<string> {
    try {
      const data = await this.call("conversations.info", { channel });
      const info = data.channel;
      let base: string;
      if (info?.is_im && info.user) {
        base = `DM com ${await this.resolveUserName(info.user)}`;
      } else if (info?.name) {
        base = `#${info.name}`;
      } else {
        base = channel;
      }
      return threadTs ? `${base} (thread)` : base;
    } catch {
      return threadTs ? `${channel} (thread)` : channel;
    }
  }

  async resolveUserName(userId: string): Promise<string> {
    const cached = this.userCache.get(userId);
    if (cached) return cached;
    try {
      const data = await this.call("users.info", { user: userId });
      const u = data.user;
      const name = u?.profile?.display_name || u?.real_name || u?.name || userId;
      this.userCache.set(userId, name);
      return name;
    } catch {
      return userId;
    }
  }

  async authUserId(): Promise<string | undefined> {
    try {
      const res = await fetch(`${SLACK_API}/auth.test`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      const data = (await res.json()) as { ok: boolean; user_id?: string };
      return data.ok ? data.user_id : undefined;
    } catch {
      return undefined;
    }
  }

  async fetchNew(target: ResolvedTarget, afterTs: string): Promise<SlackMessage[]> {
    const params: Record<string, string> = {
      channel: target.channel,
      oldest: afterTs,
      inclusive: "false",
      limit: "50",
    };
    const method = target.threadTs ? "conversations.replies" : "conversations.history";
    if (target.threadTs) params.ts = target.threadTs;

    const data = await this.call(method, params);
    const raw = data.messages ?? [];
    return raw
      .filter((m) => m.ts && !m.subtype)
      .map((m) => ({
        ts: m.ts as string,
        userId: m.user ?? "",
        text: m.text ?? "",
        threadTs: m.thread_ts,
        botId: m.bot_id,
        username: m.username,
      }))
      .filter((m) => Number(m.ts) > Number(afterTs))
      .sort((a, b) => Number(a.ts) - Number(b.ts));
  }

  async latestTs(target: ResolvedTarget): Promise<string> {
    const params: Record<string, string> = { channel: target.channel, limit: "1" };
    const method = target.threadTs ? "conversations.replies" : "conversations.history";
    if (target.threadTs) params.ts = target.threadTs;
    const data = await this.call(method, params);
    const messages = data.messages ?? [];
    let max = target.threadTs ?? "0";
    for (const m of messages) {
      if (m.ts && Number(m.ts) > Number(max)) max = m.ts;
    }
    return max;
  }
}
