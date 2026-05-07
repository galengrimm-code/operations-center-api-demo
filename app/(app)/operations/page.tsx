"use client";

import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { useFields } from "@/hooks/use-fields";
import { fetchStoredOperations, importOperations } from "@/lib/john-deere-client";
import { supabase } from "@/lib/supabase";
import { formatArea } from "@/lib/area-utils";
import { IrrigationAnalysis } from "@/components/dashboard/irrigation-analysis";
import { Wheat, Sprout, Droplets, Loader2, RefreshCw, Calendar } from "lucide-react";
import type { StoredFieldOperation } from "@/types/john-deere";
import { filterHiddenOperations } from "@/lib/crop-filter";

function OperationImage({ imagePath }: { imagePath: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    supabase.storage
      .from("operation-images")
      .download(imagePath)
      .then(({ data }) => {
        if (data) setSrc(URL.createObjectURL(data));
      });
  }, [imagePath]);
  if (!src) return null;
  return (
    <img
      src={src}
      alt="Operation map"
      className="mt-3 w-full rounded-xl border border-white/[0.06]"
    />
  );
}

type TabId = "harvest" | "seeding" | "irrigation";

const TABS: { id: TabId; label: string; icon: typeof Wheat }[] = [
  { id: "harvest", label: "Harvest", icon: Wheat },
  { id: "seeding", label: "Planting", icon: Sprout },
  { id: "irrigation", label: "Irrigation", icon: Droplets },
];

function formatDate(dateString: string | null) {
  if (!dateString) return "Unknown";
  try {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateString;
  }
}

export default function OperationsPage() {
  const { johnDeereConnection } = useAuth();
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get("type") as TabId) || "harvest";

  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const [operations, setOperations] = useState<StoredFieldOperation[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { fields } = useFields();
  const preferredUnit = johnDeereConnection?.preferred_area_unit || "ac";
  const hiddenCrops = johnDeereConnection?.hidden_crop_names || [];

  // useFields() already applies the global farm filter. Use the resulting
  // jd_field_id set to filter operations down to the active farm.
  const allowedFieldIds = useMemo(() => new Set(fields.map((f) => f.jd_field_id)), [fields]);

  useEffect(() => {
    if (johnDeereConnection?.selected_org_id && activeTab !== "irrigation") loadOps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [johnDeereConnection?.selected_org_id, activeTab, hiddenCrops.join(",")]);

  const loadOps = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchStoredOperations(undefined, activeTab);
      setOperations(filterHiddenOperations(data.operations || [], hiddenCrops));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load operations");
    } finally {
      setLoading(false);
    }
  };

  // Apply the global farm filter on the rendered operations. We don't filter
  // setOperations directly so toggling the global filter doesn't refetch.
  const visibleOperations = useMemo(() => {
    // No filter active = no fields loaded yet OR no farm selected.
    // useFields returns ALL fields when no farm is selected, so the set will
    // contain every jd_field_id and the filter is a no-op.
    if (allowedFieldIds.size === 0) return operations;
    return operations.filter((op) => allowedFieldIds.has(op.jd_field_id));
  }, [operations, allowedFieldIds]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await importOperations();
      if (activeTab !== "irrigation") await loadOps();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync");
    } finally {
      setSyncing(false);
    }
  };

  const fieldGroups = useMemo(() => {
    return visibleOperations.reduce(
      (acc, op) => {
        const key = op.jd_field_id;
        if (!acc[key]) acc[key] = [];
        acc[key].push(op);
        return acc;
      },
      {} as Record<string, StoredFieldOperation[]>,
    );
  }, [visibleOperations]);

  const fieldEntries = Object.entries(fieldGroups);

  const subtitleText =
    activeTab === "irrigation"
      ? "Irrigated vs dryland analysis"
      : `${visibleOperations.length} ${activeTab === "harvest" ? "harvest" : "planting"} operations`;

  return (
    <div className="min-h-[calc(100vh-48px)] bg-slate-950 p-6">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-white">Operations</h1>
            <p className="mt-0.5 text-sm text-slate-400">{subtitleText}</p>
          </div>
          {activeTab !== "irrigation" && (
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/[0.06] disabled:opacity-50"
            >
              {syncing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {syncing ? "Syncing..." : "Sync Operations"}
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="glass mb-6 flex w-fit gap-1 rounded-xl p-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                  isActive
                    ? "bg-emerald-500/15 border border-emerald-500/20 text-emerald-400"
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Irrigation tab */}
        {activeTab === "irrigation" && (
          <div className="irrigation-dark-wrapper">
            <IrrigationAnalysis fields={fields} preferredUnit={preferredUnit} />
          </div>
        )}

        {/* Harvest/Planting content */}
        {activeTab !== "irrigation" && (
          <>
            {loading && visibleOperations.length === 0 ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
              </div>
            ) : error ? (
              <div className="glass rounded-xl border-red-500/20 bg-red-500/10 p-4">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            ) : visibleOperations.length === 0 ? (
              <div className="py-20 text-center">
                {activeTab === "harvest" ? (
                  <Wheat className="mx-auto mb-3 h-10 w-10 text-slate-600" />
                ) : (
                  <Sprout className="mx-auto mb-3 h-10 w-10 text-slate-600" />
                )}
                <p className="text-slate-400">
                  No {activeTab === "harvest" ? "harvest" : "planting"} operations found.
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Import fields and sync operations to see data here.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {fieldEntries.map(([fieldId, ops]) => (
                  <div key={fieldId} className="glass overflow-hidden rounded-xl">
                    <div className="flex items-center gap-2 border-b border-white/[0.06] px-5 py-3">
                      <span className="text-sm font-medium text-white">{fieldId}</span>
                      <span className="font-mono-data rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
                        {ops.length} op{ops.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div className="divide-y divide-white/[0.04]">
                      {ops.map((op) => (
                        <div key={op.id} className="px-5 py-4">
                          <div className="flex flex-wrap items-center gap-3 text-sm">
                            {op.crop_name && (
                              <span className="font-medium text-white">{op.crop_name}</span>
                            )}
                            {op.crop_season && (
                              <span className="font-mono-data rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
                                {op.crop_season}
                              </span>
                            )}
                            <span className="flex items-center gap-1 text-slate-400">
                              <Calendar className="h-3.5 w-3.5" />
                              {formatDate(op.start_date)}
                            </span>
                            {op.area_value != null && (
                              <span className="font-mono-data text-slate-400">
                                {formatArea(op.area_value, op.area_unit, preferredUnit)}
                              </span>
                            )}
                            {op.avg_yield_value != null && (
                              <span className="font-mono-data text-amber-400/80">
                                {op.avg_yield_value.toLocaleString(undefined, {
                                  maximumFractionDigits: activeTab === "harvest" ? 2 : 0,
                                })}{" "}
                                {op.avg_yield_unit || ""}
                              </span>
                            )}
                            {op.avg_moisture != null && (
                              <span className="font-mono-data flex items-center gap-0.5 text-blue-400/80">
                                <Droplets className="h-3.5 w-3.5" />
                                {op.avg_moisture.toFixed(1)}%
                              </span>
                            )}
                          </div>
                          {op.variety_name && op.variety_name !== "---" && (
                            <p className="mt-1.5 text-xs text-slate-500">
                              Variety: {op.variety_name}
                            </p>
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
