# PR #2: kiro-cli snake_case Credential Fix

**Branch:** `fix/kiro-cli-snake-case` → `upstream/main`  
**Type:** Bug Fix  
**Size:** 1 commit, 5 lines changed

## Title
```
fix: read snake_case device registration credentials from kiro-cli
```

## Description

### Problem

kiro-cli's SQLite database stores device registration credentials using snake_case field names:
- `client_id` 
- `client_secret`

But the code was reading them as camelCase:
- `clientId`
- `clientSecret`

**Result:** IDC (AWS Builder ID) refresh credentials were always empty strings, causing all token refresh attempts to fail silently. Users would be forced to re-authenticate via device code flow even when valid refresh tokens existed.

### Fix

1. **Read both formats with correct priority:**
   ```ts
   clientId = d.client_id || d.clientId || "";
   clientSecret = d.client_secret || d.clientSecret || "";
   ```
   Tries snake_case first (what kiro-cli actually uses), falls back to camelCase for compatibility.

2. **Fix device-registration key query:**
   Previously grabbed whichever device-registration key came first in the DB. Now matches the key prefix to the token key (e.g., `kirocli:odic:device-registration` for `kirocli:odic:token`).

## Files Changed

- `src/kiro-cli.ts` — 5 line change in `tryKiroCliToken()`

## Testing

- All existing tests pass (222 total)
- No new tests needed — fixes existing functionality

## Impact

**Before:** Token refresh never worked with kiro-cli credentials  
**After:** Token refresh works seamlessly, avoiding unnecessary re-authentication

---

**GitHub URL:** https://github.com/mikeyobrien/pi-provider-kiro/compare/main...samfoy:pi-provider-kiro:fix/kiro-cli-snake-case

**Commits:**
```
1a5442d fix: read snake_case device registration credentials from kiro-cli
```
