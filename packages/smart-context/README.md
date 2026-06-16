# @arvoretech/pi-smart-context

Intelligent model routing and prompt compression extension for Pi/Kiro.

## Features

### Model Routing

Uses **Haiku** (fast, cheap) to classify task complexity based on the full conversation context — not just the current message. This means "bora" after a complex architecture discussion correctly routes to Opus.

| Classification | Model | When |
|---|---|---|
| trivial | `claude-haiku-4-5` | Greetings, meta-conversation, no pending task |
| simple | `claude-sonnet-4-5` | Single-file fixes, quick questions |
| medium | Current model (no change) | Standard multi-file work |
| complex | `claude-opus-4-6` | Architecture, large refactors, security audits |
| Large context (>500K) | `claude-sonnet-4-6` | 1M window needed |

### Prompt Compression

Multi-stage compression pipeline applied to context before each LLM call:

| Stage | Technique | Inspiration |
|-------|-----------|-------------|
| **BM25 Relevance** | Score older messages against current query, summarize low-relevance ones | LiteLLM compress(), Selective Context |
| **Log Folding** | Extract errors/warnings, fold INFO/DEBUG lines | Sieve, llmtrim |
| **N-gram Dedup** | Detect repeated/similar lines, collapse with template | LLMLingua, llmtrim |
| **JSON Compaction** | Tabularize JSON arrays with same schema | TOON encoding |
| **Cross-turn Delta** | Hash tool results, emit "unchanged" stub for identical repeats | Sieve delta engine |
| **Tool Result Trim** | Progressive truncation based on message age | Selective Context |

### Safety

- Recent messages (last 6) are never compressed
- Compression never makes output larger than input
- Delta only fires when content is hash-identical
- BM25 threshold (0.15) is conservative

## Usage

```bash
# Install
cd arvore-pi-extensions && pnpm install

# Build
cd packages/smart-context && pnpm build
```

Add to your Pi settings or workspace packages.

## Commands

- `/smart-context` — Show compression stats (chars saved, reduction ratio, turns processed)

## Architecture

```
src/
├── index.ts                    # Extension entry, wires hooks
├── router.ts                   # Model routing rules
└── compression/
    ├── pipeline.ts             # Orchestrates all stages
    ├── types.ts                # Shared types
    └── stages/
        ├── bm25.ts             # BM25 relevance scoring
        ├── dedup.ts            # N-gram line deduplication
        ├── log-fold.ts         # Log error extraction + folding
        ├── json-compact.ts     # JSON array tabularization
        ├── delta.ts            # Cross-turn delta compression
        └── tool-trim.ts        # Age-based tool result trimming
```
