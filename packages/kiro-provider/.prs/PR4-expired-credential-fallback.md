# PR #4: Expired Credential Fallback

**Branch:** `feat/expired-credential-fallback` → `upstream/main`  
**Type:** Feature Enhancement  
**Size:** 4 commits, ~100 lines changed

## Title
```
feat: use expired kiro-cli credentials as fallback in OAuth refresh cascade
```

## Description

Enhances the credential refresh cascade to use expired kiro-cli credentials as a fallback when OAuth refresh fails. This improves reliability when desktop app credentials exist but the OAuth flow fails.

### The Problem

When pi's OAuth credentials become stale but kiro-cli has newer (expired) credentials, the refresh cascade would fail completely and fall back to device code flow. This forces unnecessary re-authentication even when a valid refresh token exists in kiro-cli's database.

### The Solution

Add a new fallback layer that attempts to refresh using expired kiro-cli credentials before giving up:

#### New 5-Layer Refresh Cascade

1. **Layer 1:** Pre-check — kiro-cli may already have fresh tokens
2. **Layer 2:** Direct refresh with current refresh token
3. **Layer 3:** Re-read kiro-cli (may have been updated mid-refresh by another process)
4. **Layer 4:** ✨ **NEW** — Try refreshing expired kiro-cli credentials
5. **Layer 5:** Graceful degradation (return stale creds with buffer)

### Implementation Details

**1. Fix snake_case credentials** (prerequisite)
- Same fix as PR #2, included here to make the branch self-contained
- kiro-cli uses `client_id`/`client_secret`, not `clientId`/`clientSecret`

**2. Add `getKiroCliCredentialsAllowExpired()`**
- New function in `kiro-cli.ts`
- Retrieves credentials even when access token is expired
- Includes `allowExpired` param for `tryKiroCliToken()`

**3. Use expired creds in `loginKiroBuilderID()`**
- Before falling through to device code flow
- Try refreshing expired kiro-cli credentials
- Saves the refreshed tokens back to kiro-cli DB

**4. Add Layer 4 to `refreshKiroToken()`**
- When all refresh attempts fail
- Check if kiro-cli has a newer refresh token (even if access token is expired)
- Attempt direct refresh with those credentials
- Falls through to Layer 5 if that also fails

## Files Changed

- `src/kiro-cli.ts` — Add `getKiroCliCredentialsAllowExpired()`, update `tryKiroCliToken()`
- `src/oauth.ts` — Add Layer 4 to `refreshKiroToken()`, add fallback to `loginKiroBuilderID()`
- `test/oauth.test.ts` — Update tests for new behavior

## Testing

- All existing tests pass (222 total)
- New tests for expired credential fallback
- Updated tests for the new 5-layer cascade

## Impact

**Before:** Stale OAuth credentials → immediate device code flow  
**After:** Stale OAuth credentials → try expired kiro-cli creds → use refreshed tokens → seamless experience

Significantly reduces unnecessary re-authentication when kiro-cli has valid refresh tokens.

## Dependencies

This PR includes the snake_case fix (same as PR #2) to make it self-contained. If PR #2 merges first, the first commit here will be a duplicate (harmless).

---

**GitHub URL:** https://github.com/mikeyobrien/pi-provider-kiro/compare/main...samfoy:pi-provider-kiro:feat/expired-credential-fallback

**Commits:**
```
afb5ec5 fix: read snake_case device registration credentials from kiro-cli
ceb9add feat: add getKiroCliCredentialsAllowExpired for expired token refresh
6d5e82d feat: use expired kiro-cli creds as fallback in oauth refresh cascade
373ab31 test: update oauth tests for expired credential fallback
```
