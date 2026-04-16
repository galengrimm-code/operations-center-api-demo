# John Deere API Integration Guide

A practical guide to getting data flowing between a web application and the John Deere Operations Center API. Covers the full setup from developer portal registration through to successful API calls.

---

## Overview

John Deere uses a **three-layer authorization model**:

1. **App Registration** -- Register your application and get approved for API scopes
2. **User Authentication (OAuth 2.0)** -- Users log in with their John Deere credentials
3. **Organization Data Sharing** -- Each organization must explicitly grant your app access to its data

All three must be completed before your app can read any farm data. Missing any one of them results in a 403 Forbidden error.

---

## Step 1: Register Your Application

### Developer Portal

1. Go to the [John Deere Developer Portal](https://developer.deere.com)
2. Create a new application
3. Set the **redirect URIs**:
   - `http://localhost:3000/auth/callback` (local development)
   - `https://your-production-domain.com/auth/callback` (production)
4. Request the scopes your app needs (see Scopes section below)
5. Provide a business justification for your access request
6. Note your **Application ID** (this is your Client ID) and **Client Secret**

### Scopes

| Scope | Access |
|-------|--------|
| `ag1` | Fields, boundaries |
| `ag2` | Crop data |
| `ag3` | Advanced ag data |
| `org1` | Organization listing |
| `org2` | Organization details |
| `work1` | Field operations (harvest, seeding) |
| `work2` | Advanced operations data |
| `offline_access` | Refresh tokens (required for long-lived sessions) |

For a field data visualization app, request all of the above. For equipment-only apps, `org1 org2` plus equipment-specific scopes may suffice.

### Approval Timeline

- **Organization scopes** (`org1`, `org2`) are typically approved quickly
- **Ag and work scopes** (`ag1-3`, `work1-2`) may take longer as they require review
- You can verify approval by checking if the API returns data vs. 403 errors

---

## Step 2: API Environments

John Deere has multiple API environments. Use the correct base URL:

| Environment | Base URL | Use Case |
|-------------|----------|----------|
| **Production** | `https://api.deere.com/platform` | Real farm data, real organizations |
| **Sandbox** | `https://sandboxapi.deere.com/platform` | Test data only, fake organizations |

**Important:** The sandbox does not contain real organization or field data. If your users are connecting real John Deere accounts, you must use the production API. Tokens issued via OAuth work against production -- the sandbox will return 403 for real org IDs.

The **OAuth token endpoint** is the same for both environments:
```
https://signin.johndeere.com/oauth2/aus78tnlaysMraFhC1t7/v1/token
```

---

## Step 3: OAuth 2.0 Authentication

### Flow

1. **Redirect user** to John Deere's authorization URL:
   ```
   https://signin.johndeere.com/oauth2/aus78tnlaysMraFhC1t7/v1/authorize
     ?client_id=YOUR_CLIENT_ID
     &response_type=code
     &redirect_uri=YOUR_REDIRECT_URI
     &scope=ag1+ag2+ag3+org1+org2+work1+work2+offline_access
     &state=RANDOM_STATE_VALUE
   ```

2. **User logs in** on John Deere's site and grants permission

3. **John Deere redirects back** to your redirect URI with an authorization code:
   ```
   https://your-app.com/auth/callback?code=AUTHORIZATION_CODE&state=STATE
   ```

4. **Exchange the code for tokens** (server-side):
   ```
   POST https://signin.johndeere.com/oauth2/aus78tnlaysMraFhC1t7/v1/token
   Content-Type: application/x-www-form-urlencoded

   grant_type=authorization_code
   &code=AUTHORIZATION_CODE
   &redirect_uri=YOUR_REDIRECT_URI
   &client_id=YOUR_CLIENT_ID
   &client_secret=YOUR_CLIENT_SECRET
   ```

5. **Store the tokens** securely (server-side only, never expose to the browser):
   - `access_token` -- short-lived, used for API calls
   - `refresh_token` -- long-lived, used to get new access tokens
   - `expires_in` -- seconds until the access token expires

### Token Refresh

Access tokens expire. Refresh before they expire (recommend 5-minute buffer):

```
POST https://signin.johndeere.com/oauth2/aus78tnlaysMraFhC1t7/v1/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&refresh_token=STORED_REFRESH_TOKEN
&client_id=YOUR_CLIENT_ID
&client_secret=YOUR_CLIENT_SECRET
```

### Security

- **Never expose** the client secret or access tokens to the browser/client
- Route all John Deere API calls through your backend (API routes, edge functions, etc.)
- Store tokens in a database with appropriate access controls

---

## Step 4: Organization Data Sharing (The Step Most People Miss)

After OAuth authentication, your app can list organizations. But **you cannot access an organization's data** (fields, operations, equipment) until the user explicitly grants your app access.

### How It Works

1. Call the organizations endpoint:
   ```
   GET https://api.deere.com/platform/organizations
   Authorization: Bearer ACCESS_TOKEN
   Accept: application/vnd.deere.axiom.v3+json
   ```

2. Check each organization's `links` array:
   - If it contains links like `fields`, `machines`, `boundaries` -- data access is granted
   - If it only contains a `connections` link -- the user needs to authorize data sharing

3. If authorization is needed, redirect the user to:
   ```
   https://connections.deere.com/connections/YOUR_CLIENT_ID/select-organizations
   ```

4. The user selects which organizations to share data with your app

5. After authorization, re-authenticate (new OAuth flow) to get a token with the updated permissions

### Detecting the Need for Authorization

```javascript
for (const org of organizations) {
  const hasDataLinks = org.links?.some(l =>
    ['fields', 'machines', 'boundaries'].includes(l.rel)
  );

  if (!hasDataLinks) {
    const connectionsLink = org.links?.find(l => l.rel === 'connections');
    if (connectionsLink) {
      // User needs to visit connectionsLink.uri to grant access
    }
  }
}
```

### Common Symptom

If you skip this step, API calls to organization-specific endpoints (fields, operations, equipment) will return **403 Forbidden** even though the OAuth token is valid and the organization is listed.

---

## Step 5: Making API Calls

### Required Headers

```javascript
{
  'Authorization': `Bearer ${accessToken}`,
  'Accept': 'application/vnd.deere.axiom.v3+json'
}
```

### Common Endpoints

| Endpoint | Description |
|----------|-------------|
| `/organizations` | List user's organizations |
| `/organizations/{orgId}/fields` | List fields for an org |
| `/organizations/{orgId}/fields?embed=activeBoundary,clients,farms` | Fields with boundary data |
| `/organizations/{orgId}/fields/{fieldId}/boundaries` | Field boundaries |
| `/organizations/{orgId}/fields/{fieldId}/fieldOperations` | Operations for a field |
| `/fieldOperations/{opId}/measurementTypes/{type}` | Measurement data (yield, area) |

### Pagination

John Deere APIs use link-based pagination. Check the response for a `nextPage` link:

```javascript
const nextLink = (data.links || []).find(l => l.rel === 'nextPage');
if (nextLink) {
  // Fetch nextLink.uri for the next page
}
```

### Measurement Types

| Operation Type | Measurement Type |
|----------------|-----------------|
| harvest | HarvestYieldResult |
| seeding | SeedingRateResult |
| application | ApplicationRateResult |
| tillage | TillageDepthResult |

---

## Troubleshooting

### 403 Forbidden on Organization Data

**Cause:** Organization has not authorized your app for data sharing.

**Fix:** Direct the user to `https://connections.deere.com/connections/YOUR_CLIENT_ID/select-organizations` to grant access, then re-authenticate.

### 403 Forbidden on All Endpoints

**Cause:** API scopes not yet approved, or using sandbox URL with production tokens.

**Fix:** Verify scope approval in the Developer Portal. Ensure your API base URL matches your environment (production tokens need `api.deere.com`, not `sandboxapi.deere.com`).

### 401 Unauthorized

**Cause:** Access token expired.

**Fix:** Use the refresh token to get a new access token. Implement proactive refresh (before expiry) to avoid interruptions.

### Token Exchange Fails

**Cause:** Redirect URI mismatch, invalid client credentials, or authorization code already used.

**Fix:** Ensure the redirect URI in the token exchange request exactly matches what's registered in the Developer Portal. Authorization codes are single-use.

### Organizations List Is Empty

**Cause:** User's John Deere account may not be associated with any organizations, or scopes are insufficient.

**Fix:** User needs to be added to an organization in John Deere Operations Center. Verify `org1`/`org2` scopes are approved.

---

## Architecture Recommendations

1. **Keep secrets server-side** -- Client ID can be public (used in OAuth redirect URL), but the client secret and all tokens must stay on the server.

2. **One connection per user** -- Store tokens in a database table keyed by user ID. Use row-level security to prevent cross-user access.

3. **Proactive token refresh** -- Check token expiry before each API call. If expiring within 5 minutes, refresh first.

4. **Handle the connections flow** -- Build UI to detect when organizations need data sharing authorization and guide users through the connections URL.

5. **Paginate everything** -- John Deere APIs paginate results. Always follow `nextPage` links to get complete data.

6. **Cache imported data** -- Store field and operation data in your own database after import. Don't call the John Deere API on every page load.
