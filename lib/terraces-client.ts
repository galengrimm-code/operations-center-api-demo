import { supabase } from "./supabase";
import type { Terrace, TerraceKind, TerraceStatus, TerraceSource } from "@/types/terrace";

// CRUD for operations_center.terraces via the browser client (already scoped
// to the operations_center schema). The Database type doesn't include this
// table yet, so queries cast through `any` — same pattern as elevation-store
// and the direct `fields` queries elsewhere.

const SELECT =
  "id, org_id, jd_field_id, terrace_no, kind, geom, status, source, length_ft, channel_coverage, mean_elevation_ft, notes, locked_at";

export async function fetchTerraces(orgId: string, jdFieldId: string): Promise<Terrace[]> {
  const { data, error } = await (supabase.from("terraces") as any)
    .select(SELECT)
    .eq("org_id", orgId)
    .eq("jd_field_id", jdFieldId)
    .order("terrace_no", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []) as Terrace[];
}

/** Length of a lon/lat LineString in feet (local equirectangular). */
export function lineLengthFt(geom: GeoJSON.LineString): number {
  const coords = geom.coordinates;
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const [lo1, la1] = coords[i - 1];
    const [lo2, la2] = coords[i];
    const mLat = ((la1 + la2) / 2) * (Math.PI / 180);
    const dx = (lo2 - lo1) * 111320 * Math.cos(mLat);
    const dy = (la2 - la1) * 110574;
    total += Math.hypot(dx, dy);
  }
  return total * 3.28084;
}

export async function updateTerraceGeom(id: string, geom: GeoJSON.LineString): Promise<void> {
  const { error } = await (supabase.from("terraces") as any)
    .update({
      geom,
      length_ft: Math.round(lineLengthFt(geom) * 10) / 10,
      source: "edited" as TerraceSource,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function setTerraceStatus(id: string, status: TerraceStatus): Promise<void> {
  const { error } = await (supabase.from("terraces") as any)
    .update({
      status,
      locked_at: status === "locked" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Lock every remaining draft line on a field in one call. */
export async function lockField(orgId: string, jdFieldId: string): Promise<number> {
  const { data, error } = await (supabase.from("terraces") as any)
    .update({
      status: "locked",
      locked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", orgId)
    .eq("jd_field_id", jdFieldId)
    .eq("status", "draft")
    .select("id");
  if (error) throw new Error(error.message);
  return (data || []).length;
}

export async function deleteTerrace(id: string): Promise<void> {
  const { error } = await (supabase.from("terraces") as any).delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function insertTerrace(params: {
  orgId: string;
  jdFieldId: string;
  terraceNo: number;
  kind: TerraceKind;
  geom: GeoJSON.LineString;
}): Promise<Terrace> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await (supabase.from("terraces") as any)
    .insert({
      user_id: user.id,
      org_id: params.orgId,
      jd_field_id: params.jdFieldId,
      terrace_no: params.terraceNo,
      kind: params.kind,
      geom: params.geom,
      status: "draft",
      source: "manual" as TerraceSource,
      length_ft: Math.round(lineLengthFt(params.geom) * 10) / 10,
    })
    .select(SELECT)
    .single();
  if (error) throw new Error(error.message);
  return data as Terrace;
}

/** Next free terrace number for a field (for a manually drawn line). */
export function nextTerraceNo(terraces: Terrace[]): number {
  return terraces.reduce((max, t) => Math.max(max, t.terrace_no), -1) + 1;
}
