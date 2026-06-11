"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mountain, Play } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { supabase } from "@/lib/supabase";
import {
  fetchStoredFields,
  fetchStoredOperations,
  pollForShapefileUrl,
} from "@/lib/john-deere-client";
import { filterHiddenOperations } from "@/lib/crop-filter";
import { processShapefile } from "@/lib/shapefile-analysis";
import {
  applyOffsets,
  buildGrid,
  computePassOffsets,
  createLocalProjection,
  extractElevationPoints,
  gridToContours,
  smoothGrid,
  type ContourResult,
  type ElevationGrid,
  type LocalProjection,
} from "@/lib/elevation-merge";
import type { StoredField, StoredFieldOperation } from "@/types/john-deere";
import { ElevationMap } from "./elevation-map";
import { ElevationStats, type PassStat } from "./elevation-stats";

type PassStatus = "pending" | "polling" | "downloading" | "parsing" | "done" | "error";

interface PassProgress {
  status: PassStatus;
  attempt: number;
  detail?: string;
}

const DEFAULT_INTERVAL_FT = 2;
const MIN_DEFAULT_AREA_AC = 20;
const DEFAULT_SEASON_LOOKBACK = 2;

function opLabel(op: StoredFieldOperation): string {
  const season = op.crop_season || "?";
  const crop = op.crop_name_override || op.crop_name || "Unknown crop";
  const type = op.operation_type === "seeding" ? "Planting" : "Harvest";
  const area = op.area_value ? ` — ${Math.round(op.area_value)} ${op.area_unit || "ac"}` : "";
  return `${season} ${type} (${crop})${area}`;
}

function boundaryCentroid(boundary: GeoJSON.MultiPolygon): [number, number] {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const coord of boundary.coordinates[0][0]) {
    sx += coord[0];
    sy += coord[1];
    n++;
  }
  return [sx / n, sy / n];
}

export function ElevationView() {
  const { johnDeereConnection } = useAuth();

  const [fields, setFields] = useState<StoredField[]>([]);
  const [fieldsLoading, setFieldsLoading] = useState(true);
  const [selectedFieldId, setSelectedFieldId] = useState("");

  const [ops, setOps] = useState<StoredFieldOperation[]>([]);
  const [opsLoading, setOpsLoading] = useState(false);
  const [checkedOpIds, setCheckedOpIds] = useState<Set<string>>(new Set());

  const [isBuilding, setIsBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [passProgress, setPassProgress] = useState<Record<string, PassProgress>>({});

  const [intervalFt, setIntervalFt] = useState(DEFAULT_INTERVAL_FT);
  const [contours, setContours] = useState<ContourResult | null>(null);
  const [passStats, setPassStats] = useState<PassStat[]>([]);
  const gridRef = useRef<ElevationGrid | null>(null);
  const projRef = useRef<LocalProjection | null>(null);
  // Invalidates in-flight builds when inputs change so a slow build for
  // field A can't commit its results after the user switched to field B.
  const buildTokenRef = useRef(0);

  const selectedField = fields.find((f) => f.jd_field_id === selectedFieldId) || null;
  const hiddenCrops = johnDeereConnection?.hidden_crop_names;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchStoredFields();
        if (cancelled) return;
        const sorted = ((data.fields || []) as StoredField[])
          .filter((f) => f.boundary_geojson)
          .sort((a, b) => a.name.localeCompare(b.name));
        setFields(sorted);
      } catch {
        if (!cancelled) setFields([]);
      } finally {
        if (!cancelled) setFieldsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedFieldId) {
      setOps([]);
      setCheckedOpIds(new Set());
      return;
    }
    let cancelled = false;
    buildTokenRef.current++;
    setOpsLoading(true);
    setContours(null);
    setPassStats([]);
    gridRef.current = null;
    (async () => {
      try {
        const data = await fetchStoredOperations(selectedFieldId);
        if (cancelled) return;
        const all = (data.operations || []) as StoredFieldOperation[];
        const usable = filterHiddenOperations(
          all.filter((op) => op.operation_type === "seeding" || op.operation_type === "harvest"),
          hiddenCrops,
        );
        setOps(usable);

        // Default-select recent full-field passes; tiny stubs stay unchecked.
        const currentYear = new Date().getFullYear();
        const defaults = usable.filter(
          (op) =>
            Number(op.crop_season) >= currentYear - DEFAULT_SEASON_LOOKBACK &&
            (op.area_value ?? 0) >= MIN_DEFAULT_AREA_AC,
        );
        setCheckedOpIds(new Set(defaults.map((op) => op.jd_operation_id)));
      } catch {
        if (!cancelled) setOps([]);
      } finally {
        if (!cancelled) setOpsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedFieldId, hiddenCrops]);

  const toggleOp = (opId: string) => {
    setCheckedOpIds((prev) => {
      const next = new Set(prev);
      if (next.has(opId)) next.delete(opId);
      else next.add(opId);
      return next;
    });
  };

  const setProgress = (opId: string, progress: PassProgress) => {
    setPassProgress((prev) => ({ ...prev, [opId]: progress }));
  };

  const handleBuild = useCallback(async () => {
    if (!selectedField?.boundary_geojson || checkedOpIds.size === 0) return;

    const buildToken = ++buildTokenRef.current;
    setIsBuilding(true);
    setBuildError(null);
    setContours(null);
    setPassStats([]);
    setPassProgress({});
    gridRef.current = null;

    const [lon0, lat0] = boundaryCentroid(selectedField.boundary_geojson);
    const proj = createLocalProjection(lon0, lat0);
    projRef.current = proj;

    const selectedOps = ops.filter((op) => checkedOpIds.has(op.jd_operation_id));

    try {
      // All passes in parallel — JD generates shapefiles server-side
      // concurrently, so a cold build costs the slowest pass, not the sum.
      const results = await Promise.all(
        selectedOps.map(async (op) => {
          const opId = op.jd_operation_id;
          try {
            setProgress(opId, { status: "polling", attempt: 0 });
            // OneHertz: same elevation information as EachSensor at ~1/5 the
            // size (row units share one GPS fix) — keeps big planter passes
            // under the storage upload limit.
            const storagePath = await pollForShapefileUrl(
              opId,
              (attempt) => setProgress(opId, { status: "polling", attempt }),
              "OneHertz",
            );

            setProgress(opId, { status: "downloading", attempt: 0 });
            const { data: blob, error: downloadError } = await supabase.storage
              .from("shapefiles")
              .download(storagePath);
            if (downloadError || !blob) {
              throw new Error("Failed to download shapefile from storage");
            }

            setProgress(opId, { status: "parsing", attempt: 0 });
            const fc = await processShapefile(await blob.arrayBuffer());
            const extraction = extractElevationPoints(fc, proj);
            setProgress(opId, {
              status: "done",
              attempt: 0,
              detail: `${extraction.points.length.toLocaleString()} elevation points`,
            });
            return { op, points: extraction };
          } catch (err) {
            setProgress(opId, {
              status: "error",
              attempt: 0,
              detail: err instanceof Error ? err.message : "Failed",
            });
            return null;
          }
        }),
      );
      const passPoints = results.filter(
        (r): r is { op: StoredFieldOperation; points: ReturnType<typeof extractElevationPoints> } =>
          r !== null,
      );

      if (buildTokenRef.current !== buildToken) return;

      const usablePasses = passPoints.filter((p) => p.points.points.length > 0);
      if (usablePasses.length === 0) {
        throw new Error(
          "No elevation data found in the selected passes. The machines may not have recorded elevation for these operations.",
        );
      }

      const offsets = computePassOffsets(usablePasses.map((p) => p.points.points));
      const merged = applyOffsets(
        usablePasses.map((p) => p.points.points),
        offsets,
      );
      const grid = smoothGrid(buildGrid(merged));
      if (buildTokenRef.current !== buildToken) return;
      gridRef.current = grid;

      setPassStats(
        usablePasses.map((p, i) => ({
          label: opLabel(p.op),
          pointCount: p.points.points.length,
          missingElevationCount: p.points.missingElevationCount,
          outlierCount: p.points.outlierCount,
          offsetFt: offsets[i].offsetFt,
          lowConfidence: offsets[i].lowConfidence,
        })),
      );
      setContours(gridToContours(grid, proj, intervalFt));
    } catch (err) {
      if (buildTokenRef.current === buildToken) {
        setBuildError(err instanceof Error ? err.message : "Elevation build failed");
      }
    } finally {
      setIsBuilding(false);
    }
  }, [selectedField, checkedOpIds, ops, intervalFt]);

  const handleIntervalChange = (nextInterval: number) => {
    setIntervalFt(nextInterval);
    if (gridRef.current && projRef.current) {
      setContours(gridToContours(gridRef.current, projRef.current, nextInterval));
    }
  };

  const statusLabel = (p: PassProgress): string => {
    switch (p.status) {
      case "polling":
        return p.attempt > 0
          ? `Waiting on John Deere (check ${p.attempt})...`
          : "Requesting shapefile...";
      case "downloading":
        return "Downloading...";
      case "parsing":
        return "Parsing...";
      case "done":
        return p.detail || "Done";
      case "error":
        return p.detail || "Failed";
      default:
        return "";
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Mountain className="h-7 w-7 text-emerald-600" />
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Elevation</h1>
          <p className="text-sm text-slate-500">
            Merge planting and harvest passes into a topographic map
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[240px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">Field</label>
            {fieldsLoading ? (
              <div className="flex items-center gap-2 py-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading fields...
              </div>
            ) : (
              <select
                value={selectedFieldId}
                onChange={(e) => setSelectedFieldId(e.target.value)}
                disabled={isBuilding}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">Choose a field...</option>
                {fields.map((f) => (
                  <option key={f.jd_field_id} value={f.jd_field_id}>
                    {f.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="min-w-[140px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Contour interval
            </label>
            <select
              value={intervalFt}
              onChange={(e) => handleIntervalChange(Number(e.target.value))}
              disabled={isBuilding}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value={1}>1 ft</option>
              <option value={2}>2 ft</option>
              <option value={5}>5 ft</option>
            </select>
          </div>

          <button
            onClick={handleBuild}
            disabled={isBuilding || !selectedField || checkedOpIds.size === 0}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isBuilding ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {isBuilding ? "Building..." : "Build elevation map"}
          </button>
        </div>

        {selectedFieldId && (
          <div className="mt-4">
            <p className="mb-2 text-sm font-medium text-slate-700">
              Passes to merge{" "}
              <span className="font-normal text-slate-500">
                (more passes = denser coverage; different widths and patterns fill the gaps)
              </span>
            </p>
            {opsLoading ? (
              <div className="flex items-center gap-2 py-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading operations...
              </div>
            ) : ops.length === 0 ? (
              <p className="py-2 text-sm text-slate-500">
                No planting or harvest operations found for this field.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {ops.map((op) => {
                  const opId = op.jd_operation_id;
                  const progress = passProgress[opId];
                  return (
                    <label
                      key={opId}
                      className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={checkedOpIds.has(opId)}
                        onChange={() => toggleOp(opId)}
                        disabled={isBuilding}
                        className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="flex-1 text-slate-700">{opLabel(op)}</span>
                      {progress && (
                        <span
                          className={`text-xs ${
                            progress.status === "error"
                              ? "text-red-600"
                              : progress.status === "done"
                                ? "text-emerald-600"
                                : "text-slate-500"
                          }`}
                        >
                          {progress.status !== "done" &&
                            progress.status !== "error" &&
                            isBuilding && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
                          {statusLabel(progress)}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {buildError && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {buildError}
          </div>
        )}
      </div>

      {contours && gridRef.current && (
        <>
          <ElevationStats
            passStats={passStats}
            minZ={gridRef.current.minZ}
            maxZ={gridRef.current.maxZ}
            contourCount={contours.thresholds.length}
            intervalFt={intervalFt}
          />
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <ElevationMap
              boundary={selectedField?.boundary_geojson || null}
              bands={contours.bands}
              lines={contours.lines}
            />
          </div>
        </>
      )}
    </div>
  );
}
