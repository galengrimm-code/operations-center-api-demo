"use client";

import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { fetchApplications } from "@/lib/applications-client";
import {
  fetchStoredFields,
  importApplications,
  type ImportApplicationsResult,
} from "@/lib/john-deere-client";
import { useClientFilter } from "@/contexts/client-filter-context";
import type { ApplicationWithLines } from "@/types/applications";
import { ApplicationsList } from "@/components/applications/applications-list";
import { ApplicationFilters } from "@/components/applications/application-filters";

export default function ApplicationsPage() {
  const { selectedFarm } = useClientFilter();
  const [rows, setRows] = useState<ApplicationWithLines[]>([]);
  const [filter, setFilter] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<
    (ImportApplicationsResult & { fields_failed: number }) | null
  >(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
    ops: number;
    lines: number;
    failed: number;
  } | null>(null);

  const runImport = async () => {
    setImporting(true);
    setError(null);
    setImportResult(null);
    setProgress(null);
    try {
      // Pull the field list and import one field at a time. Each per-field call
      // is small enough to finish well under the gateway timeout (the all-fields
      // call 504'd on real data), and lets us show real progress.
      const fieldsData = await fetchStoredFields();
      const fields = (
        Array.isArray(fieldsData) ? fieldsData : (fieldsData?.fields ?? fieldsData?.values ?? [])
      ) as Array<{ jd_field_id?: string }>;
      const ids = Array.from(
        new Set(fields.map((f) => f.jd_field_id).filter((x): x is string => Boolean(x))),
      );

      if (ids.length === 0) {
        setError("No stored fields to import from — import your fields first.");
        return;
      }

      let ops = 0;
      let lines = 0;
      let notFound = 0;
      let errored = 0;
      let failed = 0;
      setProgress({ done: 0, total: ids.length, ops: 0, lines: 0, failed: 0 });

      for (let i = 0; i < ids.length; i++) {
        try {
          const r = await importApplications(ids[i]);
          ops += r.operations_processed;
          lines += r.product_lines_written;
          notFound += r.measurements_not_found;
          errored += r.measurements_error;
        } catch {
          failed += 1; // one field failing shouldn't abort the whole import
        }
        setProgress({ done: i + 1, total: ids.length, ops, lines, failed });
      }

      setImportResult({
        operations_processed: ops,
        product_lines_written: lines,
        measurements_not_found: notFound,
        measurements_error: errored,
        fields_failed: failed,
      });
      setFilter({}); // refetch the list with the freshly imported data
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
      setProgress(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchApplications({ ...filter, farm: selectedFarm ?? undefined })
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
  }, [filter, selectedFarm]);

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
            {importing
              ? `Importing… ${progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%`
              : "Import Applications"}
          </button>
        </header>
        <ApplicationFilters value={filter} onChange={setFilter} />
        {importing && progress && (
          <div className="glass mt-4 rounded-xl border-white/[0.08] p-4">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-slate-300">
                Importing… field {progress.done} of {progress.total}
              </span>
              <span className="font-mono-data text-emerald-400">
                {progress.ops} ops · {progress.lines} lines
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                style={{
                  width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%`,
                }}
              />
            </div>
            {progress.failed > 0 && (
              <p className="mt-2 text-xs text-amber-400">
                {progress.failed} field{progress.failed !== 1 ? "s" : ""} failed so far — re-running
                the import will retry them
              </p>
            )}
          </div>
        )}
        {importResult && (
          <div className="glass mt-4 rounded-xl border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">
            Imported {importResult.operations_processed} application
            {importResult.operations_processed !== 1 ? "s" : ""} ·{" "}
            {importResult.product_lines_written} product line
            {importResult.product_lines_written !== 1 ? "s" : ""}
            {importResult.measurements_not_found > 0 &&
              ` · ${importResult.measurements_not_found} with no measurement data`}
            {importResult.measurements_error > 0 && ` · ${importResult.measurements_error} errored`}
            {importResult.fields_failed > 0 &&
              ` · ${importResult.fields_failed} field${importResult.fields_failed !== 1 ? "s" : ""} failed (re-run to retry)`}
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
