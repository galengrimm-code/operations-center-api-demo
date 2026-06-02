"use client";

import { useState } from "react";
import { ProductLineRow } from "./product-line-row";
import { ProductLineEditDialog } from "./product-line-edit-dialog";
import { revertProductLine } from "@/lib/applications-client";
import type { ApplicationWithLines } from "@/types/applications";

const CATEGORY_ORDER = ["fertilizer", "chemical", "seed", "adjuvant", "other", null];

export function ApplicationExpanded({
  row,
  onChanged,
}: {
  row: ApplicationWithLines;
  onChanged: () => void;
}) {
  const [showCarriers, setShowCarriers] = useState(false);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const visibleLines = row.product_lines.filter(
    (l) => !l.deleted_at && (showCarriers || !l.is_carrier),
  );
  const grouped = new Map<string | null, typeof visibleLines>();
  for (const line of visibleLines) {
    const cat = line.product_category_override ?? line.product?.product_category ?? null;
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(line);
  }

  return (
    <div className="border-t border-white/[0.08] bg-white/[0.02] px-4 pb-4">
      <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs uppercase text-slate-400">
        <div className="col-span-3">Product</div>
        <div className="col-span-2">Category</div>
        <div className="col-span-2">Rate</div>
        <div className="col-span-2">Total / $/ac</div>
        <div className="col-span-1">Area</div>
        <div className="col-span-2 text-right">Actions</div>
      </div>
      {CATEGORY_ORDER.map((cat) => {
        const lines = grouped.get(cat);
        if (!lines || lines.length === 0) return null;
        return (
          <div
            key={cat ?? "uncategorized"}
            className="mt-1 rounded-lg border border-white/[0.05] bg-white/[0.02]"
          >
            {lines.map((line) => (
              <ProductLineRow
                key={line.id}
                line={line as any}
                onEdit={() => setEditingLineId(line.id)}
                onRevert={async () => {
                  try {
                    await revertProductLine(line.id);
                    onChanged();
                  } catch (e) {
                    console.error(e);
                  }
                }}
              />
            ))}
          </div>
        );
      })}
      <div className="mt-3">
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={showCarriers}
            onChange={(e) => setShowCarriers(e.target.checked)}
          />
          Show carriers (water/UAN)
        </label>
      </div>
      {editingLineId &&
        (() => {
          const line = visibleLines.find((l) => l.id === editingLineId);
          return line ? (
            <ProductLineEditDialog
              line={line as any}
              onClose={() => setEditingLineId(null)}
              onSaved={onChanged}
            />
          ) : null;
        })()}
    </div>
  );
}
