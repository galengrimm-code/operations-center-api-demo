"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/auth-context";
import { useClientFilter } from "@/contexts/client-filter-context";
import { useFields } from "@/hooks/use-fields";
import { formatArea } from "@/lib/area-utils";
import { MapPin, Loader2, Download, Search, X, Droplets } from "lucide-react";
import type { StoredField } from "@/types/john-deere";

export default function FieldsPage() {
  const { johnDeereConnection } = useAuth();
  const { selectedFarm: globalFarm } = useClientFilter();
  const { fields, loading, error, importFields, isImporting, updateIrrigationStartYear } =
    useFields();
  const [search, setSearch] = useState("");
  const [selectedClient, setSelectedClient] = useState<string | null>(null);

  const preferredUnit = johnDeereConnection?.preferred_area_unit || "ac";

  const clients = useMemo(() => {
    const set = new Set<string>();
    fields.forEach((f) => {
      if (f.client_name) set.add(f.client_name);
    });
    return Array.from(set).sort();
  }, [fields]);

  const filtered = useMemo(() => {
    let result = fields;
    if (globalFarm) result = result.filter((f) => f.farm_name === globalFarm);
    if (selectedClient) result = result.filter((f) => f.client_name === selectedClient);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          f.client_name?.toLowerCase().includes(q) ||
          f.farm_name?.toLowerCase().includes(q),
      );
    }
    return result;
  }, [fields, globalFarm, selectedClient, search]);

  return (
    <div className="min-h-[calc(100vh-48px)] bg-slate-950 p-6">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-white">Fields</h1>
            <p className="mt-0.5 text-sm text-slate-400">
              {fields.length} field{fields.length !== 1 ? "s" : ""} imported
            </p>
          </div>
          <button
            onClick={importFields}
            disabled={isImporting || loading}
            className="bg-emerald-500/15 flex items-center gap-2 rounded-xl border border-emerald-500/20 px-4 py-2 text-sm font-medium text-emerald-400 transition-colors hover:bg-emerald-500/25 disabled:opacity-50"
          >
            {isImporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {isImporting ? "Importing..." : "Import Fields"}
          </button>
        </div>

        {/* Search + Filters */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[200px] max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search fields..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] py-2 pl-9 pr-3 text-sm text-slate-200 placeholder:text-slate-500 focus:border-emerald-500/30 focus:outline-none focus:ring-1 focus:ring-emerald-500/20"
            />
          </div>
          {clients.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {clients.map((c) => (
                <button
                  key={c}
                  onClick={() => setSelectedClient(selectedClient === c ? null : c)}
                  className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${
                    selectedClient === c
                      ? "border border-sky-500/30 bg-sky-500/20 text-sky-300"
                      : "border border-white/[0.06] bg-white/[0.03] text-slate-400 hover:bg-white/[0.06]"
                  }`}
                >
                  {c}
                  {selectedClient === c && <X className="h-3 w-3" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Loading */}
        {loading && fields.length === 0 && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="glass mb-6 rounded-xl border-red-500/20 bg-red-500/10 p-4">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Empty state */}
        {!loading && fields.length === 0 && !error && (
          <div className="py-20 text-center">
            <MapPin className="mx-auto mb-3 h-10 w-10 text-slate-600" />
            <p className="text-slate-400">No fields imported yet.</p>
            <p className="mt-1 text-sm text-slate-500">Import your fields to see them here.</p>
          </div>
        )}

        {/* Fields grid */}
        {filtered.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((field) => (
              <div
                key={field.id}
                className="glass group rounded-xl p-4 transition-all hover:border-emerald-500/20 hover:bg-white/[0.06]"
              >
                <Link href={`/map/field/${field.jd_field_id}`} className="block">
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <h3 className="truncate text-sm font-medium text-white transition-colors group-hover:text-emerald-300">
                      {field.name}
                    </h3>
                    {field.boundary_geojson && (
                      <div className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-emerald-500" />
                    )}
                  </div>

                  {field.boundary_area_value && (
                    <p className="font-mono-data mb-2 text-sm text-emerald-400">
                      {formatArea(
                        field.boundary_area_value,
                        field.boundary_area_unit,
                        preferredUnit,
                      )}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-1.5">
                    {field.client_name && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-300">
                        <span className="h-1 w-1 rounded-full bg-sky-400" />
                        {field.client_name}
                      </span>
                    )}
                    {field.farm_name && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300">
                        <span className="h-1 w-1 rounded-full bg-amber-400" />
                        {field.farm_name}
                      </span>
                    )}
                  </div>
                </Link>

                {field.has_irrigated_boundary && (
                  <IrrigationYearEditor field={field} onSave={updateIrrigationStartYear} />
                )}
              </div>
            ))}
          </div>
        )}

        {/* No results from search */}
        {!loading && fields.length > 0 && filtered.length === 0 && (
          <div className="py-12 text-center">
            <p className="text-sm text-slate-500">No fields match your search.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function IrrigationYearEditor({
  field,
  onSave,
}: {
  field: StoredField;
  onSave: (fieldId: string, year: number | null) => Promise<void>;
}) {
  const [value, setValue] = useState<string>(
    field.irrigation_start_year != null ? String(field.irrigation_start_year) : "",
  );

  const commit = async () => {
    const trimmed = value.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next !== null && (!Number.isInteger(next) || next < 1900 || next > 2100)) {
      setValue(field.irrigation_start_year != null ? String(field.irrigation_start_year) : "");
      return;
    }
    if (next === field.irrigation_start_year) return;
    await onSave(field.id, next);
  };

  return (
    <div className="mt-3 flex items-center gap-2 border-t border-white/[0.05] pt-3">
      <Droplets className="h-3.5 w-3.5 flex-shrink-0 text-cyan-400" />
      <label className="flex-1 text-[11px] text-slate-400">Irrigated since</label>
      <input
        type="number"
        inputMode="numeric"
        placeholder="—"
        min={1900}
        max={2100}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        onBlur={commit}
        className="font-mono-data w-16 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-center text-[11px] text-cyan-200 focus:border-cyan-500/40 focus:outline-none focus:ring-1 focus:ring-cyan-500/20"
      />
    </div>
  );
}
