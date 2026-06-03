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
import { useClientFilter } from "@/contexts/client-filter-context";

const SELECT_CLASS =
  "rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-sm text-slate-200 [color-scheme:dark] focus:border-emerald-500/30 focus:outline-none focus:ring-1 focus:ring-emerald-500/20";

export default function ProductsPage() {
  const { johnDeereConnection } = useAuth();
  const orgId = johnDeereConnection?.selected_org_id ?? null;

  const { selectedFarm } = useClientFilter();
  const [rows, setRows] = useState<any[]>([]);
  const [season, setSeason] = useState<string>("");
  const [category, setCategory] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Season years (drives both the season filter and the price-year selector)
  const [seasonYears, setSeasonYears] = useState<number[]>([]);

  // Price-year selector: "all" or a specific year string
  const [priceYear, setPriceYear] = useState<string>("all");

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

  // Load season years once orgId is available
  useEffect(() => {
    if (!orgId) return;
    fetchSeasonYears(orgId)
      .then((years) => {
        setSeasonYears(years);
        // Default price-year to newest year from the list
        if (years.length > 0) {
          setPriceYear(String(years[0]));
        }
      })
      .catch(() => {
        // Non-fatal — price-year stays "all"
      });
  }, [orgId]);

  function loadRollup() {
    setLoading(true);
    fetchProductsRollup(season || undefined, selectedFarm ?? undefined)
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }
  useEffect(loadRollup, [season, selectedFarm]);

  // Load prices whenever priceYear or orgId changes
  function loadPrices() {
    if (!orgId) return;
    if (priceYear === "all") {
      fetchProductPriceAverages(orgId)
        .then(setAvgByProduct)
        .catch(() => {
          // Non-fatal
        });
      setPriceByProduct(new Map());
    } else {
      const yr = Number(priceYear);
      fetchProductPrices(yr, orgId)
        .then((prices) => {
          const map = new Map<string, { price_per_unit: number; price_unit: string }>();
          for (const p of prices) {
            map.set(p.product_id, { price_per_unit: p.price_per_unit, price_unit: p.price_unit });
          }
          setPriceByProduct(map);
        })
        .catch(() => {
          // Non-fatal
        });
      setAvgByProduct(new Map());
    }
  }
  useEffect(loadPrices, [priceYear, orgId]);

  const visibleRows = category
    ? rows.filter((r) => (r.product?.product_category ?? "") === category)
    : rows;

  const allSeasons = priceYear === "all";

  // Show "Copy from {priceYear-1}" only when a specific year is selected AND the prior year exists
  const priceYearNum = allSeasons ? null : Number(priceYear);
  const showCopyButton =
    !allSeasons &&
    priceYearNum !== null &&
    seasonYears.includes(priceYearNum - 1);

  async function handleSetPrice(productId: string, value: number, unit: string) {
    if (!orgId || allSeasons) return;
    await upsertProductPrice({
      productId,
      orgId,
      year: priceYearNum!,
      pricePerUnit: value,
      priceUnit: unit,
    });
    loadPrices();
  }

  async function handleSetDensity(productId: string, value: number | null) {
    await setProductDensity(productId, value);
    loadRollup();
  }

  async function handleCopyFromPriorYear() {
    if (!orgId || !priceYearNum) return;
    setCopyingPrices(true);
    try {
      await copyPricesFromYear(priceYearNum - 1, priceYearNum, orgId);
      loadPrices();
    } finally {
      setCopyingPrices(false);
    }
  }

  async function handleSetContent(productId: string, value: number | null) {
    await setProductNutrientContent(productId, value);
    loadRollup();
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
        allSeasons ? undefined : Number(priceYear),
      );
      setBulkUnitCount(count);
      loadPrices();
      loadRollup();
    } finally {
      setApplyingBulkUnit(false);
    }
  }

  return (
    <div className="min-h-[calc(100vh-48px)] bg-slate-950 p-6">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-white">Products</h1>
          <p className="mt-1 text-sm text-slate-400">
            Quantities applied across all fields, grouped by product.
          </p>
        </header>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {/* Season filter (application data) */}
          <select className={SELECT_CLASS} value={season} onChange={(e) => setSeason(e.target.value)}>
            <option value="">All seasons</option>
            {seasonYears.length > 0
              ? seasonYears.map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))
              : /* Fallback to static list until years load */
                [2026, 2025, 2024].map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
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

          {/* Price-year selector */}
          {orgId && (
            <>
              <span className="text-xs text-slate-500">Prices:</span>
              <select
                className={SELECT_CLASS}
                value={priceYear}
                onChange={(e) => setPriceYear(e.target.value)}
              >
                <option value="all">All seasons (avg)</option>
                {seasonYears.map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
              </select>

              {/* Copy-from-prior-year button */}
              {showCopyButton && (
                <button
                  type="button"
                  disabled={copyingPrices}
                  onClick={handleCopyFromPriorYear}
                  className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-sm text-slate-300 transition-colors hover:border-emerald-500/30 hover:text-emerald-300 disabled:opacity-50"
                >
                  {copyingPrices ? "Copying…" : `Copy from ${priceYearNum! - 1}`}
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
              loadRollup();
            }}
          />
        )}
      </div>
    </div>
  );
}
