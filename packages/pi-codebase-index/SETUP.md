# Setup — running your own backend

The `pi-codebase-index` client is generic. To use it you point `PI_CODEBASE_API_URL`
at a backend that implements the [Codebase Index Protocol](./PROTOCOL.md). You have two
paths.

## Option A — run the reference backend (≈15 min)

The fastest way to "anyone can run it". The reference backend ships a Qdrant adapter and
an OpenAI embedder, wired behind the vendor-neutral `VectorStore` / `Embedder`
interfaces.

You need a running vector store and the backend process:

```bash
# 1. Start a vector store. Any Qdrant instance works — local binary, a container,
#    or a managed cloud cluster. It just needs to be reachable over HTTP.
#    (The default adapter expects Qdrant on http://localhost:6333.)

# 2. Configure and run the backend
cd reference-backend
cp .env.example .env
# edit .env: set OPENAI_API_KEY, a long random JWT_SECRET, and QDRANT_URL
npm install
npm run build
npm start
```

This serves the contract under `/codebase-index` on `:8080` (health at `/health`).

Point the client at it:

```bash
export PI_CODEBASE_API_URL="http://localhost:8080"
```

Inside Pi: `/codebase-login`. With `ENABLE_DEV_AUTH=true` the backend mints a token
without a real OAuth provider, so login works immediately for local use.

### Authentication

Once logged in, the client **stays logged in**: it stores credentials in
`~/.config/pi/codebase-credentials.json` and silently refreshes the access token via
`/auth/<provider>/refresh` before it expires. You only run `/codebase-login` again if you
log out or the refresh token itself expires.

For production, turn `ENABLE_DEV_AUTH=false` and implement a real provider:
- `GET /auth/<provider>/start?redirect_url=...` → run OAuth, then redirect to
  `redirect_url?token=<jwt>&refresh_token=<jwt>`
- `POST /auth/<provider>/refresh` `{ refresh_token }` →
  `{ access_token, refresh_token, expires_in }`

The access token must be a JWT carrying `sub`, `username`, `orgs[]`, `iat`, `exp`. Restrict
access with `ALLOWED_ORGS`.

## Option B — implement the contract on your own backend

If you already run an API and a vector store, implement the four endpoints from
[`PROTOCOL.md`](./PROTOCOL.md) / [`openapi.yaml`](./openapi.yaml):

- `POST /codebase-index/sync`
- `POST /codebase-index/index`
- `POST /codebase-index/search`
- the `/auth/<provider>/start` + `/refresh` pair

Then `export PI_CODEBASE_API_URL=https://your-api.example.com`. Nothing in the client
changes.

## Swapping the vector store or embedder

In the reference backend, both are behind interfaces in `reference-backend/src/ports.ts`:

```ts
export interface Embedder {
  dimension: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface VectorStore {
  init(dimension: number): Promise<void>;
  upsert(points: VectorPoint[]): Promise<void>;
  deleteByPath(org, repo, path): Promise<void>;
  listFileHashes(org, repo): Promise<Map<string, string>>;
  search(vector, filter, limit, threshold): Promise<VectorMatch[]>;
}
```

To use pgvector, Pinecone, Weaviate, etc., write a class implementing `VectorStore` and
construct it in `src/server.ts` instead of `QdrantVectorStore`. To use a different
embedding provider, implement `Embedder`. Keep the embedding model and dimension
**consistent between indexing and search** — that is the one invariant the protocol
requires.

## Choosing where the index lives

- **Cloud (recommended for teams):** one shared backend + a managed vector store. The
  first developer to index a repo pays the cost; everyone else gets `changed: []` on sync.
  Code is embedded server-side and never leaves your infrastructure.
- **Local per developer:** run a local Qdrant plus the backend process on each machine.
  Simpler, fully private, but no shared index across the team.
