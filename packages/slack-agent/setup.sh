#!/bin/bash
set -e

echo "🤖 Pi Slack Agent — Setup"
echo ""

if [ -f .env ]; then
  echo "⚠️  .env já existe. Quer sobrescrever? (y/N)"
  read -r overwrite
  if [ "$overwrite" != "y" ]; then
    echo "Abortado."
    exit 0
  fi
fi

echo "1. Crie um Slack App: https://api.slack.com/apps → Create New App → From a manifest"
echo "   Cole o conteúdo de manifest.json quando pedir o manifest."
echo ""

read -rp "Bot Token (xoxb-...): " BOT_TOKEN
read -rp "App-Level Token (xapp-...): " APP_TOKEN
read -rp "Seu Slack User ID (U...): " USER_ID
read -rp "Anthropic API Key (sk-ant-...): " API_KEY
read -rp "Caminho dos repos [$(pwd)]: " WORKSPACE
WORKSPACE=${WORKSPACE:-$(pwd)}

cat > .env << EOF
SLACK_BOT_TOKEN=$BOT_TOKEN
SLACK_APP_TOKEN=$APP_TOKEN
ALLOWED_USER_IDS=$USER_ID
ANTHROPIC_API_KEY=$API_KEY
WORKSPACE_PATH=$WORKSPACE
EOF

echo ""
echo "✅ .env criado!"
echo ""
echo "Para rodar:"
echo "  docker compose up -d"
echo ""
echo "Ou sem Docker:"
echo "  pnpm install && pnpm build && node dist/cli.js"
