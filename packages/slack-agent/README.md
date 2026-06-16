# Pi Agent — Slack

Agente de IA no Slack que conecta o [Pi](https://github.com/earendil-works/pi) como agente nativo, com streaming em tempo real, thinking steps e suporte a imagens.

## Setup rápido (5 min)

### 1. Crie o Slack App

1. Vá em https://api.slack.com/apps → **Create New App** → **From a manifest**
2. Selecione o workspace da Árvore
3. Cole o conteúdo de [`manifest.json`](./manifest.json) 
4. Crie o app
5. Em **Socket Mode** → gere um App-Level Token com scope `connections:write` → copie o `xapp-...`
6. Em **Install App** → instale no workspace → copie o Bot Token `xoxb-...`
7. Em **App Home** → ative **Messages Tab** e marque "Allow users to send messages from the chat tab"

### 2. Descubra seu Slack User ID

No Slack: clique no seu perfil → `⋮` → **Copy member ID** (formato `U...`)

### 3. Configure o `.env`

```bash
cd packages/slack-agent
cp .env.example .env
```

Edite o `.env`:
```env
SLACK_BOT_TOKEN=xoxb-seu-token
SLACK_APP_TOKEN=xapp-seu-token
ALLOWED_USER_IDS=seu-user-id
ANTHROPIC_API_KEY=sk-ant-sua-key
WORKSPACE_PATH=/caminho/dos/seus/repos
```

### 4. Rode

**Com Docker (recomendado):**
```bash
docker compose up -d
```

**Sem Docker:**
```bash
pnpm install && pnpm build
node dist/cli.js
```

### 5. Use

Abra o Slack → busque "Pi Agent" nos apps → mande uma mensagem. Cada thread é uma sessão independente.

## Features

| Feature | Descrição |
|---|---|
| Streaming | Respostas aparecem em tempo real |
| Thinking Steps | Cada tool executada aparece como task card com status |
| Imagens | Cole screenshots/figmas e o Pi analisa |
| Steering | Mande outra mensagem durante execução para corrigir o rumo |
| Suggested Prompts | Botões prontos ao abrir o agent |
| Thread = Sessão | Cada thread é uma sessão Pi persistente |

## Comandos úteis

```bash
# Ver logs
docker logs -f slack-agent-pi-slack-agent-1

# Parar
docker compose down

# Rebuild após mudanças
docker compose up -d --build
```

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `SLACK_BOT_TOKEN` | sim | Bot token `xoxb-...` |
| `SLACK_APP_TOKEN` | sim | App-level token `xapp-...` |
| `ALLOWED_USER_IDS` | sim | Seu Slack user ID (vírgula-separados se >1) |
| `ANTHROPIC_API_KEY` | sim | API key do Anthropic (para o Pi usar Claude) |
| `WORKSPACE_PATH` | sim | Caminho dos repos na sua máquina |
| `PI_MODEL` | não | Modelo (default: Pi decide) |

## Segurança

- O agent tem acesso **total** aos repos montados (leitura + escrita + bash)
- Só user IDs na allowlist podem usar
- Rode apenas na sua própria máquina
