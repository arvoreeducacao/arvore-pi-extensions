export interface SlackBridgeConfig {
  botToken: string;
  appToken: string;
  channel: string;
  allowedUserIds: Set<string>;
}

export interface ConfigResult {
  config?: SlackBridgeConfig;
  missing: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ConfigResult {
  const botToken = (env.SLACK_BRIDGE_BOT_TOKEN ?? env.SLACK_BOT_TOKEN ?? "").trim();
  const appToken = (env.SLACK_BRIDGE_APP_TOKEN ?? env.SLACK_APP_TOKEN ?? "").trim();
  const channel = (env.SLACK_BRIDGE_CHANNEL ?? "").trim();

  const missing: string[] = [];
  if (!botToken) missing.push("SLACK_BRIDGE_BOT_TOKEN");
  if (!appToken) missing.push("SLACK_BRIDGE_APP_TOKEN");
  if (!channel) missing.push("SLACK_BRIDGE_CHANNEL");

  if (missing.length > 0) return { missing };

  const allowedUserIds = new Set(
    (env.SLACK_BRIDGE_USER_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );

  return {
    missing: [],
    config: { botToken, appToken, channel, allowedUserIds },
  };
}
