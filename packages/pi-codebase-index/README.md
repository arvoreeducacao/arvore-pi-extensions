# @arvoretech/pi-codebase-index

A [Pi](https://github.com/earendil-works/pi-coding-agent) extension that gives the
agent **semantic code search** across your repositories. Ask for code by concept
("where is subscription renewal handled") and get ranked results across every repo,
even when you don't know the exact symbol name.

The extension is **vendor-neutral**: it talks to a backend over a small HTTP contract
(see [`PROTOCOL.md`](./PROTOCOL.md) / [`openapi.yaml`](./openapi.yaml)). You bring the
backend — use the runnable [`reference-backend/`](./reference-backend) or implement the
contract on your own infrastructure. The choice of vector store (Qdrant, pgvector,
Pinecone, ...) and embedding model lives entirely in the backend.

## How it works

1. On session start the extension scans the git repos in your workspace and computes a
   content hash per file (a Merkle root per repo).
2. It sends those hashes to the backend's `/sync`, which returns only the files that
   changed since the last index. A newly added repo returns all its files, so new repos
   index automatically.
3. Changed files are chunked and sent to `/index` in the background — the backend embeds
   and stores them. A status widget shows progress. Chunking is **AST-aware**
   (via tree-sitter) for the languages it recognizes, so each chunk maps to a real
   function/class/method and carries its actual symbol name; files in unsupported
   languages fall back to fixed-size line windows.
4. The agent calls the `search_codebase` tool, which hits `/search` and returns ranked
   snippets with file paths and line numbers.

## Install

```bash
pnpm add @arvoretech/pi-codebase-index
```

Point it at your backend and authenticate:

```bash
export PI_CODEBASE_API_URL="https://your-backend.example.com/api"
```

Inside Pi:

```
/codebase-login
```

That's it — sync runs automatically from then on.

## Commands

| Command | What it does |
|---|---|
| `/codebase-login` | Authenticate with the backend |
| `/codebase-logout` | Clear credentials |
| `/codebase-search <query>` | Manual search (debugging) |
| `/codebase-reindex` | Force a fresh sync of the workspace |
| `/codebase-hide` | Hide the status widget (sync keeps running) |
| `/codebase-show` | Show the status widget again |

## Configuration

| Env var | Required | Default | Purpose |
|---|---|---|---|
| `PI_CODEBASE_API_URL` | yes | — | Base URL of a backend implementing the protocol |
| `PI_CODEBASE_AUTH_PROVIDER` | no | `github` | Auth provider segment in the `/auth/<provider>/...` routes |

There is **no built-in backend URL** — the extension fails loudly until you set
`PI_CODEBASE_API_URL`. This keeps the package free of any single company's
infrastructure.

## Running your own backend

See [`SETUP.md`](./SETUP.md). The short version: start a Qdrant instance and run the
service in [`reference-backend/`](./reference-backend) (`npm install && npm run build &&
npm start`). Swap the vector store or embedder by implementing the `VectorStore` /
`Embedder` interfaces in `reference-backend/src/ports.ts`.

## License

MIT
