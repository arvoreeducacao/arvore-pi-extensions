# Slack Bridge

Extensão do Pi que conecta a sua sessão Pi do terminal a uma thread no Slack, espelhando mensagens nos dois sentidos. **Cada sessão Pi vira uma thread no Slack.**

- O que você digita no terminal aparece na thread.
- A resposta do agente aparece na thread.
- O que você responder na thread é injetado de volta na sessão Pi (via `sendUserMessage`).

A extensão roda **dentro** da sua sessão Pi (o terminal é o host). Não é um bot standalone.

## Como funciona

| Sentido | Gatilho | Ação |
|---|---|---|
| Pi → Slack | `input` (terminal) | posta a mensagem do usuário na thread (convertida para mrkdwn do Slack) |
| Pi → Slack | `turn_start` | atualiza o status nativo da thread (`assistant.threads.setStatus`) |
| Pi → Slack | `tool_execution_start` | posta cada chamada de tool como uma linha na thread (ex: `:computer: \`bash\` pnpm test`) e atualiza o status |
| Pi → Slack | `tool_execution_start` (tool de pergunta) | detecta `ask_user_question`/`questionnaire` e posta o enunciado com as opções numeradas na thread |
| Pi → Slack | `turn_end` | posta a resposta final na thread (convertida para mrkdwn) e limpa o status |
| Slack → Pi | mensagem na thread vinculada | `pi.sendUserMessage()` (steer se ocupado, normal se ocioso). Se havia pergunta pendente, o número escolhido é resolvido para o rótulo da opção |

### Quem inicia a thread

A vinculação sessão ↔ thread funciona nos dois sentidos:

- **Sessão inicia:** você digita no terminal → a extensão cria a thread no Slack (mensagem raiz no canal) e passa a espelhar nela.
- **Slack inicia:** você abre uma conversa nova com o app no Slack e manda uma mensagem → a sessão Pi aberta (que ainda não tem thread vinculada) **adota** essa thread e injeta a mensagem.

O que vier primeiro define a thread. A partir daí o vínculo é fixo: só mensagens daquela thread chegam na sessão, e as respostas vão só para ela. O `thread_ts` é persistido via `appendEntry`, então sobrevive a `/reload`.

### Status nativo (animação)

Durante um turno a extensão usa o status nativo de Assistant do Slack (`assistant.threads.setStatus`) — a animação "is typing…" com o passo atual (ex: `:wrench: bash: pnpm test`). Ao postar a resposta final, o status é limpo. Requer um app com scope `assistant:write`.

### Markdown

Toda mensagem do agente e do terminal passa por [`slackify-markdown`](https://www.npmjs.com/package/slackify-markdown) antes de ser postada, convertendo Markdown/GFM (headings, `**negrito**`, listas, links `[texto](url)`, blocos de código) para o mrkdwn do Slack (`*negrito*`, `<url|texto>`, `•`). Prefixos decorativos da própria bridge (ex: `:bust_in_silhouette: *terminal*`) já são mrkdwn e não são convertidos.

### Tool calls e perguntas

- Cada chamada de tool vira uma linha na thread com emoji + nome + um resumo do argumento principal, além de atualizar o status nativo.
- Quando o agente chama uma tool de pergunta (`ask_user_question` ou `questionnaire`), a bridge posta o enunciado com as opções numeradas e fica aguardando. Você responde pela thread com o número (`1`) ou texto livre; para uma única pergunta o número é resolvido para o rótulo da opção antes de voltar ao agente. Perguntas com múltiplos itens mandam o texto cru (ex: `1.2`) para o agente interpretar.

## Setup

### 1. Slack App (Socket Mode + Assistant)

A forma mais rápida é usar o manifest pronto: [`slack-app-manifest.yaml`](./slack-app-manifest.yaml).

1. https://api.slack.com/apps → **Create New App** → **From an app manifest**
2. Escolha o workspace → cole o conteúdo de `slack-app-manifest.yaml` (aba YAML) → **Create**
3. **Basic Information** → **App-Level Tokens** → **Generate Token and Scopes** → scope `connections:write` → copie o `xapp-...` (este é o `SLACK_BRIDGE_APP_TOKEN`)
4. **Install App** → instale no workspace → em **OAuth & Permissions** copie o **Bot User OAuth Token** `xoxb-...` (este é o `SLACK_BRIDGE_BOT_TOKEN`)
5. Abra uma conversa (DM) com o app no Slack. Pegue o ID do canal (`D...`) — abra a DM, clique no nome do app no topo → o ID aparece no rodapé do painel de detalhes. Esse é o `SLACK_BRIDGE_CHANNEL`. Para usar um canal em vez de DM, convide o bot (`/invite @Pi Bridge`) e use o ID do canal (`C...`).

O manifest já habilita: Socket Mode, o modo Assistant (necessário para receber mensagens da DM via `message.im` + `assistant_thread_started`) e os scopes `chat:write`, `assistant:write`, `im:*`, `channels:history`, `groups:history`.

> Nota: num app Assistant, toda mensagem do usuário na DM chega já com `thread_ts` (a thread do assistant). Não há "mensagem de topo" sem thread — a extensão adota a thread pelo `thread_ts` da primeira mensagem.

### 2. Variáveis de ambiente

```env
SLACK_BRIDGE_BOT_TOKEN=xoxb-...
SLACK_BRIDGE_APP_TOKEN=xapp-...
SLACK_BRIDGE_CHANNEL=C0123456789
SLACK_BRIDGE_USER_IDS=U0123456789
```

| Variável | Obrigatória | Descrição |
|---|---|---|
| `SLACK_BRIDGE_BOT_TOKEN` | sim | Bot token `xoxb-...` (aceita `SLACK_BOT_TOKEN` como fallback) |
| `SLACK_BRIDGE_APP_TOKEN` | sim | App-level token `xapp-...` (aceita `SLACK_APP_TOKEN` como fallback) |
| `SLACK_BRIDGE_CHANNEL` | sim | ID do canal/DM onde as threads serão criadas (DM começa com `D`) |
| `SLACK_BRIDGE_USER_IDS` | não | Allowlist de user IDs que podem mandar do Slack (vazio = qualquer um). Ignorada em DMs. |

Sem as 3 obrigatórias a extensão fica inativa silenciosamente.

## Uso

Abra uma sessão Pi normalmente. A bridge conecta no `session_start`. A thread é criada quando a sessão fala primeiro (você digita no terminal) **ou** quando você inicia a conversa pelo Slack — o que vier primeiro. Rode `/slack-bridge` para ver o status.

## Comandos

| Comando | Descrição |
|---|---|
| `/slack-bridge` | Mostra o status da ponte (ativa / inativa / variáveis faltando) |
