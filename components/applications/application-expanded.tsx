"use client";

import { useState } from "react";
import { ProductLineRow } from "./product-line-row";
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
  const visibleLines = row.product_lines.filter(
    (l) => !l.deleted_at && (showCarriers || !l.is_carrier),
  );
  const grouped = new Map<string | null, typeof visibleLines>();
  for (const line of visibleLines) {
    const cat = line.product_category_override ?? line.product.product_category ?? null;
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(line);
  }

  return (
    <div className="border-t border-slate-100 bg-slate-50/50 px-4 pb-4">
      <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs uppercase text-slate-500">
        <div className="col-span-3">Product</div>
        <div className="col-span-2">Category</div>
        <div className="col-span-2">Rate</div>
        <div className="col-span-2">Total</div>
        <div className="col-span-1">Area</div>
        <div className="col-span-2 text-right">Actions</div>
      </div>
      {CATEGORY_ORDER.map((cat) => {
        const lines = grouped.get(cat);
        if (!lines || lines.length === 0) return null;
        return (
          <div key={cat ?? "uncategorized"} className="mt-1 rounded bg-white">
            {lines.map((line) => (
              <ProductLineRow key={line.id} line={line as any} />
            ))}
          </div>
        );
      })}
      <div className="mt-3">
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={showCarriers}
            onChange={(e) => setShowCarriers(e.target.checked)}
          />
          Show carriers (water/UAN)
        </label>
      </div>
    </div>
  );
}
