# @arvoretech/pi-git-review-bridge

Local pi extension that connects your running pi session to
[`git-review-cloud`](../git-review-cloud). It is the only piece that touches pi:
it opens an outbound WebSocket to the cloud hub, registers your session and its
GitHub repos, and turns each browser review comment into a
`pi.sendUserMessage(...)` — so the agent answers in **your** terminal.

```
cloud hub ──(wss /ws/bridge)──► this extension ──► pi.sendUserMessage(...)
```

No inbound ports are opened locally. The bridge dials out to the cloud.

## Commands

- `/review-cloud-login` — GitHub **device flow**; stores a bridge token in
  `~/.config/pi/git-review-cloud.json`.
- `/review-cloud` — opens the cloud reviewer in your browser. Comments you make
  there arrive as user messages in this pi session.

## Config

`~/.config/pi/git-review-cloud.json`:

```jsonc
{
  "cloudUrl": "https://git-review.arvore.com.br",
  "bridgeToken": "…",   // written by /review-cloud-login
  "login": "you"
}
```

`cloudUrl` can also be set with the `GIT_REVIEW_CLOUD_URL` env var. Defaults to
`https://git-review.arvore.com.br`.

## How repos are discovered

On session start the bridge scans the workspace for git repos (`.git` up to
depth 4, pruning `node_modules`) and reads each `origin` remote to build the list
of `owner/name` slugs it reports to the cloud. The cloud lists open PRs for those
slugs (that the GitHub App is installed on).

## Message formatting

The wording sent to the agent (PR context primer, single comment, thread, batch)
is identical to the local `@arvoretech/pi-git-review` extension — the formatters
are duplicated here so the cloud stays agnostic about message shape.

## Install

Workspace package. Build and load like the other extensions:

```
pnpm --filter @arvoretech/pi-git-review-bridge build
```
