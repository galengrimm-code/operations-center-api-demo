"use client";

import { useEffect, useState } from "react";
import { fetchProductsRollup, editProductCategory } from "@/lib/applications-client";
import { ProductsRollupTable } from "@/components/applications/products-rollup-table";

export default function ProductsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [season, setSeason] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetchProductsRollup(season || undefined)
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }
  useEffect(load, [season]);

  return (
    <div className="mx-auto max-w-7xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Products</h1>
        <p className="mt-1 text-sm text-slate-600">
          Quantities applied across all fields, grouped by product.
        </p>
      </header>
      <div className="mb-4 flex items-center gap-3">
        <select
          className="rounded border border-slate-200 px-2 py-1 text-sm"
          value={season}
          onChange={(e) => setSeason(e.target.value)}
        >
          <option value="">All seasons</option>
          <option value="2026">2026</option>
          <option value="2025">2025</option>
          <option value="2024">2024</option>
        </select>
      </div>
      {error && <div className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {loading && rows.length === 0 ? (
        <div className="text-slate-500">Loading...</div>
      ) : (
        <ProductsRollupTable
          rows={rows}
          onEditCategory={async (productId, cat) => {
            await editProductCategory(productId, cat);
            load();
          }}
        />
      )}
    </div>
  );
}
