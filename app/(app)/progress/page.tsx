'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useClientFilter } from '@/contexts/client-filter-context';
import {
  loadSeasonProgress,
  seriesKey,
  type SeasonProgress,
  type FieldProgressRow,
} from '@/lib/season-progress';
import { supabase } from '@/lib/supabase';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { Loader2, Sprout, Calendar, Pencil, Check, X } from 'lucide-react';

const CROP_COLORS: Record<string, string> = {
  CORN: '#fbbf24',       // amber-400
  SOYBEANS: '#34d399',   // emerald-400
  WHEAT: '#a78bfa',      // violet-400
  DEFAULT: '#60a5fa',    // blue-400
};

function cropColor(crop: string): string {
  return CROP_COLORS[crop] ?? CROP_COLORS.DEFAULT;
}

function fmtAcres(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtMonthDay(md: string): string {
  // md = "MM-DD"
  const [m, d] = md.split('-').map(Number);
  if (!m || !d) return md;
  return `${MONTH_NAMES[m - 1]} ${d}`;
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(100, Math.round((part / whole) * 100));
}

// Compress crop slug for display: "SOYBEANS" -> "Soybeans"
function prettyCrop(c: string): string {
  return c.charAt(0) + c.slice(1).toLowerCase();
}

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 10 }, (_, i) => CURRENT_YEAR - i);

export default function ProgressPage() {
  const { user, johnDeereConnection } = useAuth();
  const { selectedFarm } = useClientFilter();
  const [year, setYear] = useState(CURRENT_YEAR);
  const [data, setData] = useState<SeasonProgress | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const orgId = johnDeereConnection?.selected_org_id ?? null;
  const userId = user?.id ?? null;
  const hiddenCrops = useMemo(
    () => johnDeereConnection?.hidden_crop_names ?? [],
    [johnDeereConnection?.hidden_crop_names]
  );

  const refresh = useCallback(async () => {
    if (!userId || !orgId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await loadSeasonProgress({
        userId,
        orgId,
        year,
        hiddenCrops,
        farmFilter: selectedFarm,
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load season progress');
    } finally {
      setLoading(false);
    }
  }, [userId, orgId, year, hiddenCrops, selectedFarm]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!orgId) {
    return (
      <div className="min-h-[calc(100vh-48px)] bg-slate-950 p-6 flex items-center justify-center">
        <div className="text-center">
          <Sprout className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">Connect a John Deere organization to see season progress.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-48px)] bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-white">Season Progress</h1>
            <p className="text-sm text-slate-400 mt-0.5">
              Planting and harvest pace, {year}
            </p>
          </div>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="bg-white/[0.03] border border-white/[0.06] rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500/40"
          >
            {YEARS.map((y) => (
              <option key={y} value={y} className="bg-slate-900">{y}</option>
            ))}
          </select>
        </div>

        {error && (
          <div className="glass rounded-xl p-4 border-red-500/20 bg-red-500/10 mb-6">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {loading && !data ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
          </div>
        ) : !data || (data.crops.length === 0 && data.fields.length === 0) ? (
          <EmptyState year={year} />
        ) : (
          <>
            {data.crops.length > 0 && <CropCards data={data} />}
            {data.crops.length > 0 && <CumulativeChart data={data} />}
            <FieldsTable fields={data.fields} year={year} onSaved={refresh} />
          </>
        )}
      </div>
    </div>
  );
}

function EmptyState({ year }: { year: number }) {
  return (
    <div className="text-center py-20">
      <Sprout className="w-10 h-10 text-slate-600 mx-auto mb-3" />
      <p className="text-slate-400">No planting data yet for {year}.</p>
      <p className="text-sm text-slate-500 mt-1">
        Sync operations from the Operations page, or set intended crop on each field below.
      </p>
    </div>
  );
}

function CropCards({ data }: { data: SeasonProgress }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
      {data.crops.map((c) => {
        const percent = pct(c.planted_acres, c.target_acres);
        const remaining = Math.max(0, c.target_acres - c.planted_acres);
        const color = cropColor(c.crop);
        return (
          <div key={c.crop} className="glass rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <h3 className="text-sm font-semibold text-white tracking-tight">
                  {prettyCrop(c.crop)}
                </h3>
              </div>
              <span className="text-xs text-slate-400 font-mono-data">{percent}%</span>
            </div>
            <div className="text-2xl font-semibold text-white font-mono-data mb-1">
              {fmtAcres(c.planted_acres)}
              <span className="text-sm text-slate-500 font-normal ml-1.5">
                / {fmtAcres(c.target_acres)} ac
              </span>
            </div>
            <div className="h-2 bg-white/5 rounded-full overflow-hidden mb-3">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${percent}%`,
                  backgroundColor: color,
                }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>
                {c.fields_planted} of {c.fields_total} fields
              </span>
              <span className="font-mono-data">
                {fmtAcres(remaining)} ac left
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Tooltip groups all values for the hovered month-day, by crop, comparing
// the active year vs. prior years. Only crops with non-zero values for that
// day are shown — keeps the tooltip tight when only some crops are active.
function ChartTooltip({
  active,
  payload,
  label,
  cropKeys,
  yearsIncluded,
  activeYear,
}: {
  active?: boolean;
  payload?: Array<{ payload: Record<string, number | string> }>;
  label?: string;
  cropKeys: string[];
  yearsIncluded: number[];
  activeYear: number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;

  // Only show crops that have a value > 0 for the active year on this day OR
  // any year. Otherwise tooltip gets noisy.
  const visibleCrops = cropKeys.filter((c) =>
    yearsIncluded.some((y) => Number(point[seriesKey(c, y)] ?? 0) > 0)
  );
  if (visibleCrops.length === 0) return null;

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs shadow-lg">
      <div className="font-semibold text-slate-100 mb-1.5">{fmtMonthDay(String(label))}</div>
      <div className="space-y-2">
        {visibleCrops.map((crop) => (
          <div key={crop}>
            <div className="flex items-center gap-1.5 mb-0.5">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: cropColor(crop) }}
              />
              <span className="text-slate-200 font-medium">{prettyCrop(crop)}</span>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 pl-3.5">
              {yearsIncluded.map((y) => {
                const v = Number(point[seriesKey(crop, y)] ?? 0);
                return (
                  <span key={y} className="contents">
                    <span className={y === activeYear ? 'text-slate-200' : 'text-slate-500'}>
                      {y}
                    </span>
                    <span
                      className={`text-right font-mono-data ${
                        y === activeYear ? 'text-slate-200' : 'text-slate-500'
                      }`}
                    >
                      {fmtAcres(v)} ac
                    </span>
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CumulativeChart({ data }: { data: SeasonProgress }) {
  if (data.cumulative.length === 0) {
    return (
      <div className="glass rounded-xl p-8 mb-6 text-center">
        <Calendar className="w-8 h-8 text-slate-600 mx-auto mb-2" />
        <p className="text-sm text-slate-500">
          No dated planting records yet. Set plant dates on fields below to populate the curve.
        </p>
      </div>
    );
  }

  const cropKeys = data.crops.map((c) => c.crop);
  const priorYears = data.yearsIncluded.filter((y) => y !== data.year);

  return (
    <div className="glass rounded-xl p-5 mb-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-white">Cumulative acres planted</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {data.year} solid · prior years dashed for pace comparison
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs flex-wrap justify-end">
          {cropKeys.map((c) => (
            <div key={c} className="flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: cropColor(c) }}
              />
              <span className="text-slate-300">{prettyCrop(c)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data.cumulative} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <defs>
              {cropKeys.map((c) => (
                <linearGradient id={`grad-${c}`} key={c} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={cropColor(c)} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={cropColor(c)} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
            <XAxis
              dataKey="monthDay"
              stroke="#64748b"
              fontSize={11}
              tickFormatter={(md) => fmtMonthDay(String(md))}
              minTickGap={32}
            />
            <YAxis
              stroke="#64748b"
              fontSize={11}
              tickFormatter={(v) => `${(v as number).toLocaleString()}`}
            />
            <Tooltip
              content={
                <ChartTooltip
                  cropKeys={cropKeys}
                  yearsIncluded={data.yearsIncluded}
                  activeYear={data.year}
                />
              }
            />
            {/* Prior-year reference lines first so active-year fills layer on top */}
            {priorYears.map((y, idx) =>
              cropKeys.map((c) => (
                <Line
                  key={`${c}-${y}`}
                  type="monotone"
                  dataKey={seriesKey(c, y)}
                  stroke={cropColor(c)}
                  strokeWidth={1.5}
                  strokeDasharray={idx === 0 ? '4 3' : '2 4'}
                  strokeOpacity={idx === 0 ? 0.55 : 0.35}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))
            )}
            {/* Active-year filled areas */}
            {cropKeys.map((c) => (
              <Area
                key={c}
                type="monotone"
                dataKey={seriesKey(c, data.year)}
                stroke={cropColor(c)}
                strokeWidth={2}
                fill={`url(#grad-${c})`}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

interface EditState {
  field_id: string;
  intended_crop: string;
  intended_acres: string;
  planted_date: string;
  planted_acres: string;
}

function FieldsTable({
  fields,
  year,
  onSaved,
}: {
  fields: FieldProgressRow[];
  year: number;
  onSaved: () => void;
}) {
  const [edit, setEdit] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const sorted = useMemo(() => {
    return [...fields].sort((a, b) => {
      // Unplanted first, then by acres desc
      if (a.planted_acres > 0 && b.planted_acres === 0) return 1;
      if (a.planted_acres === 0 && b.planted_acres > 0) return -1;
      return b.target_acres - a.target_acres;
    });
  }, [fields]);

  const visible = showAll ? sorted : sorted.slice(0, 30);

  const startEdit = (row: FieldProgressRow) => {
    setEdit({
      field_id: row.field_id,
      intended_crop: row.crop ?? '',
      intended_acres: row.target_acres > 0 ? String(Math.round(row.target_acres * 10) / 10) : '',
      planted_date: row.planted_date ?? '',
      planted_acres: row.planted_acres > 0 ? String(Math.round(row.planted_acres * 10) / 10) : '',
    });
  };

  const cancel = () => setEdit(null);

  const save = async () => {
    if (!edit) return;
    setSaving(true);
    try {
      const payload = {
        field_id: edit.field_id,
        season_year: year,
        intended_crop: edit.intended_crop.trim().toUpperCase() || null,
        intended_acres: edit.intended_acres ? Number(edit.intended_acres) : null,
        planted_date: edit.planted_date || null,
        planted_acres: edit.planted_acres ? Number(edit.planted_acres) : null,
        updated_at: new Date().toISOString(),
      };
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');

      const { error: upsertError } = await supabase
        .from('field_seasons')
        .upsert(
          { ...payload, user_id: user.id } as never,
          { onConflict: 'user_id,field_id,season_year' }
        );
      if (upsertError) throw upsertError;
      setEdit(null);
      onSaved();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="glass rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">Fields</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Click a row to set intended crop or override the plant date
          </p>
        </div>
        <span className="text-xs text-slate-500 font-mono-data">{fields.length} fields</span>
      </div>
      <div className="divide-y divide-white/[0.04]">
        {visible.map((row) => {
          const isEditing = edit?.field_id === row.field_id;
          const planted = row.planted_acres > 0;
          return (
            <div key={row.field_id} className="px-5 py-3">
              <div className="flex items-center gap-4 text-sm">
                <button
                  onClick={() => (isEditing ? cancel() : startEdit(row))}
                  className="flex-1 min-w-0 text-left flex items-center gap-3 group"
                >
                  <div
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{
                      backgroundColor: planted
                        ? row.crop ? cropColor(row.crop) : '#64748b'
                        : '#475569',
                    }}
                  />
                  <span className="font-medium text-white truncate">{row.field_name}</span>
                  {row.crop && (
                    <span className="text-xs text-slate-400">{prettyCrop(row.crop)}</span>
                  )}
                  {row.source === 'manual' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono-data">
                      manual
                    </span>
                  )}
                </button>
                <span className="text-xs text-slate-400 font-mono-data w-24 text-right">
                  {fmtDate(row.planted_date)}
                </span>
                <span className="text-xs text-slate-300 font-mono-data w-32 text-right">
                  {fmtAcres(row.planted_acres)} / {fmtAcres(row.target_acres)} ac
                </span>
                <button
                  onClick={() => (isEditing ? cancel() : startEdit(row))}
                  className="text-slate-500 hover:text-slate-200 p-1"
                  aria-label="Edit field season"
                >
                  {isEditing ? <X className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
                </button>
              </div>

              {isEditing && edit && (
                <div className="mt-3 pl-4 grid grid-cols-2 md:grid-cols-5 gap-2">
                  <label className="text-xs text-slate-400 col-span-2 md:col-span-1">
                    <span className="block mb-1">Crop</span>
                    <select
                      value={edit.intended_crop}
                      onChange={(e) => setEdit({ ...edit, intended_crop: e.target.value })}
                      className="w-full bg-white/[0.03] border border-white/[0.06] rounded-md px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500/40"
                    >
                      <option value="" className="bg-slate-900">—</option>
                      <option value="CORN" className="bg-slate-900">Corn</option>
                      <option value="SOYBEANS" className="bg-slate-900">Soybeans</option>
                      <option value="WHEAT" className="bg-slate-900">Wheat</option>
                      <option value="MILO" className="bg-slate-900">Milo</option>
                    </select>
                  </label>
                  <label className="text-xs text-slate-400">
                    <span className="block mb-1">Target ac</span>
                    <input
                      type="number"
                      step="0.1"
                      value={edit.intended_acres}
                      onChange={(e) => setEdit({ ...edit, intended_acres: e.target.value })}
                      className="w-full bg-white/[0.03] border border-white/[0.06] rounded-md px-2 py-1.5 text-xs text-slate-200 font-mono-data focus:outline-none focus:border-emerald-500/40"
                    />
                  </label>
                  <label className="text-xs text-slate-400">
                    <span className="block mb-1">Plant date</span>
                    <input
                      type="date"
                      value={edit.planted_date}
                      onChange={(e) => setEdit({ ...edit, planted_date: e.target.value })}
                      className="w-full bg-white/[0.03] border border-white/[0.06] rounded-md px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500/40"
                    />
                  </label>
                  <label className="text-xs text-slate-400">
                    <span className="block mb-1">Planted ac</span>
                    <input
                      type="number"
                      step="0.1"
                      value={edit.planted_acres}
                      onChange={(e) => setEdit({ ...edit, planted_acres: e.target.value })}
                      className="w-full bg-white/[0.03] border border-white/[0.06] rounded-md px-2 py-1.5 text-xs text-slate-200 font-mono-data focus:outline-none focus:border-emerald-500/40"
                    />
                  </label>
                  <div className="flex items-end gap-2 col-span-2 md:col-span-1">
                    <button
                      onClick={save}
                      disabled={saving}
                      className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/20 rounded-md text-xs text-emerald-400 disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                      Save
                    </button>
                    <button
                      onClick={cancel}
                      disabled={saving}
                      className="px-3 py-1.5 bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] rounded-md text-xs text-slate-400"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {sorted.length > visible.length && (
        <div className="px-5 py-3 border-t border-white/[0.06] text-center">
          <button
            onClick={() => setShowAll(true)}
            className="text-xs text-slate-400 hover:text-slate-200"
          >
            Show all {sorted.length} fields
          </button>
        </div>
      )}
    </div>
  );
}
