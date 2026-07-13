# deploy — git-review-cloud on Dokploy

This service runs as a single stateless container. State (WS pairing) is in-memory
per instance, so run it as **one replica** unless you add a shared pub/sub — the
browser and the local bridge must land on the same instance to be paired.

## 1. GitHub App

Create a GitHub App (org settings → Developer settings → GitHub Apps):

- **Callback URL:** `https://<public-url>/auth/github/callback`
- **Request user authorization (OAuth) during installation:** on
- **Enable Device Flow:** on (required for the local bridge login)
- **Permissions (repository):**
  - Contents: Read-only
  - Pull requests: Read & write
  - Metadata: Read-only
- **Webhooks:** not required for v1 (leave off or set a secret if you add them later)

Install the App on the org/repos you want reviewable. Note the **App ID**,
**Client ID**, generate a **Client secret** and a **private key** (`.pem`).

## 2. Dokploy application

- Source: this repo, build context `packages/git-review-cloud`, Dockerfile `Dockerfile`.
- Port: `8080`.
- Domain: attach the public domain and let Dokploy/Traefik terminate TLS.
- Health check path: `/healthz`.

## 3. Environment variables (Dokploy → Environment)

| Var | Required | Notes |
|-----|----------|-------|
| `SESSION_SECRET` | yes | long random string; signs the session/bridge JWTs |
| `GITHUB_APP_ID` | yes | numeric App ID |
| `GITHUB_CLIENT_ID` | yes | App client id |
| `GITHUB_CLIENT_SECRET` | yes | App client secret |
| `GITHUB_APP_PRIVATE_KEY` | yes | PEM contents (with real newlines or `\n`-escaped), **or** base64 of the PEM |
| `PUBLIC_URL` | yes | e.g. `https://git-review.arvore.com.br` |
| `GITHUB_ALLOWED_ORG` | recommended | only members of this org can log in |
| `GITHUB_WEBHOOK_SECRET` | no | only if you wire webhooks later |
| `PORT` | no | defaults to `8080` |
| `SESSION_TTL_SEC` | no | browser session cookie lifetime, default 3600 |
| `BROWSER_TOKEN_TTL_SEC` | no | SPA cookie max-age, default 8h |
| `REFRESH_TTL_SEC` | no | bridge token lifetime, default 30d |

Store `GITHUB_APP_PRIVATE_KEY`, `GITHUB_CLIENT_SECRET`, and `SESSION_SECRET` as
Dokploy **secrets**, never in plaintext build args.

## 4. Local bridge

On each developer machine, install `@arvoretech/pi-git-review-bridge` as a pi
extension and point it at the deployed URL:

```jsonc
// ~/.config/pi/git-review-cloud.json
{ "cloudUrl": "https://git-review.arvore.com.br" }
```

Then inside pi:

```
/review-cloud-login   # GitHub device flow, stores the bridge token
/review-cloud         # opens the cloud reviewer; comments land in this terminal
```
