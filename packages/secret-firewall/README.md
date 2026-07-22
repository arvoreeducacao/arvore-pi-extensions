# @arvoretech/pi-secret-firewall

A secret firewall for the Pi/Kiro agent. It keeps secret **values** out of the
model context entirely, exposing them only as shell environment variables that
the model can *reference by name* but never *read*. Where a secret value would
appear, the model instead sees a self-describing placeholder that names the
exact shell variable to use, e.g.
`«SECRET DATABASE_URL redacted — ... read it in bash as "$DATABASE_URL"»`.

## How it works

On session start (and on demand) it discovers secrets from two sources:

1. **Real environment variables** whose name looks sensitive
   (`*_TOKEN`, `*_SECRET`, `*_API_KEY`, `*_PASSWORD`, `DATABASE_URL`, ...) — exact
   value match, zero false positives.
2. **`.env` / `.env.local` / `.env.development*`** files in the cwd.

Each secret value gets a stable, self-describing placeholder that tells the
model exactly how to use it. For env/dotenv secrets the shell variable is the
secret's **original name**: `MY_API_KEY=xptolksjf` →
`«SECRET MY_API_KEY redacted — the real value is live in your shell env; read it in bash as "$MY_API_KEY"»`.

Redaction happens on three channels:

- **`input` hook** — the user's own message is redacted at the moment it is
  submitted, before it is stored in the session or shown in the transcript. So a
  pasted secret never persists in the user's session and the user sees the
  placeholder too, making it clear the value was redacted.
- **`context` hook** — every message sent to the model (user text, assistant
  text, thinking, and tool-call arguments) has secret values swapped for their
  placeholder.
- **`tool_result` hook** — output from `bash`, `read`, `grep`, etc. is redacted,
  so `cat .env` returns placeholders, not values.

A pattern fallback also catches well-known token shapes (AWS keys, JWTs,
`sk-...`, GitHub/Slack tokens, PEM private keys) that leak into output even when
they were never in an env var. When such a token is caught, it is **captured and
auto-exported** to the shell under a generated name (`SECRET_JWT`,
`SECRET_JWT_2`, ...), written to `process.env`, and replaced in the context with
the same self-describing placeholder. So if you paste a JWT into the chat, the
model sees `... read it in bash as "$SECRET_JWT"` and can use it via
`curl -H "Authorization: Bearer $SECRET_JWT"` without ever seeing the value.
Captured names show up under `/secret-firewall` status.

### Custom patterns

The built-in pattern list can be extended with your own regexes via a JSON
config file, so internal or vendor-specific token shapes are also caught and
auto-exported. Config is read from, in order of precedence (both are merged;
global first, then project):

- `~/.pi/agent/secret-firewall.json` — global, applies to every project.
- `<cwd>/.pi/secret-firewall.json` — project-local.

```json
{
  "patterns": [
    { "name": "ACME", "regex": "acme-[0-9a-f]{12}" },
    { "name": "INTERNAL_TOKEN", "regex": "int_[A-Za-z0-9]{24}", "flags": "i" }
  ]
}
```

- `name` — used to build the exported shell var (`$SECRET_ACME`,
  `$SECRET_ACME_2` for a second distinct match). Sanitized to `[A-Za-z0-9_]`.
- `regex` — the pattern to match. The `g` flag is always applied.
- `flags` — optional extra RegExp flags (e.g. `i`).

Invalid regexes and malformed entries are skipped silently rather than crashing
the firewall. Custom patterns behave exactly like the built-in ones: matches are
masked, captured, and exported to the shell. Keep patterns specific — a
too-broad regex will redact large chunks of normal output and degrade the agent,
and a pathological regex runs on every tool result (ReDoS risk).

### Standing guidance in the system prompt

A `before_agent_start` hook appends a short section to the system prompt every
turn explaining the contract: placeholders are **not** the value and **not** an
unset variable; the real value is **live in the shell**; reference it by name in
a `bash` command; never echo/print/cat it. It also lists the currently available
secret env var names. This is what stops the model from concluding "the env var
isn't set" or treating the placeholder text as the literal value.

## Security model — the model never sees the value

This extension uses the **shell-env-only** strategy:

- The real value lives in `process.env` (which the `bash` tool inherits).
- The model references it as a shell variable: `curl -H "Authorization: Bearer $MY_API_KEY"`.
- The shell resolves `$MY_API_KEY` at execution time.
- The value never returns to the context — any echo of it in tool output is
  redacted again.

The extension never re-hydrates placeholders itself. If the model writes the
literal *value* instead of the shell reference, that value is redacted on the
way back, but the model must use the `$NAME` reference for a command to actually
use the secret.

### Pasted/leaked tokens are captured and exported

When a value is caught by a **pattern rule** (JWT, AWS key, `sk-...`, etc.) it is
not only masked — its real value is captured and exported as a `$SECRET_*` shell
variable on the fly. This means a token pasted into the chat becomes usable in
bash (`$SECRET_JWT`) without the model ever seeing the value, and without
needing it in `.env` beforehand. Distinct values caught by the same pattern get
suffixed names (`$SECRET_JWT_2`).

### Limits / non-goals

- A determined model could still exfiltrate a secret by transforming it before
  printing (e.g. base64). This raises the bar; it is not a sandbox.
- Values shorter than 8 chars or matching trivial values (`true`, `3000`, ...)
  are not protected — they are not secrets and redacting them breaks the agent.
- Infra/session vars (`PATH`, `HOME`, `SSH_AUTH_SOCK`, `*_SESSION`, ...) are
  explicitly never treated as secrets.

## Commands

- `/secret-firewall` — show status (protected secrets, redaction count, the
  shell env var names the model may reference).
- `/secret-firewall-toggle` — enable/disable redaction.
- `/secret-firewall-rescan` — re-scan env + `.env` files.

## Develop

```bash
pnpm build   # tsc -> dist/
pnpm test    # node --test against dist/
pnpm lint    # tsc --noEmit
```
