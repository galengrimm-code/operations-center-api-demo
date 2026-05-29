"use client";

import { displayUnit } from "@/lib/unit-display";
import type { Product } from "@/types/applications";

interface RollupRow {
  product: Product;
  total_value_sum: number;
  total_unit: string | null;
  field_count: number;
  operation_count: number;
}

export function ProductsRollupTable({
  rows,
  onEditCategory,
}: {
  rows: RollupRow[];
  onEditCategory: (productId: string, category: string) => Promise<void>;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-slate-400">
        No products yet.
      </div>
    );
  }
  return (
    <div className="glass overflow-hidden rounded-xl">
      <table className="w-full text-sm">
        <thead className="border-b border-white/[0.08] text-xs uppercase text-slate-400">
          <tr>
            <th className="px-3 py-2 text-left">Product</th>
            <th className="px-3 py-2 text-left">Category</th>
            <th className="px-3 py-2 text-right">Total Applied</th>
            <th className="px-3 py-2 text-right">Fields</th>
            <th className="px-3 py-2 text-right">Operations</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.product.id} className="border-b border-white/[0.05] last:border-b-0">
              <td className="px-3 py-2 font-medium text-white">{r.product.name}</td>
              <td className="px-3 py-2">
                <select
                  className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-xs text-slate-200 focus:border-emerald-500/30 focus:outline-none focus:ring-1 focus:ring-emerald-500/20"
                  value={r.product.product_category ?? ""}
                  onChange={(e) => onEditCategory(r.product.id, e.target.value)}
                >
                  <option value="">(uncategorized)</option>
                  <option value="fertilizer">Fertilizer</option>
                  <option value="chemical">Chemical</option>
                  <option value="seed">Seed</option>
                  <option value="adjuvant">Adjuvant</option>
                  <option value="other">Other</option>
                </select>
              </td>
              <td className="font-mono-data px-3 py-2 text-right text-slate-200">
                {r.total_value_sum.toFixed(2)} {displayUnit(r.total_unit)}
              </td>
              <td className="font-mono-data px-3 py-2 text-right text-slate-200">
                {r.field_count}
              </td>
              <td className="font-mono-data px-3 py-2 text-right text-slate-200">
                {r.operation_count}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
