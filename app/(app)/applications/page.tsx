"use client";

import { useEffect, useState } from "react";
import { fetchApplications } from "@/lib/applications-client";
import type { ApplicationWithLines } from "@/types/applications";
import { ApplicationsList } from "@/components/applications/applications-list";
import { ApplicationFilters } from "@/components/applications/application-filters";

export default function ApplicationsPage() {
  const [rows, setRows] = useState<ApplicationWithLines[]>([]);
  const [filter, setFilter] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    <div className="mx-auto max-w-7xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Applications</h1>
        <p className="mt-1 text-sm text-slate-600">
          Spray applications imported from John Deere Operations Center.
        </p>
      </header>
      <ApplicationFilters value={filter} onChange={setFilter} />
      {error && <div className="mt-4 rounded bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {loading ? (
        <div className="mt-6 text-slate-500">Loading...</div>
      ) : (
        <ApplicationsList rows={rows} onChanged={() => setFilter({ ...filter })} />
      )}
    </div>
  );
}
