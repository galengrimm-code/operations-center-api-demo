import { createLocalProjection, type ElevationGrid, type LocalProjection } from "./elevation-merge";

// The supabase client is imported lazily inside the IO functions so the pure
// serialization helpers stay importable in environments without the
// NEXT_PUBLIC_* env vars (vitest).
async function getClient() {
  const { supabase } = await import("./supabase");
  return supabase;
}

// Persistence for merged elevation models (operations_center.elevation_models).
// One row per field; rebuilding overwrites. The grid is stored as jsonb with
// values rounded to 0.01 ft and null for no-coverage cells.

export interface ElevationPassStat {
  label: string;
  pointCount: number;
  missingElevationCount: number;
  outlierCount: number;
  offsetFt: number;
  lowConfidence: boolean;
}

export interface SerializedGrid {
  lon0: number;
  lat0: number;
  x0: number;
  y0: number;
  cellSize: number;
  nx: number;
  ny: number;
  values: (number | null)[];
}

export interface SavedElevationModel {
  grid: ElevationGrid;
  proj: LocalProjection;
  passStats: ElevationPassStat[];
  passOpIds: string[];
  pointCount: number;
  builtAt: string;
}

export function serializeGrid(grid: ElevationGrid, proj: LocalProjection): SerializedGrid {
  const values: (number | null)[] = new Array(grid.values.length);
  for (let i = 0; i < grid.values.length; i++) {
    const v = grid.values[i];
    values[i] = Number.isNaN(v) ? null : Math.round(v * 100) / 100;
  }
  return {
    lon0: proj.lon0,
    lat0: proj.lat0,
    x0: grid.x0,
    y0: grid.y0,
    cellSize: grid.cellSize,
    nx: grid.nx,
    ny: grid.ny,
    values,
  };
}

export function deserializeGrid(serialized: SerializedGrid): {
  grid: ElevationGrid;
  proj: LocalProjection;
} {
  const values = new Float64Array(serialized.values.length);
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < serialized.values.length; i++) {
    const v = serialized.values[i];
    if (v === null) {
      values[i] = NaN;
    } else {
      values[i] = v;
      if (v < minZ) minZ = v;
      if (v > maxZ) maxZ = v;
    }
  }
  return {
    grid: {
      x0: serialized.x0,
      y0: serialized.y0,
      cellSize: serialized.cellSize,
      nx: serialized.nx,
      ny: serialized.ny,
      values,
      minZ: Number.isFinite(minZ) ? minZ : 0,
      maxZ: Number.isFinite(maxZ) ? maxZ : 0,
    },
    proj: createLocalProjection(serialized.lon0, serialized.lat0),
  };
}

export async function saveElevationModel(params: {
  orgId: string;
  jdFieldId: string;
  passOpIds: string[];
  passStats: ElevationPassStat[];
  grid: ElevationGrid;
  proj: LocalProjection;
  pointCount: number;
}): Promise<void> {
  const supabase = await getClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Database type doesn't include this table yet — same cast pattern as the
  // direct `fields` queries elsewhere in the app.
  const { error } = await (supabase.from("elevation_models") as any).upsert(
    {
      user_id: user.id,
      org_id: params.orgId,
      jd_field_id: params.jdFieldId,
      pass_op_ids: params.passOpIds,
      pass_stats: params.passStats,
      grid: serializeGrid(params.grid, params.proj),
      min_z: params.grid.minZ,
      max_z: params.grid.maxZ,
      point_count: params.pointCount,
      built_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,org_id,jd_field_id" },
  );
  if (error) throw new Error(error.message);
}

export async function loadElevationModel(
  orgId: string,
  jdFieldId: string,
): Promise<SavedElevationModel | null> {
  const supabase = await getClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await (supabase.from("elevation_models") as any)
    .select("pass_op_ids, pass_stats, grid, point_count, built_at")
    .eq("user_id", user.id)
    .eq("org_id", orgId)
    .eq("jd_field_id", jdFieldId)
    .maybeSingle();

  if (error || !data) return null;

  const { grid, proj } = deserializeGrid(data.grid as SerializedGrid);
  return {
    grid,
    proj,
    passStats: (data.pass_stats || []) as ElevationPassStat[],
    passOpIds: (data.pass_op_ids || []) as string[],
    pointCount: (data.point_count as number) || 0,
    builtAt: data.built_at as string,
  };
}
