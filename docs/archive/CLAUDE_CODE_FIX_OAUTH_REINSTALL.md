# Claude Code Task: Fix OAuth Reinstall Error

**Priority:** BLOCKING — Philip cannot reinstall the app in his test sub-account, which blocks ALL snapshot and workflow testing.

**Date:** 2026-03-31

---

## THE ERROR

When Philip reinstalls the ScaleSafe app in his GHL sub-account (Vine and Branch), the OAuth callback returns:

```json
{"error":"VALIDATION_ERROR","message":"GHL token response missing locationId — cannot provision merchant"}
```

This means the `/auth/callback` handler is exchanging the OAuth code for tokens, but the GHL token response does NOT contain a `locationId` field (or it's under a different key than expected).

---

## YOUR TASK

1. **Find the OAuth callback handler** — likely at `/auth/callback` in the routes. Find where the app exchanges the authorization code for tokens and where it extracts `locationId` from the response.

2. **Log the full GHL token response** — Add temporary debug logging that captures the ENTIRE response body from GHL's token endpoint. The response likely contains location info under a different field name than what the code expects (e.g., `locationId` vs `location_id` vs nested under `userType` or `companyId`).

3. **Check for these common GHL OAuth issues:**
   - GHL sometimes returns `locationId` only for location-level installs, and `companyId` for agency-level installs. The app may be installed at the wrong level.
   - The token exchange may be using the wrong `grant_type` or missing the `user_type=Location` parameter.
   - GHL's OAuth token response format may have changed — the field might be `location_id` (snake_case) instead of `locationId` (camelCase) or vice versa.
   - If the merchant was previously provisioned and then uninstalled, the `merchants` table may still have a row with that `location_id`. The reinstall flow may need to handle "re-provisioning" (update existing row) rather than only "new provisioning" (insert new row).

4. **Fix the issue** so that:
   - The app correctly extracts the location identifier from GHL's token response regardless of field naming
   - Reinstalling the app in a location that was previously provisioned works (upsert, not just insert)
   - The error response includes the actual GHL response body for debugging (in development/staging only — not in production)

5. **Test the fix:**
   - Write or update a test for the OAuth callback that covers both fresh install and reinstall scenarios
   - Verify the `/auth/callback` endpoint handles missing fields gracefully with clear error messages

---

## CONTEXT: WHAT'S ALREADY WORKING (before this broke)

The app was functioning correctly before Philip uninstalled it from the test sub-account:
- OAuth callback → merchant record in Supabase ✓
- SSO via postMessage handshake → loads in GHL iframe ✓
- Merchant provisioning: 50 custom fields + 3 custom values via GHL API ✓
- Offer creation with PIF + installment pricing ✓
- Public enrollment page at /enrollment?offerId=xxx ✓
- 76+ tests passing, deployed on Railway, health check green ✓

Philip uninstalled the app from the Vine and Branch sub-account and is now trying to reinstall it. The reinstall triggers the OAuth flow again, and it's failing at the token exchange step.

---

## FILES TO CHECK

Start by searching for:
- `auth/callback` in routes
- `locationId` or `location_id` in the auth controller/service
- `VALIDATION_ERROR` and `missing locationId` in error handling code
- `merchant.service` or `provision` for the provisioning logic
- The GHL token exchange HTTP call (likely using axios or fetch to POST to `https://services.leadconnectorhq.com/oauth/token`)

---

## ARCHITECTURE REFERENCE

Per SCALESAFE_APP_BLUEPRINT_v2.1.md, the OAuth flow should:
1. Receive authorization code from GHL redirect
2. POST to GHL token endpoint to exchange code for access_token + refresh_token
3. Extract `location_id` from the response
4. Create or update merchant record in Supabase `merchants` table
5. Redirect merchant to the app dashboard

The `merchants` table schema:
```sql
merchants (
  id UUID PRIMARY KEY,
  location_id TEXT UNIQUE NOT NULL,
  company_id TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  business_name TEXT,
  support_email TEXT,
  is_active BOOLEAN DEFAULT true,
  installed_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
)
```

---

## WHAT TO REPORT BACK

After investigating, tell me:
1. What the GHL token response actually contains (the full structure)
2. What field name the code was looking for vs what GHL sends
3. Whether there's a stale merchant row from the previous install
4. The fix you applied
5. Whether tests pass after the fix

Do NOT deploy until Philip confirms the fix looks right.
