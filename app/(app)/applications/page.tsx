"use client";

import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { fetchApplications } from "@/lib/applications-client";
import { importApplications, type ImportApplicationsResult } from "@/lib/john-deere-client";
import type { ApplicationWithLines } from "@/types/applications";
import { ApplicationsList } from "@/components/applications/applications-list";
import { ApplicationFilters } from "@/components/applications/application-filters";

export default function ApplicationsPage() {
  const [rows, setRows] = useState<ApplicationWithLines[]>([]);
  const [filter, setFilter] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportApplicationsResult | null>(null);

  const runImport = async () => {
    setImporting(true);
    setError(null);
    setImportResult(null);
    try {
      const result = await importApplications();
      setImportResult(result);
      setFilter({}); // refetch the list with the freshly imported data
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchApplications(filter)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filter]);

  return (
    <div className="min-h-[calc(100vh-48px)] bg-slate-950 p-6">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-white">Applications</h1>
            <p className="mt-1 text-sm text-slate-400">
              Spray applications imported from John Deere Operations Center.
            </p>
          </div>
          <button
            onClick={runImport}
            disabled={importing}
            className="bg-emerald-500/15 flex flex-shrink-0 items-center gap-2 rounded-xl border border-emerald-500/20 px-4 py-2 text-sm font-medium text-emerald-400 transition-colors hover:bg-emerald-500/25 disabled:opacity-50"
          >
            {importing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {importing ? "Importing..." : "Import Applications"}
          </button>
        </header>
        <ApplicationFilters value={filter} onChange={setFilter} />
        {importResult && (
          <div className="glass mt-4 rounded-xl border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">
            Imported {importResult.operations_processed} application
            {importResult.operations_processed !== 1 ? "s" : ""} ·{" "}
            {importResult.product_lines_written} product line
            {importResult.product_lines_written !== 1 ? "s" : ""}
            {importResult.measurements_not_found > 0 &&
              ` · ${importResult.measurements_not_found} with no measurement data`}
            {importResult.measurements_error > 0 && ` · ${importResult.measurements_error} errored`}
          </div>
        )}
        {error && (
          <div className="glass mt-4 rounded-xl border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
            {error}
          </div>
        )}
        {loading && rows.length === 0 ? (
          <div className="mt-6 text-slate-400">Loading...</div>
        ) : (
          <ApplicationsList rows={rows} onChanged={() => setFilter({ ...filter })} />
        )}
      </div>
    </div>
  );
}
