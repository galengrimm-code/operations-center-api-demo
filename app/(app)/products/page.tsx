"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import {
  fetchProductsRollup,
  editProductCategory,
  fetchSeasonYears,
  fetchProductPrices,
  fetchProductPriceAverages,
  upsertProductPrice,
  setProductDensity,
  copyPricesFromYear,
  setProductNutrientContent,
  setCategoryPriceUnit,
} from "@/lib/applications-client";
import { ProductsRollupTable } from "@/components/applications/products-rollup-table";
import { exportProductsExcel, exportProductsPdf } from "@/lib/products-export";
import { useClientFilter } from "@/contexts/client-filter-context";
import { Download, FileText } from "lucide-react";

const SELECT_CLASS =
  "rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-sm text-slate-200 [color-scheme:dark] focus:border-emerald-500/30 focus:outline-none focus:ring-1 focus:ring-emerald-500/20";

export default function ProductsPage() {
  const { johnDeereConnection } = useAuth();
  const orgId = johnDeereConnection?.selected_org_id ?? null;

  const { selectedFarm } = useClientFilter();
  const [rows, setRows] = useState<any[]>([]);
  const [category, setCategory] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Season years available in the data.
  const [seasonYears, setSeasonYears] = useState<number[]>([]);

  // ONE year selector drives both the rollup totals AND which year's prices show.
  // "all" => all-season totals + averaged, read-only prices; a year => that year's totals + editable prices.
  const [year, setYear] = useState<string>("all");

  // Prices loaded for the selected price-year
  const [priceByProduct, setPriceByProduct] = useState<
    Map<string, { price_per_unit: number; price_unit: string }>
  >(new Map());
  const [avgByProduct, setAvgByProduct] = useState<
    Map<string, { avg: number; unit: string }>
  >(new Map());

  const [copyingPrices, setCopyingPrices] = useState(false);

  // Bulk unit-setter state
  const [bulkCategory, setBulkCategory] = useState<string>("fertilizer");
  const [bulkUnit, setBulkUnit] = useState<string>("ton");
  const [applyingBulkUnit, setApplyingBulkUnit] = useState(false);
  const [bulkUnitCount, setBulkUnitCount] = useState<number | null>(null);

  // Bumped by mutation handlers to trigger a reload through the single loader effect below.
  const [refreshKey, setRefreshKey] = useState(0);
  const reload = () => setRefreshKey((k) => k + 1);

  // Load season years once orgId is available.
  useEffect(() => {
    if (!orgId) return;
    fetchSeasonYears(orgId)
      .then((years) => {
        setSeasonYears(years);
        // Default to the newest year (editable) — but never clobber a choice the user already made.
        if (years.length > 0) {
          setYear((prev) => (prev === "all" ? String(years[0]) : prev));
        }
      })
      .catch(() => {
        // Non-fatal — year stays "all"
      });
  }, [orgId]);

  // ONE loader for both the rollup totals AND the year's prices, so they can never desync.
  // A `cancelled` guard drops stale results when the year/farm changes mid-flight.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchProductsRollup(year === "all" ? undefined : year, selectedFarm ?? undefined)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    if (orgId) {
      if (year === "all") {
        fetchProductPriceAverages(orgId)
          .then((m) => {
            if (!cancelled) {
              setAvgByProduct(m);
              setPriceByProduct(new Map());
            }
          })
          .catch(() => {});
      } else {
        fetchProductPrices(Number(year), orgId)
          .then((prices) => {
            if (cancelled) return;
            const map = new Map<string, { price_per_unit: number; price_unit: string }>();
            for (const p of prices) {
              map.set(p.product_id, { price_per_unit: p.price_per_unit, price_unit: p.price_unit });
            }
            setPriceByProduct(map);
            setAvgByProduct(new Map());
          })
          .catch(() => {});
      }
    }
    return () => {
      cancelled = true;
    };
  }, [year, selectedFarm, orgId, refreshKey]);

  const visibleRows = category
    ? rows.filter((r) => (r.product?.product_category ?? "") === category)
    : rows;

  const allSeasons = year === "all";

  // Show "Copy from {year-1}" only when a specific year is selected AND the prior year exists.
  const yearNum = allSeasons ? null : Number(year);
  const showCopyButton = !allSeasons && yearNum !== null && seasonYears.includes(yearNum - 1);

  async function handleSetPrice(productId: string, value: number, unit: string) {
    if (!orgId || allSeasons) return;
    await upsertProductPrice({
      productId,
      orgId,
      year: yearNum!,
      pricePerUnit: value,
      priceUnit: unit,
    });
    reload();
  }

  async function handleSetDensity(productId: string, value: number | null) {
    await setProductDensity(productId, value);
    reload();
  }

  async function handleCopyFromPriorYear() {
    if (!orgId || !yearNum) return;
    setCopyingPrices(true);
    try {
      await copyPricesFromYear(yearNum - 1, yearNum, orgId);
      reload();
    } finally {
      setCopyingPrices(false);
    }
  }

  async function handleSetContent(productId: string, value: number | null) {
    await setProductNutrientContent(productId, value);
    reload();
  }

  async function handleApplyBulkUnit() {
    if (!orgId) return;
    setApplyingBulkUnit(true);
    setBulkUnitCount(null);
    try {
      const count = await setCategoryPriceUnit(
        bulkCategory,
        bulkUnit,
        orgId,
        allSeasons ? undefined : Number(year),
      );
      setBulkUnitCount(count);
      reload();
    } finally {
      setApplyingBulkUnit(false);
    }
  }

  return (
    <div className="min-h-[calc(100vh-48px)] bg-slate-950 p-6">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-white">Products</h1>
            <p className="mt-1 text-sm text-slate-400">
              Quantities applied across all fields, grouped by product.
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => exportProductsExcel(visibleRows, priceByProduct, allSeasons, avgByProduct)}
              disabled={visibleRows.length === 0}
              className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:border-emerald-500/30 hover:text-emerald-300 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              Excel
            </button>
            <button
              type="button"
              onClick={() => exportProductsPdf(visibleRows, priceByProduct, allSeasons, avgByProduct)}
              disabled={visibleRows.length === 0}
              className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:border-emerald-500/30 hover:text-emerald-300 disabled:opacity-50"
            >
              <FileText className="h-4 w-4" />
              PDF
            </button>
          </div>
        </header>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {/* ONE year selector: drives the rollup totals AND the prices shown/edited.
              "All seasons" => all totals + averaged read-only prices; a year => that year's totals + editable prices. */}
          <span className="text-xs text-slate-500">Season:</span>
          {/* Specific seasons first (newest = default), then the all-seasons average last.
              Only real season years are offered — no hardcoded fallback, so you can't price into a
              year that has no data while the list is still loading. */}
          <select className={SELECT_CLASS} value={year} onChange={(e) => setYear(e.target.value)}>
            {seasonYears.map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
            <option value="all">All Seasons (avg)</option>
          </select>

          {/* Category filter */}
          <select
            className={SELECT_CLASS}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All categories</option>
            <option value="fertilizer">Fertilizer</option>
            <option value="chemical">Chemical</option>
            <option value="seed">Seed</option>
            <option value="adjuvant">Adjuvant</option>
            <option value="other">Other</option>
          </select>

          {/* Editing controls (copy-year, bulk set-unit) only in a specific year — hidden when
              "All seasons" is showing averaged, read-only prices. */}
          {orgId && !allSeasons && (
            <>
              {/* Copy-from-prior-year button */}
              {showCopyButton && (
                <button
                  type="button"
                  disabled={copyingPrices}
                  onClick={handleCopyFromPriorYear}
                  className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-sm text-slate-300 transition-colors hover:border-emerald-500/30 hover:text-emerald-300 disabled:opacity-50"
                >
                  {copyingPrices ? "Copying…" : `Copy from ${yearNum! - 1}`}
                </button>
              )}

              {/* Bulk unit setter */}
              <span className="text-xs text-slate-500">Bulk:</span>
              <select
                className={SELECT_CLASS}
                value={bulkCategory}
                onChange={(e) => setBulkCategory(e.target.value)}
              >
                <option value="fertilizer">Fertilizer</option>
                <option value="chemical">Chemical</option>
                <option value="seed">Seed</option>
                <option value="adjuvant">Adjuvant</option>
                <option value="other">Other</option>
              </select>
              <select
                className={SELECT_CLASS}
                value={bulkUnit}
                onChange={(e) => setBulkUnit(e.target.value)}
              >
                <option value="ozm">ozm</option>
                <option value="lb">lb</option>
                <option value="ton">ton</option>
                <option value="floz">floz</option>
                <option value="pt">pt</option>
                <option value="qt">qt</option>
                <option value="gal">gal</option>
              </select>
              <button
                type="button"
                disabled={applyingBulkUnit}
                onClick={handleApplyBulkUnit}
                className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-sm text-slate-300 transition-colors hover:border-emerald-500/30 hover:text-emerald-300 disabled:opacity-50"
              >
                {applyingBulkUnit
                  ? "Applying…"
                  : bulkUnitCount !== null
                    ? `Set unit on all ${bulkCategory} (${bulkUnitCount})`
                    : `Set unit on all ${bulkCategory}`}
              </button>
            </>
          )}
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
            rows={visibleRows}
            priceByProduct={priceByProduct}
            allSeasons={allSeasons}
            avgByProduct={avgByProduct}
            onSetPrice={handleSetPrice}
            onSetDensity={handleSetDensity}
            onSetContent={handleSetContent}
            onEditCategory={async (productId, cat) => {
              await editProductCategory(productId, cat);
              reload();
            }}
          />
        )}
      </div>
    </div>
  );
}
