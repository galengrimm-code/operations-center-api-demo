"use client";

import { useState } from "react";
import { z } from "zod";
import { editProductLine } from "@/lib/applications-client";
import { displayUnit } from "@/lib/unit-display";
import type { FieldOperationProductLine, Product } from "@/types/applications";

interface Props {
  line: FieldOperationProductLine & { product: Product };
  onClose: () => void;
  onSaved: () => void;
}

// Numeric fields: empty string -> null, otherwise a finite non-negative number.
const numericField = z
  .union([z.literal(""), z.coerce.number().finite().nonnegative()])
  .transform((v) => (v === "" ? null : v));

const editSchema = z.object({
  rate_value: numericField,
  total_value: numericField,
  area_value: numericField,
  product_category_override: z
    .string()
    .transform((v) => (v === "" ? null : v))
    .nullable(),
});

export function ProductLineEditDialog({ line, onClose, onSaved }: Props) {
  const [rate, setRate] = useState(String(line.rate_value ?? ""));
  const [total, setTotal] = useState(String(line.total_value ?? ""));
  const [area, setArea] = useState(String(line.area_value ?? ""));
  const [override, setOverride] = useState(line.product_category_override ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const parsed = editSchema.safeParse({
        rate_value: rate,
        total_value: total,
        area_value: area,
        product_category_override: override,
      });
      if (!parsed.success) {
        setError("Enter valid non-negative numbers for rate, total, and area.");
        setSaving(false);
        return;
      }
      await editProductLine(line.id, parsed.data);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">Edit {line.product.name}</h3>
        <div className="space-y-3">
          <Row label={`Rate (${displayUnit(line.rate_unit)})`} value={rate} setValue={setRate} />
          <Row
            label={`Total (${displayUnit(line.total_unit)})`}
            value={total}
            setValue={setTotal}
          />
          <Row label={`Area (${displayUnit(line.area_unit)})`} value={area} setValue={setArea} />
          <div>
            <label className="mb-1 block text-xs text-slate-600">
              Category override (optional)
            </label>
            <select
              className="w-full rounded border border-slate-200 px-2 py-1.5"
              value={override}
              onChange={(e) => setOverride(e.target.value)}
            >
              <option value="">(use product default)</option>
              <option value="fertilizer">Fertilizer</option>
              <option value="chemical">Chemical</option>
              <option value="seed">Seed</option>
              <option value="adjuvant">Adjuvant</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
        {error && <div className="mt-3 rounded bg-red-50 p-2 text-sm text-red-700">{error}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-200 px-3 py-1.5 hover:bg-slate-50"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            className="rounded bg-emerald-600 px-3 py-1.5 text-white hover:bg-emerald-700 disabled:opacity-50"
            disabled={saving}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  setValue,
}: {
  label: string;
  value: string;
  setValue: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-slate-600">{label}</label>
      <input
        type="number"
        step="any"
        className="w-full rounded border border-slate-200 px-2 py-1.5"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    </div>
  );
}
