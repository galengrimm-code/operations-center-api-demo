import { supabase } from './supabase';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  console.log('[john-deere-client] Session:', session ? 'exists' : 'null');
  if (!session) {
    throw new Error('Not authenticated');
  }
  console.log('[john-deere-client] Access token (first 20 chars):', session.access_token.substring(0, 20) + '...');
  return {
    'Authorization': `Bearer ${session.access_token}`,
    'apikey': SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
  };
}

export async function exchangeCodeForTokens(code: string, redirectUri: string) {
  console.log('[john-deere-client] Exchanging code for tokens...');
  console.log('[john-deere-client] Redirect URI:', redirectUri);

  const headers = await getAuthHeaders();
  console.log('[john-deere-client] Headers prepared, making request...');

  const url = `${SUPABASE_URL}/functions/v1/john-deere-auth?action=exchange`;
  console.log('[john-deere-client] URL:', url);

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ code, redirectUri }),
  });

  console.log('[john-deere-client] Response status:', response.status);

  if (!response.ok) {
    const error = await response.json();
    console.error('[john-deere-client] Error response:', error);
    throw new Error(error.error || 'Failed to exchange code');
  }

  const result = await response.json();
  console.log('[john-deere-client] Exchange successful');
  return result;
}

export async function refreshJohnDeereToken() {
  const headers = await getAuthHeaders();
  const response = await fetch(`${SUPABASE_URL}/functions/v1/john-deere-auth?action=refresh`, {
    method: 'POST',
    headers,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to refresh token');
  }

  return response.json();
}

export async function disconnectJohnDeere() {
  const headers = await getAuthHeaders();
  const response = await fetch(`${SUPABASE_URL}/functions/v1/john-deere-auth?action=disconnect`, {
    method: 'POST',
    headers,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to disconnect');
  }

  return response.json();
}

export async function fetchOrganizations() {
  const headers = await getAuthHeaders();
  const response = await fetch(`${SUPABASE_URL}/functions/v1/john-deere-api?action=organizations`, {
    headers,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch organizations');
  }

  return response.json();
}

export async function selectOrganization(orgId: string, orgName: string) {
  const headers = await getAuthHeaders();
  const response = await fetch(`${SUPABASE_URL}/functions/v1/john-deere-api?action=select-organization`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ orgId, orgName }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to select organization');
  }

  return response.json();
}

export async function fetchFields() {
  const headers = await getAuthHeaders();
  const response = await fetch(`${SUPABASE_URL}/functions/v1/john-deere-api?action=fields`, {
    headers,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch fields');
  }

  return response.json();
}

export async function importFieldsWithBoundaries() {
  const headers = await getAuthHeaders();
  const response = await fetch(`${SUPABASE_URL}/functions/v1/john-deere-import?action=import-fields`, {
    method: 'POST',
    headers,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to import fields');
  }

  return response.json();
}

export async function importOperations() {
  const headers = await getAuthHeaders();
  const response = await fetch(`${SUPABASE_URL}/functions/v1/john-deere-import?action=import-operations`, {
    method: 'POST',
    headers,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to import operations');
  }

  return response.json();
}

export async function importFieldOperations(fieldId: string): Promise<{ totalImported: number }> {
  const headers = await getAuthHeaders();
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/john-deere-import?action=import-field-operations&fieldId=${encodeURIComponent(fieldId)}`,
    { method: 'POST', headers },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to import field operations');
  }

  return response.json();
}

export async function fetchStoredOperations(fieldId?: string, operationType?: string) {
  const headers = await getAuthHeaders();
  const params = new URLSearchParams({ action: 'get-stored-operations' });
  if (fieldId) params.set('fieldId', fieldId);
  if (operationType) params.set('operationType', operationType);

  const response = await fetch(`${SUPABASE_URL}/functions/v1/john-deere-api?${params.toString()}`, {
    headers,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch stored operations');
  }

  return response.json();
}

export async function fetchStoredFields() {
  const headers = await getAuthHeaders();
  const response = await fetch(`${SUPABASE_URL}/functions/v1/john-deere-api?action=get-stored-fields`, {
    headers,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch stored fields');
  }

  return response.json();
}

export async function fetchIrrigationAnalysis(fieldId: string) {
  const headers = await getAuthHeaders();
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/john-deere-irrigation?action=irrigation-analysis&fieldId=${encodeURIComponent(fieldId)}`,
    { headers },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch irrigation analysis');
  }

  return response.json();
}

export async function pollForShapefileUrl(
  operationId: string,
  onProgress?: (attempt: number, status: string) => void,
): Promise<string> {
  const headers = await getAuthHeaders();
  // Budget: up to ~20 minutes total. JD usually finishes in 1-3 min, but
  // some large / dense operations take 10-15 min. Backoff starts fast
  // (5s) and ramps to 20s so we don't spam when it's clearly going to be slow.
  const maxAttempts = 120;
  const startedAt = Date.now();

  const backoffMs = (attempt: number): number => {
    if (attempt <= 6) return 5_000;    // first 30s: poll every 5s
    if (attempt <= 20) return 10_000;  // next ~2.5 min: every 10s
    return 20_000;                      // after that: every 20s
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    onProgress?.(attempt, 'polling');

    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/john-deere-irrigation?action=shapefile-status&operationId=${encodeURIComponent(operationId)}`,
      { headers },
    );

    if (response.status === 202) {
      await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)));
      continue;
    }

    if (!response.ok) {
      let errorMsg = 'Failed to check shapefile status';
      try {
        const error = await response.json();
        errorMsg = error.error || errorMsg;
      } catch { /* response not JSON */ }
      throw new Error(errorMsg);
    }

    const data = await response.json();
    if (data.status === 'ready' && data.storagePath) {
      return data.storagePath as string;
    }

    throw new Error('Unexpected shapefile status response');
  }

  const elapsedMin = Math.round((Date.now() - startedAt) / 60_000);
  throw new Error(
    `Shapefile still processing after ${elapsedMin} min. John Deere is taking unusually long on this operation — try again in a few minutes (the next attempt will pick up where this one left off).`,
  );
}

export function getJohnDeereAuthUrl(redirectUri: string, state: string) {
  const params = new URLSearchParams({
    client_id: process.env.NEXT_PUBLIC_JOHN_DEERE_CLIENT_ID || '',
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'ag1 ag2 ag3 org1 org2 work1 work2 offline_access',
    state,
  });

  return `https://signin.johndeere.com/oauth2/aus78tnlaysMraFhC1t7/v1/authorize?${params.toString()}`;
}
