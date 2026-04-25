'use client';

import { useState, useEffect } from 'react';
import {
  fetchHarvestOperations,
  fetchAnalysisResults,
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
import { BarChart3, Loader2 } from 'lucide-react';
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
        const byOpId = new Map(results.map((r) => [r.jd_operation_id, r]));

        type Acc = { irrBu: number; irrAc: number; dryBu: number; dryAc: number };
        const groups = new Map<string, Map<string, Acc>>();

        for (const op of ops) {
          const r = byOpId.get(op.jd_operation_id);
          if (!r) continue;
          const crop = op.crop_name;
          const season = op.crop_season;
          if (!crop || !season) continue;

          const irrYieldDry = toDryYield(r.irrigated_yield, r.irrigated_moisture, crop);
          const dryYieldDry = toDryYield(r.dryland_yield, r.dryland_moisture, crop);

          let cropMap = groups.get(crop);
          if (!cropMap) { cropMap = new Map(); groups.set(crop, cropMap); }
          let acc = cropMap.get(season);
          if (!acc) { acc = { irrBu: 0, irrAc: 0, dryBu: 0, dryAc: 0 }; cropMap.set(season, acc); }
          if (irrYieldDry != null && r.irrigated_acres > 0) {
            acc.irrBu += irrYieldDry * r.irrigated_acres;
            acc.irrAc += r.irrigated_acres;
          }
          if (dryYieldDry != null && r.dryland_acres > 0) {
            acc.dryBu += dryYieldDry * r.dryland_acres;
            acc.dryAc += r.dryland_acres;
          }
        }

        const next = new Map<string, ChartPoint[]>();
        groups.forEach((seasons, crop) => {
          const points: ChartPoint[] = [];
          seasons.forEach((acc, season) => {
            points.push({
              season,
              irrigated: acc.irrAc > 0 ? acc.irrBu / acc.irrAc : null,
              dryland: acc.dryAc > 0 ? acc.dryBu / acc.dryAc : null,
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
        {cropEntries.map(([crop, points]) => (
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
                <Tooltip
                  contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#e2e8f0' }}
                  formatter={(value) => typeof value === 'number' ? value.toFixed(1) + ' bu/ac' : '—'}
                />
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
        ))}
      </div>
    </div>
  );
}
