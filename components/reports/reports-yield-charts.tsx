'use client';

import { useState, useEffect } from 'react';
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
import { BarChart3, Loader2, TrendingUp, Trophy, Sparkles } from 'lucide-react';
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
    if (p.irrigated != null && p.dryland != null) {
      const d = p.irrigated - p.dryland;
      diffs.push(d);
      if (!biggestGap || d > biggestGap.diff) {
        biggestGap = { season: p.season, diff: d };
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

export function ReportsYieldCharts({ userId, orgId, irrigatedFields }: ReportsYieldChartsProps) {
  const { johnDeereConnection } = useAuth();
  const hiddenCrops = johnDeereConnection?.hidden_crop_names || [];
  const [loading, setLoading] = useState(true);
  const [byCrop, setByCrop] = useState<Map<string, ChartPoint[]>>(new Map());

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
            acc = { irrBu: 0, irrYieldWeight: 0, dryBu: 0, dryYieldWeight: 0, irrAc: 0, dryAc: 0 };
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
          } else if (row.drylandAcres > 0 && row.irrigatedAcres === 0) {
            // Pre-irrigation op (or 100%-dryland field): whole-field yield is
            // dryland yield. Use op's avg_yield_value with toDryYield.
            const wholeFieldDry = toDryYield(row.operation.avg_yield_value, row.operation.avg_moisture, crop);
            acc.dryAc += row.drylandAcres;
            if (wholeFieldDry != null) {
              acc.dryBu += wholeFieldDry * row.drylandAcres;
              acc.dryYieldWeight += row.drylandAcres;
            }
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

  return (
    <div className="space-y-6">
      <div className="glass rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-emerald-500" />
          Irrigated vs Dryland Yield by Crop
        </h3>
        <p className="text-xs text-slate-400 mt-1">
          Moisture-adjusted bu/ac, area-weighted across all fields, by year
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {cropEntries.map(([crop, points]) => {
          const stats = computeStats(points);
          return (
          <div key={crop} className="glass rounded-xl p-6">
            <h4 className="text-base font-semibold text-white mb-4">{formatCropName(crop)}</h4>
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

            <div className="mt-4 pt-4 border-t border-white/[0.05] grid grid-cols-3 gap-3">
              <div className="flex items-start gap-2">
                <TrendingUp className="w-3.5 h-3.5 text-cyan-400 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Avg Irr Bonus</div>
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
