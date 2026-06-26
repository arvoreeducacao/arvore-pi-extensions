# Codebase Index Protocol

This document defines the **vendor-neutral contract** between the `pi-codebase-index`
client (a Pi extension) and any backend that powers semantic code search.

The client never knows which vector store, embedding model, or reranker the backend
uses. It only speaks the four HTTP endpoints described here. Implement these endpoints
on top of any stack (Qdrant, pgvector, Pinecone, Weaviate, Milvus, ...) and the client
works unchanged. A runnable reference backend lives in `reference-backend/`.

## Concepts

- **Repo**: a versioned project in the workspace. Identified by a stable `name`.
- **Chunk**: a unit of code the backend embeds and stores. Produced by the client.
- **Merkle root**: a single hash per repo derived from the content hashes of all its
  tracked files. The backend stores the last root it indexed per repo so it can return
  only the files that changed.

## Authentication

All four endpoints require a bearer token obtained through an OAuth-style flow. The
provider is configurable (GitHub in the reference backend) and is not part of the data
contract.

```
GET  /auth/<provider>/start?redirect_url=<client_local_url>
  -> redirects the browser through the provider, then to:
     <client_local_url>?token=<jwt>&refresh_token=<jwt>

POST /auth/<provider>/refresh
  body:  { "refresh_token": "<jwt>" }
  reply: { "access_token": "<jwt>", "refresh_token": "<jwt>", "expires_in": <seconds> }
```

The access token is a JWT whose payload carries `username`, `exp`, and `iat`. The
backend is responsible for restricting access (e.g. to members of an allowed org). The
client treats the token as opaque except for reading those three fields.

Every data request below carries `Authorization: Bearer <access_token>`.

## Data endpoints

Base path is implementation-defined (the reference backend mounts them under
`/codebase-index`). All bodies are JSON.

### POST /sync

The client sends one Merkle root per repo. The backend compares each root with what it
last indexed and returns the files that must be re-indexed. A repo the backend has never
seen returns all of its files (this is how a newly added repo gets indexed automatically).

```jsonc
// request
{
  "repos": [
    { "name": "api-arvore", "rootHash": "<sha256>", "files": [
        { "path": "src/main.ts", "hash": "<sha256>" }
    ] }
  ]
}
```

`files` is optional. When omitted the backend may treat a changed `rootHash` as "reindex
the whole repo". When present the backend diffs file hashes and returns only the deltas,
which is the cheap path the client uses by default.

```jsonc
// reply
{
  "changed": [
    { "repo": "api-arvore", "path": "src/main.ts" }
  ],
  "removed": [
    { "repo": "api-arvore", "path": "src/old.ts" }
  ]
}
```

`changed` are files to (re)index. `removed` are files whose chunks the backend has
already dropped (returned for transparency; the client does not act on them).

### POST /index

The client embeds nothing. It sends raw chunks; the backend embeds and stores them.
Chunks are upserted by `(repo, path, symbol)` identity, so re-sending a changed file
replaces its previous chunks.

```jsonc
// request
{
  "chunks": [
    {
      "repo": "api-arvore",
      "path": "src/billing/subscription.service.ts",
      "symbol": "SubscriptionService.renew",
      "lang": "typescript",
      "gitSha": "<commit sha or file hash>",
      "lineStart": 42,
      "lineEnd": 88,
      "content": "<the code, optionally context-enriched by the client>"
    }
  ]
}
```

```jsonc
// reply
{ "indexed": 1 }
```

The client also calls `/index` with `{ "chunks": [], "remove": [{ "repo", "path" }] }`
to drop chunks for deleted files. `remove` is optional.

### POST /search

```jsonc
// request
{ "query": "where is subscription renewal handled", "repo": "api-arvore", "lang": "typescript", "limit": 10 }
```

`repo` and `lang` are optional filters. Omitting `repo` searches across all repos
(cross-repo ranking). `limit` defaults to 10.

```jsonc
// reply
{
  "results": [
    {
      "repo": "api-arvore",
      "path": "src/billing/subscription.service.ts",
      "symbol": "SubscriptionService.renew",
      "lang": "typescript",
      "snippet": "<~15 lines of the matched chunk>",
      "score": 0.83,
      "lineStart": 42,
      "lineEnd": 88
    }
  ]
}
```

The backend owns retrieval quality: it may do pure vector search, hybrid
vector+lexical recall, and/or cross-encoder reranking. The contract only fixes the shape
of the response.

## Error model

Non-2xx responses carry a plain-text or `{ "message": string }` body. `401` means the
token is missing/expired (client re-authenticates), `403` means the user is not allowed.

## What the backend must guarantee

1. The **same embedding model and dimension** are used for `/index` and `/search`.
2. Chunk identity is stable across re-indexing: upsert by `(repo, path, symbol)`.
3. `/sync` is idempotent and cheap for unchanged repos (returns empty `changed`).
4. Access control happens in the guard, not in the client.
