# git-review-cloud

Cloud backend for the pi git-review flow. It moves the **PR review** surface off
`localhost` and onto a shared, authenticated web app — while the agent keeps
running on your machine.

```
┌──────────────── Dokploy (this service) ────────────────┐
│  SPA (web/index.html)   OAuth GitHub App                │
│  /api/prs /api/pr-diff /api/pr-comments                 │
│  /api/pr-comment /api/pr-reply /api/pr-merge            │
│      → GitHub REST/GraphQL via App installation token   │
│  /ws/browser ◄── browser      /ws/bridge ◄── local pi   │
│         hub pairs them per GitHub user                  │
└─────────────────────────────────────────────────────────┘
                    ▲ wss (outbound)
        ┌───────────┴───────────┐
        │  @arvoretech/pi-git-   │  runs inside your pi session
        │  review-bridge         │  → pi.sendUserMessage(comment)
        └────────────────────────┘
```

## What is cloud vs local

- **Cloud:** the reviewer UI, GitHub login (OAuth), and every PR read/write
  (diff, comments, merge) using the **GitHub App installation token** — no `gh`
  on any machine.
- **Local:** a tiny bridge extension. It is the only thing that touches your pi
  session. A browser comment is routed by the hub to your bridge, which calls
  `pi.sendUserMessage(...)` so the agent answers in your terminal, exactly like
  the local `/review` did.

Working-tree diff review (`working`/`staged`/`branch`) is **not** in the cloud —
the cloud cannot see your disk. Keep using `@arvoretech/pi-git-review` locally
for that.

## Security model

- All `/api/*` routes require a valid session JWT (HttpOnly cookie, set after
  OAuth). `GITHUB_ALLOWED_ORG` restricts login to your org.
- The WS hub authenticates the **browser** (session cookie) and the **bridge**
  (device-flow JWT) separately and keys both by GitHub user id, so a comment can
  only ever reach *your own* bridge sessions.
- GitHub access uses the App installation token scoped to installed repos with
  minimal permissions (contents:read, pull_requests:write). No broad user PAT.
- Pairing state is in-memory → run a single replica (or add shared pub/sub).

## Endpoints

| Route | Auth | Purpose |
|-------|------|---------|
| `GET /auth/github/login` `/callback` | — | OAuth login for the browser |
| `POST /auth/device/start` `/poll` | — | device flow for the local bridge |
| `GET /api/prs` | session | open PRs across the user's live sessions' repos |
| `GET /api/pr-diff` `/pr-comments` `/pr-merge-status` | session | PR reads |
| `POST /api/pr-comment` `/pr-reply` `/pr-merge` | session | PR writes |
| `WS /ws/browser` | session cookie | browser → hub (review payloads) |
| `WS /ws/bridge` | bridge JWT | hub → local pi |
| `GET /healthz` | — | health check |

## Deploy

See [`deploy/README.md`](./deploy/README.md).

## Dev

```bash
pnpm --filter @arvoretech/git-review-cloud dev
```

Requires the same env as production (see deploy README).
