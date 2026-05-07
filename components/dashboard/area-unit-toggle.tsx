"use client";

import { Ruler } from "lucide-react";

interface AreaUnitToggleProps {
  value: string;
  onChange: (unit: string) => void;
}

export function AreaUnitToggle({ value, onChange }: AreaUnitToggleProps) {
  return (
    <div className="flex items-center gap-2">
      <Ruler className="h-4 w-4 text-slate-400" />
      <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
        <button
          onClick={() => onChange("ac")}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            value === "ac" ? "bg-emerald-600 text-white" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          Acres
        </button>
        <button
          onClick={() => onChange("ha")}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            value === "ha" ? "bg-emerald-600 text-white" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          Hectares
        </button>
      </div>
    </div>
  );
}
