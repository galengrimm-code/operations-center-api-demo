'use client';

import { type ReportRow } from '@/lib/reports-data';
import { ReportsSummaryRow } from './reports-summary-row';
import { Play, RotateCcw, Loader2, AlertCircle } from 'lucide-react';

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

export function ReportsTable({
  rows,
  runningOperationId,
  failedOperationIds,
  onRunAnalysis,
  onRerunAnalysis,
}: ReportsTableProps) {
  return (
    <div className="glass rounded-xl overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-700 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
            <th className="px-4 py-3">Field</th>
            <th className="px-4 py-3">Crop</th>
            <th className="px-4 py-3 text-right">Irr Ac</th>
            <th className="px-4 py-3 text-right">Dry Ac</th>
            <th className="px-4 py-3 text-right">Total Ac</th>
            <th className="px-4 py-3 text-right">Irr Yield</th>
            <th className="px-4 py-3 text-right">Dry Yield</th>
            <th className="px-4 py-3 text-right">Total Yield</th>
            <th className="px-4 py-3 text-right">Irr Mst</th>
            <th className="px-4 py-3 text-right">Dry Mst</th>
            <th className="px-4 py-3 text-right">Total Mst</th>
            <th className="px-4 py-3 text-center">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const opId = row.operation.jd_operation_id;
            const isRunning = runningOperationId === opId;
            const isFailed = failedOperationIds.has(opId);
            const hasAnalysis = !!row.analysis;

            return (
              <tr
                key={opId}
                className="border-b border-slate-800 hover:bg-slate-800/50 transition-colors"
              >
                <td className="px-4 py-3 text-slate-200 font-medium">{row.field.name}</td>
                <td className="px-4 py-3 text-slate-300">{row.operation.crop_name}</td>
                <td className="px-4 py-3 text-right text-emerald-400">{fmt(row.irrigatedAcres)}</td>
                <td className="px-4 py-3 text-right text-amber-400">{fmt(row.drylandAcres)}</td>
                <td className="px-4 py-3 text-right text-slate-300">{fmt(row.totalAcres)}</td>
                <td className="px-4 py-3 text-right text-emerald-400">
                  {hasAnalysis ? fmt(row.analysis!.irrigated_yield) : '--'}
                </td>
                <td className="px-4 py-3 text-right text-amber-400">
                  {hasAnalysis ? fmt(row.analysis!.dryland_yield) : '--'}
                </td>
                <td className="px-4 py-3 text-right text-slate-300">
                  {fmt(row.operation.avg_yield_value)}
                </td>
                <td className="px-4 py-3 text-right text-emerald-400/70">
                  {hasAnalysis ? fmtPct(row.analysis!.irrigated_moisture) : '--'}
                </td>
                <td className="px-4 py-3 text-right text-amber-400/70">
                  {hasAnalysis ? fmtPct(row.analysis!.dryland_moisture) : '--'}
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
