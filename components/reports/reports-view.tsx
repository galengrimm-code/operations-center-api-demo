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
import { ReportsTable } from './reports-table';
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

  const [runningOperationId, setRunningOperationId] = useState<string | null>(null);
  const [failedOperationIds, setFailedOperationIds] = useState<Set<string>>(new Set());

  const handleRunAnalysis = async (row: ReportRow) => {
    // Will be implemented in Task 6
  };

  const handleRerunAnalysis = async (row: ReportRow) => {
    // Will be implemented in Task 6
  };

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
          <ReportsTable
            rows={rows}
            runningOperationId={runningOperationId}
            failedOperationIds={failedOperationIds}
            onRunAnalysis={handleRunAnalysis}
            onRerunAnalysis={handleRerunAnalysis}
          />
        </div>
      )}
    </div>
  );
}
