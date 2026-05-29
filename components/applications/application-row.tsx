"use client";

import { useState } from "react";
import type { ApplicationWithLines } from "@/types/applications";
import { ApplicationExpanded } from "./application-expanded";

export function ApplicationRow({
  row,
  onChanged,
}: {
  row: ApplicationWithLines;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const lineCount = row.product_lines.filter((l) => !l.deleted_at).length;
  const dateLabel = row.start_date ? new Date(row.start_date).toLocaleDateString() : "—";

  return (
    <div className="rounded border border-slate-200 bg-white">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
        onClick={() => setOpen(!open)}
      >
        <span className="w-24 text-sm text-slate-600">{dateLabel}</span>
        <span className="flex-1 font-medium text-slate-900">
          {row.application_name ?? "(unnamed)"}
        </span>
        <span className="text-sm text-slate-500">{row.field_name}</span>
        <span className="text-sm text-slate-500">{lineCount} items</span>
        {row.measurement_status === "not_found" && (
          <span className="rounded bg-yellow-50 px-2 py-0.5 text-xs text-yellow-700">
            JD data pending
          </span>
        )}
        <span className="text-slate-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && <ApplicationExpanded row={row} onChanged={onChanged} />}
    </div>
  );
}
