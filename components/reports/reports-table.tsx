'use client';

import { useState, useMemo } from 'react';
import { type ReportRow, effectiveCropName, formatCropName, toDryYield } from '@/lib/reports-data';
import { ReportsSummaryRow } from './reports-summary-row';
import { Play, RotateCcw, Loader2, AlertCircle, ArrowUp, ArrowDown, Pencil } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface ReportsTableProps {
  rows: ReportRow[];
  runningOperationId: string | null;
  failedOperationIds: Set<string>;
  onRunAnalysis: (row: ReportRow) => void;
  onRerunAnalysis: (row: ReportRow) => void;
}

function fmt(value: number | null | undefined, decimals = 1): string {
  if (value == null) return '--';
  return value.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

function fmtPct(value: number | null | undefined): string {
  if (value == null) return '--';
  return value.toFixed(1) + '%';
}

type SortKey = 'field' | 'crop' | 'irrigatedAcres' | 'drylandAcres' | 'totalAcres' | 'irrYield' | 'dryYield' | 'totalBuAc';
type SortDir = 'asc' | 'desc';

function getSortValue(row: ReportRow, key: SortKey): number | string {
  switch (key) {
    case 'field': return row.field.name;
    case 'crop': return formatCropName(effectiveCropName(row.operation));
    case 'irrigatedAcres': return row.irrigatedAcres;
    case 'drylandAcres': return row.drylandAcres;
    case 'totalAcres': return row.totalAcres;
    case 'irrYield': return toDryYield(row.analysis?.irrigated_yield ?? null, row.analysis?.irrigated_moisture ?? null, effectiveCropName(row.operation)) ?? -1;
    case 'dryYield': return toDryYield(row.analysis?.dryland_yield ?? null, row.analysis?.dryland_moisture ?? null, effectiveCropName(row.operation)) ?? -1;
    case 'totalBuAc': return toDryYield(row.operation.avg_yield_value, row.operation.avg_moisture, effectiveCropName(row.operation)) ?? -1;
    default: return 0;
  }
}

function SortHeader({ label, sortKey, currentSort, currentDir, onSort, align }: {
  label: string;
  sortKey: SortKey;
  currentSort: SortKey;
  currentDir: SortDir;
  onSort: (key: SortKey) => void;
  align?: 'left' | 'right';
}) {
  const isActive = currentSort === sortKey;
  return (
    <th
      className={`px-4 py-3 cursor-pointer hover:text-slate-200 select-none ${align === 'right' ? 'text-right' : ''}`}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive && (currentDir === 'asc'
          ? <ArrowUp className="w-3 h-3" />
          : <ArrowDown className="w-3 h-3" />
        )}
      </span>
    </th>
  );
}

export function ReportsTable({
  rows,
  runningOperationId,
  failedOperationIds,
  onRunAnalysis,
  onRerunAnalysis,
}: ReportsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('field');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'field' || key === 'crop' ? 'asc' : 'desc');
    }
  };

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const va = getSortValue(a, sortKey);
      const vb = getSortValue(b, sortKey);
      let cmp = 0;
      if (typeof va === 'string' && typeof vb === 'string') {
        cmp = va.localeCompare(vb);
      } else {
        cmp = (va as number) - (vb as number);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir]);

  const hp = { currentSort: sortKey, currentDir: sortDir, onSort: handleSort };

  return (
    <div className="glass rounded-xl overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-700 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
            <SortHeader label="Field" sortKey="field" {...hp} />
            <SortHeader label="Crop" sortKey="crop" {...hp} />
            <SortHeader label="Irr Ac" sortKey="irrigatedAcres" align="right" {...hp} />
            <SortHeader label="Dry Ac" sortKey="drylandAcres" align="right" {...hp} />
            <SortHeader label="Total Ac" sortKey="totalAcres" align="right" {...hp} />
            <SortHeader label="Irr Yield" sortKey="irrYield" align="right" {...hp} />
            <SortHeader label="Dry Yield" sortKey="dryYield" align="right" {...hp} />
            <SortHeader label="Total Bu/Ac" sortKey="totalBuAc" align="right" {...hp} />
            <th className="px-4 py-3 text-right">Mst %</th>
            <th className="px-4 py-3 text-center">Action</th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => {
            const opId = row.operation.jd_operation_id;
            const isRunning = runningOperationId === opId;
            const isFailed = failedOperationIds.has(opId);
            const hasAnalysis = !!row.analysis;
            const cropName = effectiveCropName(row.operation);
            const irrYieldDry = hasAnalysis
              ? toDryYield(row.analysis!.irrigated_yield, row.analysis!.irrigated_moisture, cropName)
              : null;
            const dryYieldDry = hasAnalysis
              ? toDryYield(row.analysis!.dryland_yield, row.analysis!.dryland_moisture, cropName)
              : null;
            const totalBuAc = toDryYield(row.operation.avg_yield_value, row.operation.avg_moisture, cropName);

            return (
              <tr
                key={opId}
                className="border-b border-slate-800 hover:bg-slate-800/50 transition-colors"
              >
                <td className="px-4 py-3 text-slate-200 font-medium">{row.field.name}</td>
                <td className="px-4 py-3 text-slate-300">
                  <CropCell row={row} />
                </td>
                <td className="px-4 py-3 text-right text-emerald-400">{fmt(row.irrigatedAcres)}</td>
                <td className="px-4 py-3 text-right text-amber-400">{fmt(row.drylandAcres)}</td>
                <td className="px-4 py-3 text-right text-slate-300">{fmt(row.totalAcres)}</td>
                <td className="px-4 py-3 text-right text-emerald-400">
                  {hasAnalysis ? fmt(irrYieldDry) : '--'}
                </td>
                <td className="px-4 py-3 text-right text-amber-400">
                  {hasAnalysis ? fmt(dryYieldDry) : '--'}
                </td>
                <td className="px-4 py-3 text-right text-cyan-400 font-medium">
                  {fmt(totalBuAc)}
                </td>
                <td className="px-4 py-3 text-right text-slate-400">
                  {fmtPct(row.operation.avg_moisture)}
                </td>
                <td className="px-4 py-3 text-center">
                  {isRunning ? (
                    <Loader2 className="w-4 h-4 animate-spin text-emerald-500 mx-auto" />
                  ) : isFailed ? (
                    <button
                      onClick={() => onRunAnalysis(row)}
                      className="text-red-400 hover:text-red-300 flex items-center gap-1 mx-auto text-xs"
                    >
                      <AlertCircle className="w-3 h-3" /> Retry
                    </button>
                  ) : hasAnalysis ? (
                    <button
                      onClick={() => onRerunAnalysis(row)}
                      className="text-slate-500 hover:text-slate-300 mx-auto"
                      title="Re-run analysis"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => onRunAnalysis(row)}
                      className="text-emerald-500 hover:text-emerald-400 mx-auto"
                      title="Run analysis"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <ReportsSummaryRow rows={rows} />
      </table>
    </div>
  );
}

const CROP_OPTIONS = [
  { value: '', label: 'Use JD default' },
  { value: 'CORN_WET', label: 'Corn' },
  { value: 'CORN_EURO', label: 'Amylose' },
  { value: 'SOYBEANS', label: 'Soybeans' },
];

function CropCell({ row }: { row: ReportRow }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  // Track override locally so the cell updates immediately after save without
  // waiting for a parent reload.
  const [override, setOverride] = useState<string | null>(row.operation.crop_name_override);

  const effective = override ?? row.operation.crop_name;
  const isOverridden = override != null && override !== row.operation.crop_name;

  const onChange = async (next: string) => {
    const value = next === '' ? null : next;
    setSaving(true);
    const { error } = await (supabase.from('field_operations') as any)
      .update({ crop_name_override: value, updated_at: new Date().toISOString() })
      .eq('id', row.operation.id);
    setSaving(false);
    if (error) {
      console.error('Failed to save crop override:', error);
      return;
    }
    setOverride(value);
    row.operation.crop_name_override = value;
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <select
          autoFocus
          defaultValue={override ?? ''}
          disabled={saving}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setEditing(false)}
          className="px-2 py-1 text-xs bg-slate-800 border border-emerald-500/40 rounded-md text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        >
          {CROP_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {saving && <Loader2 className="w-3 h-3 animate-spin text-emerald-500" />}
      </div>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="group inline-flex items-center gap-1.5 hover:text-emerald-300 transition-colors"
      title={isOverridden ? `Originally: ${formatCropName(row.operation.crop_name)} (overridden)` : 'Click to override crop type'}
    >
      <span>{formatCropName(effective)}</span>
      {isOverridden && <span className="text-[9px] uppercase tracking-wider text-cyan-400">override</span>}
      <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
    </button>
  );
}
