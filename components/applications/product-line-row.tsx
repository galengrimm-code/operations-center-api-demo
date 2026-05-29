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
    <div className="grid grid-cols-12 items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm last:border-b-0">
      <div className="col-span-3 font-medium text-slate-900">{line.product.name}</div>
      <div className="col-span-2">
        <CategoryBadge category={effectiveCategory} />
      </div>
      <div className="col-span-2 text-slate-700">
        {displayRate(line.rate_value, line.rate_unit)}
      </div>
      <div className="col-span-2 text-slate-700">
        {displayTotal(line.total_value, line.total_unit)}
      </div>
      <div className="col-span-1 text-slate-700">
        {line.area_value} {displayUnit(line.area_unit)}
      </div>
      <div className="col-span-2 flex items-center justify-end gap-2">
        <InconsistencyBadge
          rate={line.rate_value}
          area={line.area_value}
          total={line.total_value}
        />
        {line.is_user_edited && (
          <span className="rounded bg-purple-50 px-2 py-0.5 text-xs text-purple-700">edited</span>
        )}
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="rounded border border-slate-200 px-2 py-0.5 text-xs hover:bg-slate-50"
          >
            Edit
          </button>
        )}
        {line.is_user_edited && onRevert && (
          <button
            type="button"
            onClick={onRevert}
            className="rounded border border-slate-200 px-2 py-0.5 text-xs hover:bg-slate-50"
          >
            Revert
          </button>
        )}
      </div>
    </div>
  );
}
