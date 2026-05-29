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
    <div className="glass rounded-xl">
      <button
        type="button"
        className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left hover:bg-white/[0.04]"
        onClick={() => setOpen(!open)}
      >
        <span className="w-24 text-sm text-slate-400">{dateLabel}</span>
        <span className="flex-1 font-medium text-white">{row.application_name ?? "(unnamed)"}</span>
        <span className="text-sm text-slate-400">{row.field_name}</span>
        <span className="text-sm text-slate-500">{lineCount} items</span>
        {row.measurement_status === "not_found" && (
          <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300">
            JD data pending
          </span>
        )}
        <span className="text-slate-500">{open ? "▾" : "▸"}</span>
      </button>
      {open && <ApplicationExpanded row={row} onChanged={onChanged} />}
    </div>
  );
}
