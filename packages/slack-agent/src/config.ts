export interface AgentConfig {
  slackBotToken: string;
  slackAppToken: string;
  allowedUserIds: Set<string>;
  piBin: string;
  piCwd: string;
  piModel?: string;
  sessionIdleMs: number;
}

export function loadConfig(): AgentConfig {
  const botToken = process.env.SLACK_BOT_TOKEN;
  const appToken = process.env.SLACK_APP_TOKEN;
  if (!botToken || !appToken) {
    throw new Error("SLACK_BOT_TOKEN and SLACK_APP_TOKEN are required.");
  }

  const ids = (process.env.ALLOWED_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (ids.length === 0) {
    throw new Error("ALLOWED_USER_IDS must list at least one Slack user ID.");
  }

  return {
    slackBotToken: botToken,
    slackAppToken: appToken,
    allowedUserIds: new Set(ids),
    piBin: process.env.PI_BIN ?? "pi",
    piCwd: process.env.PI_CWD ?? process.cwd(),
    piModel: process.env.PI_MODEL,
    sessionIdleMs: Number(process.env.PI_SESSION_IDLE_MS ?? 15 * 60 * 1000),
  };
}
