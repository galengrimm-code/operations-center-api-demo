'use client';

import { formatCropName } from '@/lib/reports-data';

interface ReportsFiltersProps {
  seasons: string[];
  crops: string[];
  fieldNames: string[];
  selectedSeason: string;
  selectedCrop: string;
  selectedField: string;
  onSeasonChange: (season: string) => void;
  onCropChange: (crop: string) => void;
  onFieldChange: (field: string) => void;
}

export function ReportsFilters({
  seasons,
  crops,
  fieldNames,
  selectedSeason,
  selectedCrop,
  selectedField,
  onSeasonChange,
  onCropChange,
  onFieldChange,
}: ReportsFiltersProps) {
  const selectClass =
    'rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500';

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1">Year</label>
        <select
          value={selectedSeason}
          onChange={(e) => onSeasonChange(e.target.value)}
          className={selectClass}
        >
          {seasons.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1">Crop</label>
        <select
          value={selectedCrop}
          onChange={(e) => onCropChange(e.target.value)}
          className={selectClass}
        >
          <option value="">All Crops</option>
          {crops.map((c) => (
            <option key={c} value={c}>{formatCropName(c)}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1">Field</label>
        <select
          value={selectedField}
          onChange={(e) => onFieldChange(e.target.value)}
          className={selectClass}
        >
          <option value="">All Fields</option>
          {fieldNames.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
