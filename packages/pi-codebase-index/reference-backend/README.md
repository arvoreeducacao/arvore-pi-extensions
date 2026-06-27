# Codebase Index — reference backend

A small, runnable backend implementing the [Codebase Index Protocol](../PROTOCOL.md). It
exists so anyone can stand up the `pi-codebase-index` extension without writing a backend
from scratch.

It is intentionally minimal (~5 files of logic) and built around two interfaces so the
storage and embedding choices are swappable:

```
src/
  ports.ts                 VectorStore + Embedder interfaces (the seam)
  adapters/
    qdrant-store.ts        default VectorStore (Qdrant)
    openai-embedder.ts     default Embedder (OpenAI)
  service.ts               sync / index / search logic (vendor-agnostic)
  auth.ts                  JWT bearer guard + org allowlist
  dev-auth.ts              dev-only token minting (no real OAuth)
  server.ts               wiring
```

## Run

You need a reachable Qdrant instance (local binary, container, or managed cloud) and
the backend process:

```bash
cp .env.example .env       # set OPENAI_API_KEY, JWT_SECRET, and QDRANT_URL
npm install
npm run build
npm start
```

Backend: `http://localhost:8080`, contract under `/codebase-index`. Health: `/health`.
The default Qdrant adapter expects `QDRANT_URL` (defaults to `http://localhost:6333`).

## Swap the vector store

Implement `VectorStore` from `src/ports.ts` (e.g. a `PgVectorStore`) and construct it in
`src/server.ts` in place of `QdrantVectorStore`. No other file changes.

## Swap the embedder

Implement `Embedder` from `src/ports.ts` and construct it in `src/server.ts`. Keep
`dimension` consistent with what was used to index.

## Production auth

Set `ENABLE_DEV_AUTH=false` and replace `dev-auth.ts` with routes that run your real
OAuth provider, returning a JWT with `sub`, `username`, `orgs[]`, `iat`, `exp`. The data
endpoints already enforce the `ALLOWED_ORGS` allowlist via `auth.ts`.
