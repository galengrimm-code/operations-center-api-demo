import { SupabaseClient } from "npm:@supabase/supabase-js@2";

export const JOHN_DEERE_API_BASE = "https://api.deere.com/platform";
export const JOHN_DEERE_TOKEN_URL = "https://signin.johndeere.com/oauth2/aus78tnlaysMraFhC1t7/v1/token";
export const JOHN_DEERE_CLIENT_ID = Deno.env.get("JOHN_DEERE_CLIENT_ID") || "";
export const JOHN_DEERE_CLIENT_SECRET = Deno.env.get("JOHN_DEERE_CLIENT_SECRET") || "";

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export interface Connection {
  id: string;
  user_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  selected_org_id: string | null;
  selected_org_name: string | null;
}

export async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<TokenResponse> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: JOHN_DEERE_CLIENT_ID,
    client_secret: JOHN_DEERE_CLIENT_SECRET,
  });

  const response = await fetch(JOHN_DEERE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
  }

  return response.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: JOHN_DEERE_CLIENT_ID,
    client_secret: JOHN_DEERE_CLIENT_SECRET,
  });

  const response = await fetch(JOHN_DEERE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
  }

  return response.json();
}

export async function getValidToken(supabase: SupabaseClient, connection: Connection): Promise<string> {
  const expiresAt = new Date(connection.token_expires_at);
  const now = new Date();
  const bufferMs = 5 * 60 * 1000;

  if (expiresAt.getTime() - now.getTime() > bufferMs) {
    return connection.access_token;
  }

  const tokens = await refreshAccessToken(connection.refresh_token);
  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await supabase
    .from("john_deere_connections")
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: newExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connection.id);

  return tokens.access_token;
}

export async function callJohnDeereApi(accessToken: string, endpoint: string): Promise<Response> {
  return fetch(`${JOHN_DEERE_API_BASE}${endpoint}`, {
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Accept": "application/vnd.deere.axiom.v3+json",
    },
  });
}

export async function callJohnDeereUrl(accessToken: string, fullUrl: string): Promise<Response> {
  return fetch(fullUrl, {
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Accept": "application/vnd.deere.axiom.v3+json",
    },
  });
}

export async function getUserConnection(supabase: SupabaseClient, userId: string): Promise<Connection | null> {
  const { data, error } = await supabase
    .from("john_deere_connections")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;
  return data as Connection;
}
