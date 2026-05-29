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
      <div className="rounded border border-dashed border-slate-200 p-8 text-center text-slate-500">
        No products yet.
      </div>
    );
  }
  return (
    <table className="w-full text-sm">
      <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
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
          <tr key={r.product.id} className="border-b border-slate-100">
            <td className="px-3 py-2 font-medium text-slate-900">{r.product.name}</td>
            <td className="px-3 py-2">
              <select
                className="rounded border border-slate-200 px-2 py-0.5 text-xs"
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
            <td className="px-3 py-2 text-right">
              {r.total_value_sum.toFixed(2)} {displayUnit(r.total_unit)}
            </td>
            <td className="px-3 py-2 text-right">{r.field_count}</td>
            <td className="px-3 py-2 text-right">{r.operation_count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
