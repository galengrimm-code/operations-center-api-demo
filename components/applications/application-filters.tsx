"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface Filter {
  fieldId?: string;
  productId?: string;
  season?: string;
  category?: string;
}

export function ApplicationFilters({
  value,
  onChange,
}: {
  value: Filter;
  onChange: (f: Filter) => void;
}) {
  const [fields, setFields] = useState<Array<{ jd_field_id: string; name: string }>>([]);
  const [seasons] = useState<string[]>(["2026", "2025", "2024"]);

  useEffect(() => {
    (supabase.from("fields") as any)
      .select("jd_field_id, name")
      .order("name")
      .then(({ data }: { data: Array<{ jd_field_id: string; name: string }> | null }) => {
        setFields(data ?? []);
      });
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-sm text-slate-200 [color-scheme:dark] focus:border-emerald-500/30 focus:outline-none focus:ring-1 focus:ring-emerald-500/20"
        value={value.fieldId ?? ""}
        onChange={(e) => onChange({ ...value, fieldId: e.target.value || undefined })}
      >
        <option value="">All fields</option>
        {fields.map((f) => (
          <option key={f.jd_field_id} value={f.jd_field_id}>
            {f.name}
          </option>
        ))}
      </select>
      <select
        className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-sm text-slate-200 [color-scheme:dark] focus:border-emerald-500/30 focus:outline-none focus:ring-1 focus:ring-emerald-500/20"
        value={value.season ?? ""}
        onChange={(e) => onChange({ ...value, season: e.target.value || undefined })}
      >
        <option value="">All seasons</option>
        {seasons.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <select
        className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-sm text-slate-200 [color-scheme:dark] focus:border-emerald-500/30 focus:outline-none focus:ring-1 focus:ring-emerald-500/20"
        value={value.category ?? ""}
        onChange={(e) => onChange({ ...value, category: e.target.value || undefined })}
      >
        <option value="">All categories</option>
        <option value="fertilizer">Fertilizer</option>
        <option value="chemical">Chemical</option>
        <option value="seed">Seed</option>
        <option value="adjuvant">Adjuvant</option>
        <option value="other">Other</option>
      </select>
    </div>
  );
}
