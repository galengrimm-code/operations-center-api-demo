'use client';

import { useState, useEffect } from 'react';
import {
  fetchHarvestOperations,
  fetchAnalysisResults,
  buildReportRows,
  type ReportRow,
} from '@/lib/reports-data';
import type { StoredField } from '@/types/john-deere';
import { TrendingUp, Loader2 } from 'lucide-react';

interface ReportsTrendsProps {
  userId: string;
  orgId: string;
  irrigatedFields: StoredField[];
}

function fmt(value: number | null | undefined, decimals = 1): string {
  if (value == null) return '--';
  return value.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

interface TrendRow {
  season: string;
  irrigatedAcres: number;
  drylandAcres: number;
  totalAcres: number;
  irrigatedYield: number | null;
  drylandYield: number | null;
  totalYield: number | null;
}

export function ReportsTrends({ userId, orgId, irrigatedFields }: ReportsTrendsProps) {
  const [selectedField, setSelectedField] = useState('');
  const [selectedCrop, setSelectedCrop] = useState('');
  const [loading, setLoading] = useState(false);
  const [trendRows, setTrendRows] = useState<TrendRow[]>([]);
  const [availableCrops, setAvailableCrops] = useState<string[]>([]);

  const fieldNames = irrigatedFields.map((f) => f.name).sort();

  // Load available crops when field changes
  useEffect(() => {
    if (!selectedField) { setAvailableCrops([]); return; }
    const field = irrigatedFields.find((f) => f.name === selectedField);
    if (!field) return;

    const loadCrops = async () => {
      const ops = await fetchHarvestOperations(userId, orgId, [field.jd_field_id]);
      const crops = [...new Set(ops.map((o) => o.crop_name).filter(Boolean) as string[])].sort();
      setAvailableCrops(crops);
      if (crops.length > 0 && !crops.includes(selectedCrop)) {
        setSelectedCrop(crops[0]);
      }
    };
    loadCrops();
  }, [selectedField, userId, orgId, irrigatedFields]);

  // Load trend data when field+crop changes
  useEffect(() => {
    if (!selectedField || !selectedCrop) {
      setTrendRows([]);
      return;
    }

    const field = irrigatedFields.find((f) => f.name === selectedField);
    if (!field) return;

    const loadTrends = async () => {
      setLoading(true);
      try {
        const ops = await fetchHarvestOperations(
          userId,
          orgId,
          [field.jd_field_id],
          undefined,
          selectedCrop,
        );

        const opIds = ops.map((o) => o.jd_operation_id);
        const results = await fetchAnalysisResults(userId, opIds);
        const reportRows = buildReportRows([field], ops, results);

        const bySeasonMap = new Map<string, ReportRow>();
        for (const row of reportRows) {
          const season = row.operation.crop_season || 'Unknown';
          if (!bySeasonMap.has(season)) {
            bySeasonMap.set(season, row);
          }
        }

        const trends: TrendRow[] = [];
        for (const [season, row] of bySeasonMap) {
          trends.push({
            season,
            irrigatedAcres: row.analysis?.irrigated_acres || row.irrigatedAcres,
            drylandAcres: row.analysis?.dryland_acres || row.drylandAcres,
            totalAcres: row.totalAcres,
            irrigatedYield: row.analysis?.irrigated_yield ?? null,
            drylandYield: row.analysis?.dryland_yield ?? null,
            totalYield: row.operation.avg_yield_value,
          });
        }

        trends.sort((a, b) => b.season.localeCompare(a.season));
        setTrendRows(trends);
      } catch (err) {
        console.error('Failed to load trends:', err);
      } finally {
        setLoading(false);
      }
    };

    loadTrends();
  }, [selectedField, selectedCrop, userId, orgId, irrigatedFields]);

  // Weighted averages for summary row
  const avgRow = (() => {
    if (trendRows.length === 0) return null;

    const totalIrrAc = trendRows.reduce((s, r) => s + r.irrigatedAcres, 0);
    const totalDryAc = trendRows.reduce((s, r) => s + r.drylandAcres, 0);
    const totalAc = trendRows.reduce((s, r) => s + r.totalAcres, 0);

    let irrYieldSum = 0, irrYieldWeight = 0;
    let dryYieldSum = 0, dryYieldWeight = 0;
    let totalYieldSum = 0, totalYieldWeight = 0;

    for (const r of trendRows) {
      if (r.irrigatedYield != null) { irrYieldSum += r.irrigatedYield * r.irrigatedAcres; irrYieldWeight += r.irrigatedAcres; }
      if (r.drylandYield != null) { dryYieldSum += r.drylandYield * r.drylandAcres; dryYieldWeight += r.drylandAcres; }
      if (r.totalYield != null) { totalYieldSum += r.totalYield * r.totalAcres; totalYieldWeight += r.totalAcres; }
    }

    return {
      irrigatedAcres: totalIrrAc / trendRows.length,
      drylandAcres: totalDryAc / trendRows.length,
      totalAcres: totalAc / trendRows.length,
      irrigatedYield: irrYieldWeight > 0 ? irrYieldSum / irrYieldWeight : null,
      drylandYield: dryYieldWeight > 0 ? dryYieldSum / dryYieldWeight : null,
      totalYield: totalYieldWeight > 0 ? totalYieldSum / totalYieldWeight : null,
    };
  })();

  const selectClass =
    'rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500';

  return (
    <div className="glass rounded-xl p-6 space-y-4">
      <h3 className="text-lg font-semibold text-white flex items-center gap-2">
        <TrendingUp className="w-5 h-5 text-emerald-500" />
        Year-over-Year Trends
      </h3>

      <div className="flex flex-wrap items-center gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Field</label>
          <select value={selectedField} onChange={(e) => setSelectedField(e.target.value)} className={selectClass}>
            <option value="">Select a field...</option>
            {fieldNames.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Crop</label>
          <select value={selectedCrop} onChange={(e) => setSelectedCrop(e.target.value)} className={selectClass}>
            {availableCrops.length === 0 && <option value="">Select a field first</option>}
            {availableCrops.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading trends...
        </div>
      ) : trendRows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                <th className="px-4 py-3">Year</th>
                <th className="px-4 py-3 text-right">Irr Ac</th>
                <th className="px-4 py-3 text-right">Dry Ac</th>
                <th className="px-4 py-3 text-right">Total Ac</th>
                <th className="px-4 py-3 text-right">Irr Yield</th>
                <th className="px-4 py-3 text-right">Dry Yield</th>
                <th className="px-4 py-3 text-right">Total Yield</th>
              </tr>
            </thead>
            <tbody>
              {trendRows.map((r) => (
                <tr key={r.season} className="border-b border-slate-800">
                  <td className="px-4 py-3 text-slate-200 font-medium">{r.season}</td>
                  <td className="px-4 py-3 text-right text-emerald-400">{fmt(r.irrigatedAcres)}</td>
                  <td className="px-4 py-3 text-right text-amber-400">{fmt(r.drylandAcres)}</td>
                  <td className="px-4 py-3 text-right text-slate-300">{fmt(r.totalAcres)}</td>
                  <td className="px-4 py-3 text-right text-emerald-400">{fmt(r.irrigatedYield)}</td>
                  <td className="px-4 py-3 text-right text-amber-400">{fmt(r.drylandYield)}</td>
                  <td className="px-4 py-3 text-right text-slate-300">{fmt(r.totalYield)}</td>
                </tr>
              ))}
            </tbody>
            {avgRow && (
              <tfoot>
                <tr className="border-t-2 border-slate-600 font-semibold text-slate-200">
                  <td className="px-4 py-3">AVG</td>
                  <td className="px-4 py-3 text-right text-emerald-400">{fmt(avgRow.irrigatedAcres)}</td>
                  <td className="px-4 py-3 text-right text-amber-400">{fmt(avgRow.drylandAcres)}</td>
                  <td className="px-4 py-3 text-right">{fmt(avgRow.totalAcres)}</td>
                  <td className="px-4 py-3 text-right text-emerald-400">{fmt(avgRow.irrigatedYield)}</td>
                  <td className="px-4 py-3 text-right text-amber-400">{fmt(avgRow.drylandYield)}</td>
                  <td className="px-4 py-3 text-right">{fmt(avgRow.totalYield)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      ) : selectedField && selectedCrop ? (
        <p className="text-slate-500 py-4">No harvest data found for this field and crop.</p>
      ) : (
        <p className="text-slate-500 py-4">Select a field and crop to view trends.</p>
      )}
    </div>
  );
}
