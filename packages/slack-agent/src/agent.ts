import { App, Assistant, LogLevel } from "@slack/bolt";
import type { ChatStreamer } from "@slack/web-api";
import type { AgentConfig } from "./config.js";
import { SessionManager } from "./session-manager.js";
import type { RpcEvent } from "./rpc-client.js";

export function createAgent(config: AgentConfig) {
  const app = new App({
    token: config.slackBotToken,
    appToken: config.slackAppToken,
    socketMode: true,
    logLevel: LogLevel.DEBUG,
  });

  const sessions = new SessionManager(config);

  const assistant = new Assistant({
    threadStarted: async ({ say, setSuggestedPrompts }) => {
      await say("Oi! No que posso te ajudar?");
      await setSuggestedPrompts({
        prompts: [
          { title: "Listar repos", message: "Quais repositórios tem no diretório atual?" },
          { title: "Status do git", message: "Qual o status do git nos repos com mudanças?" },
          { title: "Rodar testes", message: "Rode os testes do projeto atual e me diga se passam." },
          { title: "Resumo de PRs", message: "Liste as PRs abertas no GitHub para os repos daqui." },
        ],
      });
    },

    userMessage: async ({ message, say, sayStream, setTitle, setStatus, client }) => {
      const msg = message as unknown as Record<string, unknown>;
      const userId = msg.user as string;
      if (!config.allowedUserIds.has(userId)) {
        await say("⛔ Acesso não autorizado.");
        return;
      }

      const threadTs = (msg.thread_ts as string) ?? (msg.ts as string);
      const text = (msg.text as string ?? "").trim();

      if (text === "!session") {
        const session = sessions.get(threadTs, { onEvent: () => {} });
        const state = await session.getState();
        if (state) {
          const sessionFile = state.sessionFile as string | undefined;
          const sessionId = state.sessionId as string | undefined;
          await say(`📎 *Sessão Pi*\n\`\`\`\npi --session ${sessionId ?? sessionFile ?? "(sem sessão)"}\n\`\`\``);
        } else {
          await say("⚠️ Nenhuma sessão ativa nessa thread.");
        }
        return;
      }

      const files = (msg.files as Array<Record<string, unknown>> | undefined) ?? [];

      if (!text && files.length === 0) return;

      const images: Array<{ type: string; data: string; mimeType: string }> = [];
      for (const file of files) {
        const mimetype = file.mimetype as string | undefined;
        if (!mimetype?.startsWith("image/")) continue;
        const url = file.url_private as string | undefined;
        if (!url) continue;
        try {
          const res = await fetch(url, {
            headers: { "Authorization": `Bearer ${config.slackBotToken}` },
          });
          const buffer = Buffer.from(await res.arrayBuffer());
          images.push({ type: "image", data: buffer.toString("base64"), mimeType: mimetype });
        } catch {}
      }

      await setStatus("pensando...");
      await setTitle((text || "imagem").slice(0, 60));

      const streamer = sayStream();
      const taskTitles = new Map<string, string>();
      let taskCounter = 0;
      let textBuffer = "";
      let flushTimer: NodeJS.Timeout | undefined;

      let finished = false;

      async function flushText(): Promise<void> {
        if (!textBuffer || finished) return;
        const chunk = textBuffer;
        textBuffer = "";
        await streamer.append({ chunks: [{ type: "markdown_text", text: chunk }] });
      }

      function scheduleFlush(): void {
        if (flushTimer) return;
        flushTimer = setTimeout(() => {
          flushTimer = undefined;
          flushText().catch(() => {});
        }, 300);
      }

      function handleEvent(event: RpcEvent): void {
        if (finished) return;
        switch (event.type) {
          case "message_update": {
            const delta = event.assistantMessageEvent as Record<string, unknown> | undefined;
            if (delta?.type === "text_delta" && typeof delta.delta === "string") {
              textBuffer += delta.delta;
              scheduleFlush();
            }
            break;
          }
          case "tool_execution_start": {
            const toolName = event.toolName as string;
            const args = event.args as Record<string, unknown> | undefined;
            const toolCallId = event.toolCallId as string;
            const taskId = `task_${++taskCounter}`;
            const title = formatToolTitle(toolName, args);
            taskTitles.set(toolCallId, taskId);

            void setStatus(title);
            void flushText().then(() =>
              streamer.append({
                chunks: [{
                  type: "task_update",
                  id: taskId,
                  title,
                  status: "in_progress",
                }],
              })
            ).catch(() => {});
            break;
          }
          case "tool_execution_end": {
            const toolCallId = event.toolCallId as string;
            const taskId = taskTitles.get(toolCallId);
            if (!taskId) break;
            const isError = event.isError as boolean | undefined;
            const result = event.result as Record<string, unknown> | undefined;
            const content = result?.content as Array<Record<string, unknown>> | undefined;
            const output = content
              ?.filter((c) => c.type === "text")
              .map((c) => String(c.text ?? ""))
              .join("\n")
              .slice(0, 200);

            void streamer.append({
              chunks: [{
                type: "task_update",
                id: taskId,
                title: formatToolTitle(
                  event.toolName as string,
                  event.args as Record<string, unknown> | undefined,
                ),
                status: isError ? "error" : "complete",
                ...(output ? { details: output } : {}),
              }],
            }).catch(() => {});
            break;
          }
          case "agent_end": {
            void finish();
            break;
          }
        }
      }

      async function finish(): Promise<void> {
        if (finished) return;
        finished = true;
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = undefined; }
        const finalChunks: Array<{ type: "markdown_text"; text: string }> = [];
        if (textBuffer) {
          finalChunks.push({ type: "markdown_text", text: textBuffer });
          textBuffer = "";
        }
        if (finalChunks.length > 0) {
          await streamer.stop({ chunks: finalChunks });
        } else {
          await streamer.stop();
        }
        await setStatus("");
      }

      const session = sessions.get(threadTs, {
        onEvent: handleEvent,
        onExit: () => void finish(),
      });

      try {
        await session.submit(text || "O que tem nessa imagem?", images.length > 0 ? images : undefined);
      } catch (error) {
        await streamer.append({
          chunks: [{ type: "markdown_text", text: `❌ Erro: ${(error as Error).message}` }],
        });
        await streamer.stop();
        await setStatus("");
      }
    },
  });

  app.assistant(assistant);

  return { app, sessions };
}

function formatToolTitle(name: string, args: Record<string, unknown> | undefined): string {
  if (!args) return name;
  if (name === "bash" && typeof args.command === "string") {
    return `bash: ${String(args.command).slice(0, 80)}`;
  }
  if ((name === "read" || name === "edit" || name === "write") && typeof args.path === "string") {
    return `${name}: ${String(args.path)}`;
  }
  if (name === "web_search" && typeof args.query === "string") {
    return `search: ${String(args.query).slice(0, 60)}`;
  }
  return name;
}
