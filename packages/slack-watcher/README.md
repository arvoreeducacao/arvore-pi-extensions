# Slack Watcher

Extensão do Pi que deixa **o modelo observar** uma thread, canal ou DM do Slack. A extensão faz polling do Slack e **empurra cada mensagem nova pro agente conforme ela chega** — igual ao `pi monitor`, mas a fonte é o Slack. O modelo então julga se aquilo requer ação.

- O modelo chama `slack_watch(target)` no meio da conversa quando fizer sentido.
- A cada mensagem nova daquele alvo, a extensão injeta a mensagem na sessão (via `sendUserMessage` em modo `steer`) com um enquadramento de observador.
- O modelo decide: **agir** (responder/reagir usando o MCP `slack-advanced`) ou **ignorar em silêncio**.

Não é um bot standalone: roda **dentro** da sua sessão Pi. Os watches são *session-scoped* — param quando a sessão fecha ou no `/reload`.

## Como funciona

| Passo | Mecanismo |
|---|---|
| Ligar | o modelo chama a tool `slack_watch({ target, ... })` |
| Observar | `setInterval` faz poll de `conversations.history` (canal/DM) ou `conversations.replies` (thread), guardando o último `ts` e deduplicando |
| Filtrar (opcional) | pré-filtro barato na extensão: `keywords`, `mentionsOnly`, `questionsOnly` |
| Empurrar | mensagem nova → `sendUserMessage(..., { deliverAs: "steer" })` com framing "julgue se requer ação" |
| Agir | o modelo usa o MCP `slack-advanced` (`send_channel_message`, `add_reaction`, …) |

Mensagens do próprio usuário do token e de bots são ignoradas (sem eco/loop).

## Por que polling com user token (e não Socket Mode)

O `slack-bridge` usa Socket Mode + bot token — um bot só vê canais onde foi convidado e **não vê suas DMs**. O watcher usa um **user token** com escopos `*:history`, então enxerga **tudo que você enxerga**: threads, canais privados e DMs, sem convidar bot nenhum. É o que casa com "thread, canal ou DM".

## Setup

### Variável de ambiente

```env
SLACK_WATCHER_TOKEN=xoxp-...
```

| Variável | Obrigatória | Descrição |
|---|---|---|
| `SLACK_WATCHER_TOKEN` | sim | User token `xoxp-…` (aceita `SLACK_USER_TOKEN` como fallback) |

Escopos necessários no token: `channels:history`, `groups:history`, `im:history`, `mpim:history`, `channels:read`, `groups:read`, `users:read`. Sem o token a extensão fica inativa silenciosamente (as tools retornam aviso).

## Tools (chamadas pelo modelo)

| Tool | Descrição |
|---|---|
| `slack_watch({ target, id?, keywords?, mentionsOnly?, questionsOnly?, pollIntervalMs? })` | começa a observar. `target` = link de mensagem/thread, `#canal`, `@usuario` (DM) ou ID (`C…`/`D…`/`G…`) |
| `slack_unwatch({ id? , all? })` | para um watch (ou todos) |
| `slack_watch_list()` | lista watches ativos com uptime e contadores |

## Comandos

| Comando | Descrição |
|---|---|
| `/slack-watch` | mostra os watches ativos nesta sessão |

## Exemplo de uso

> **você:** fica de olho no #eng-prs e me avisa se alguém reportar um deploy quebrado
>
> **modelo:** *(chama `slack_watch({ target: "#eng-prs", keywords: ["deploy", "quebr", "erro", "prod"] })`)* Observando #eng-prs. Vou te avisar se algo relevante aparecer.
>
> *(mensagem nova é empurrada; o modelo julga e, se relevante, responde na thread via `slack-advanced`)*
