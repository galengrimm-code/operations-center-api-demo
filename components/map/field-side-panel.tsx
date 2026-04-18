'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMapContext } from '@/contexts/map-context';
import { useAuth } from '@/contexts/auth-context';
import { fetchStoredOperations } from '@/lib/john-deere-client';
import { formatArea } from '@/lib/area-utils';
import { X, MapPin, Wheat, Sprout, Droplets, ArrowRight, Loader2, Map as MapIcon } from 'lucide-react';
import type { StoredFieldOperation } from '@/types/john-deere';
import { filterHiddenOperations } from '@/lib/crop-filter';

export function FieldSidePanel() {
  const router = useRouter();
  const { johnDeereConnection } = useAuth();
  const { selectedFieldId, setSelectedFieldId, fields, refreshKey, selectedOperation, setSelectedOperation } = useMapContext();
  const [operations, setOperations] = useState<StoredFieldOperation[]>([]);
  const [opsLoading, setOpsLoading] = useState(false);

  const field = fields.find(f => f.jd_field_id === selectedFieldId);
  const preferredUnit = johnDeereConnection?.preferred_area_unit || 'ac';
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
      .then(data => setOperations(filterHiddenOperations(data.operations || [], hiddenCrops)))
      .catch(() => setOperations([]))
      .finally(() => setOpsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFieldId, refreshKey, setSelectedOperation, hiddenCrops.join(',')]);

  const handleClose = () => {
    setSelectedFieldId(null);
    setSelectedOperation(null);
    router.push('/map');
  };

  const handleToggleOperation = (op: StoredFieldOperation) => {
    if (selectedOperation?.id === op.id) {
      setSelectedOperation(null);
    } else {
      setSelectedOperation(op);
    }
  };

  const harvestOps = operations.filter(op => op.operation_type === 'harvest');
  const seedingOps = operations.filter(op => op.operation_type === 'seeding');

  return (
    <div
      className={`
        absolute top-0 right-0 bottom-0 w-[420px] max-w-[calc(100%-64px)] z-20
        transition-transform duration-300 ease-out
        ${isOpen ? 'translate-x-0' : 'translate-x-full'}
      `}
    >
      <div className="h-full glass-panel border-l border-white/[0.06] overflow-y-auto">
        {field && (
          <div className="p-5">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 mb-5">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-white truncate">{field.name}</h2>
                <div className="flex items-center gap-2 mt-1">
                  {field.boundary_area_value && (
                    <span className="text-sm font-mono-data text-emerald-400">
                      {formatArea(field.boundary_area_value, field.boundary_area_unit, preferredUnit)}
                    </span>
                  )}
                  {field.has_irrigated_boundary && field.irrigated_boundary_area_value && (
                    <span className="flex items-center gap-1 text-sm font-mono-data text-cyan-400">
                      <Droplets className="w-3.5 h-3.5" />
                      {formatArea(field.irrigated_boundary_area_value, field.irrigated_boundary_area_unit, preferredUnit)} irrigated
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={handleClose}
                className="p-1.5 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-colors flex-shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Client / Farm badges */}
            <div className="flex flex-wrap gap-2 mb-6">
              {field.client_name && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-500/10 border border-sky-500/20 text-xs text-sky-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                  {field.client_name}
                </span>
              )}
              {field.farm_name && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  {field.farm_name}
                </span>
              )}
              {field.has_irrigated_boundary && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-xs text-cyan-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                  Irrigated
                </span>
              )}
            </div>

            {/* Divider */}
            <div className="border-t border-white/[0.06] mb-5" />

            {/* Operations */}
            <div className="space-y-4">
              <h3 className="text-xs uppercase tracking-wider text-slate-500 font-medium">
                Operations
              </h3>

              {opsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
                </div>
              ) : operations.length === 0 ? (
                <p className="text-sm text-slate-500 py-4">No operations synced for this field.</p>
              ) : (
                <>
                  {/* Harvest */}
                  {harvestOps.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-amber-400">
                        <Wheat className="w-4 h-4" />
                        <span className="text-xs font-medium">Harvest ({harvestOps.length})</span>
                      </div>
                      {harvestOps.slice(0, 3).map(op => (
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
                          className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                        >
                          View all {harvestOps.length} <ArrowRight className="w-3 h-3" />
                        </Link>
                      )}
                    </div>
                  )}

                  {/* Seeding */}
                  {seedingOps.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-emerald-400">
                        <Sprout className="w-4 h-4" />
                        <span className="text-xs font-medium">Planting ({seedingOps.length})</span>
                      </div>
                      {seedingOps.slice(0, 3).map(op => (
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
                          className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                        >
                          View all {seedingOps.length} <ArrowRight className="w-3 h-3" />
                        </Link>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Actions */}
            <div className="mt-6 pt-5 border-t border-white/[0.06] space-y-2">
              <Link
                href="/fields"
                className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] text-sm text-slate-300 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-slate-500" />
                  View all fields
                </span>
                <ArrowRight className="w-4 h-4 text-slate-500" />
              </Link>
              <Link
                href="/operations"
                className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] text-sm text-slate-300 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Wheat className="w-4 h-4 text-slate-500" />
                  View all operations
                </span>
                <ArrowRight className="w-4 h-4 text-slate-500" />
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
      className={`
        w-full text-left px-3 py-2.5 rounded-lg transition-all
        ${isSelected
          ? 'bg-emerald-500/15 border border-emerald-500/30 ring-1 ring-emerald-500/20'
          : hasOverlay
            ? 'bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:border-white/[0.1] cursor-pointer'
            : 'bg-white/[0.03] border border-white/[0.06] cursor-default'
        }
      `}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm text-white font-medium">{op.crop_name || 'Unknown Crop'}</span>
        <div className="flex items-center gap-1.5">
          {isSelected && (
            <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-medium">
              <MapIcon className="w-3 h-3" />
              On map
            </span>
          )}
          {!isSelected && hasOverlay && (
            <MapIcon className="w-3.5 h-3.5 text-slate-500" />
          )}
          {op.crop_season && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-slate-400 font-mono-data">
              {op.crop_season}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-400">
        {op.area_value != null && (
          <span className="font-mono-data">
            {formatArea(op.area_value, op.area_unit, preferredUnit)}
          </span>
        )}
        {op.avg_yield_value != null && (
          <span className="font-mono-data text-amber-400/70">
            {op.avg_yield_value.toFixed(1)} {op.avg_yield_unit || 'bu/ac'}
          </span>
        )}
        {op.avg_moisture != null && (
          <span className="flex items-center gap-0.5 font-mono-data text-blue-400/70">
            <Droplets className="w-3 h-3" />
            {op.avg_moisture.toFixed(1)}%
          </span>
        )}
      </div>

      {/* Legend */}
      {isSelected && op.map_image_legends && op.map_image_legends.length > 0 && (
        <div className="mt-2 pt-2 border-t border-white/[0.06]">
          <div className="flex items-center gap-1 flex-wrap">
            {op.map_image_legends.map((entry, i) => (
              <div key={i} className="flex items-center gap-1">
                <div
                  className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: entry.hexColor || '#666' }}
                />
                {entry.label && (
                  <span className="text-[9px] text-slate-500 font-mono-data">{entry.label}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </button>
  );
}
