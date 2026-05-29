"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchApplications } from "@/lib/applications-client";
import type { ApplicationWithLines } from "@/types/applications";
import { ApplicationsList } from "@/components/applications/applications-list";

export default function FieldApplicationsPage() {
  const params = useParams();
  const fieldId = params.fieldId as string;
  const [rows, setRows] = useState<ApplicationWithLines[]>([]);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    fetchApplications({ fieldId })
      .then(setRows)
      .finally(() => setLoading(false));
  }
  useEffect(load, [fieldId]);

  return (
    <div className="mx-auto max-w-7xl p-6">
      <h1 className="text-2xl font-semibold text-slate-900">Field applications</h1>
      {loading ? (
        <div className="mt-4 text-slate-500">Loading...</div>
      ) : (
        <ApplicationsList rows={rows} onChanged={load} />
      )}
    </div>
  );
}
