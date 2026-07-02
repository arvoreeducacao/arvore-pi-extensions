# PR #3: History Sanitization Fix

**Branch:** `fix/history-sanitization` → `upstream/main`  
**Type:** Bug Fix  
**Size:** 1 commit, 16 lines changed

## Title
```
fix: drop empty assistant messages from history sanitization
```

## Description

### Problem

Empty assistant messages (messages with no content and no tool uses) can appear in conversation history due to API errors, malformed responses, or edge cases in message construction. When these are sent to the Kiro API, they cause validation failures.

### Fix

Add a check in `sanitizeHistory()` to skip assistant messages that have:
- No `content` field
- No `toolUses` array

This is a 2-line addition with proper documentation.

### Example

**Before:**
```ts
history = [
  { userInputMessage: { content: "Hello" } },
  { assistantResponseMessage: {} },  // ← Empty, causes API error
  { userInputMessage: { content: "Are you there?" } }
]
```

**After:**
```ts
history = [
  { userInputMessage: { content: "Hello" } },
  // Empty message dropped during sanitization
  { userInputMessage: { content: "Are you there?" } }
]
```

## Files Changed

- `src/history.ts` — Add empty message check (2 lines)
- `test/history.test.ts` — Add test case (14 lines)

## Testing

- All existing tests pass (224 total)
- New test: verifies empty assistant messages are removed

## Impact

Prevents validation errors from malformed history entries, improving reliability when conversation state includes API error artifacts.

---

**GitHub URL:** https://github.com/mikeyobrien/pi-provider-kiro/compare/main...samfoy:pi-provider-kiro:fix/history-sanitization

**Commits:**
```
9ef247d fix: drop empty assistant messages from history sanitization
```
