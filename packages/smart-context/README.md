# @arvoretech/pi-smart-context

Intelligent model routing and retrieval-augmented prompt compression for Pi/Kiro.

## Features

### Model Routing

Uses **Haiku** (fast, cheap) to classify task complexity based on the full conversation context — not just the current message. So "bora" after a complex architecture discussion correctly routes to Opus.

| Classification | Model | When |
|---|---|---|
| trivial | `claude-haiku-4-5` | Greetings, meta-conversation, no pending task |
| simple | `claude-sonnet-4-5` | Single-file fixes, quick questions |
| medium | `claude-sonnet-4-5` | Standard multi-file work (deterministic baseline) |
| complex | `claude-opus-4-6` | Architecture, large refactors, security audits |
| Large context (>500K) | `claude-sonnet-4-6` | 1M window needed |

### Retrieval-Augmented Compression

The core principle (from the prompt-compression literature): **the model never loses access to information — it just pays less to carry it by default.**

Compressed/dropped content is replaced by a summary + a `recover_context("id")` hint. The original is kept in an in-memory store. If the model actually needs the detail, it calls the `recover_context` tool to pull back the full text. This lets us compress aggressively with no quality loss.

#### Pipeline

| Stage | Technique | Safety |
|---|---|---|
| **Tool output (structural)** | Log folding, n-gram dedup, JSON tabularize, cross-turn delta | Lossless / near-lossless |
| **BM25 relevance** | Score old messages vs current query | — |
| **Haiku summarization** | Summarize old messages preserving load-bearing facts, cached by hash | Lossy but recoverable |
| **Retrieval drop** | Replace low-relevance content with stub + recover hint | Recoverable |

#### Cache-aware (critical)

Anthropic/Kiro use **prompt caching** keyed by prefix. Compression that rewrites the context differently each turn would *break the cache and increase cost*. This extension keeps compression **stable and monotonic**: once a message is compressed, the identical compressed form is reused on every subsequent turn. The cache prefix is invalidated only once, then rebuilds and stays cached.

#### Aggressive quality gate

- Last **4 turns** never compressed (active working set)
- Compression only applied if it saves **>15%**
- Haiku summary only used if it beats the original by >15%; otherwise falls back to a recoverable stub

### Commands

- `/smart-context` — Stats: chars saved, avg ratio, Haiku calls/cache hits, recoverable items

## Architecture

```
src/
├── index.ts                      # Hooks + recover_context tool
├── router.ts                     # Haiku-based complexity classification
└── compression/
    ├── pipeline.ts               # Orchestrates stages, cache-stable, retrieval-augmented
    ├── store.ts                  # Content store for recover_context
    ├── haiku-summarize.ts        # Haiku summarizer with hash cache
    ├── types.ts
    └── stages/
        ├── bm25.ts               # BM25 relevance scoring
        ├── dedup.ts              # N-gram line deduplication
        ├── log-fold.ts           # Log error extraction + folding
        ├── json-compact.ts       # JSON array tabularization
        └── delta.ts              # Cross-turn delta compression
```

## Usage

```bash
cd arvore-pi-extensions && pnpm install
cd packages/smart-context && pnpm build
```

Add to your Pi packages. The extension hooks into `before_agent_start` (routing), `context` (compression), and `tool_result` (structural tool-output compression).
