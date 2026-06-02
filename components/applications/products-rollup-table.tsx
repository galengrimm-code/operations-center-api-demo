"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { displayUnit } from "@/lib/unit-display";
import type { Product } from "@/types/applications";

interface RollupRow {
  product: Product;
  total_value_sum: number;
  total_unit: string | null;
  field_count: number;
  operation_count: number;
}

type SortKey = "name" | "category" | "total" | "fields" | "operations" | "price";

const PRICE_UNITS = ["ozm", "lb", "ton", "floz", "pt", "qt", "gal"] as const;
type PriceUnit = (typeof PRICE_UNITS)[number];

function defaultPriceUnit(product: Product): PriceUnit {
  const du = product.default_unit ?? "";
  if ((PRICE_UNITS as readonly string[]).includes(du)) return du as PriceUnit;
  return "lb";
}

const INPUT_CLASS =
  "w-20 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-xs text-slate-200 [color-scheme:dark] focus:border-emerald-500/30 focus:outline-none focus:ring-1 focus:ring-emerald-500/20";

const SELECT_CLASS =
  "rounded-md border border-white/[0.08] bg-white/[0.03] px-1 py-0.5 text-xs text-slate-200 [color-scheme:dark] focus:border-emerald-500/30 focus:outline-none focus:ring-1 focus:ring-emerald-500/20";

// Per-row price editor that manages its own local input state
function PriceCell({
  row,
  priceByProduct,
  onSetPrice,
}: {
  row: RollupRow;
  priceByProduct: Map<string, { price_per_unit: number; price_unit: string }>;
  onSetPrice: (productId: string, value: number, unit: string) => void;
}) {
  const existing = priceByProduct.get(row.product.id);
  const [inputVal, setInputVal] = useState<string>(
    existing ? String(existing.price_per_unit) : "",
  );
  const [unit, setUnit] = useState<PriceUnit>(
    existing ? (existing.price_unit as PriceUnit) : defaultPriceUnit(row.product),
  );

  // Sync if external data changes (e.g. after copy-from-year reloads prices)
  const existingKey = existing
    ? `${existing.price_per_unit}:${existing.price_unit}`
    : "";
  useMemo(() => {
    if (existing) {
      setInputVal(String(existing.price_per_unit));
      setUnit(existing.price_unit as PriceUnit);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingKey]);

  function commit() {
    const trimmed = inputVal.trim();
    if (trimmed === "") return;
    const num = Number(trimmed);
    if (isNaN(num) || num < 0) return;
    onSetPrice(row.product.id, num, unit);
  }

  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-slate-500">$</span>
      <input
        type="number"
        min={0}
        step="any"
        placeholder="—"
        value={inputVal}
        onChange={(e) => setInputVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        onBlur={commit}
        className={INPUT_CLASS}
      />
      <select
        value={unit}
        onChange={(e) => {
          setUnit(e.target.value as PriceUnit);
        }}
        onBlur={commit}
        className={SELECT_CLASS}
      >
        {PRICE_UNITS.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </select>
    </div>
  );
}

// Per-row density editor
function DensityCell({
  row,
  onSetDensity,
}: {
  row: RollupRow;
  onSetDensity: (productId: string, value: number | null) => void;
}) {
  const [inputVal, setInputVal] = useState<string>(
    row.product.density_lbs_per_gal != null ? String(row.product.density_lbs_per_gal) : "",
  );

  function commit() {
    const trimmed = inputVal.trim();
    if (trimmed === "") {
      onSetDensity(row.product.id, null);
      return;
    }
    const num = Number(trimmed);
    if (isNaN(num) || num <= 0) return;
    onSetDensity(row.product.id, num);
  }

  const isEmpty = inputVal.trim() === "";

  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        min={0}
        step="any"
        placeholder="set"
        value={inputVal}
        onChange={(e) => setInputVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        onBlur={commit}
        className={`${INPUT_CLASS} ${isEmpty ? "text-slate-500 placeholder:text-slate-600" : ""}`}
      />
      {!isEmpty && <span className="text-xs text-slate-500">lb/gal</span>}
    </div>
  );
}

export function ProductsRollupTable({
  rows,
  priceByProduct,
  allSeasons,
  avgByProduct,
  onSetPrice,
  onSetDensity,
  onEditCategory,
}: {
  rows: RollupRow[];
  priceByProduct: Map<string, { price_per_unit: number; price_unit: string }>;
  allSeasons: boolean;
  avgByProduct?: Map<string, { avg: number; unit: string }>;
  onSetPrice: (productId: string, value: number, unit: string) => void;
  onSetDensity: (productId: string, value: number | null) => void;
  onEditCategory: (productId: string, category: string) => Promise<void>;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.product.name.localeCompare(b.product.name);
          break;
        case "category":
          cmp = (a.product.product_category ?? "").localeCompare(b.product.product_category ?? "");
          break;
        case "total":
          cmp = a.total_value_sum - b.total_value_sum;
          break;
        case "fields":
          cmp = a.field_count - b.field_count;
          break;
        case "operations":
          cmp = a.operation_count - b.operation_count;
          break;
        case "price": {
          const aPrice = allSeasons
            ? (avgByProduct?.get(a.product.id)?.avg ?? -1)
            : (priceByProduct.get(a.product.id)?.price_per_unit ?? -1);
          const bPrice = allSeasons
            ? (avgByProduct?.get(b.product.id)?.avg ?? -1)
            : (priceByProduct.get(b.product.id)?.price_per_unit ?? -1);
          cmp = aPrice - bPrice;
          break;
        }
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir, priceByProduct, avgByProduct, allSeasons]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // text columns default A→Z, numeric columns default high→low
      setSortDir(key === "name" || key === "category" ? "asc" : "desc");
    }
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-slate-400">
        No products yet.
      </div>
    );
  }

  function Header({
    k,
    label,
    align = "left",
  }: {
    k: SortKey;
    label: string;
    align?: "left" | "right";
  }) {
    return (
      <th className={`px-3 py-2 ${align === "right" ? "text-right" : "text-left"}`}>
        <button
          type="button"
          onClick={() => toggleSort(k)}
          className={`inline-flex items-center gap-1 uppercase transition-colors hover:text-slate-200 ${
            sortKey === k ? "text-slate-200" : ""
          } ${align === "right" ? "flex-row-reverse" : ""}`}
        >
          {label}
          {sortKey === k &&
            (sortDir === "asc" ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            ))}
        </button>
      </th>
    );
  }

  return (
    <div className="glass overflow-hidden rounded-xl">
      <table className="w-full text-sm">
        <thead className="border-b border-white/[0.08] text-xs uppercase text-slate-400">
          <tr>
            <Header k="name" label="Product" />
            <Header k="category" label="Category" />
            <Header k="price" label="Price" />
            <th className="px-3 py-2 text-left text-xs uppercase text-slate-400">Density</th>
            <Header k="total" label="Total Applied" align="right" />
            <Header k="fields" label="Fields" align="right" />
            <Header k="operations" label="Operations" align="right" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.product.id} className="border-b border-white/[0.05] last:border-b-0">
              <td className="px-3 py-2 font-medium text-white">{r.product.name}</td>
              <td className="px-3 py-2">
                <select
                  className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-xs text-slate-200 [color-scheme:dark] focus:border-emerald-500/30 focus:outline-none focus:ring-1 focus:ring-emerald-500/20"
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
              <td className="px-3 py-2">
                {allSeasons ? (
                  <span className="font-mono-data text-xs text-slate-300">
                    {avgByProduct?.get(r.product.id)
                      ? `$${avgByProduct.get(r.product.id)!.avg.toFixed(2)}/${avgByProduct.get(r.product.id)!.unit}`
                      : "—"}
                  </span>
                ) : (
                  <PriceCell
                    row={r}
                    priceByProduct={priceByProduct}
                    onSetPrice={onSetPrice}
                  />
                )}
              </td>
              <td className="px-3 py-2">
                <DensityCell row={r} onSetDensity={onSetDensity} />
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
