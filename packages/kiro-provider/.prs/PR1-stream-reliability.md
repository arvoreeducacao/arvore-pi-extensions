# PR #1: Stream Reliability Fixes

**Branch:** `fix/stream-reliability` → `upstream/main`  
**Type:** Bug Fix  
**Size:** 2 commits, 89 lines changed

## Title
```
fix: improve stream reliability — 403 token refresh and error event handling
```

## Description

Two focused stream reliability improvements that fix silent failures and authentication issues:

### 1. Refresh token from kiro-cli on 403 before retrying

When receiving `403 Forbidden`, the retry loop was reusing the same stale access token for all attempts. If the token was rotated by kiro-cli or another pi session, every retry was doomed to fail with the same invalid token.

**Fix:** Check kiro-cli's SQLite DB for a fresh token before retrying on 403. This handles the common case where another process has already refreshed credentials.

### 2. Handle error events mid-stream and reset idle timer correctly

Two issues with stream reliability:

**a) Missing error event parsing:** API error responses mid-stream (throttling, internal errors) were silently dropped because the event parser didn't recognize the error event type. This led to silent failures that exhausted retries without a useful error message.

**Fix:** Add `error` event type to `KiroStreamEvent` and parser patterns.

**b) Premature idle timeout:** The idle timer started before the first token arrived and reset on every raw read. This meant keepalive data prevented the timer from detecting a genuinely stalled stream.

**Fix:** Start idle timer after first token arrives, and only reset on meaningful parsed events (content, tool use, etc.), not on raw reads.

## Files Changed

- `src/stream.ts` — Add 403 token refresh logic, fix idle timer logic, add `streamError` tracking
- `src/event-parser.ts` — Add error event type and parser patterns
- `test/stream.test.ts` — Add test for 403 token refresh behavior

## Testing

- All existing tests pass (223 total)
- New test: `refreshes token from kiro-cli on 403 before retrying`

## Impact

- Reduces auth errors during long-running sessions
- Surfaces API errors that were previously silent
- Prevents false idle timeout on streams with keepalive data

---

**GitHub URL:** https://github.com/mikeyobrien/pi-provider-kiro/compare/main...samfoy:pi-provider-kiro:fix/stream-reliability

**Commits:**
```
2b7290e fix: refresh token from kiro-cli on 403 before retrying
e776dd0 fix: handle error events mid-stream and reset idle timer on meaningful events
```
