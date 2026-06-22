"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchApplications } from "@/lib/applications-client";
import { supabase } from "@/lib/supabase";
import { opsTable } from "@/lib/fdh-flags";
import { acresFrom } from "@/lib/cost-calc";
import type { ApplicationWithLines } from "@/types/applications";
import { ApplicationsList } from "@/components/applications/applications-list";
import { FieldCostSummary } from "@/components/applications/field-cost-summary";
import { useAuth } from "@/contexts/auth-context";

export default function FieldApplicationsPage() {
  const params = useParams();
  const fieldId = params.fieldId as string;
  const { johnDeereConnection } = useAuth();
  const orgId = johnDeereConnection?.selected_org_id ?? null;
  const [rows, setRows] = useState<ApplicationWithLines[]>([]);
  const [fieldAcres, setFieldAcres] = useState(0);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      // Field-acres query must be org-scoped: jd_field_id is not unique across orgs,
      // so querying by jd_field_id alone can return multiple rows and cause maybeSingle()
      // to reject. Skip the field lookup (pass 0 acres) if orgId is not yet available.
      const fieldPromise =
        orgId != null
          ? (supabase.from(opsTable("fields")) as any)
              .select("boundary_area_value, boundary_area_unit")
              .eq("org_id", orgId)
              .eq("jd_field_id", fieldId)
              .maybeSingle()
          : Promise.resolve({ data: null });

      const [appRows, fieldResult] = await Promise.all([
        fetchApplications({ fieldId }),
        fieldPromise,
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
  }, [fieldId, orgId]);

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
