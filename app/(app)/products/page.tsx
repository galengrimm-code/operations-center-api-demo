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
    <div className="min-h-[calc(100vh-48px)] bg-slate-950 p-6">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-white">Products</h1>
          <p className="mt-1 text-sm text-slate-400">
            Quantities applied across all fields, grouped by product.
          </p>
        </header>
        <div className="mb-4 flex items-center gap-3">
          <select
            className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-sm text-slate-200 focus:border-emerald-500/30 focus:outline-none focus:ring-1 focus:ring-emerald-500/20"
            value={season}
            onChange={(e) => setSeason(e.target.value)}
          >
            <option value="">All seasons</option>
            <option value="2026">2026</option>
            <option value="2025">2025</option>
            <option value="2024">2024</option>
          </select>
        </div>
        {error && (
          <div className="glass rounded-xl border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
            {error}
          </div>
        )}
        {loading && rows.length === 0 ? (
          <div className="text-slate-400">Loading...</div>
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
    </div>
  );
}
