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
import { ReportsTrends } from './reports-trends';
import { Loader2, FileBarChart } from 'lucide-react';
import { AnalysisRunner } from './analysis-runner';
import { ReportsExport } from './reports-export';
import { saveAnalysisResult, deleteAnalysisResult } from '@/lib/reports-data';
import { pollForShapefileUrl, importFieldOperations } from '@/lib/john-deere-client';
import { processShapefile, classifyHarvestPolygons } from '@/lib/shapefile-analysis';
import { supabase } from '@/lib/supabase';

export function ReportsView() {
  const { user, johnDeereConnection } = useAuth();
  const { selectedFarm: globalFarm } = useClientFilter();
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
  }, [user, orgId, selectedSeason, selectedCrop, selectedField, globalFarm]);

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
        <AnalysisRunner
          unanalyzedCount={rows.filter((r) => !r.analysis).length}
          isBatchRunning={isBatchRunning}
          batchProgress={batchProgress}
          onRunAll={handleRunAll}
        />
        <ReportsExport rows={rows} season={selectedSeason} />
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
          <p className="text-slate-400">No harvest data found for the selected filters.</p>
        </div>
      ) : (
        <div className="space-y-6">
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
        </div>
      )}
    </div>
  );
}
