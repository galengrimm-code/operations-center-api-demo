'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useClientFilter } from '@/contexts/client-filter-context';
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
import { ReportsTable } from './reports-table';
import { SeedingReportsTable } from './reports-table-seeding';
import { ReportsTrends } from './reports-trends';
import { Loader2, FileBarChart, Wheat, Sprout, FlaskConical } from 'lucide-react';
import { AnalysisRunner } from './analysis-runner';
import { ReportsExport } from './reports-export';
import { saveAnalysisResult, deleteAnalysisResult, formatCropName } from '@/lib/reports-data';
import { pollForShapefileUrl, importFieldOperations } from '@/lib/john-deere-client';
import { processShapefile, classifyHarvestPolygons, classifySeedingPolygons } from '@/lib/shapefile-analysis';
import { supabase } from '@/lib/supabase';

type ReportTab = 'harvest' | 'seeding' | 'application';

const TABS: { id: ReportTab; label: string; icon: typeof Wheat; disabled?: boolean }[] = [
  { id: 'harvest', label: 'Harvest', icon: Wheat },
  { id: 'seeding', label: 'Seeding', icon: Sprout },
  { id: 'application', label: 'Application', icon: FlaskConical, disabled: true },
];

export function ReportsView() {
  const { user, johnDeereConnection } = useAuth();
  const { selectedFarm: globalFarm } = useClientFilter();
  const orgId = johnDeereConnection?.selected_org_id;
  const hiddenCrops = johnDeereConnection?.hidden_crop_names || [];

  const [activeTab, setActiveTab] = useState<ReportTab>('harvest');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [irrigatedFields, setIrrigatedFields] = useState<StoredField[]>([]);
  const [seasons, setSeasons] = useState<string[]>([]);
  const [crops, setCrops] = useState<string[]>([]);
  const [rows, setRows] = useState<ReportRow[]>([]);

  const [selectedSeason, setSelectedSeason] = useState('');
  const [selectedCrop, setSelectedCrop] = useState('');
  const [selectedField, setSelectedField] = useState('');

  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<string | null>(null);

  const [runningOperationId, setRunningOperationId] = useState<string | null>(null);
  const [failedOperationIds, setFailedOperationIds] = useState<Set<string>>(new Set());
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; fieldName: string } | null>(null);

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

      let result;
      if (activeTab === 'seeding') {
        const stats = classifySeedingPolygons(geojson, irrigatedBoundary, row.field.has_irrigated_boundary);
        result = {
          user_id: user!.id,
          field_id: row.field.id,
          jd_field_id: row.field.jd_field_id,
          jd_operation_id: opId,
          operation_type: row.operation.operation_type,
          crop_name: row.operation.crop_name || '',
          crop_season: row.operation.crop_season || '',
          irrigated_acres: stats.irrigatedSeededAcres,
          dryland_acres: stats.drylandSeededAcres,
          total_acres: stats.irrigatedSeededAcres + stats.drylandSeededAcres,
          // Reuse yield columns to store seeding rates
          irrigated_yield: stats.irrigatedAvgSeedingRate,
          dryland_yield: stats.drylandAvgSeedingRate,
          total_yield: row.operation.avg_yield_value,
          irrigated_moisture: null,
          dryland_moisture: null,
          total_moisture: null,
          irrigated_bushels: null,
          dryland_bushels: null,
          polygon_count: stats.seedingPolygonCount,
          analyzed_at: new Date().toISOString(),
        };
      } else {
        const stats = classifyHarvestPolygons(geojson, irrigatedBoundary, row.field.has_irrigated_boundary);
        result = {
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
      }

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

    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    const failed: ReportRow[] = [];

    setIsBatchRunning(true);

    for (let i = 0; i < unanalyzed.length; i++) {
      const row = unanalyzed[i];
      setBatchProgress({
        current: i + 1,
        total: unanalyzed.length,
        fieldName: `${row.field.name} - ${formatCropName(row.operation.crop_name)}`,
      });
      await runAnalysisForRow(row);

      if (failedOperationIds.has(row.operation.jd_operation_id)) {
        failed.push(row);
      }

      if (i < unanalyzed.length - 1) {
        await delay(4000);
      }
    }

    if (failed.length > 0) {
      setBatchProgress({
        current: 0,
        total: failed.length,
        fieldName: `Retrying ${failed.length} failed...`,
      });
      await delay(10000);

      for (let i = 0; i < failed.length; i++) {
        const row = failed[i];
        setBatchProgress({
          current: i + 1,
          total: failed.length,
          fieldName: `Retry: ${row.field.name} - ${formatCropName(row.operation.crop_name)}`,
        });
        await runAnalysisForRow(row);

        if (i < failed.length - 1) {
          await delay(5000);
        }
      }
    }

    setIsBatchRunning(false);
    setBatchProgress(null);
  };

  const handleSyncOperations = async () => {
    if (!irrigatedFields.length) return;
    setIsSyncing(true);
    try {
      for (let i = 0; i < irrigatedFields.length; i++) {
        const field = irrigatedFields[i];
        setSyncProgress(`Syncing ${field.name}... ${i + 1} of ${irrigatedFields.length}`);
        try {
          await importFieldOperations(field.jd_field_id);
        } catch (err) {
          console.error(`Failed to sync operations for ${field.name}:`, err);
        }
      }
      await loadData();
    } finally {
      setIsSyncing(false);
      setSyncProgress(null);
    }
  };

  const loadData = useCallback(async () => {
    if (!user || !orgId) return;
    if (activeTab === 'application') {
      setRows([]);
      setSeasons([]);
      setCrops([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let fields = await fetchIrrigatedFields(user.id, orgId);
      if (globalFarm) {
        fields = fields.filter((f) => f.farm_name === globalFarm);
      }
      setIrrigatedFields(fields);

      const fieldIds = fields.map((f) => f.jd_field_id);
      const [seasonList, cropList] = await Promise.all([
        fetchAvailableSeasons(user.id, orgId, activeTab),
        fetchAvailableCrops(user.id, orgId, fieldIds, activeTab, hiddenCrops),
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
        activeTab,
        hiddenCrops,
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
  }, [user, orgId, activeTab, selectedSeason, selectedCrop, selectedField, globalFarm, hiddenCrops.join(',')]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Reset season/crop when switching tabs — harvest and seeding can have different sets
  useEffect(() => {
    setSelectedSeason('');
    setSelectedCrop('');
  }, [activeTab]);

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
            Reports
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Irrigated vs dryland breakdown by operation type
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 glass rounded-xl w-fit">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => !tab.disabled && setActiveTab(tab.id)}
              disabled={tab.disabled}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
                ${isActive
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                  : tab.disabled
                    ? 'text-slate-600 cursor-not-allowed'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}`}
              title={tab.disabled ? 'Coming soon — application data not yet imported' : undefined}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
              {tab.disabled && <span className="text-[10px] uppercase opacity-70">soon</span>}
            </button>
          );
        })}
      </div>

      {activeTab === 'application' ? (
        <div className="glass rounded-xl p-12 text-center">
          <FlaskConical className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-300 mb-2">Application Reports — Coming Soon</h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            Application (chemical / fertilizer) operations aren&rsquo;t yet imported from John Deere.
            Once the import pipeline is extended, this tab will show product-by-field-by-year breakdowns
            with the same irrigated / dryland split as Harvest and Seeding.
          </p>
        </div>
      ) : (
        <>
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
            <AnalysisRunner
              unanalyzedCount={rows.filter((r) => !r.analysis).length}
              isBatchRunning={isBatchRunning}
              batchProgress={batchProgress}
              onRunAll={handleRunAll}
            />
            {activeTab === 'harvest' && <ReportsExport rows={rows} season={selectedSeason} />}
            {isSyncing ? (
              <div className="flex items-center gap-2 text-sm text-emerald-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{syncProgress}</span>
              </div>
            ) : (
              <button
                onClick={handleSyncOperations}
                className="text-xs text-slate-500 hover:text-slate-300 underline"
              >
                Sync Missing Operations
              </button>
            )}
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
              <p className="text-slate-400">No {activeTab} data found for the selected filters.</p>
              {activeTab === 'seeding' && (
                <p className="text-xs text-slate-500 mt-2">
                  Tip: click &ldquo;Sync Missing Operations&rdquo; to pull planting operations from John Deere.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {activeTab === 'harvest' ? (
                <>
                  <ReportsTable
                    rows={rows}
                    runningOperationId={runningOperationId}
                    failedOperationIds={failedOperationIds}
                    onRunAnalysis={handleRunAnalysis}
                    onRerunAnalysis={handleRerunAnalysis}
                  />
                  <ReportsTrends
                    userId={user!.id}
                    orgId={orgId}
                    irrigatedFields={irrigatedFields}
                  />
                </>
              ) : (
                <SeedingReportsTable
                  rows={rows}
                  runningOperationId={runningOperationId}
                  failedOperationIds={failedOperationIds}
                  onRunAnalysis={handleRunAnalysis}
                  onRerunAnalysis={handleRerunAnalysis}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
