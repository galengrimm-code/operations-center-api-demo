'use client';

import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { fetchStoredOperations } from '@/lib/john-deere-client';
import type { StoredFieldOperation } from '@/types/john-deere';
import { filterHiddenOperations } from '@/lib/crop-filter';

export function useOperations(fieldId?: string, operationType?: string) {
  const { johnDeereConnection } = useAuth();
  const orgId = johnDeereConnection?.selected_org_id;
  const hiddenCrops = johnDeereConnection?.hidden_crop_names || [];

  const [operations, setOperations] = useState<StoredFieldOperation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hiddenKey = hiddenCrops.join(',');

  const refresh = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchStoredOperations(fieldId, operationType);
      setOperations(filterHiddenOperations(data.operations || [], hiddenCrops));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load operations');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, fieldId, operationType, hiddenKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { operations, loading, error, refresh };
}
