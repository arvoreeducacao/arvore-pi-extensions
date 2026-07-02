# PR #5: Bedrock Fallback

**Branch:** `feat/bedrock-fallback` → `upstream/main`  
**Type:** Major Feature  
**Size:** 6 commits, ~750 lines changed

## Title
```
feat: add Bedrock fallback with automatic provider tagging
```

## Description

Adds AWS Bedrock as a fallback provider when Kiro API fails. Automatically maps Kiro model IDs to Bedrock equivalents and routes requests to Bedrock on auth failures, 5xx errors, or timeouts.

### The Problem

When Kiro API fails (auth errors, rate limits, service issues), users get an error and their request fails completely. There's no graceful degradation or fallback option.

### The Solution

Introduce a `streamWithFallback()` wrapper that:
1. Attempts to stream from Kiro first
2. On failure, automatically maps the model to Bedrock equivalent
3. Routes the request to Bedrock seamlessly
4. Tags all events with provider metadata so the UI knows which backend served the response

### Features

#### 1. Comprehensive Model Mapping (17 models)
Maps Kiro model IDs to their Bedrock equivalents:
- **Claude:** opus-4-6, sonnet-4-6, sonnet-4-5, sonnet-4, haiku-4-5
- **DeepSeek:** deepseek-3-2
- **Kimi:** kimi-k2-5
- **MiniMax:** minimax-m2-1
- **GLM:** glm-4-7, glm-4-7-flash
- **Qwen:** qwen3-coder models
- **Nova:** AGI Nova → Premier

#### 2. Automatic AWS Configuration
- Uses `PI_BEDROCK_PROFILE` or `AWS_PROFILE` environment variables
- Auto-detects region from model baseUrl or environment
- Uses cross-region inference profiles (us.*) where available

#### 3. Provider Tagging
All streaming events tagged with:
```ts
event.partial.provider = "bedrock"
event.partial.model = "claude-sonnet-4-6 (bedrock)"
```
UI can show which backend served the response.

#### 4. OAuth Changes for Fallback
Modified `refreshKiroToken()` graceful degradation:
- Returns stale credentials with short TTL instead of throwing
- Allows stream attempt to proceed
- If token is truly expired, Kiro rejects and Bedrock takes over
- Previously blocked at auth layer before fallback could run

### Implementation Details

**Includes prerequisite bug fixes:**
- Stream reliability fixes (PR #1)
- kiro-cli snake_case fix (PR #2)

**New files:**
- `src/fallback.ts` — Main fallback orchestration (278 lines)
- `test/fallback.test.ts` — Comprehensive test suite (391 lines)

**Modified files:**
- `src/index.ts` — Use `streamWithFallback` instead of `streamKiro`
- `src/oauth.ts` — Change Layer 4 graceful degradation behavior
- `src/stream.ts` — (via PR #1)
- `src/event-parser.ts` — (via PR #1)
- `src/kiro-cli.ts` — (via PR #2)

## Files Changed

**New:**
- `src/fallback.ts` (278 lines)
- `test/fallback.test.ts` (391 lines)

**Modified:**
- `src/index.ts` — Entry point now uses fallback wrapper
- `src/oauth.ts` — Graceful degradation returns stale creds
- `src/stream.ts`, `src/event-parser.ts`, `src/kiro-cli.ts` — Bug fixes

## Testing

- All tests pass (234 total)
- 18 new tests for fallback logic:
  - Model mapping coverage
  - Provider tagging verification
  - Error propagation
  - Configuration resolution

## Requirements

**Peer Dependency:**
- Requires `@earendil-works/pi-ai` with `pi-provider-bedrock` module

**AWS Credentials:**
- Must have valid AWS credentials (via environment, profile, or IAM)
- Uses standard AWS SDK credential chain

**Environment Variables (optional):**
- `PI_BEDROCK_PROFILE` — Override AWS profile for Bedrock
- `AWS_PROFILE` — Standard AWS profile
- `PI_BEDROCK_REGION` — Override region selection

## Impact

**Before:** Kiro API failure → User sees error → Conversation blocked  
**After:** Kiro API failure → Seamless fallback to Bedrock → Conversation continues

Significantly improves reliability and user experience during Kiro service issues or auth edge cases.

## Dependencies

This PR includes bug fixes (PR #1, PR #2) to make it self-contained and fully functional. Those can merge independently; this branch will just have duplicate commits (harmless).

---

**GitHub URL:** https://github.com/mikeyobrien/pi-provider-kiro/compare/main...samfoy:pi-provider-kiro:feat/bedrock-fallback

**Commits:**
```
6ed000a fix: refresh token from kiro-cli on 403 before retrying
4519eb3 fix: handle error events mid-stream and reset idle timer on meaningful events
bb55ba9 fix: read snake_case device registration credentials from kiro-cli
34a70e8 feat: add Bedrock fallback with provider tagging in status
435cd5a fix: throw Bedrock errors instead of leaking error events to UI
772e394 fix: return stale credentials on refresh failure to allow Bedrock fallback
```
