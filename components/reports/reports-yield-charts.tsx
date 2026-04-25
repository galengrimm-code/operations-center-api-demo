'use client';

import { useState, useEffect, useRef } from 'react';
import {
  fetchHarvestOperations,
  fetchAnalysisResults,
  buildReportRows,
  effectiveCropName,
  formatCropName,
  toDryYield,
} from '@/lib/reports-data';
import type { StoredField } from '@/types/john-deere';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { BarChart3, Loader2, TrendingUp, Trophy, Sparkles, Printer } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';

interface ReportsYieldChartsProps {
  userId: string;
  orgId: string;
  irrigatedFields: StoredField[];
}

interface ChartPoint {
  season: string;
  irrigated: number | null;
  dryland: number | null;
  irrigatedAcres: number;
  drylandAcres: number;
  // Per-field gap (irr - dry on the same field), weighted by that field's
  // irrigated acres, summed across fields and divided by total irrigated
  // acres. Answers "what did the pivot gain me per pivot acre this year."
  pivotGainPerAcre: number | null;
}

// Only chart the major harvested grain crops. Cover crops, grasses, etc.
// produce noisy single-year panels that aren't useful here.
const CHART_CROPS = new Set(['CORN_WET', 'CORN_EURO', 'SOYBEANS']);

interface CropStats {
  avgDiff: number | null;
  bestYear: { season: string; yield: number } | null;
  biggestGap: { season: string; diff: number } | null;
}

function YieldTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  const fmtNum = (v: number | null, suffix = '') =>
    v == null ? '—' : `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })}${suffix}`;
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs shadow-lg">
      <div className="font-semibold text-slate-100 mb-1.5">{label}</div>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <span className="text-emerald-400">Irrigated</span>
        <span className="text-slate-200 text-right font-mono-data">
          {fmtNum(p.irrigated, ' bu')} <span className="text-slate-500">·</span> {fmtNum(p.irrigatedAcres, ' ac')}
        </span>
        <span className="text-amber-400">Dryland</span>
        <span className="text-slate-200 text-right font-mono-data">
          {fmtNum(p.dryland, ' bu')} <span className="text-slate-500">·</span> {fmtNum(p.drylandAcres, ' ac')}
        </span>
      </div>
    </div>
  );
}

function computeStats(points: ChartPoint[]): CropStats {
  const diffs: number[] = [];
  let bestYear: { season: string; yield: number } | null = null;
  let biggestGap: { season: string; diff: number } | null = null;

  for (const p of points) {
    if (p.pivotGainPerAcre != null) {
      diffs.push(p.pivotGainPerAcre);
      if (!biggestGap || p.pivotGainPerAcre > biggestGap.diff) {
        biggestGap = { season: p.season, diff: p.pivotGainPerAcre };
      }
    }
    if (p.irrigated != null && (!bestYear || p.irrigated > bestYear.yield)) {
      bestYear = { season: p.season, yield: p.irrigated };
    }
  }

  return {
    avgDiff: diffs.length > 0 ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null,
    bestYear,
    biggestGap,
  };
}

function buildPrintHtml(
  sections: Array<{ crop: string; points: ChartPoint[]; stats: CropStats; svgHtml: string }>,
): string {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const fmtBu = (v: number | null) =>
    v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)} bu`;
  const fmtYield = (v: number | null) =>
    v == null ? '—' : v.toFixed(1) + ' bu';

  const avg = (vals: Array<number | null>): number | null => {
    const xs = vals.filter((v): v is number => v != null);
    return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
  };
  const sum = (vals: number[]): number => vals.reduce((a, b) => a + b, 0);

  const sectionHtml = sections.map(({ crop, points, stats, svgHtml }) => {
    const tableRows = points.map((p) => `
      <tr>
        <td>${p.season}</td>
        <td style="text-align:right">${fmtYield(p.irrigated)}</td>
        <td style="text-align:right">${fmtYield(p.dryland)}</td>
        <td style="text-align:right">${fmtBu(p.pivotGainPerAcre)}</td>
        <td style="text-align:right">${p.irrigatedAcres.toFixed(1)}</td>
        <td style="text-align:right">${p.drylandAcres.toFixed(1)}</td>
      </tr>`).join('');

    const avgIrr = avg(points.map((p) => p.irrigated));
    const avgDry = avg(points.map((p) => p.dryland));
    const avgGain = avg(points.map((p) => p.pivotGainPerAcre));
    const totalIrrAc = sum(points.map((p) => p.irrigatedAcres));
    const totalDryAc = sum(points.map((p) => p.drylandAcres));

    return `
    <section class="crop">
      <h2>${formatCropName(crop)}</h2>
      <div class="stats">
        <div><span class="label">Avg Pivot Gain</span><span class="value">${fmtBu(stats.avgDiff)}/ac</span></div>
        <div><span class="label">Best Irr Year</span><span class="value">${stats.bestYear ? `${stats.bestYear.season} · ${stats.bestYear.yield.toFixed(1)} bu` : '—'}</span></div>
        <div><span class="label">Biggest Gap</span><span class="value">${stats.biggestGap ? `${stats.biggestGap.season} · ${fmtBu(stats.biggestGap.diff)}/ac` : '—'}</span></div>
      </div>
      <div class="chart">${svgHtml}</div>
      <table>
        <thead>
          <tr><th>Year</th><th style="text-align:right">Irr Yield</th><th style="text-align:right">Dry Yield</th><th style="text-align:right">Pivot Gain</th><th style="text-align:right">Irr Ac</th><th style="text-align:right">Dry Ac</th></tr>
        </thead>
        <tbody>${tableRows}</tbody>
        <tfoot>
          <tr class="totals">
            <td><strong>Average</strong></td>
            <td style="text-align:right"><strong>${fmtYield(avgIrr)}</strong></td>
            <td style="text-align:right"><strong>${fmtYield(avgDry)}</strong></td>
            <td style="text-align:right"><strong>${fmtBu(avgGain)}/ac</strong></td>
            <td style="text-align:right"><strong>${totalIrrAc.toFixed(1)}</strong></td>
            <td style="text-align:right"><strong>${totalDryAc.toFixed(1)}</strong></td>
          </tr>
        </tfoot>
      </table>
    </section>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <title>Yield Report — ${today}</title>
  <style>
    @page { margin: 0; size: auto; }
    body { font-family: -apple-system, Arial, sans-serif; color: #111827; margin: 0; padding: 0.5in 0.6in; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    .subtitle { font-size: 12px; color: #6b7280; margin-bottom: 24px; }
    section.crop { page-break-inside: avoid; margin-bottom: 28px; padding-bottom: 20px; border-bottom: 1px solid #e5e7eb; }
    section.crop:last-child { border-bottom: none; }
    section.crop h2 { font-size: 18px; margin: 0 0 12px; color: #047857; }
    .stats { display: flex; gap: 24px; margin-bottom: 16px; padding: 12px 16px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; }
    .stats > div { display: flex; flex-direction: column; gap: 2px; }
    .stats .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; }
    .stats .value { font-size: 14px; font-weight: 600; color: #111827; }
    .chart { margin-bottom: 16px; }
    .chart svg { width: 100%; height: 300px; max-width: 100%; background: #fff; }
    .chart svg text { fill: #374151 !important; }
    .chart svg .recharts-cartesian-grid line { stroke: #d1d5db !important; }
    .chart svg .recharts-cartesian-axis line, .chart svg .recharts-cartesian-axis-tick-line { stroke: #9ca3af !important; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th, td { border: 1px solid #e5e7eb; padding: 5px 8px; }
    th { background: #f3f4f6; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #4b5563; }
    tfoot tr.totals td { background: #f9fafb; border-top: 2px solid #d1d5db; }
    @media print {
      body { padding: 0.5in 0.6in; }
      section.crop { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <h1>Yield Report — Irrigated vs Dryland by Crop</h1>
  <div class="subtitle">Moisture-adjusted, area-weighted across all fields · Printed ${today}</div>
  ${sectionHtml}
</body>
</html>`;
}

export function ReportsYieldCharts({ userId, orgId, irrigatedFields }: ReportsYieldChartsProps) {
  const { johnDeereConnection } = useAuth();
  const hiddenCrops = johnDeereConnection?.hidden_crop_names || [];
  const [loading, setLoading] = useState(true);
  const [byCrop, setByCrop] = useState<Map<string, ChartPoint[]>>(new Map());
  const chartRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const fieldIds = irrigatedFields.map((f) => f.jd_field_id);
        if (fieldIds.length === 0) {
          setByCrop(new Map());
          return;
        }

        const ops = await fetchHarvestOperations(
          userId, orgId, fieldIds, undefined, undefined, 'harvest', hiddenCrops,
        );
        const opIds = ops.map((o) => o.jd_operation_id);
        const results = await fetchAnalysisResults(userId, opIds);

        // Use buildReportRows so irrigation_start_year is honored — pre-pivot
        // ops have analysis nulled and acres flipped to 100% dryland.
        const rows = buildReportRows(irrigatedFields, ops, results);

        type Acc = {
          irrBu: number; irrYieldWeight: number;
          dryBu: number; dryYieldWeight: number;
          irrAc: number; dryAc: number;
          // For pivot-gain-per-acre stat (Option 2). Sum across fields of
          // (per-field gap × that field's pivot acres), and the matching
          // pivot-acre weight.
          gainBuSum: number; gainAcWeight: number;
        };
        const groups = new Map<string, Map<string, Acc>>();

        for (const row of rows) {
          const crop = effectiveCropName(row.operation);
          const season = row.operation.crop_season;
          if (!crop || !season) continue;
          if (!CHART_CROPS.has(crop)) continue;

          let cropMap = groups.get(crop);
          if (!cropMap) { cropMap = new Map(); groups.set(crop, cropMap); }
          let acc = cropMap.get(season);
          if (!acc) {
            acc = {
              irrBu: 0, irrYieldWeight: 0, dryBu: 0, dryYieldWeight: 0,
              irrAc: 0, dryAc: 0,
              gainBuSum: 0, gainAcWeight: 0,
            };
            cropMap.set(season, acc);
          }

          if (row.analysis) {
            // Field had its current pivot during this op — use the per-zone analysis
            const irrYieldDry = toDryYield(row.analysis.irrigated_yield, row.analysis.irrigated_moisture, crop);
            const dryYieldDry = toDryYield(row.analysis.dryland_yield, row.analysis.dryland_moisture, crop);
            acc.irrAc += row.analysis.irrigated_acres || 0;
            acc.dryAc += row.analysis.dryland_acres || 0;
            if (irrYieldDry != null && row.analysis.irrigated_acres > 0) {
              acc.irrBu += irrYieldDry * row.analysis.irrigated_acres;
              acc.irrYieldWeight += row.analysis.irrigated_acres;
            }
            if (dryYieldDry != null && row.analysis.dryland_acres > 0) {
              acc.dryBu += dryYieldDry * row.analysis.dryland_acres;
              acc.dryYieldWeight += row.analysis.dryland_acres;
            }
            // Per-field gap × pivot acres (Option 2). Only when this field
            // has BOTH zones with valid yields — same field, same weather,
            // apples to apples.
            if (irrYieldDry != null && dryYieldDry != null
                && row.analysis.irrigated_acres > 0 && row.analysis.dryland_acres > 0) {
              acc.gainBuSum += (irrYieldDry - dryYieldDry) * row.analysis.irrigated_acres;
              acc.gainAcWeight += row.analysis.irrigated_acres;
            }
          } else if (row.drylandAcres > 0 && row.irrigatedAcres === 0) {
            // Pre-irrigation op (or 100%-dryland field): whole-field yield is
            // dryland yield. Use op's avg_yield_value with toDryYield.
            const wholeFieldDry = toDryYield(row.operation.avg_yield_value, row.operation.avg_moisture, crop);
            acc.dryAc += row.drylandAcres;
            if (wholeFieldDry != null) {
              acc.dryBu += wholeFieldDry * row.drylandAcres;
              acc.dryYieldWeight += row.drylandAcres;
            }
            // No per-field gap available pre-pivot — pivot didn't exist yet.
          }
          // else: post-pivot op without analysis — split unknown, skip.
        }

        const next = new Map<string, ChartPoint[]>();
        groups.forEach((seasons, crop) => {
          const points: ChartPoint[] = [];
          seasons.forEach((acc, season) => {
            points.push({
              season,
              irrigated: acc.irrYieldWeight > 0 ? acc.irrBu / acc.irrYieldWeight : null,
              dryland: acc.dryYieldWeight > 0 ? acc.dryBu / acc.dryYieldWeight : null,
              irrigatedAcres: acc.irrAc,
              drylandAcres: acc.dryAc,
              pivotGainPerAcre: acc.gainAcWeight > 0 ? acc.gainBuSum / acc.gainAcWeight : null,
            });
          });
          points.sort((a, b) => a.season.localeCompare(b.season));
          next.set(crop, points);
        });
        setByCrop(next);
      } catch (err) {
        console.error('Failed to load yield charts:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [userId, orgId, irrigatedFields, hiddenCrops.join(',')]);

  if (loading) {
    return (
      <div className="glass rounded-xl p-12 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
      </div>
    );
  }

  const cropEntries = Array.from(byCrop.entries())
    .filter(([, pts]) => pts.length > 0)
    .sort((a, b) => formatCropName(a[0]).localeCompare(formatCropName(b[0])));

  if (cropEntries.length === 0) {
    return (
      <div className="glass rounded-xl p-12 text-center">
        <BarChart3 className="w-12 h-12 text-slate-600 mx-auto mb-4" />
        <p className="text-slate-400">No analysis results yet.</p>
        <p className="text-xs text-slate-500 mt-2">Run shapefile analysis on harvest operations to populate charts.</p>
      </div>
    );
  }

  const handlePrint = () => {
    const sections = cropEntries.map(([crop, points]) => {
      const container = chartRefs.current.get(crop);
      const svgEl = container?.querySelector('svg');
      let svgHtml = '';
      if (svgEl) {
        const cloned = svgEl.cloneNode(true) as SVGSVGElement;
        cloned.removeAttribute('width');
        cloned.removeAttribute('height');
        cloned.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svgHtml = cloned.outerHTML;
      }
      return { crop, points, stats: computeStats(points), svgHtml };
    });
    const html = buildPrintHtml(sections);
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.onload = () => win.print();
  };

  return (
    <div className="space-y-6">
      <div className="glass rounded-xl p-6 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-emerald-500" />
            Irrigated vs Dryland Yield by Crop
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Moisture-adjusted bu/ac, area-weighted across all fields, by year
          </p>
        </div>
        <button
          onClick={handlePrint}
          className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:bg-white/5 transition-colors flex-shrink-0"
        >
          <Printer className="w-4 h-4" />
          Print PDF
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {cropEntries.map(([crop, points]) => {
          const stats = computeStats(points);
          return (
          <div key={crop} className="glass rounded-xl p-6">
            <h4 className="text-base font-semibold text-white mb-4">{formatCropName(crop)}</h4>
            <div ref={(el) => { chartRefs.current.set(crop, el); }}>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={points} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="season" stroke="#94a3b8" fontSize={12} />
                <YAxis
                  stroke="#94a3b8"
                  fontSize={12}
                  label={{ value: 'bu/ac', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 11 }}
                />
                <Tooltip content={<YieldTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line
                  type="monotone"
                  dataKey="irrigated"
                  stroke="#10b981"
                  strokeWidth={2}
                  name="Irrigated"
                  dot={{ r: 4 }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="dryland"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  name="Dryland"
                  dot={{ r: 4 }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
            </div>

            <div className="mt-4 pt-4 border-t border-white/[0.05] grid grid-cols-3 gap-3">
              <div className="flex items-start gap-2">
                <TrendingUp className="w-3.5 h-3.5 text-cyan-400 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Avg Pivot Gain</div>
                  <div className="text-sm font-mono-data text-cyan-300">
                    {stats.avgDiff != null ? `${stats.avgDiff >= 0 ? '+' : ''}${stats.avgDiff.toFixed(1)} bu` : '—'}
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Trophy className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Best Irr Year</div>
                  <div className="text-sm font-mono-data text-emerald-300">
                    {stats.bestYear ? `${stats.bestYear.season} · ${stats.bestYear.yield.toFixed(1)} bu` : '—'}
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Sparkles className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Biggest Gap</div>
                  <div className="text-sm font-mono-data text-amber-300">
                    {stats.biggestGap ? `${stats.biggestGap.season} · ${stats.biggestGap.diff >= 0 ? '+' : ''}${stats.biggestGap.diff.toFixed(1)} bu` : '—'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
        })}
      </div>
    </div>
  );
}
