# @arvoretech/pi-secret-firewall

A secret firewall for the Pi/Kiro agent. It keeps secret **values** out of the
model context entirely, exposing them only as `$SECRET_*` shell environment
variables that the model can *reference by name* but never *read*.

## How it works

On session start (and on demand) it discovers secrets from two sources:

1. **Real environment variables** whose name looks sensitive
   (`*_TOKEN`, `*_SECRET`, `*_API_KEY`, `*_PASSWORD`, `DATABASE_URL`, ...) — exact
   value match, zero false positives.
2. **`.env` / `.env.local` / `.env.development*`** files in the cwd.

Each secret value gets a stable placeholder: `MY_API_KEY=xptolksjf` →
`$SECRET_MY_API_KEY`.

Redaction happens on two channels:

- **`context` hook** — every message sent to the model (user text, assistant
  text, thinking, and tool-call arguments) has secret values swapped for their
  placeholder.
- **`tool_result` hook** — output from `bash`, `read`, `grep`, etc. is redacted,
  so `cat .env` returns placeholders, not values.

A pattern fallback also catches well-known token shapes (AWS keys, JWTs,
`sk-...`, GitHub/Slack tokens, PEM private keys) that leak into output even when
they were never in an env var.

## Security model — the model never sees the value

This extension uses the **shell-env-only** strategy:

- The real value lives in `process.env` (which the `bash` tool inherits).
- The model references it as a shell variable: `curl -H "Authorization: Bearer $SECRET_MY_API_KEY"`.
- The shell resolves `$SECRET_MY_API_KEY` at execution time.
- The value never returns to the context — any echo of it in tool output is
  redacted again.

The extension never re-hydrates placeholders itself. If the model writes the
literal *value* instead of the placeholder, that value is redacted on the way
back, but the model must use the `$SECRET_*` reference for a command to actually
use the secret.

### Limits / non-goals

- A determined model could still exfiltrate a secret by transforming it before
  printing (e.g. base64). This raises the bar; it is not a sandbox.
- Values shorter than 8 chars or matching trivial values (`true`, `3000`, ...)
  are not protected — they are not secrets and redacting them breaks the agent.
- Infra/session vars (`PATH`, `HOME`, `SSH_AUTH_SOCK`, `*_SESSION`, ...) are
  explicitly never treated as secrets.

## Commands

- `/secret-firewall` — show status (protected secrets, redaction count, the
  `$SECRET_*` names the model may reference).
- `/secret-firewall-toggle` — enable/disable redaction.
- `/secret-firewall-rescan` — re-scan env + `.env` files.

## Develop

```bash
pnpm build   # tsc -> dist/
pnpm test    # node --test against dist/
pnpm lint    # tsc --noEmit
```
