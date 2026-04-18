'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { useFields } from '@/hooks/use-fields';
import { fetchStoredOperations, importOperations } from '@/lib/john-deere-client';
import { supabase } from '@/lib/supabase';
import { formatArea } from '@/lib/area-utils';
import { IrrigationAnalysis } from '@/components/dashboard/irrigation-analysis';
import { Wheat, Sprout, Droplets, Loader2, RefreshCw, Calendar } from 'lucide-react';
import type { StoredFieldOperation } from '@/types/john-deere';
import { filterHiddenOperations } from '@/lib/crop-filter';

function OperationImage({ imagePath }: { imagePath: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    supabase.storage
      .from('operation-images')
      .download(imagePath)
      .then(({ data }) => { if (data) setSrc(URL.createObjectURL(data)); });
  }, [imagePath]);
  if (!src) return null;
  return <img src={src} alt="Operation map" className="w-full rounded-xl border border-white/[0.06] mt-3" />;
}

type TabId = 'harvest' | 'seeding' | 'irrigation';

const TABS: { id: TabId; label: string; icon: typeof Wheat }[] = [
  { id: 'harvest', label: 'Harvest', icon: Wheat },
  { id: 'seeding', label: 'Planting', icon: Sprout },
  { id: 'irrigation', label: 'Irrigation', icon: Droplets },
];

function formatDate(dateString: string | null) {
  if (!dateString) return 'Unknown';
  try {
    return new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return dateString; }
}

export default function OperationsPage() {
  const { johnDeereConnection } = useAuth();
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get('type') as TabId) || 'harvest';

  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const [operations, setOperations] = useState<StoredFieldOperation[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { fields } = useFields();
  const preferredUnit = johnDeereConnection?.preferred_area_unit || 'ac';
  const hiddenCrops = johnDeereConnection?.hidden_crop_names || [];

  useEffect(() => {
    if (johnDeereConnection?.selected_org_id && activeTab !== 'irrigation') loadOps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [johnDeereConnection?.selected_org_id, activeTab, hiddenCrops.join(',')]);

  const loadOps = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchStoredOperations(undefined, activeTab);
      setOperations(filterHiddenOperations(data.operations || [], hiddenCrops));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load operations');
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await importOperations();
      if (activeTab !== 'irrigation') await loadOps();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync');
    } finally {
      setSyncing(false);
    }
  };

  const fieldGroups = useMemo(() => {
    return operations.reduce((acc, op) => {
      const key = op.jd_field_id;
      if (!acc[key]) acc[key] = [];
      acc[key].push(op);
      return acc;
    }, {} as Record<string, StoredFieldOperation[]>);
  }, [operations]);

  const fieldEntries = Object.entries(fieldGroups);

  const subtitleText = activeTab === 'irrigation'
    ? 'Irrigated vs dryland analysis'
    : `${operations.length} ${activeTab === 'harvest' ? 'harvest' : 'planting'} operations`;

  return (
    <div className="min-h-[calc(100vh-48px)] bg-slate-950 p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-white">Operations</h1>
            <p className="text-sm text-slate-400 mt-0.5">{subtitleText}</p>
          </div>
          {activeTab !== 'irrigation' && (
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-2 px-4 py-2 bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] rounded-xl text-sm text-slate-300 transition-colors disabled:opacity-50"
            >
              {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {syncing ? 'Syncing...' : 'Sync Operations'}
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 p-1 glass rounded-xl w-fit">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Irrigation tab */}
        {activeTab === 'irrigation' && (
          <div className="irrigation-dark-wrapper">
            <IrrigationAnalysis fields={fields} preferredUnit={preferredUnit} />
          </div>
        )}

        {/* Harvest/Planting content */}
        {activeTab !== 'irrigation' && (
          <>
            {loading && operations.length === 0 ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
              </div>
            ) : error ? (
              <div className="glass rounded-xl p-4 border-red-500/20 bg-red-500/10">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            ) : operations.length === 0 ? (
              <div className="text-center py-20">
                {activeTab === 'harvest' ? (
                  <Wheat className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                ) : (
                  <Sprout className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                )}
                <p className="text-slate-400">No {activeTab === 'harvest' ? 'harvest' : 'planting'} operations found.</p>
                <p className="text-sm text-slate-500 mt-1">Import fields and sync operations to see data here.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {fieldEntries.map(([fieldId, ops]) => (
                  <div key={fieldId} className="glass rounded-xl overflow-hidden">
                    <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-2">
                      <span className="text-sm font-medium text-white">{fieldId}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-slate-400 font-mono-data">
                        {ops.length} op{ops.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="divide-y divide-white/[0.04]">
                      {ops.map(op => (
                        <div key={op.id} className="px-5 py-4">
                          <div className="flex flex-wrap items-center gap-3 text-sm">
                            {op.crop_name && (
                              <span className="font-medium text-white">{op.crop_name}</span>
                            )}
                            {op.crop_season && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-slate-400 font-mono-data">
                                {op.crop_season}
                              </span>
                            )}
                            <span className="flex items-center gap-1 text-slate-400">
                              <Calendar className="w-3.5 h-3.5" />
                              {formatDate(op.start_date)}
                            </span>
                            {op.area_value != null && (
                              <span className="font-mono-data text-slate-400">
                                {formatArea(op.area_value, op.area_unit, preferredUnit)}
                              </span>
                            )}
                            {op.avg_yield_value != null && (
                              <span className="font-mono-data text-amber-400/80">
                                {op.avg_yield_value.toLocaleString(undefined, { maximumFractionDigits: activeTab === 'harvest' ? 2 : 0 })} {op.avg_yield_unit || ''}
                              </span>
                            )}
                            {op.avg_moisture != null && (
                              <span className="flex items-center gap-0.5 font-mono-data text-blue-400/80">
                                <Droplets className="w-3.5 h-3.5" />
                                {op.avg_moisture.toFixed(1)}%
                              </span>
                            )}
                          </div>
                          {op.variety_name && op.variety_name !== '---' && (
                            <p className="text-xs text-slate-500 mt-1.5">Variety: {op.variety_name}</p>
                          )}
                          {op.map_image_path && <OperationImage imagePath={op.map_image_path} />}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
