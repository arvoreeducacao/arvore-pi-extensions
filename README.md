# Arvore PI Extensions

Monorepo for custom PI extensions used across Arvore projects.

## Extensions

| Package | Description |
|---------|-------------|
| `@arvoretech/pi-bee-context` | Injects personal facts from the Bee wearable assistant into the system prompt |
| `@arvoretech/pi-changes-tracker` | Shows changed repos and files with `/changed` and `/changes` commands |
| `@arvoretech/pi-ci-watch` | Monitors CI status, auto-fixes failures, and notifies on completion |
| `@arvoretech/pi-git-review-bridge` | Local bridge for `git-review-cloud`: connects a pi session to the cloud PR reviewer over WebSocket and injects browser comments |
| `@arvoretech/pi-element-inspector` | Receives inspected browser elements and pastes them into the editor |
| `@arvoretech/pi-elevenlabs-stt` | Push-to-talk speech-to-text using ElevenLabs Scribe API |
| `@arvoretech/pi-kiro-provider` | Provider for the Kiro API (AWS CodeWhisperer/Q) with multi-provider OAuth (Builder ID, Google, GitHub) |
| `@arvoretech/pi-kokoro-tts` | Speaks assistant responses using Kokoro-FastAPI TTS |
| `@arvoretech/pi-open-editor` | Opens files in the user's $EDITOR (tmux pane, GUI, or new terminal) |
| `@arvoretech/pi-plan-mode` | Cursor-style plan mode with read-only exploration and manual /build approval |
| `@arvoretech/pi-team-memory` | Team memory with proactive capture hooks |
| `@arvoretech/pi-memory` | Cloud-based memory with RAG (Qdrant + GitHub OAuth) |
| `@arvoretech/pi-monitor` | Watches a background process and pushes matching output lines to the agent as notifications (no polling) |
| `@arvoretech/pi-recap` | Drafts a one-line recap of where you left off — on demand with `/recap` and automatically when you return to an idle session |
| `@arvoretech/pi-warp-tab-title` | Renames Warp terminal tab to reflect current task focus |
| `@arvoretech/pi-worktree` | Manages git worktrees across multi-repo workspaces with tree-themed names |

## Cloud services

| Package | Description |
|---------|-------------|
| `@arvoretech/git-review-cloud` | Cloud backend (Dokploy) for PR review: GitHub App OAuth + PR REST + a WS hub that pairs a browser reviewer with the local `pi-git-review-bridge`. Not a pi extension — deployed as a service. |

## Development

```bash
pnpm install
pnpm build
pnpm test
```

## Using Extensions

### Via npm (recommended)

Add to `.pi/settings.json`:
```json
{
  "packages": [
    "npm:@arvoretech/pi-team-memory",
    "npm:@arvoretech/pi-open-editor"
  ]
}
```

### Project-local (dev)

Reference the dist path in `.pi/settings.json`:
```json
{
  "extensions": [
    "./arvore-pi-extensions/packages/element-inspector/dist/index.js"
  ]
}
```

### Global (all projects)

Symlink to `~/.pi/agent/extensions/`:
```bash
ln -s $(pwd)/packages/team-memory/dist/index.js ~/.pi/agent/extensions/team-memory.js
```
