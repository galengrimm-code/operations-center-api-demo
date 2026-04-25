'use client';

import { type ReportRow, effectiveCropName, toDryYield } from '@/lib/reports-data';

interface ReportsSummaryRowProps {
  rows: ReportRow[];
}

function weightedAvg(
  rows: ReportRow[],
  valueFn: (r: ReportRow) => number | null | undefined,
  weightFn: (r: ReportRow) => number,
): number | null {
  let totalWeight = 0;
  let weightedSum = 0;

  for (const row of rows) {
    const value = valueFn(row);
    if (value == null) continue;
    const weight = weightFn(row);
    weightedSum += value * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : null;
}

function fmt(value: number | null, decimals = 1): string {
  if (value == null) return '--';
  return value.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

function fmtPct(value: number | null): string {
  if (value == null) return '--';
  return value.toFixed(1) + '%';
}

export function ReportsSummaryRow({ rows }: ReportsSummaryRowProps) {
  const totalIrrAc = rows.reduce((s, r) => s + r.irrigatedAcres, 0);
  const totalDryAc = rows.reduce((s, r) => s + r.drylandAcres, 0);
  const totalAc = rows.reduce((s, r) => s + r.totalAcres, 0);

  const avgIrrYield = weightedAvg(
    rows,
    (r) => toDryYield(r.analysis?.irrigated_yield ?? null, r.analysis?.irrigated_moisture ?? null, effectiveCropName(r.operation)),
    (r) => r.analysis?.irrigated_acres || 0,
  );
  const avgDryYield = weightedAvg(
    rows,
    (r) => toDryYield(r.analysis?.dryland_yield ?? null, r.analysis?.dryland_moisture ?? null, effectiveCropName(r.operation)),
    (r) => r.analysis?.dryland_acres || 0,
  );
  const avgTotalBuAc = weightedAvg(
    rows,
    (r) => toDryYield(r.operation.avg_yield_value, r.operation.avg_moisture, effectiveCropName(r.operation)),
    (r) => r.totalAcres,
  );
  const avgTotalMst = weightedAvg(
    rows,
    (r) => r.operation.avg_moisture,
    (r) => r.totalAcres,
  );

  return (
    <tfoot>
      <tr className="border-t-2 border-slate-600 font-semibold text-slate-200">
        <td className="px-4 py-3">TOTALS</td>
        <td className="px-4 py-3"></td>
        <td className="px-4 py-3 text-right text-emerald-400">{fmt(totalIrrAc)}</td>
        <td className="px-4 py-3 text-right text-amber-400">{fmt(totalDryAc)}</td>
        <td className="px-4 py-3 text-right">{fmt(totalAc)}</td>
        <td className="px-4 py-3 text-right text-emerald-400">{fmt(avgIrrYield)}</td>
        <td className="px-4 py-3 text-right text-amber-400">{fmt(avgDryYield)}</td>
        <td className="px-4 py-3 text-right text-cyan-400">{fmt(avgTotalBuAc)}</td>
        <td className="px-4 py-3 text-right">{fmtPct(avgTotalMst)}</td>
        <td className="px-4 py-3"></td>
      </tr>
    </tfoot>
  );
}
