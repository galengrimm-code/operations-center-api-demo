# Irrigation Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reports page showing irrigated vs dryland acreage and yield breakdowns across all fields, with cached shapefile analysis, year-over-year trends, and CSV/PDF export.

**Architecture:** Hybrid approach — Edge Functions fetch shapefiles from John Deere and store in Supabase Storage. Browser downloads shapefiles and runs polygon classification using existing `lib/shapefile-analysis.ts`. Results cached in a new `irrigation_analysis_results` DB table. Report page reads from DB for instant loading.

**Tech Stack:** Next.js 13 App Router, Supabase (Postgres + Storage), TypeScript, Tailwind CSS, shadcn/ui, existing shapefile-analysis library, recharts (for potential future charts).

**Spec:** `docs/superpowers/specs/2026-04-16-irrigation-reports-design.md`

---

## File Structure

```
# New files
app/(app)/reports/page.tsx                    — Report page (thin server shell, delegates to reports-view)
components/reports/reports-view.tsx            — Main client component: state, data loading, orchestration
components/reports/reports-filters.tsx         — Year/Crop/Field filter dropdowns
components/reports/reports-table.tsx           — Data table with per-row Run/Re-run buttons
components/reports/reports-summary-row.tsx     — Weighted average totals row
components/reports/reports-trends.tsx          — Year-over-year trends with field/crop picker
components/reports/reports-export.tsx          — CSV and PDF export buttons
components/reports/analysis-runner.tsx         — Single + batch shapefile analysis with progress UI
lib/reports-data.ts                           — DB queries: load report data, save/delete analysis results
lib/reports-export-utils.ts                   — CSV string builder and PDF HTML generator
types/john-deere.ts                           — Add IrrigationAnalysisResult type (modify existing)

# Modified files
components/layout/nav-links.tsx               — Add Reports nav link
```

---

### Task 1: Create the database table

**Files:**
- None (SQL executed against Supabase directly)

- [ ] **Step 1: Create the `irrigation_analysis_results` table**

Run against the linked Supabase project:

```sql
CREATE TABLE operations_center.irrigation_analysis_results (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  field_id              uuid NOT NULL,
  jd_field_id           text NOT NULL,
  jd_operation_id       text NOT NULL,
  operation_type        text NOT NULL,
  crop_name             text NOT NULL,
  crop_season           text NOT NULL,
  irrigated_acres       double precision NOT NULL,
  dryland_acres         double precision NOT NULL,
  total_acres           double precision NOT NULL,
  irrigated_yield       double precision,
  dryland_yield         double precision,
  total_yield           double precision,
  irrigated_moisture    double precision,
  dryland_moisture      double precision,
  total_moisture        double precision,
  irrigated_bushels     double precision,
  dryland_bushels       double precision,
  polygon_count         integer NOT NULL DEFAULT 0,
  analyzed_at           timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, jd_operation_id)
);
```

- [ ] **Step 2: Enable RLS and create policy**

```sql
ALTER TABLE operations_center.irrigation_analysis_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own analysis results"
  ON operations_center.irrigation_analysis_results
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

- [ ] **Step 3: Grant permissions to Supabase roles**

```sql
GRANT ALL ON operations_center.irrigation_analysis_results
  TO anon, authenticated, service_role;
```

- [ ] **Step 4: Verify table exists**

```bash
npx supabase db query --linked "SELECT table_name FROM information_schema.tables WHERE table_schema = 'operations_center' AND table_name = 'irrigation_analysis_results';" -o table
```

Expected: One row showing `irrigation_analysis_results`.

- [ ] **Step 5: Commit** (nothing to commit — DB-only change)

---

### Task 2: Add TypeScript type and data layer

**Files:**
- Modify: `types/john-deere.ts` (add type at end of file)
- Create: `lib/reports-data.ts`

- [ ] **Step 1: Add `IrrigationAnalysisResult` type to `types/john-deere.ts`**

Add at the end of the file:

```typescript
export interface IrrigationAnalysisResult {
  id: string;
  user_id: string;
  field_id: string;
  jd_field_id: string;
  jd_operation_id: string;
  operation_type: string;
  crop_name: string;
  crop_season: string;
  irrigated_acres: number;
  dryland_acres: number;
  total_acres: number;
  irrigated_yield: number | null;
  dryland_yield: number | null;
  total_yield: number | null;
  irrigated_moisture: number | null;
  dryland_moisture: number | null;
  total_moisture: number | null;
  irrigated_bushels: number | null;
  dryland_bushels: number | null;
  polygon_count: number;
  analyzed_at: string;
  created_at: string;
}
```

- [ ] **Step 2: Create `lib/reports-data.ts`**

```typescript
import { supabase } from './supabase';
import type { StoredField, StoredFieldOperation, IrrigationAnalysisResult } from '@/types/john-deere';

export interface ReportRow {
  field: StoredField;
  operation: StoredFieldOperation;
  analysis: IrrigationAnalysisResult | null;
  irrigatedAcres: number;
  drylandAcres: number;
  totalAcres: number;
}

/** Fetch all fields that have irrigated boundaries */
export async function fetchIrrigatedFields(userId: string, orgId: string): Promise<StoredField[]> {
  const { data, error } = await supabase
    .from('fields')
    .select('*')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .eq('has_irrigated_boundary', true);

  if (error) throw new Error(`Failed to load fields: ${error.message}`);
  return data || [];
}

/** Fetch harvest operations for a set of fields, optionally filtered by season and crop */
export async function fetchHarvestOperations(
  userId: string,
  orgId: string,
  fieldIds: string[],
  season?: string,
  cropName?: string,
): Promise<StoredFieldOperation[]> {
  let query = supabase
    .from('field_operations')
    .select('*')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .eq('operation_type', 'harvest')
    .in('jd_field_id', fieldIds);

  if (season) query = query.eq('crop_season', season);
  if (cropName) query = query.eq('crop_name', cropName);

  const { data, error } = await query.order('crop_season', { ascending: false });
  if (error) throw new Error(`Failed to load operations: ${error.message}`);
  return data || [];
}

/** Fetch all available crop seasons */
export async function fetchAvailableSeasons(userId: string, orgId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('field_operations')
    .select('crop_season')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .eq('operation_type', 'harvest')
    .not('crop_season', 'is', null);

  if (error) return [];
  const seasons = [...new Set((data || []).map(d => d.crop_season as string))];
  return seasons.sort((a, b) => b.localeCompare(a));
}

/** Fetch all available crop names for irrigated fields */
export async function fetchAvailableCrops(
  userId: string,
  orgId: string,
  fieldIds: string[],
): Promise<string[]> {
  const { data, error } = await supabase
    .from('field_operations')
    .select('crop_name')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .eq('operation_type', 'harvest')
    .in('jd_field_id', fieldIds)
    .not('crop_name', 'is', null);

  if (error) return [];
  const crops = [...new Set((data || []).map(d => d.crop_name as string))];
  return crops.sort();
}

/** Fetch cached analysis results for a list of operation IDs */
export async function fetchAnalysisResults(
  userId: string,
  operationIds: string[],
): Promise<IrrigationAnalysisResult[]> {
  if (operationIds.length === 0) return [];
  const { data, error } = await supabase
    .from('irrigation_analysis_results')
    .select('*')
    .eq('user_id', userId)
    .in('jd_operation_id', operationIds);

  if (error) throw new Error(`Failed to load analysis results: ${error.message}`);
  return data || [];
}

/** Save an analysis result (upsert by user_id + jd_operation_id) */
export async function saveAnalysisResult(
  result: Omit<IrrigationAnalysisResult, 'id' | 'created_at'>,
): Promise<void> {
  const { error } = await supabase
    .from('irrigation_analysis_results')
    .upsert(result, { onConflict: 'user_id,jd_operation_id' });

  if (error) throw new Error(`Failed to save analysis: ${error.message}`);
}

/** Delete an analysis result and its cached shapefile */
export async function deleteAnalysisResult(
  userId: string,
  operationId: string,
): Promise<void> {
  await supabase
    .from('irrigation_analysis_results')
    .delete()
    .eq('user_id', userId)
    .eq('jd_operation_id', operationId);

  await supabase.storage
    .from('shapefiles')
    .remove([`${userId}/${operationId}.zip`]);
}

/** Build report rows by joining fields, operations, and cached analysis */
export function buildReportRows(
  fields: StoredField[],
  operations: StoredFieldOperation[],
  analysisResults: IrrigationAnalysisResult[],
): ReportRow[] {
  const fieldMap = new Map(fields.map(f => [f.jd_field_id, f]));
  const analysisMap = new Map(analysisResults.map(a => [a.jd_operation_id, a]));

  return operations
    .filter(op => fieldMap.has(op.jd_field_id))
    .map(op => {
      const field = fieldMap.get(op.jd_field_id)!;
      const analysis = analysisMap.get(op.jd_operation_id) || null;

      const totalBoundaryAcres = field.boundary_area_value || 0;
      const irrigatedBoundaryAcres = field.irrigated_boundary_area_value || 0;
      const drylandBoundaryAcres = totalBoundaryAcres - irrigatedBoundaryAcres;

      return {
        field,
        operation: op,
        analysis,
        irrigatedAcres: irrigatedBoundaryAcres,
        drylandAcres: Math.max(0, drylandBoundaryAcres),
        totalAcres: op.area_value || totalBoundaryAcres,
      };
    })
    .sort((a, b) => a.field.name.localeCompare(b.field.name));
}
```

- [ ] **Step 3: Commit**

```bash
git add types/john-deere.ts lib/reports-data.ts
git commit -m "feat: add irrigation analysis result type and reports data layer"
```

---

### Task 3: Add Reports nav link

**Files:**
- Modify: `components/layout/nav-links.tsx`

- [ ] **Step 1: Add the Reports link**

In `components/layout/nav-links.tsx`, add the `FileBarChart` import and a new entry to the `links` array:

Add to imports:
```typescript
import { Map, Grid3X3, BarChart3, FileBarChart } from 'lucide-react';
```

Add to the `links` array after the Operations entry:
```typescript
{ href: '/reports', label: 'Reports', icon: FileBarChart },
```

- [ ] **Step 2: Commit**

```bash
git add components/layout/nav-links.tsx
git commit -m "feat: add Reports link to navigation"
```

---

### Task 4: Create the reports page shell and filters

**Files:**
- Create: `app/(app)/reports/page.tsx`
- Create: `components/reports/reports-filters.tsx`
- Create: `components/reports/reports-view.tsx`

- [ ] **Step 1: Create `app/(app)/reports/page.tsx`**

```typescript
'use client';

import { ReportsView } from '@/components/reports/reports-view';

export default function ReportsPage() {
  return <ReportsView />;
}
```

- [ ] **Step 2: Create `components/reports/reports-filters.tsx`**

```typescript
'use client';

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
            <option key={c} value={c}>{c}</option>
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
```

- [ ] **Step 3: Create `components/reports/reports-view.tsx` (initial shell)**

```typescript
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { ReportsFilters } from './reports-filters';
import {
  fetchIrrigatedFields,
  fetchHarvestOperations,
  fetchAvailableSeasons,
  fetchAvailableCrops,
  fetchAnalysisResults,
  buildReportRows,
  type ReportRow,
} from '@/lib/reports-data';
import type { StoredField } from '@/types/john-deere';
import { Loader2, FileBarChart } from 'lucide-react';

export function ReportsView() {
  const { user, johnDeereConnection } = useAuth();
  const orgId = johnDeereConnection?.selected_org_id;
  const preferredUnit = johnDeereConnection?.preferred_area_unit || 'ac';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [irrigatedFields, setIrrigatedFields] = useState<StoredField[]>([]);
  const [seasons, setSeasons] = useState<string[]>([]);
  const [crops, setCrops] = useState<string[]>([]);
  const [rows, setRows] = useState<ReportRow[]>([]);

  const [selectedSeason, setSelectedSeason] = useState('');
  const [selectedCrop, setSelectedCrop] = useState('');
  const [selectedField, setSelectedField] = useState('');

  const loadData = useCallback(async () => {
    if (!user || !orgId) return;
    setLoading(true);
    setError(null);

    try {
      const fields = await fetchIrrigatedFields(user.id, orgId);
      setIrrigatedFields(fields);

      const fieldIds = fields.map((f) => f.jd_field_id);
      const [seasonList, cropList] = await Promise.all([
        fetchAvailableSeasons(user.id, orgId),
        fetchAvailableCrops(user.id, orgId, fieldIds),
      ]);

      setSeasons(seasonList);
      setCrops(cropList);

      const season = selectedSeason || seasonList[0] || '';
      if (!selectedSeason && season) setSelectedSeason(season);

      const ops = await fetchHarvestOperations(
        user.id,
        orgId,
        fieldIds,
        season || undefined,
        selectedCrop || undefined,
      );

      const opIds = ops.map((o) => o.jd_operation_id);
      const results = await fetchAnalysisResults(user.id, opIds);

      let reportRows = buildReportRows(fields, ops, results);

      if (selectedField) {
        reportRows = reportRows.filter((r) => r.field.name === selectedField);
      }

      setRows(reportRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report data');
    } finally {
      setLoading(false);
    }
  }, [user, orgId, selectedSeason, selectedCrop, selectedField]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const fieldNames = irrigatedFields.map((f) => f.name).sort();

  if (!orgId) {
    return (
      <div className="p-8 text-center text-slate-400">
        Connect to John Deere and select an organization to view reports.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <FileBarChart className="w-6 h-6 text-emerald-500" />
            Irrigation Reports
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Irrigated vs dryland acreage and yield breakdown
          </p>
        </div>
      </div>

      <div className="glass rounded-xl p-4 flex flex-wrap items-end justify-between gap-4">
        <ReportsFilters
          seasons={seasons}
          crops={crops}
          fieldNames={fieldNames}
          selectedSeason={selectedSeason}
          selectedCrop={selectedCrop}
          selectedField={selectedField}
          onSeasonChange={setSelectedSeason}
          onCropChange={setSelectedCrop}
          onFieldChange={setSelectedField}
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
        </div>
      ) : error ? (
        <div className="glass rounded-xl p-6 text-red-400 text-center">{error}</div>
      ) : rows.length === 0 ? (
        <div className="glass rounded-xl p-12 text-center">
          <FileBarChart className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <p className="text-slate-400">No harvest data found for the selected filters.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* ReportsTable and other components will be added in subsequent tasks */}
          <div className="glass rounded-xl p-6 text-slate-300">
            {rows.length} operations loaded for {selectedSeason}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify the page loads**

Run `npm run build` or `npm run dev` and navigate to `/reports`. Verify it shows the filters and a row count.

- [ ] **Step 5: Commit**

```bash
git add app/(app)/reports/page.tsx components/reports/reports-view.tsx components/reports/reports-filters.tsx
git commit -m "feat: add reports page shell with filters and data loading"
```

---

### Task 5: Create the reports data table

**Files:**
- Create: `components/reports/reports-table.tsx`
- Create: `components/reports/reports-summary-row.tsx`
- Modify: `components/reports/reports-view.tsx` (wire in table)

- [ ] **Step 1: Create `components/reports/reports-table.tsx`**

```typescript
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
```

- [ ] **Step 2: Create `components/reports/reports-summary-row.tsx`**

```typescript
'use client';

import { type ReportRow } from '@/lib/reports-data';

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
    (r) => r.analysis?.irrigated_yield,
    (r) => r.analysis?.irrigated_acres || 0,
  );
  const avgDryYield = weightedAvg(
    rows,
    (r) => r.analysis?.dryland_yield,
    (r) => r.analysis?.dryland_acres || 0,
  );
  const avgTotalYield = weightedAvg(
    rows,
    (r) => r.operation.avg_yield_value,
    (r) => r.totalAcres,
  );
  const avgIrrMst = weightedAvg(
    rows,
    (r) => r.analysis?.irrigated_moisture,
    (r) => r.analysis?.irrigated_acres || 0,
  );
  const avgDryMst = weightedAvg(
    rows,
    (r) => r.analysis?.dryland_moisture,
    (r) => r.analysis?.dryland_acres || 0,
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
        <td className="px-4 py-3 text-right">{fmt(avgTotalYield)}</td>
        <td className="px-4 py-3 text-right text-emerald-400/70">{fmtPct(avgIrrMst)}</td>
        <td className="px-4 py-3 text-right text-amber-400/70">{fmtPct(avgDryMst)}</td>
        <td className="px-4 py-3 text-right">{fmtPct(avgTotalMst)}</td>
        <td className="px-4 py-3"></td>
      </tr>
    </tfoot>
  );
}
```

- [ ] **Step 3: Wire the table into `reports-view.tsx`**

In `components/reports/reports-view.tsx`, replace the placeholder `<div>` that says "operations loaded" with:

Add imports at the top:
```typescript
import { ReportsTable } from './reports-table';
```

Add state variables after the existing state declarations:
```typescript
const [runningOperationId, setRunningOperationId] = useState<string | null>(null);
const [failedOperationIds, setFailedOperationIds] = useState<Set<string>>(new Set());
```

Add handler stubs (will be implemented in Task 6):
```typescript
const handleRunAnalysis = async (row: ReportRow) => {
  // Implemented in Task 6
};

const handleRerunAnalysis = async (row: ReportRow) => {
  // Implemented in Task 6
};
```

Replace the placeholder div with:
```typescript
<ReportsTable
  rows={rows}
  runningOperationId={runningOperationId}
  failedOperationIds={failedOperationIds}
  onRunAnalysis={handleRunAnalysis}
  onRerunAnalysis={handleRerunAnalysis}
/>
```

- [ ] **Step 4: Verify the table renders**

Run `npm run dev`, navigate to `/reports`, select a year with data. Verify the table shows field names, crops, acreage columns, `--` for yield columns, and Run buttons.

- [ ] **Step 5: Commit**

```bash
git add components/reports/reports-table.tsx components/reports/reports-summary-row.tsx components/reports/reports-view.tsx
git commit -m "feat: add reports data table with summary row"
```

---

### Task 6: Implement single + batch analysis runner

**Files:**
- Create: `components/reports/analysis-runner.tsx`
- Modify: `components/reports/reports-view.tsx` (wire in analysis logic)

- [ ] **Step 1: Create `components/reports/analysis-runner.tsx`**

```typescript
'use client';

import { Button } from '@/components/ui/button';
import { Loader2, PlayCircle } from 'lucide-react';

interface AnalysisRunnerProps {
  unanalyzedCount: number;
  isBatchRunning: boolean;
  batchProgress: { current: number; total: number; fieldName: string } | null;
  onRunAll: () => void;
}

export function AnalysisRunner({
  unanalyzedCount,
  isBatchRunning,
  batchProgress,
  onRunAll,
}: AnalysisRunnerProps) {
  if (unanalyzedCount === 0 && !isBatchRunning) return null;

  return (
    <div className="flex items-center gap-4">
      {isBatchRunning && batchProgress ? (
        <div className="flex items-center gap-2 text-sm text-emerald-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>
            Analyzing {batchProgress.fieldName}... {batchProgress.current} of {batchProgress.total}
          </span>
        </div>
      ) : unanalyzedCount > 0 ? (
        <Button
          onClick={onRunAll}
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          <PlayCircle className="w-4 h-4 mr-2" />
          Run All Analysis ({unanalyzedCount})
        </Button>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Add analysis logic to `reports-view.tsx`**

Add imports at the top of `components/reports/reports-view.tsx`:
```typescript
import { AnalysisRunner } from './analysis-runner';
import { saveAnalysisResult, deleteAnalysisResult, type ReportRow } from '@/lib/reports-data';
import { pollForShapefileUrl } from '@/lib/john-deere-client';
import { processShapefile, classifyHarvestPolygons } from '@/lib/shapefile-analysis';
import { supabase } from '@/lib/supabase';
```

Add state for batch running after existing state declarations:
```typescript
const [isBatchRunning, setIsBatchRunning] = useState(false);
const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; fieldName: string } | null>(null);
```

Replace the `handleRunAnalysis` stub with:
```typescript
const runAnalysisForRow = async (row: ReportRow): Promise<void> => {
  const opId = row.operation.jd_operation_id;
  setRunningOperationId(opId);
  setFailedOperationIds((prev) => { const next = new Set(prev); next.delete(opId); return next; });

  try {
    const storagePath = await pollForShapefileUrl(opId, () => {});

    const { data: blob, error: downloadError } = await supabase.storage
      .from('shapefiles')
      .download(storagePath);

    if (downloadError || !blob) {
      throw new Error(`Failed to download shapefile: ${downloadError?.message || 'No data'}`);
    }

    const zipBuffer = await blob.arrayBuffer();
    const geojson = await processShapefile(zipBuffer);

    const irrigatedBoundary = (row.field.irrigated_boundary_geojson || null) as
      { type: 'MultiPolygon'; coordinates: number[][][][] } | null;

    const stats = classifyHarvestPolygons(geojson, irrigatedBoundary, row.field.has_irrigated_boundary);

    const result = {
      user_id: user!.id,
      field_id: row.field.id,
      jd_field_id: row.field.jd_field_id,
      jd_operation_id: opId,
      operation_type: row.operation.operation_type,
      crop_name: row.operation.crop_name || '',
      crop_season: row.operation.crop_season || '',
      irrigated_acres: stats.irrigatedHarvestedAcres,
      dryland_acres: stats.drylandHarvestedAcres,
      total_acres: stats.irrigatedHarvestedAcres + stats.drylandHarvestedAcres,
      irrigated_yield: stats.irrigatedAvgYield,
      dryland_yield: stats.drylandAvgYield,
      total_yield: row.operation.avg_yield_value,
      irrigated_moisture: stats.irrigatedAvgMoisture,
      dryland_moisture: stats.drylandAvgMoisture,
      total_moisture: row.operation.avg_moisture,
      irrigated_bushels: stats.irrigatedTotalBushels,
      dryland_bushels: stats.drylandTotalBushels,
      polygon_count: stats.harvestPolygonCount,
      analyzed_at: new Date().toISOString(),
    };

    await saveAnalysisResult(result);
    await loadData();
  } catch (err) {
    console.error(`Analysis failed for ${opId}:`, err);
    setFailedOperationIds((prev) => new Set(prev).add(opId));
  } finally {
    setRunningOperationId(null);
  }
};

const handleRunAnalysis = async (row: ReportRow) => {
  await runAnalysisForRow(row);
};

const handleRerunAnalysis = async (row: ReportRow) => {
  await deleteAnalysisResult(user!.id, row.operation.jd_operation_id);
  await runAnalysisForRow(row);
};

const handleRunAll = async () => {
  const unanalyzed = rows.filter((r) => !r.analysis);
  if (unanalyzed.length === 0) return;

  setIsBatchRunning(true);
  for (let i = 0; i < unanalyzed.length; i++) {
    const row = unanalyzed[i];
    setBatchProgress({
      current: i + 1,
      total: unanalyzed.length,
      fieldName: `${row.field.name} - ${row.operation.crop_name}`,
    });
    await runAnalysisForRow(row);
  }
  setIsBatchRunning(false);
  setBatchProgress(null);
};
```

Add the `AnalysisRunner` component in the JSX, inside the `<div className="glass rounded-xl p-4 flex ...">` filter bar, after `<ReportsFilters ... />`:

```typescript
<AnalysisRunner
  unanalyzedCount={rows.filter((r) => !r.analysis).length}
  isBatchRunning={isBatchRunning}
  batchProgress={batchProgress}
  onRunAll={handleRunAll}
/>
```

- [ ] **Step 3: Verify single and batch analysis work**

Run `npm run dev`, navigate to `/reports`. Click "Run" on a single row — verify it shows a spinner, then populates yield/moisture columns. Click "Run All Analysis" — verify it processes rows sequentially with progress.

- [ ] **Step 4: Commit**

```bash
git add components/reports/analysis-runner.tsx components/reports/reports-view.tsx
git commit -m "feat: add single and batch analysis runner for reports"
```

---

### Task 7: Add trends section

**Files:**
- Create: `components/reports/reports-trends.tsx`
- Modify: `components/reports/reports-view.tsx` (wire in trends)

- [ ] **Step 1: Create `components/reports/reports-trends.tsx`**

```typescript
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

function fmtPct(value: number | null | undefined): string {
  if (value == null) return '--';
  return value.toFixed(1) + '%';
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

  const fieldNames = irrigatedFields.map((f) => f.name).sort();

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

  // Compute available crops for the selected field
  const [availableCrops, setAvailableCrops] = useState<string[]>([]);
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
```

- [ ] **Step 2: Wire trends into `reports-view.tsx`**

Add import:
```typescript
import { ReportsTrends } from './reports-trends';
```

Add the trends component after the `<ReportsTable />` in the JSX, inside the `<div className="space-y-6">`:
```typescript
<ReportsTrends
  userId={user!.id}
  orgId={orgId}
  irrigatedFields={irrigatedFields}
/>
```

- [ ] **Step 3: Verify trends load**

Navigate to `/reports`, select a field and crop in the trends section. Verify year-over-year rows appear with the weighted average row.

- [ ] **Step 4: Commit**

```bash
git add components/reports/reports-trends.tsx components/reports/reports-view.tsx
git commit -m "feat: add year-over-year trends section to reports"
```

---

### Task 8: Add CSV and PDF export

**Files:**
- Create: `lib/reports-export-utils.ts`
- Create: `components/reports/reports-export.tsx`
- Modify: `components/reports/reports-view.tsx` (wire in export)

- [ ] **Step 1: Create `lib/reports-export-utils.ts`**

```typescript
import { type ReportRow } from './reports-data';

function fmt(value: number | null | undefined, decimals = 1): string {
  if (value == null) return '';
  return value.toFixed(decimals);
}

export function generateCSV(rows: ReportRow[], season: string): string {
  const headers = [
    'Field', 'Crop', 'Season',
    'Irrigated Acres', 'Dryland Acres', 'Total Acres',
    'Irrigated Yield (bu/ac)', 'Dryland Yield (bu/ac)', 'Total Yield (bu/ac)',
    'Irrigated Moisture %', 'Dryland Moisture %', 'Total Moisture %',
  ];

  const csvRows = [headers.join(',')];

  for (const row of rows) {
    csvRows.push([
      `"${row.field.name}"`,
      row.operation.crop_name || '',
      row.operation.crop_season || season,
      fmt(row.irrigatedAcres),
      fmt(row.drylandAcres),
      fmt(row.totalAcres),
      row.analysis ? fmt(row.analysis.irrigated_yield) : '',
      row.analysis ? fmt(row.analysis.dryland_yield) : '',
      fmt(row.operation.avg_yield_value),
      row.analysis ? fmt(row.analysis.irrigated_moisture) : '',
      row.analysis ? fmt(row.analysis.dryland_moisture) : '',
      fmt(row.operation.avg_moisture),
    ].join(','));
  }

  return csvRows.join('\n');
}

export function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function generatePDFHtml(rows: ReportRow[], season: string, title: string): string {
  const tableRows = rows.map((row) => `
    <tr>
      <td>${row.field.name}</td>
      <td>${row.operation.crop_name || ''}</td>
      <td style="text-align:right">${fmt(row.irrigatedAcres)}</td>
      <td style="text-align:right">${fmt(row.drylandAcres)}</td>
      <td style="text-align:right">${fmt(row.totalAcres)}</td>
      <td style="text-align:right">${row.analysis ? fmt(row.analysis.irrigated_yield) : '--'}</td>
      <td style="text-align:right">${row.analysis ? fmt(row.analysis.dryland_yield) : '--'}</td>
      <td style="text-align:right">${fmt(row.operation.avg_yield_value)}</td>
      <td style="text-align:right">${row.analysis ? fmt(row.analysis.irrigated_moisture, 1) + '%' : '--'}</td>
      <td style="text-align:right">${row.analysis ? fmt(row.analysis.dryland_moisture, 1) + '%' : '--'}</td>
      <td style="text-align:right">${row.operation.avg_moisture != null ? fmt(row.operation.avg_moisture, 1) + '%' : '--'}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 11px; margin: 20px; }
    h1 { font-size: 18px; margin-bottom: 4px; }
    h2 { font-size: 13px; color: #666; margin-top: 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border: 1px solid #ddd; padding: 6px 8px; }
    th { background: #f5f5f5; text-align: left; font-size: 10px; text-transform: uppercase; }
    td { font-size: 11px; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <h2>Season: ${season}</h2>
  <table>
    <thead>
      <tr>
        <th>Field</th><th>Crop</th>
        <th style="text-align:right">Irr Ac</th><th style="text-align:right">Dry Ac</th><th style="text-align:right">Total Ac</th>
        <th style="text-align:right">Irr Yield</th><th style="text-align:right">Dry Yield</th><th style="text-align:right">Total Yield</th>
        <th style="text-align:right">Irr Mst</th><th style="text-align:right">Dry Mst</th><th style="text-align:right">Total Mst</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
</body>
</html>`;
}

export function printPDF(html: string): void {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.onload = () => { win.print(); };
}
```

- [ ] **Step 2: Create `components/reports/reports-export.tsx`**

```typescript
'use client';

import { Button } from '@/components/ui/button';
import { Download, Printer } from 'lucide-react';
import { type ReportRow } from '@/lib/reports-data';
import { generateCSV, downloadCSV, generatePDFHtml, printPDF } from '@/lib/reports-export-utils';

interface ReportsExportProps {
  rows: ReportRow[];
  season: string;
}

export function ReportsExport({ rows, season }: ReportsExportProps) {
  const handleCSV = () => {
    const csv = generateCSV(rows, season);
    downloadCSV(csv, `irrigation-report-${season}.csv`);
  };

  const handlePDF = () => {
    const html = generatePDFHtml(rows, season, 'Irrigation Report');
    printPDF(html);
  };

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={handleCSV} className="border-slate-700 text-slate-300 hover:text-white">
        <Download className="w-4 h-4 mr-1" /> CSV
      </Button>
      <Button variant="outline" size="sm" onClick={handlePDF} className="border-slate-700 text-slate-300 hover:text-white">
        <Printer className="w-4 h-4 mr-1" /> PDF
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Wire exports into `reports-view.tsx`**

Add imports:
```typescript
import { ReportsExport } from './reports-export';
```

Add the export component in the filter bar area, after `<AnalysisRunner ... />`:
```typescript
<ReportsExport rows={rows} season={selectedSeason} />
```

- [ ] **Step 4: Verify export works**

Click CSV — verify a file downloads with the correct data. Click PDF — verify a print dialog opens with a formatted table.

- [ ] **Step 5: Commit**

```bash
git add lib/reports-export-utils.ts components/reports/reports-export.tsx components/reports/reports-view.tsx
git commit -m "feat: add CSV and PDF export to reports page"
```

---

### Task 9: Build verification and push

**Files:**
- All files from previous tasks

- [ ] **Step 1: Run the build**

```bash
cd /c/Users/galen/operations-center-api-demo && npm run build
```

Expected: Build succeeds with no type errors. Warnings about `@supabase/realtime-js` are expected and can be ignored.

- [ ] **Step 2: Fix any build errors**

If there are type errors, fix them. Common issues:
- Missing imports
- Nullable type mismatches (add `!` or null checks)
- Missing `'use client'` directives

- [ ] **Step 3: Push to trigger Vercel deploy**

```bash
git push
```

- [ ] **Step 4: Verify on production**

Navigate to `https://operations-center-api-demo.vercel.app/reports`. Verify:
- Filters load with seasons and crops
- Table shows fields with irrigated boundaries
- Acreage columns are populated
- Run button triggers shapefile analysis
- Trends section loads year-over-year data
- CSV and PDF exports work
