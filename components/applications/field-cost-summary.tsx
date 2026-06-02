"use client";

import { useMemo, useState } from "react";
import type { ApplicationWithLines } from "@/types/applications";
import { fieldCostPerAcre, type CostLine, type FieldBasis } from "@/lib/cost-calc";

const CATEGORY_ORDER = ["fertilizer", "chemical", "seed", "adjuvant", "other", "uncategorized"];

function labelForCategory(cat: string): string {
  if (cat === "uncategorized") return "Uncategorized";
  return cat.charAt(0).toUpperCase() + cat.slice(1);
}

export function FieldCostSummary({
  rows,
  fieldAcres,
}: {
  rows: ApplicationWithLines[];
  fieldAcres: number;
}) {
  const [basis, setBasis] = useState<FieldBasis>("spread");

  const { total, byCategory, footnotes } = useMemo(() => {
    // Flatten all non-deleted lines across all rows
    const allRawLines = rows.flatMap((row) =>
      row.product_lines.filter((l) => !l.deleted_at),
    );

    const allLines: CostLine[] = allRawLines.map((l) => ({
      totalCost: l.cost?.total_cost ?? null,
      appliedAcres: l.applied_acres ?? 0,
    }));

    const computedTotal = fieldCostPerAcre(allLines, basis, fieldAcres);

    // Group by effective category
    const grouped = new Map<string, CostLine[]>();
    for (const l of allRawLines) {
      const cat =
        (l.product_category_override ?? l.product?.product_category ?? "uncategorized") ||
        "uncategorized";
      const existing = grouped.get(cat) ?? [];
      existing.push({ totalCost: l.cost?.total_cost ?? null, appliedAcres: l.applied_acres ?? 0 });
      grouped.set(cat, existing);
    }

    // Build ordered category breakdown (skip groups with null result)
    const orderedCats = [
      ...CATEGORY_ORDER.filter((c) => grouped.has(c)),
      ...Array.from(grouped.keys()).filter((c) => !CATEGORY_ORDER.includes(c)),
    ];
    const computedByCategory: Array<{ category: string; value: number | null }> = orderedCats
      .map((cat) => ({
        category: cat,
        value: fieldCostPerAcre(grouped.get(cat)!, basis, fieldAcres),
      }))
      .filter((entry) => entry.value !== null);

    // Footnotes: count distinct lines needing density vs unpriced
    let needsDensityCount = 0;
    let unpricedCount = 0;
    for (const l of allRawLines) {
      if (l.cost?.needs_density) {
        needsDensityCount++;
      } else if (l.cost?.price_per_unit == null) {
        unpricedCount++;
      }
    }

    const notes: string[] = [];
    if (needsDensityCount > 0) {
      notes.push(
        `${needsDensityCount} input${needsDensityCount !== 1 ? "s" : ""} ${needsDensityCount !== 1 ? "need" : "needs"} a density set to price.`,
      );
    }
    if (unpricedCount > 0) {
      notes.push(
        `${unpricedCount} input${unpricedCount !== 1 ? "s" : ""} ${unpricedCount !== 1 ? "have" : "has"} no price set.`,
      );
    }

    return {
      total: computedTotal,
      byCategory: computedByCategory,
      footnotes: notes,
    };
  }, [rows, basis, fieldAcres]);

  const basisCaption =
    basis === "spread" ? "spread across all field acres" : "per acre actually covered";

  return (
    <div className="glass rounded-xl p-4 mb-4">
      {/* Header row: label + toggle */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Input cost per acre
          </p>
          <p className="mt-0.5 text-xs text-slate-500">{basisCaption}</p>
        </div>
        {/* Actual / Spread segmented toggle */}
        <div className="flex rounded-lg border border-white/[0.08] bg-white/[0.03] p-0.5">
          {(["spread", "actual"] as FieldBasis[]).map((b) => {
            const active = basis === b;
            return (
              <button
                key={b}
                type="button"
                onClick={() => setBasis(b)}
                className={[
                  "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                  active
                    ? "border border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                    : "border border-transparent text-slate-400 hover:text-slate-300",
                ].join(" ")}
              >
                {b.charAt(0).toUpperCase() + b.slice(1)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Headline number */}
      <div className="mt-3">
        <span className="font-mono-data text-3xl font-semibold text-white">
          {total != null ? `$${total.toFixed(2)}/ac` : "—"}
        </span>
      </div>

      {/* Per-category breakdown */}
      {byCategory.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-white/[0.06] pt-3">
          {byCategory.map(({ category, value }) => (
            <div key={category} className="flex items-center justify-between gap-2">
              <span className="text-sm text-slate-400">{labelForCategory(category)}</span>
              <span className="font-mono-data text-sm text-slate-300">
                {value != null ? `$${value.toFixed(2)}/ac` : "—"}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Footnotes */}
      {footnotes.length > 0 && (
        <div className="mt-3 space-y-0.5 border-t border-white/[0.06] pt-3">
          {footnotes.map((note) => (
            <p key={note} className="text-xs text-amber-400/80">
              {note}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
