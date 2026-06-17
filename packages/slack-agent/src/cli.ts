#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { createAgent } from "./agent.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { app, sessions } = createAgent(config);

  const shutdown = async (signal: string): Promise<void> => {
    process.stderr.write(`\n${signal} received, shutting down...\n`);
    sessions.disposeAll();
    try { await app.stop(); } catch {}
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.start();
  process.stderr.write(
    `pi-slack-agent running. cwd=${config.piCwd} allowed=${config.allowedUserIds.size} user(s)\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`Fatal: ${(error as Error).message}\n`);
  process.exit(1);
});
