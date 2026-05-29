"use client";

import { displayRate, displayTotal, displayUnit } from "@/lib/unit-display";
import { CategoryBadge } from "./category-badge";
import { InconsistencyBadge } from "./inconsistency-badge";
import type { FieldOperationProductLine, Product } from "@/types/applications";

interface Props {
  line: FieldOperationProductLine & { product: Product };
  onEdit?: () => void;
  onRevert?: () => void;
}

export function ProductLineRow({ line, onEdit, onRevert }: Props) {
  const effectiveCategory = line.product_category_override ?? line.product.product_category;
  return (
    <div className="grid grid-cols-12 items-center gap-2 border-b border-white/[0.05] px-3 py-2 text-sm last:border-b-0">
      <div className="col-span-3 font-medium text-white">{line.product.name}</div>
      <div className="col-span-2">
        <CategoryBadge category={effectiveCategory} />
      </div>
      <div className="font-mono-data col-span-2 text-slate-200">
        {displayRate(line.rate_value, line.rate_unit)}
      </div>
      <div className="font-mono-data col-span-2 text-slate-200">
        {displayTotal(line.total_value, line.total_unit)}
      </div>
      <div className="font-mono-data col-span-1 text-slate-200">
        {line.area_value} {displayUnit(line.area_unit)}
      </div>
      <div className="col-span-2 flex items-center justify-end gap-2">
        <InconsistencyBadge
          rate={line.rate_value}
          area={line.area_value}
          total={line.total_value}
        />
        {line.is_user_edited && (
          <span className="bg-purple-500/15 rounded-md px-2 py-0.5 text-xs text-purple-300">
            edited
          </span>
        )}
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md border border-white/[0.08] px-2 py-0.5 text-xs text-slate-300 hover:bg-white/[0.06]"
          >
            Edit
          </button>
        )}
        {line.is_user_edited && onRevert && (
          <button
            type="button"
            onClick={onRevert}
            className="rounded-md border border-white/[0.08] px-2 py-0.5 text-xs text-slate-300 hover:bg-white/[0.06]"
          >
            Revert
          </button>
        )}
      </div>
    </div>
  );
}
