# @arvoretech/pi-slack-agent

Slack Agent nativo que expõe o Pi como um agente de IA no Slack, usando **todas as features do Slack Agents SDK**: streaming em tempo real, thinking steps (task cards), suggested prompts, thread titles e status indicators.

> **Aviso de segurança.** Auto-aprova todas as ações do Pi (bash, edit, write). A barreira é `ALLOWED_USER_IDS`.

## Features

- **Vive no top bar** — habilitado como Agent & AI App, abre em split pane
- **Streaming nativo** — `chat.startStream` / `appendStream` / `stopStream` (sem hack de `chat.update`)
- **Thinking Steps** — cada tool executada pelo Pi aparece como task card com status `in_progress` → `complete`/`error`
- **Suggested Prompts** — botões prontos ao abrir o agent
- **Thread Titles** — auto-nomeadas pela primeira mensagem
- **Status Indicator** — "pensando...", nome da tool em execução
- **Steering** — mande outra mensagem durante execução e ela entra como `steer`
- **Idle Shutdown** — processo Pi encerrado após inatividade, sessão retomada pelo mesmo thread

## Arquitetura

```
Slack Agent (top bar, split pane, mobile)
   │  Socket Mode + Agent APIs
   ▼
pi-slack-agent (host sempre ligado)
   │  1 processo Pi RPC por thread
   ▼
Pi --mode rpc (JSONL)
   │  events → streaming chunks + task cards
   ▼
repos em PI_CWD
```

## Setup do Slack App

1. Crie um app em https://api.slack.com/apps → From scratch
2. **Agents & AI Apps** (sidebar) → Enable
3. **Socket Mode** → Enable → gera App-Level Token `xapp-...` com scope `connections:write`
4. **OAuth & Permissions** → Bot Token Scopes:
   - `assistant:write`
   - `chat:write`
   - `im:history`, `im:read`, `im:write`
5. **Event Subscriptions** → Subscribe to bot events:
   - `assistant_thread_started`
   - `assistant_thread_context_changed`
   - `message.im`
6. **Install App** → copie o Bot Token `xoxb-...`

## Variáveis de Ambiente

| Variável | Obrigatória | Default | Descrição |
|---|---|---|---|
| `SLACK_BOT_TOKEN` | sim | — | Bot token `xoxb-...` |
| `SLACK_APP_TOKEN` | sim | — | App-level token `xapp-...` |
| `ALLOWED_USER_IDS` | sim | — | Slack user IDs (vírgula-separados) |
| `PI_BIN` | não | `pi` | Binário do Pi |
| `PI_CWD` | não | cwd | Diretório de trabalho |
| `PI_MODEL` | não | default Pi | Modelo (`provider/id[:thinking]`) |
| `PI_SESSION_IDLE_MS` | não | `900000` | Idle timeout (ms) |

## Rodando

```bash
cd arvore-pi-extensions
pnpm install
pnpm --filter @arvoretech/pi-slack-agent build

SLACK_BOT_TOKEN=xoxb-... \
SLACK_APP_TOKEN=xapp-... \
ALLOWED_USER_IDS=U0123ABCD \
PI_CWD=/Users/voce/arvore/arvore-hub \
node packages/slack-agent/dist/cli.js
```

### Produção

```bash
pm2 start packages/slack-agent/dist/cli.js --name pi-slack-agent
pm2 save
```

## Como usar

1. Abra o agent no top bar do Slack (ou no app mobile)
2. Use os prompts sugeridos ou digite qualquer coisa
3. Veja as tools sendo executadas em tempo real (task cards)
4. Mande outra mensagem durante execução → steering
5. Cada thread é uma sessão Pi independente
