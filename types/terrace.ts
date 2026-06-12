export type TerraceKind = "crest" | "channel" | "waterway";
export type TerraceStatus = "draft" | "locked";
export type TerraceSource = "lidar" | "machine" | "manual" | "edited" | "driven";

export interface Terrace {
  id: string;
  org_id: string;
  jd_field_id: string;
  terrace_no: number;
  kind: TerraceKind;
  geom: GeoJSON.LineString;
  status: TerraceStatus;
  source: TerraceSource;
  length_ft: number | null;
  channel_coverage: number | null;
  mean_elevation_ft: number | null;
  notes: string | null;
  locked_at: string | null;
}
