'use client';

import { createContext, useContext, useState, useCallback, useEffect, useMemo, ReactNode } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useClientFilter } from '@/contexts/client-filter-context';
import { fetchStoredFields, importFieldsWithBoundaries, importOperations } from '@/lib/john-deere-client';
import type { StoredField, StoredFieldOperation } from '@/types/john-deere';
import type mapboxgl from 'mapbox-gl';

interface MapContextType {
  // Map instance
  mapInstance: mapboxgl.Map | null;
  setMapInstance: (map: mapboxgl.Map | null) => void;

  // Fields
  fields: StoredField[];
  fieldsLoading: boolean;
  fieldsError: string | null;
  refreshFields: () => Promise<void>;
  importFields: () => Promise<void>;
  isImporting: boolean;

  // Operations sync
  isSyncingOps: boolean;
  syncOperations: () => Promise<void>;

  // Selection
  selectedFieldId: string | null;
  setSelectedFieldId: (id: string | null) => void;

  // Operation overlay
  selectedOperation: StoredFieldOperation | null;
  setSelectedOperation: (op: StoredFieldOperation | null) => void;

  // Filters
  selectedClient: string | null;
  setSelectedClient: (c: string | null) => void;
  selectedFarm: string | null;
  setSelectedFarm: (f: string | null) => void;
  filteredFields: StoredField[];

  // Refresh key for child components
  refreshKey: number;
}

const MapContext = createContext<MapContextType | undefined>(undefined);

export function MapProvider({ children }: { children: ReactNode }) {
  const { johnDeereConnection } = useAuth();
  const orgId = johnDeereConnection?.selected_org_id;
  const { selectedClient: globalClient } = useClientFilter();

  const [mapInstance, setMapInstance] = useState<mapboxgl.Map | null>(null);
  const [fields, setFields] = useState<StoredField[]>([]);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [fieldsError, setFieldsError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isSyncingOps, setIsSyncingOps] = useState(false);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [selectedOperation, setSelectedOperation] = useState<StoredFieldOperation | null>(null);
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [selectedFarm, setSelectedFarm] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refreshFields = useCallback(async () => {
    if (!orgId) return;
    setFieldsLoading(true);
    setFieldsError(null);
    try {
      const data = await fetchStoredFields();
      setFields(data.fields || []);
    } catch (err) {
      setFieldsError(err instanceof Error ? err.message : 'Failed to load fields');
    } finally {
      setFieldsLoading(false);
    }
  }, [orgId]);

  const importFields = useCallback(async () => {
    setIsImporting(true);
    setFieldsError(null);
    try {
      const data = await importFieldsWithBoundaries();
      setFields(data.fields || []);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setFieldsError(err instanceof Error ? err.message : 'Failed to import fields');
    } finally {
      setIsImporting(false);
    }
  }, []);

  const syncOperations = useCallback(async () => {
    setIsSyncingOps(true);
    try {
      await importOperations();
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setFieldsError(err instanceof Error ? err.message : 'Failed to sync operations');
    } finally {
      setIsSyncingOps(false);
    }
  }, []);

  // Load fields when org changes
  useEffect(() => {
    refreshFields();
  }, [refreshFields]);

  // Reset filters when org changes
  useEffect(() => {
    setSelectedClient(null);
    setSelectedFarm(null);
    setSelectedOperation(null);
  }, [orgId]);

  const filteredFields = useMemo(() => {
    let result = fields;
    // Apply global client filter first, then per-page client filter
    const activeClient = globalClient || selectedClient;
    if (activeClient) result = result.filter(f => f.client_name === activeClient);
    if (selectedFarm) result = result.filter(f => f.farm_name === selectedFarm);
    return result;
  }, [fields, globalClient, selectedClient, selectedFarm]);

  return (
    <MapContext.Provider value={{
      mapInstance,
      setMapInstance,
      fields,
      fieldsLoading,
      fieldsError,
      refreshFields,
      importFields,
      isImporting,
      isSyncingOps,
      syncOperations,
      selectedFieldId,
      setSelectedFieldId,
      selectedOperation,
      setSelectedOperation,
      selectedClient,
      setSelectedClient,
      selectedFarm,
      setSelectedFarm,
      filteredFields,
      refreshKey,
    }}>
      {children}
    </MapContext.Provider>
  );
}

export function useMapContext() {
  const context = useContext(MapContext);
  if (context === undefined) {
    throw new Error('useMapContext must be used within a MapProvider');
  }
  return context;
}
