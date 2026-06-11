"use client";

import { AlertTriangle } from "lucide-react";
import type { ElevationPassStat } from "@/lib/elevation-store";

// Persisted in elevation_models.pass_stats — shape lives in the store module.
export type PassStat = ElevationPassStat;

interface ElevationStatsProps {
  passStats: PassStat[];
  minZ: number;
  maxZ: number;
  contourCount: number;
  intervalFt: number;
}

export function ElevationStats({
  passStats,
  minZ,
  maxZ,
  contourCount,
  intervalFt,
}: ElevationStatsProps) {
  const totalPoints = passStats.reduce((sum, p) => sum + p.pointCount, 0);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Elevation points
          </p>
          <p className="text-xl font-semibold text-slate-900">{totalPoints.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Relief</p>
          <p className="text-xl font-semibold text-slate-900">{(maxZ - minZ).toFixed(1)} ft</p>
          <p className="text-xs text-slate-500">
            {minZ.toFixed(0)} – {maxZ.toFixed(0)} ft
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Contours</p>
          <p className="text-xl font-semibold text-slate-900">{contourCount}</p>
          <p className="text-xs text-slate-500">{intervalFt} ft interval</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Passes</p>
          <p className="text-xl font-semibold text-slate-900">{passStats.length}</p>
        </div>
      </div>

      <div className="space-y-1">
        {passStats.map((pass) => (
          <div
            key={pass.label}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm"
          >
            <span className="font-medium text-slate-700">{pass.label}</span>
            <span className="flex items-center gap-3 text-xs text-slate-500">
              <span>{pass.pointCount.toLocaleString()} points</span>
              {pass.missingElevationCount > 0 && (
                <span>{pass.missingElevationCount.toLocaleString()} without elevation</span>
              )}
              {pass.outlierCount > 0 && (
                <span>{pass.outlierCount.toLocaleString()} outliers dropped</span>
              )}
              <span
                className={
                  Math.abs(pass.offsetFt) > 0.05 ? "font-medium text-amber-600" : undefined
                }
              >
                {pass.offsetFt === 0
                  ? "reference pass"
                  : `${pass.offsetFt > 0 ? "+" : ""}${pass.offsetFt.toFixed(2)} ft correction`}
              </span>
              {pass.lowConfidence && (
                <span className="flex items-center gap-1 text-amber-600">
                  <AlertTriangle className="h-3 w-3" />
                  low overlap
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
