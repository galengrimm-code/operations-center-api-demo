'use client';

import { useState, useMemo } from 'react';
import { type ReportRow, formatCropName } from '@/lib/reports-data';
import { Play, RotateCcw, Loader2, AlertCircle, ArrowUp, ArrowDown } from 'lucide-react';

interface Props {
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

type SortKey = 'field' | 'crop' | 'variety' | 'irrigatedAcres' | 'drylandAcres' | 'totalAcres' | 'irrRate' | 'dryRate' | 'avgRate';
type SortDir = 'asc' | 'desc';

function getSortValue(row: ReportRow, key: SortKey): number | string {
  switch (key) {
    case 'field': return row.field.name;
    case 'crop': return formatCropName(row.operation.crop_name);
    case 'variety': return row.operation.variety_name || '';
    case 'irrigatedAcres': return row.irrigatedAcres;
    case 'drylandAcres': return row.drylandAcres;
    case 'totalAcres': return row.totalAcres;
    case 'irrRate': return row.analysis?.irrigated_yield ?? -1;
    case 'dryRate': return row.analysis?.dryland_yield ?? -1;
    case 'avgRate': return row.operation.avg_yield_value ?? -1;
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
        {isActive && (currentDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
      </span>
    </th>
  );
}

export function SeedingReportsTable({
  rows,
  runningOperationId,
  failedOperationIds,
  onRunAnalysis,
  onRerunAnalysis,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('field');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'field' || key === 'crop' || key === 'variety' ? 'asc' : 'desc');
    }
  };

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const va = getSortValue(a, sortKey);
      const vb = getSortValue(b, sortKey);
      let cmp = 0;
      if (typeof va === 'string' && typeof vb === 'string') cmp = va.localeCompare(vb);
      else cmp = (va as number) - (vb as number);
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
            <SortHeader label="Variety" sortKey="variety" {...hp} />
            <SortHeader label="Irr Ac" sortKey="irrigatedAcres" align="right" {...hp} />
            <SortHeader label="Dry Ac" sortKey="drylandAcres" align="right" {...hp} />
            <SortHeader label="Total Ac" sortKey="totalAcres" align="right" {...hp} />
            <SortHeader label="Irr Rate" sortKey="irrRate" align="right" {...hp} />
            <SortHeader label="Dry Rate" sortKey="dryRate" align="right" {...hp} />
            <SortHeader label="Avg Rate" sortKey="avgRate" align="right" {...hp} />
            <th className="px-4 py-3 text-center">Action</th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => {
            const opId = row.operation.jd_operation_id;
            const isRunning = runningOperationId === opId;
            const isFailed = failedOperationIds.has(opId);
            const hasAnalysis = !!row.analysis;

            return (
              <tr key={opId} className="border-b border-slate-800 hover:bg-slate-800/50 transition-colors">
                <td className="px-4 py-3 text-slate-200 font-medium">{row.field.name}</td>
                <td className="px-4 py-3 text-slate-300">{formatCropName(row.operation.crop_name)}</td>
                <td className="px-4 py-3 text-slate-400">{row.operation.variety_name || '--'}</td>
                <td className="px-4 py-3 text-right text-emerald-400">{fmt(row.irrigatedAcres)}</td>
                <td className="px-4 py-3 text-right text-amber-400">{fmt(row.drylandAcres)}</td>
                <td className="px-4 py-3 text-right text-slate-300">{fmt(row.totalAcres)}</td>
                <td className="px-4 py-3 text-right text-emerald-400">{hasAnalysis ? fmt(row.analysis!.irrigated_yield, 0) : '--'}</td>
                <td className="px-4 py-3 text-right text-amber-400">{hasAnalysis ? fmt(row.analysis!.dryland_yield, 0) : '--'}</td>
                <td className="px-4 py-3 text-right text-slate-300">{fmt(row.operation.avg_yield_value, 0)}</td>
                <td className="px-4 py-3 text-center">
                  {isRunning ? (
                    <Loader2 className="w-4 h-4 animate-spin text-emerald-500 mx-auto" />
                  ) : isFailed ? (
                    <button onClick={() => onRunAnalysis(row)} className="text-red-400 hover:text-red-300 flex items-center gap-1 mx-auto text-xs">
                      <AlertCircle className="w-3 h-3" /> Retry
                    </button>
                  ) : hasAnalysis ? (
                    <button onClick={() => onRerunAnalysis(row)} className="text-slate-500 hover:text-slate-300 mx-auto" title="Re-run analysis">
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  ) : (
                    <button onClick={() => onRunAnalysis(row)} className="text-emerald-500 hover:text-emerald-400 mx-auto" title="Run analysis">
                      <Play className="w-4 h-4" />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
