# @arvoretech/pi-smart-context

Intelligent model routing and retrieval-augmented prompt compression for Pi/Kiro.

## Features

### Model Routing

Uses a cheap classifier model (Haiku by default) to classify task complexity based on the full conversation context — not just the current message. So "bora" after a complex architecture discussion correctly routes to Opus.

| Classification | Default model | When |
|---|---|---|
| trivial | `claude-haiku-4-5` | Greetings, meta-conversation, no pending task |
| simple | `claude-sonnet-4-6` | Single-file fixes, quick questions |
| medium | `claude-opus-4-8` | Standard multi-file work |
| complex | `claude-opus-4-8` | Architecture, large refactors, security audits |
| Large context (>500K) | `claude-sonnet-4-6` | 1M window needed |

Every slot above — provider and model — is configurable (see [Configuration](#configuration)).

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

Anthropic/Kiro use **prompt caching** keyed by prefix. Compression that rewrites the context differently each turn would *break the cache and increase cost*.

Two protections:

1. **Runtime cache detection** — the extension inspects the last assistant message's `cacheRead`/`cacheWrite`. If the provider is actively caching, **lossy compression of the prefix is disabled** (only safe structural compression of new tool output runs). No cache break, ever.
2. **Stable/monotonic compression** — when cache is off, once a message is compressed the identical compressed form is reused on every subsequent turn, so even the one-time prefix change rebuilds and stays stable.

> Note: at the time of writing, the Kiro provider reports `cacheRead: 0 / cacheWrite: 0` across sessions — caching is effectively off, so compression is pure savings (the full context is re-billed every turn with no cache to break). The cache-detection path future-proofs the extension for when Kiro enables caching.

#### Aggressive quality gate

The pipeline runs with one of two aggression profiles, chosen per turn:

| Profile | Trigger | Protected turns | Min savings | Summarize ≥ | BM25 drop | Tool trim ≥ | Compress under cache |
|---|---|---|---|---|---|---|---|
| **Balanced** | Large-context model, low usage | 4 | 15% | 400 chars | 0.25 | 4000 chars | no |
| **Aggressive** | Small context window (<200K) **or** usage ≥60% of the window | 2 | 10% | 250 chars | 0.35 | 2000 chars | yes |

Detection uses `ctx.getModel().contextWindow` and `ctx.getContextUsage().tokens`. On a smaller-context model (or when the window is filling up) the extension protects fewer turns, summarizes shorter messages, drops more low-relevance content, trims tool output sooner, and — only in this mode — keeps compressing the prefix even when the provider is caching (the cost of a cache rebuild beats overflowing the window).

### Commands

- `/smart-context` — Stats: chars saved, avg ratio, Haiku calls/cache hits, recoverable items

## Configuration

Model routing is fully configurable via a project-local `.pi/smart-context.json` file. The extension walks up from the current working directory looking for the nearest `.pi`/`.git` root, then reads `.pi/smart-context.json` from it. If the file is missing or malformed, the built-in defaults are used (behavior identical to no config).

Every slot is a `{ "provider", "model" }` pair, so you are **not** locked to the `kiro` provider — you can mix providers and models freely across slots. The `provider`/`model` strings must match what `modelRegistry.find(provider, model)` resolves for your Pi setup.

```json
{
  "classifier": { "provider": "kiro", "model": "claude-haiku-4-5" },

  "routing": {
    "trivial": { "provider": "kiro", "model": "claude-haiku-4-5" },
    "simple":  { "provider": "kiro", "model": "claude-sonnet-4-6" },
    "medium":  { "provider": "kiro", "model": "claude-opus-4-8" },
    "complex": { "provider": "kiro", "model": "claude-opus-4-8" }
  },

  "largeContext": {
    "thresholdTokens": 500000,
    "model": { "provider": "kiro", "model": "claude-sonnet-4-6" }
  }
}
```

| Key | Purpose |
|---|---|
| `classifier` | The cheap model that classifies task complexity. Also reused by the compression summarizer. |
| `routing.trivial` / `.simple` / `.medium` / `.complex` | Model picked for each classified complexity. |
| `largeContext.thresholdTokens` | When context usage exceeds this, skip classification and use `largeContext.model` directly. |
| `largeContext.model` | Model forced for very large contexts. |

Partial configs are deep-merged over the defaults — you only need to specify the slots you want to override. Each slot independently falls back to its default if the value is missing or not a valid `{ provider, model }` pair.

### Example: use a different provider

```json
{
  "classifier": { "provider": "anthropic", "model": "claude-haiku-4-5" },
  "routing": {
    "complex": { "provider": "openai", "model": "gpt-5" }
  }
}
```

This classifies with Anthropic Haiku, routes `complex` tasks to OpenAI, and keeps the defaults for every other slot.

## Architecture

```
src/
├── index.ts                      # Hooks + recover_context tool
├── config.ts                     # .pi/smart-context.json loader (provider+model per slot)
├── router.ts                     # Classifier-based complexity routing
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
