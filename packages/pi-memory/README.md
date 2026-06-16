# @arvoretech/pi-memory

Cloud-based team memory for Pi. All intelligence (embeddings, chunking, ADD/UPDATE/NOOP decision, PII sanitization) runs server-side in `api-arvore`. The extension only sends raw text.

## How it works

1. `/memory-login` → GitHub OAuth via api-arvore (org-based access: `arvoreeducacao` or `SuperAutor`).
2. During the session → on each `turn_end` (debounced) the new turns are sent to `api-arvore`, which sanitizes, embeds, and decides ADD/UPDATE/NOOP. Final flush on `session_shutdown`.
3. On `before_agent_start` → the current prompt is used to retrieve relevant team memory, injected into the system prompt.

Memory is a single org-wide pool (cross-user). Two tiers: `raw` (episodic chat, decays over time) and `curated` (promoted, never auto-deleted).

## Commands

| Command | Description |
|---------|-------------|
| `/memory-login` | GitHub OAuth login |
| `/memory-logout` | Clear credentials |
| `/memory-incognito` | Toggle incognito (skip saving this session) |
| `/memory-status` | Show auth/config info |
| `/memory-search <query>` | Manual semantic search |
| `/memory-candidates` | List raw memories eligible for promotion |
| `/memory-promote <id>` | Promote a raw memory to curated |
| `/memory-curate <category>\|<title>\|<content>` | Create a curated memory directly |
| `/memory-forget` | Delete the current session from memory (retroactive incognito) |

## Config

- `PI_MEMORY_API_URL` — override the api-arvore base URL (default: production).

## Dependencies

None at runtime — uses native `fetch` and Node builtins. Backend: `api-arvore` `pi-memory` module.
