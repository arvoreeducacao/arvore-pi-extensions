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
  members?: RawUser[];
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

interface RawUser {
  id: string;
  name?: string;
  real_name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  profile?: { display_name?: string; real_name?: string };
}

const SLACK_API = "https://slack.com/api";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;

export function loadToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const token = (env.SLACK_WATCHER_TOKEN ?? env.SLACK_USER_TOKEN ?? "").trim();
  return token || undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SlackClient {
  private readonly token: string;
  private readonly userCache = new Map<string, string>();

  constructor(token: string) {
    this.token = token;
  }

  private async request(url: URL): Promise<SlackApiResponse> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after") ?? "1");
        if (attempt < MAX_RETRIES) {
          await delay((Number.isFinite(retryAfter) ? retryAfter : 1) * 1000);
          continue;
        }
        throw new Error("slack_rate_limited");
      }
      const data = (await res.json()) as SlackApiResponse;
      if (!data.ok) throw new Error(data.error ?? "slack_api_error");
      return data;
    }
    throw new Error("slack_rate_limited");
  }

  private async call(method: string, params: Record<string, string>): Promise<SlackApiResponse> {
    const url = new URL(`${SLACK_API}/${method}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, value);
    }
    return this.request(url);
  }

  async resolveTarget(target: string): Promise<ResolvedTarget> {
    const trimmed = target.trim();

    const link = this.parseArchivesLink(trimmed);
    if (link) {
      const label = await this.describeChannel(link.channel, link.threadTs);
      return { ...link, label };
    }

    if (trimmed.startsWith("@")) {
      const channel = await this.openDirectMessage(trimmed);
      const label = await this.describeChannel(channel);
      return { channel, label };
    }

    if (trimmed.startsWith("#")) {
      const channel = await this.resolveName(trimmed);
      const label = await this.describeChannel(channel);
      return { channel, label };
    }

    if (/^[CDG][A-Z0-9]{6,}$/.test(trimmed)) {
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
    const clean = name.replace(/^#/, "").toLowerCase();
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
    throw new Error(`Canal "${name}" não encontrado (ou o usuário não tem acesso).`);
  }

  private async openDirectMessage(handle: string): Promise<string> {
    const userId = await this.findUserId(handle.replace(/^@/, ""));
    const data = await this.call("conversations.open", { users: userId });
    const channel = data.channel?.id;
    if (!channel) throw new Error(`Não consegui abrir DM com "${handle}".`);
    return channel;
  }

  private async findUserId(handle: string): Promise<string> {
    const clean = handle.toLowerCase();
    let cursor = "";
    for (let page = 0; page < 40; page++) {
      const data = await this.call("users.list", { limit: "500", cursor });
      const member = data.members?.find((u) => {
        if (u.deleted) return false;
        const candidates = [u.name, u.real_name, u.profile?.display_name, u.profile?.real_name]
          .filter((v): v is string => Boolean(v))
          .map((v) => v.toLowerCase());
        return candidates.includes(clean);
      });
      if (member) return member.id;
      cursor = data.response_metadata?.next_cursor ?? "";
      if (!cursor) break;
    }
    throw new Error(`Usuário "@${handle}" não encontrado.`);
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
      const url = new URL(`${SLACK_API}/auth.test`);
      const data = (await this.request(url)) as SlackApiResponse & { user_id?: string };
      return data.user_id;
    } catch {
      return undefined;
    }
  }

  async fetchNew(target: ResolvedTarget, afterTs: string): Promise<SlackMessage[]> {
    const method = target.threadTs ? "conversations.replies" : "conversations.history";
    const collected: RawMessage[] = [];
    let cursor = "";

    for (let page = 0; page < 10; page++) {
      const params: Record<string, string> = {
        channel: target.channel,
        oldest: afterTs,
        inclusive: "false",
        limit: "100",
        cursor,
      };
      if (target.threadTs) params.ts = target.threadTs;

      const data = await this.call(method, params);
      collected.push(...(data.messages ?? []));
      cursor = data.response_metadata?.next_cursor ?? "";
      if (!cursor) break;
    }

    return collected
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
    if (!target.threadTs) {
      const data = await this.call("conversations.history", { channel: target.channel, limit: "1" });
      const first = data.messages?.[0];
      return first?.ts && Number(first.ts) > 0 ? first.ts : "0";
    }

    let max = target.threadTs;
    let cursor = "";
    for (let page = 0; page < 20; page++) {
      const params: Record<string, string> = {
        channel: target.channel,
        ts: target.threadTs,
        limit: "200",
        cursor,
      };
      const data = await this.call("conversations.replies", params);
      for (const m of data.messages ?? []) {
        if (m.ts && Number(m.ts) > Number(max)) max = m.ts;
      }
      cursor = data.response_metadata?.next_cursor ?? "";
      if (!cursor) break;
    }
    return max;
  }
}
