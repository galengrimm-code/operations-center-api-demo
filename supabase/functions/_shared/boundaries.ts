// Types matching John Deere boundary API responses
export interface JdLink { rel: string; uri: string; }
export interface JdBoundaryPoint { lat: number; lon: number; }
export interface JdRing { points: JdBoundaryPoint[]; type: string; passable?: boolean; }
export interface JdPolygon { rings: JdRing[]; }
export interface JdMeasurement { valueAsDouble: number; unit: string; }
export interface JdBoundary {
  id: string;
  name?: string;
  multipolygons: JdPolygon[];
  area?: JdMeasurement;
  workableArea?: JdMeasurement;
  active: boolean;
  irrigated?: boolean;
  archived?: boolean;
  links?: JdLink[];
}
export interface JdClient { id: string; name: string; links?: JdLink[]; }
export interface JdFarm { id: string; name: string; links?: JdLink[]; }
export interface JdClientsEmbed { clients?: JdClient[]; }
export interface JdFarmsEmbed { farms?: JdFarm[]; }
export interface JdField {
  id: string;
  name: string;
  activeBoundary?: JdBoundary;
  boundaries?: JdBoundary[];
  clients?: JdClient[] | JdClientsEmbed;
  farms?: JdFarm[] | JdFarmsEmbed;
  links: JdLink[];
}

function closeRing(coords: number[][]): number[][] {
  if (coords.length > 0 && (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1])) {
    coords.push([...coords[0]]);
  }
  return coords;
}

function pointsToCoords(points: JdBoundaryPoint[]): number[][] {
  return points.map((p) => [p.lon, p.lat]);
}

/**
 * Convert a JD boundary to a GeoJSON MultiPolygon.
 * Exterior and interior rings are preserved in the standard GeoJSON structure.
 */
export function convertBoundaryToGeoJSON(boundary: JdBoundary): { type: "MultiPolygon"; coordinates: number[][][][] } | null {
  if (!boundary.multipolygons || boundary.multipolygons.length === 0) return null;

  const polygons: number[][][][] = [];

  for (const polygon of boundary.multipolygons) {
    const exteriorRings = (polygon.rings || []).filter((r) => r.type === "exterior");
    const interiorRings = (polygon.rings || []).filter((r) => r.type === "interior");

    for (const ring of exteriorRings) {
      const coords = closeRing(pointsToCoords(ring.points));
      const polyRings: number[][][] = [coords];
      for (const hole of interiorRings) {
        polyRings.push(closeRing(pointsToCoords(hole.points)));
      }
      polygons.push(polyRings);
    }
  }

  if (polygons.length === 0) return null;
  return { type: "MultiPolygon", coordinates: polygons };
}

/**
 * Build a GeoJSON Polygon from only the exterior rings of a boundary (no holes).
 * Useful for calculating total field area.
 */
export function buildExteriorOnlyGeoJSON(boundary: JdBoundary): { type: "MultiPolygon"; coordinates: number[][][][] } | null {
  if (!boundary.multipolygons || boundary.multipolygons.length === 0) return null;

  const polygons: number[][][][] = [];

  for (const polygon of boundary.multipolygons) {
    const exteriorRings = (polygon.rings || []).filter((r) => r.type === "exterior");
    for (const ring of exteriorRings) {
      polygons.push([closeRing(pointsToCoords(ring.points))]);
    }
  }

  if (polygons.length === 0) return null;
  return { type: "MultiPolygon", coordinates: polygons };
}

/**
 * Extract interior rings as individual GeoJSON Polygons.
 * Each interior ring (e.g., a dryland corner outside a pivot) becomes its own polygon.
 */
export function buildInteriorRingPolygons(boundary: JdBoundary): Array<{ type: "Polygon"; coordinates: number[][][] }> {
  const result: Array<{ type: "Polygon"; coordinates: number[][][] }> = [];

  for (const polygon of boundary.multipolygons || []) {
    const interiorRings = (polygon.rings || []).filter((r) => r.type === "interior");
    for (const ring of interiorRings) {
      const coords = closeRing(pointsToCoords(ring.points));
      result.push({ type: "Polygon", coordinates: [coords] });
    }
  }

  return result;
}

export function extractClients(field: JdField): JdClient[] {
  if (!field.clients) return [];
  if (Array.isArray(field.clients)) return field.clients;
  if ((field.clients as JdClientsEmbed).clients) return (field.clients as JdClientsEmbed).clients!;
  return [];
}

export function extractFarms(field: JdField): JdFarm[] {
  if (!field.farms) return [];
  if (Array.isArray(field.farms)) return field.farms;
  if ((field.farms as JdFarmsEmbed).farms) return (field.farms as JdFarmsEmbed).farms!;
  return [];
}
