# AGENTS.md — pi-provider-kiro

> Context file for AI coding assistants working on this codebase.

## Project Overview

pi extension that connects the pi coding agent to the Kiro API (AWS CodeWhisperer/Q). Provides 17 models across 7 families with multi-provider authentication (AWS Builder ID, Google, GitHub).

## Directory Structure

```
pi-provider-kiro/
├── src/                    # TypeScript source (9 files, one feature each)
│   ├── index.ts            # F1: Extension registration entry point
│   ├── models.ts           # F2: Model catalog + ID resolution
│   ├── oauth.ts            # F3: Multi-provider OAuth (Builder ID / Google / GitHub)
│   ├── kiro-cli.ts         # F4: kiro-cli SQLite credential sharing
│   ├── transform.ts        # F5: pi ↔ Kiro message transformation
│   ├── history.ts          # F6: History truncation + sanitization
│   ├── thinking-parser.ts  # F7: Streaming <thinking> tag parser
│   ├── event-parser.ts     # F8: Kiro stream JSON event parser
│   └── stream.ts           # F9: Main streaming orchestrator
├── test/                   # 1:1 test files for each source file
├── dist/                   # Compiled output (tsc)
├── .agents/summary/        # Detailed documentation (architecture, components, etc.)
├── package.json            # Extension config: pi.extensions → dist/index.js
├── tsconfig.json           # ES2022, ESNext modules, strict
└── vitest.config.ts        # Test config
```

## Key Patterns

### Feature-per-file
Each `src/` file owns exactly one numbered feature (F1–F9). When modifying a feature, the relevant file is obvious. Each has a matching test file.

### Model ID Convention
pi uses dashes (`claude-sonnet-4-6`), Kiro API uses dots (`claude-sonnet-4.6`). Conversion in `resolveKiroModel()` via regex: `(\d)-(\d)` → `$1.$2`. The `KIRO_MODEL_IDS` Set is the source of truth for valid model IDs.

### Kiro History Format
Kiro requires strict alternating `userInputMessage` / `assistantResponseMessage` entries. Tool results must be wrapped in synthetic user messages. `buildHistory()` in transform.ts handles this; `history.ts` sanitizes and truncates.

### Streaming Pipeline
Raw bytes → `parseKiroEvents()` → typed `KiroStreamEvent` → `ThinkingTagParser` (if reasoning) → pi `AssistantMessageEventStream` events.

### Retry with Reduction
On 413/too-large: error propagated immediately to the caller (no retry). The caller is responsible for handling context overflow (e.g., compaction or history trimming), matching kiro-cli behavior.

### Credential Cascade
1. kiro-cli SQLite DB — checks social token first (`kirocli:social:token`), then IDC token
2. OAuth device code flow (interactive, opens browser)

### Auth Methods
- `idc`: AWS Builder ID or IAM Identity Center (SSO). Refresh via SSO OIDC endpoint. Token format: `refreshToken|clientId|clientSecret|idc`. Preferred — has clientId/clientSecret for refresh.
- `desktop`: Google/GitHub social login via Kiro auth service. Refresh via `prod.{region}.auth.desktop.kiro.dev`. Token format: `refreshToken|desktop`

### Login Methods
Users can authenticate via:
- **Builder ID**: Native device code flow (works in SSH/remote)
- **Google**: Social login (delegates to `kiro-cli login`, requires local browser or SSH port forwarding)
- **GitHub**: Social login (delegates to `kiro-cli login`, requires local browser or SSH port forwarding)

## Development

```bash
npm run build     # tsc → dist/
npm run check     # tsc --noEmit (type check only)
npm test          # vitest run (248 tests)
npm run test:watch # vitest (watch mode)
```

## Testing Patterns

- All tests use Vitest
- External calls (`fetch`, `execSync`, `existsSync`) are mocked via `vi.fn()` / `vi.stubGlobal()`
- Stream tests mock `fetch` to return a `ReadableStream`-like reader with `read()` returning encoded JSON chunks
- No integration tests — all unit tests with mocks
- Test file naming: `test/<source-name>.test.ts`

## Adding a New Model

1. Add the Kiro model ID to `KIRO_MODEL_IDS` Set in `src/models.ts`
2. Add a model definition object to the `kiroModels` array with: id (dash format), name, reasoning, input modalities, contextWindow, maxTokens
3. Update test counts in `test/models.test.ts` and `test/registration.test.ts`
4. Run `npm test` to verify

## Common Gotchas

- `ZERO_COST` is a frozen shared object — don't try to mutate model costs
- The `as any` cast in `index.ts` is intentional — `ProviderConfig.oauth` doesn't type `getCliCredentials`
- `kiro-cli.ts` uses `sqlite3` CLI via `execSync`, not a Node native module
- Output token count is estimated (`content.length / 4`), not from the API
- `contextUsagePercentage` is the only usage metric Kiro provides; input tokens are back-calculated
- Social login (Google/GitHub) requires `kiro-cli` to be installed — pi delegates the auth flow to it
