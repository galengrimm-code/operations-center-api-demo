"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMapContext } from "@/contexts/map-context";
import { useAuth } from "@/contexts/auth-context";
import { fetchStoredOperations } from "@/lib/john-deere-client";
import { formatArea } from "@/lib/area-utils";
import {
  X,
  MapPin,
  Wheat,
  Sprout,
  Droplets,
  ArrowRight,
  Loader2,
  Map as MapIcon,
} from "lucide-react";
import type { StoredFieldOperation } from "@/types/john-deere";
import { filterHiddenOperations } from "@/lib/crop-filter";

export function FieldSidePanel() {
  const router = useRouter();
  const { johnDeereConnection } = useAuth();
  const {
    selectedFieldId,
    setSelectedFieldId,
    fields,
    refreshKey,
    selectedOperation,
    setSelectedOperation,
  } = useMapContext();
  const [operations, setOperations] = useState<StoredFieldOperation[]>([]);
  const [opsLoading, setOpsLoading] = useState(false);

  const field = fields.find((f) => f.jd_field_id === selectedFieldId);
  const preferredUnit = johnDeereConnection?.preferred_area_unit || "ac";
  const hiddenCrops = johnDeereConnection?.hidden_crop_names || [];
  const isOpen = !!selectedFieldId && !!field;

  useEffect(() => {
    if (!selectedFieldId) {
      setOperations([]);
      setSelectedOperation(null);
      return;
    }
    setOpsLoading(true);
    setSelectedOperation(null);
    fetchStoredOperations(selectedFieldId)
      .then((data) => setOperations(filterHiddenOperations(data.operations || [], hiddenCrops)))
      .catch(() => setOperations([]))
      .finally(() => setOpsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFieldId, refreshKey, setSelectedOperation, hiddenCrops.join(",")]);

  const handleClose = () => {
    setSelectedFieldId(null);
    setSelectedOperation(null);
    router.push("/map");
  };

  const handleToggleOperation = (op: StoredFieldOperation) => {
    if (selectedOperation?.id === op.id) {
      setSelectedOperation(null);
    } else {
      setSelectedOperation(op);
    }
  };

  const harvestOps = operations.filter((op) => op.operation_type === "harvest");
  const seedingOps = operations.filter((op) => op.operation_type === "seeding");

  return (
    <div
      className={`absolute bottom-0 right-0 top-0 z-20 w-[420px] max-w-[calc(100%-64px)] transition-transform duration-300 ease-out ${isOpen ? "translate-x-0" : "translate-x-full"} `}
    >
      <div className="glass-panel h-full overflow-y-auto border-l border-white/[0.06]">
        {field && (
          <div className="p-5">
            {/* Header */}
            <div className="mb-5 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold text-white">{field.name}</h2>
                <div className="mt-1 flex items-center gap-2">
                  {field.boundary_area_value && (
                    <span className="font-mono-data text-sm text-emerald-400">
                      {formatArea(
                        field.boundary_area_value,
                        field.boundary_area_unit,
                        preferredUnit,
                      )}
                    </span>
                  )}
                  {field.has_irrigated_boundary && field.irrigated_boundary_area_value && (
                    <span className="font-mono-data flex items-center gap-1 text-sm text-cyan-400">
                      <Droplets className="h-3.5 w-3.5" />
                      {formatArea(
                        field.irrigated_boundary_area_value,
                        field.irrigated_boundary_area_unit,
                        preferredUnit,
                      )}{" "}
                      irrigated
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={handleClose}
                className="flex-shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Client / Farm badges */}
            <div className="mb-6 flex flex-wrap gap-2">
              {field.client_name && (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/20 bg-sky-500/10 px-2.5 py-1 text-xs text-sky-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
                  {field.client_name}
                </span>
              )}
              {field.farm_name && (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  {field.farm_name}
                </span>
              )}
              {field.has_irrigated_boundary && (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
                  Irrigated
                </span>
              )}
            </div>

            {/* Divider */}
            <div className="mb-5 border-t border-white/[0.06]" />

            {/* Operations */}
            <div className="space-y-4">
              <h3 className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Operations
              </h3>

              {opsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
                </div>
              ) : operations.length === 0 ? (
                <p className="py-4 text-sm text-slate-500">No operations synced for this field.</p>
              ) : (
                <>
                  {/* Harvest */}
                  {harvestOps.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-amber-400">
                        <Wheat className="h-4 w-4" />
                        <span className="text-xs font-medium">Harvest ({harvestOps.length})</span>
                      </div>
                      {harvestOps.slice(0, 3).map((op) => (
                        <OperationCard
                          key={op.id}
                          op={op}
                          preferredUnit={preferredUnit}
                          isSelected={selectedOperation?.id === op.id}
                          onToggle={handleToggleOperation}
                        />
                      ))}
                      {harvestOps.length > 3 && (
                        <Link
                          href={`/operations?type=harvest&field=${selectedFieldId}`}
                          className="flex items-center gap-1 text-xs text-emerald-400 transition-colors hover:text-emerald-300"
                        >
                          View all {harvestOps.length} <ArrowRight className="h-3 w-3" />
                        </Link>
                      )}
                    </div>
                  )}

                  {/* Seeding */}
                  {seedingOps.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-emerald-400">
                        <Sprout className="h-4 w-4" />
                        <span className="text-xs font-medium">Planting ({seedingOps.length})</span>
                      </div>
                      {seedingOps.slice(0, 3).map((op) => (
                        <OperationCard
                          key={op.id}
                          op={op}
                          preferredUnit={preferredUnit}
                          isSelected={selectedOperation?.id === op.id}
                          onToggle={handleToggleOperation}
                        />
                      ))}
                      {seedingOps.length > 3 && (
                        <Link
                          href={`/operations?type=seeding&field=${selectedFieldId}`}
                          className="flex items-center gap-1 text-xs text-emerald-400 transition-colors hover:text-emerald-300"
                        >
                          View all {seedingOps.length} <ArrowRight className="h-3 w-3" />
                        </Link>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Actions */}
            <div className="mt-6 space-y-2 border-t border-white/[0.06] pt-5">
              <Link
                href="/fields"
                className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-slate-300 transition-colors hover:bg-white/[0.06]"
              >
                <span className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-slate-500" />
                  View all fields
                </span>
                <ArrowRight className="h-4 w-4 text-slate-500" />
              </Link>
              <Link
                href="/operations"
                className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-slate-300 transition-colors hover:bg-white/[0.06]"
              >
                <span className="flex items-center gap-2">
                  <Wheat className="h-4 w-4 text-slate-500" />
                  View all operations
                </span>
                <ArrowRight className="h-4 w-4 text-slate-500" />
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function OperationCard({
  op,
  preferredUnit,
  isSelected,
  onToggle,
}: {
  op: StoredFieldOperation;
  preferredUnit: string;
  isSelected: boolean;
  onToggle: (op: StoredFieldOperation) => void;
}) {
  const hasOverlay = !!op.map_image_path && !!op.map_image_extent;

  return (
    <button
      onClick={hasOverlay ? () => onToggle(op) : undefined}
      className={`w-full rounded-lg px-3 py-2.5 text-left transition-all ${
        isSelected
          ? "bg-emerald-500/15 border border-emerald-500/30 ring-1 ring-emerald-500/20"
          : hasOverlay
            ? "cursor-pointer border border-white/[0.06] bg-white/[0.03] hover:border-white/[0.1] hover:bg-white/[0.06]"
            : "cursor-default border border-white/[0.06] bg-white/[0.03]"
      } `}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-white">{op.crop_name || "Unknown Crop"}</span>
        <div className="flex items-center gap-1.5">
          {isSelected && (
            <span className="flex items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
              <MapIcon className="h-3 w-3" />
              On map
            </span>
          )}
          {!isSelected && hasOverlay && <MapIcon className="h-3.5 w-3.5 text-slate-500" />}
          {op.crop_season && (
            <span className="font-mono-data rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
              {op.crop_season}
            </span>
          )}
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-xs text-slate-400">
        {op.area_value != null && (
          <span className="font-mono-data">
            {formatArea(op.area_value, op.area_unit, preferredUnit)}
          </span>
        )}
        {op.avg_yield_value != null && (
          <span className="font-mono-data text-amber-400/70">
            {op.avg_yield_value.toFixed(1)} {op.avg_yield_unit || "bu/ac"}
          </span>
        )}
        {op.avg_moisture != null && (
          <span className="font-mono-data flex items-center gap-0.5 text-blue-400/70">
            <Droplets className="h-3 w-3" />
            {op.avg_moisture.toFixed(1)}%
          </span>
        )}
      </div>

      {/* Legend */}
      {isSelected && op.map_image_legends && op.map_image_legends.length > 0 && (
        <div className="mt-2 border-t border-white/[0.06] pt-2">
          <div className="flex flex-wrap items-center gap-1">
            {op.map_image_legends.map((entry, i) => (
              <div key={i} className="flex items-center gap-1">
                <div
                  className="h-2.5 w-2.5 flex-shrink-0 rounded-sm"
                  style={{ backgroundColor: entry.hexColor || "#666" }}
                />
                {entry.label && (
                  <span className="font-mono-data text-[9px] text-slate-500">{entry.label}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </button>
  );
}
