'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useClientFilter } from '@/contexts/client-filter-context';
import { fetchStoredFields, importFieldsWithBoundaries } from '@/lib/john-deere-client';
import { supabase } from '@/lib/supabase';
import type { StoredField } from '@/types/john-deere';

export function useFields() {
  const { johnDeereConnection } = useAuth();
  const { selectedFarm: globalFarm } = useClientFilter();
  const orgId = johnDeereConnection?.selected_org_id;

  const [allFields, setAllFields] = useState<StoredField[]>([]);

  const fields = useMemo(() => {
    if (!globalFarm) return allFields;
    return allFields.filter(f => f.farm_name === globalFarm);
  }, [allFields, globalFarm]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const refresh = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchStoredFields();
      setAllFields(data.fields || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load fields');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  const updateIrrigationStartYear = useCallback(async (fieldId: string, year: number | null) => {
    setAllFields(prev => prev.map(f => f.id === fieldId ? { ...f, irrigation_start_year: year } : f));
    const { error: updateError } = await supabase
      .from('fields')
      .update({ irrigation_start_year: year, updated_at: new Date().toISOString() } as never)
      .eq('id', fieldId);
    if (updateError) {
      setError(updateError.message);
      await refresh();
    }
  }, [refresh]);

  const importFields = useCallback(async () => {
    setIsImporting(true);
    setError(null);
    try {
      const data = await importFieldsWithBoundaries();
      setAllFields(data.fields || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import fields');
    } finally {
      setIsImporting(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const clients = useMemo(() => {
    const set = new Set<string>();
    fields.forEach(f => { if (f.client_name) set.add(f.client_name); });
    return Array.from(set).sort();
  }, [fields]);

  const farms = useMemo(() => {
    const set = new Set<string>();
    fields.forEach(f => { if (f.farm_name) set.add(f.farm_name); });
    return Array.from(set).sort();
  }, [fields]);

  return { fields, loading, error, refresh, importFields, isImporting, clients, farms, updateIrrigationStartYear };
}
