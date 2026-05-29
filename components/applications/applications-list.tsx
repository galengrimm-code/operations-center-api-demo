"use client";

import { ApplicationRow } from "./application-row";
import type { ApplicationWithLines } from "@/types/applications";

export function ApplicationsList({
  rows,
  onChanged,
}: {
  rows: ApplicationWithLines[];
  onChanged: () => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="mt-6 rounded border border-dashed border-slate-200 p-8 text-center text-slate-500">
        No applications to show. Import from John Deere via Settings.
      </div>
    );
  }
  return (
    <div className="mt-6 space-y-2">
      {rows.map((row) => (
        <ApplicationRow key={row.id} row={row} onChanged={onChanged} />
      ))}
    </div>
  );
}
