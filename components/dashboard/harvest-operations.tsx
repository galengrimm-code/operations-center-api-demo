"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth-context";
import { fetchStoredOperations } from "@/lib/john-deere-client";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Loader2, Wheat, RefreshCw, Calendar, Droplets } from "lucide-react";
import type { StoredFieldOperation } from "@/types/john-deere";

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
    <img src={src} alt="Operation map" className="mt-3 w-full rounded-lg border border-slate-200" />
  );
}

export function HarvestOperations() {
  const { johnDeereConnection } = useAuth();
  const [operations, setOperations] = useState<StoredFieldOperation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (johnDeereConnection?.selected_org_id) {
      loadOperations();
    }
  }, [johnDeereConnection?.selected_org_id]);

  const loadOperations = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchStoredOperations(undefined, "harvest");
      setOperations(data.operations || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load harvest operations");
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "Unknown date";
    try {
      return new Date(dateString).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return dateString;
    }
  };

  // Group by field
  const fieldGroups = operations.reduce(
    (acc, op) => {
      const key = op.jd_field_id;
      if (!acc[key]) acc[key] = [];
      acc[key].push(op);
      return acc;
    },
    {} as Record<string, StoredFieldOperation[]>,
  );

  const fieldEntries = Object.entries(fieldGroups);
  const totalOperations = operations.length;

  if (!johnDeereConnection?.selected_org_id) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="py-8 text-center">
          <Wheat className="mx-auto mb-3 h-12 w-12 text-slate-300" />
          <p className="text-slate-500">Select an organization to view harvest operations</p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100">
            <Wheat className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">Harvest Operations</h3>
            <p className="text-sm text-slate-500">
              {totalOperations} operations across {fieldEntries.length} fields
            </p>
          </div>
        </div>
        <Button onClick={loadOperations} variant="outline" size="sm" disabled={isLoading}>
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      {isLoading && operations.length === 0 ? (
        <div className="p-8 text-center">
          <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-amber-600" />
          <p className="text-slate-500">Loading harvest operations...</p>
        </div>
      ) : error ? (
        <div className="p-6">
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        </div>
      ) : totalOperations === 0 ? (
        <div className="p-8 text-center">
          <Wheat className="mx-auto mb-3 h-12 w-12 text-slate-300" />
          <p className="text-slate-500">
            No harvest operations found. Import fields to sync operations.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {fieldEntries.map(([fieldId, ops]) => (
            <div key={fieldId} className="px-6 py-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="font-medium text-slate-900">{fieldId}</span>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  {ops.length} operation{ops.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="space-y-3">
                {ops.map((op) => (
                  <div key={op.id} className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center gap-4 text-sm">
                      {op.crop_name && (
                        <div className="flex items-center gap-1.5">
                          <Wheat className="h-4 w-4 text-amber-600" />
                          <span className="text-slate-700">{op.crop_name}</span>
                        </div>
                      )}
                      {op.crop_season && (
                        <span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                          {op.crop_season}
                        </span>
                      )}
                      <div className="flex items-center gap-1.5">
                        <Calendar className="h-4 w-4 text-blue-600" />
                        <span className="text-slate-700">{formatDate(op.start_date)}</span>
                      </div>
                      {op.avg_moisture != null && (
                        <div className="flex items-center gap-1.5">
                          <Droplets className="h-4 w-4 text-cyan-600" />
                          <span className="text-slate-700">
                            {op.avg_moisture.toFixed(1)}% moisture
                          </span>
                        </div>
                      )}
                      {op.avg_yield_value != null && (
                        <span className="font-medium text-slate-700">
                          Avg yield:{" "}
                          {op.avg_yield_value.toLocaleString(undefined, {
                            maximumFractionDigits: 2,
                          })}{" "}
                          {op.avg_yield_unit || ""}
                        </span>
                      )}
                      {op.area_value != null && (
                        <span className="text-slate-500">
                          {op.area_value.toLocaleString(undefined, { maximumFractionDigits: 1 })}{" "}
                          {op.area_unit || ""}
                        </span>
                      )}
                    </div>
                    {op.variety_name && op.variety_name !== "---" && (
                      <p className="mt-2 text-xs text-slate-500">Variety: {op.variety_name}</p>
                    )}
                    {op.map_image_path && <OperationImage imagePath={op.map_image_path} />}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
