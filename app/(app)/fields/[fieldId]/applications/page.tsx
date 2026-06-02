"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchApplications } from "@/lib/applications-client";
import { supabase } from "@/lib/supabase";
import { acresFrom } from "@/lib/cost-calc";
import type { ApplicationWithLines } from "@/types/applications";
import { ApplicationsList } from "@/components/applications/applications-list";
import { FieldCostSummary } from "@/components/applications/field-cost-summary";

export default function FieldApplicationsPage() {
  const params = useParams();
  const fieldId = params.fieldId as string;
  const [rows, setRows] = useState<ApplicationWithLines[]>([]);
  const [fieldAcres, setFieldAcres] = useState(0);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [appRows, fieldResult] = await Promise.all([
        fetchApplications({ fieldId }),
        (supabase.from("fields") as any)
          .select("boundary_area_value, boundary_area_unit")
          .eq("jd_field_id", fieldId)
          .maybeSingle(),
      ]);
      setRows(appRows);
      const fieldRow = fieldResult.data;
      const acres =
        acresFrom(fieldRow?.boundary_area_value ?? null, fieldRow?.boundary_area_unit ?? null) ?? 0;
      setFieldAcres(acres);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldId]);

  return (
    <div className="min-h-[calc(100vh-48px)] bg-slate-950 p-6">
      <div className="mx-auto max-w-7xl">
        <h1 className="text-2xl font-semibold text-white">Field applications</h1>
        {loading && rows.length === 0 ? (
          <div className="mt-4 text-slate-400">Loading...</div>
        ) : (
          <>
            <div className="mt-4">
              <FieldCostSummary rows={rows} fieldAcres={fieldAcres} />
            </div>
            <ApplicationsList rows={rows} onChanged={load} />
          </>
        )}
      </div>
    </div>
  );
}
