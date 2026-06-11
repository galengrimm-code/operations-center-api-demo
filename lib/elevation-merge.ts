import { contours as d3Contours } from "d3-contour";
import type { FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";

// Multi-pass elevation merge: extract per-sensor elevation points from JD
// operation shapefiles, remove per-pass vertical bias, interpolate to a
// regular grid, and generate contour bands/lines for map rendering.
//
// Units: x/y are meters in a local equirectangular projection centered on
// the data; z is feet (John Deere shapefiles report Elevation in ft).

export interface ElevationPoint {
  x: number;
  y: number;
  z: number;
}

export interface LocalProjection {
  lon0: number;
  lat0: number;
  mPerDegLon: number;
  mPerDegLat: number;
  toLocal: (lon: number, lat: number) => [number, number];
  toLonLat: (x: number, y: number) => [number, number];
}

export interface PassExtraction {
  points: ElevationPoint[];
  featureCount: number;
  missingElevationCount: number;
  outlierCount: number;
}

export interface PassOffset {
  offsetFt: number;
  sharedCells: number;
  lowConfidence: boolean;
}

export interface ElevationGrid {
  x0: number;
  y0: number;
  cellSize: number;
  nx: number;
  ny: number;
  /** Row-major, row 0 = southernmost. NaN = no data coverage. */
  values: Float64Array;
  minZ: number;
  maxZ: number;
}

export interface ContourResult {
  /** Filled bands: Polygon features with lowFt/highFt/midFt/fill props. */
  bands: FeatureCollection;
  /** Isolines: LineString features with elevationFt/label props. */
  lines: FeatureCollection;
  thresholds: number[];
}

const EARTH_M_PER_DEG_LAT = 110_574;
const EARTH_M_PER_DEG_LON_EQUATOR = 111_320;

export function createLocalProjection(lon0: number, lat0: number): LocalProjection {
  const mPerDegLon = EARTH_M_PER_DEG_LON_EQUATOR * Math.cos((lat0 * Math.PI) / 180);
  const mPerDegLat = EARTH_M_PER_DEG_LAT;
  return {
    lon0,
    lat0,
    mPerDegLon,
    mPerDegLat,
    toLocal: (lon, lat) => [(lon - lon0) * mPerDegLon, (lat - lat0) * mPerDegLat],
    toLonLat: (x, y) => [lon0 + x / mPerDegLon, lat0 + y / mPerDegLat],
  };
}

function ringCentroid(ring: Position[]): [number, number] {
  // Average of vertices (skip the closing duplicate). Sensor polygons are
  // a few meters across, so vertex averaging is plenty accurate.
  const n = ring.length > 1 ? ring.length - 1 : ring.length;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += ring[i][0];
    sy += ring[i][1];
  }
  return [sx / n, sy / n];
}

function readElevation(props: Record<string, unknown> | null): number | null {
  if (!props) return null;
  const raw = props.Elevation ?? props.ELEVATION ?? props.elevation;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return raw;
}

/**
 * Pull (x, y, elevation) points out of a parsed operation shapefile.
 * Applies a robust MAD-based outlier filter so a handful of bad GPS fixes
 * can't warp the surface.
 */
export function extractElevationPoints(
  fc: FeatureCollection,
  proj: LocalProjection,
): PassExtraction {
  const rawPoints: ElevationPoint[] = [];
  let missingElevationCount = 0;

  for (const feature of fc.features) {
    const geom = feature.geometry;
    if (!geom) continue;

    let ring: Position[] | null = null;
    if (geom.type === "Polygon") {
      ring = (geom as Polygon).coordinates[0] ?? null;
    } else if (geom.type === "MultiPolygon") {
      ring = (geom as MultiPolygon).coordinates[0]?.[0] ?? null;
    } else if (geom.type === "Point") {
      ring = [geom.coordinates as Position];
    }
    if (!ring || ring.length === 0) continue;

    const z = readElevation(feature.properties as Record<string, unknown> | null);
    if (z === null || z <= 0) {
      missingElevationCount++;
      continue;
    }

    const [lon, lat] = ringCentroid(ring);
    const [x, y] = proj.toLocal(lon, lat);
    rawPoints.push({ x, y, z });
  }

  // Robust outlier filter: real terrain relief survives (MAD covers it),
  // GPS glitches (0 ft, 5-digit spikes) do not.
  let outlierCount = 0;
  let points = rawPoints;
  if (rawPoints.length >= 10) {
    const zs = rawPoints.map((p) => p.z).sort((a, b) => a - b);
    const median = zs[Math.floor(zs.length / 2)];
    const deviations = rawPoints.map((p) => Math.abs(p.z - median)).sort((a, b) => a - b);
    const mad = deviations[Math.floor(deviations.length / 2)];
    const tolerance = Math.max(33, 8 * 1.4826 * mad);
    points = rawPoints.filter((p) => Math.abs(p.z - median) <= tolerance);
    outlierCount = rawPoints.length - points.length;
  }

  return {
    points,
    featureCount: fc.features.length,
    missingElevationCount,
    outlierCount,
  };
}

function cellKey(x: number, y: number, cellSize: number): string {
  return `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`;
}

/**
 * Compute per-pass vertical offsets against a reference pass (the one with
 * the most points). Different years/receivers carry systematic vertical
 * bias; without removing it the merged surface grows phantom ridges where
 * passes interleave. Offset = median of per-cell mean differences.
 */
export function computePassOffsets(passes: ElevationPoint[][], cellSizeM = 10): PassOffset[] {
  const MIN_SHARED_CELLS = 25;

  let refIndex = 0;
  for (let i = 1; i < passes.length; i++) {
    if (passes[i].length > passes[refIndex].length) refIndex = i;
  }

  const cellMeans = passes.map((points) => {
    const sums = new Map<string, { sum: number; count: number }>();
    for (const p of points) {
      const key = cellKey(p.x, p.y, cellSizeM);
      const entry = sums.get(key);
      if (entry) {
        entry.sum += p.z;
        entry.count++;
      } else {
        sums.set(key, { sum: p.z, count: 1 });
      }
    }
    const means = new Map<string, number>();
    sums.forEach((v, k) => means.set(k, v.sum / v.count));
    return means;
  });

  const refMeans = cellMeans[refIndex];

  const medianDiff = (
    target: Map<string, number>,
    other: Map<string, number>,
    otherOffset: number,
  ): { median: number; shared: number } => {
    const diffs: number[] = [];
    target.forEach((mean, key) => {
      const otherMean = other.get(key);
      if (otherMean !== undefined) diffs.push(otherMean + otherOffset - mean);
    });
    if (diffs.length === 0) return { median: 0, shared: 0 };
    diffs.sort((a, b) => a - b);
    return { median: diffs[Math.floor(diffs.length / 2)], shared: diffs.length };
  };

  const offsets: PassOffset[] = passes.map((_, i) => {
    if (i === refIndex) return { offsetFt: 0, sharedCells: refMeans.size, lowConfidence: false };
    const { median, shared } = medianDiff(cellMeans[i], refMeans, 0);
    if (shared < MIN_SHARED_CELLS) {
      return { offsetFt: 0, sharedCells: shared, lowConfidence: true };
    }
    return { offsetFt: median, sharedCells: shared, lowConfidence: false };
  });

  // One-hop chaining: a pass that barely overlaps the reference may still
  // overlap another already-corrected pass (C–B–A layouts). Route its offset
  // through the best-connected corrected pass instead of leaving it at zero.
  for (let i = 0; i < passes.length; i++) {
    if (!offsets[i].lowConfidence) continue;
    let best: { median: number; shared: number } | null = null;
    for (let k = 0; k < passes.length; k++) {
      if (k === i || offsets[k].lowConfidence) continue;
      const candidate = medianDiff(cellMeans[i], cellMeans[k], offsets[k].offsetFt);
      if (candidate.shared >= MIN_SHARED_CELLS && (!best || candidate.shared > best.shared)) {
        best = candidate;
      }
    }
    if (best) {
      offsets[i] = { offsetFt: best.median, sharedCells: best.shared, lowConfidence: false };
    }
  }

  return offsets;
}

export function applyOffsets(passes: ElevationPoint[][], offsets: PassOffset[]): ElevationPoint[] {
  const merged: ElevationPoint[] = [];
  for (let i = 0; i < passes.length; i++) {
    const offset = offsets[i].offsetFt;
    for (const p of passes[i]) {
      merged.push(offset === 0 ? p : { x: p.x, y: p.y, z: p.z + offset });
    }
  }
  return merged;
}

/**
 * Inverse-distance-weighted interpolation onto a regular grid. Nodes with
 * no points within the search radius stay NaN, which masks the surface to
 * actual data coverage.
 */
export function buildGrid(
  points: ElevationPoint[],
  cellSize = 4,
  searchRadius = 12,
): ElevationGrid {
  if (points.length === 0) {
    return { x0: 0, y0: 0, cellSize, nx: 0, ny: 0, values: new Float64Array(0), minZ: 0, maxZ: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const x0 = minX - cellSize;
  const y0 = minY - cellSize;
  const nx = Math.ceil((maxX - x0 + cellSize) / cellSize) + 1;
  const ny = Math.ceil((maxY - y0 + cellSize) / cellSize) + 1;

  // Spatial hash with bin size = search radius → 3x3 bin scan per node.
  const bins = new Map<string, ElevationPoint[]>();
  for (const p of points) {
    const key = cellKey(p.x, p.y, searchRadius);
    const bin = bins.get(key);
    if (bin) bin.push(p);
    else bins.set(key, [p]);
  }

  const values = new Float64Array(nx * ny).fill(NaN);
  const r2 = searchRadius * searchRadius;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (let j = 0; j < ny; j++) {
    const gy = y0 + j * cellSize;
    const bj = Math.floor(gy / searchRadius);
    for (let i = 0; i < nx; i++) {
      const gx = x0 + i * cellSize;
      const bi = Math.floor(gx / searchRadius);

      let weightSum = 0;
      let valueSum = 0;
      let exact: number | null = null;

      for (let dj = -1; dj <= 1 && exact === null; dj++) {
        for (let di = -1; di <= 1 && exact === null; di++) {
          const bin = bins.get(`${bi + di}:${bj + dj}`);
          if (!bin) continue;
          for (const p of bin) {
            const dx = p.x - gx;
            const dy = p.y - gy;
            const d2 = dx * dx + dy * dy;
            if (d2 > r2) continue;
            if (d2 < 1e-6) {
              exact = p.z;
              break;
            }
            const w = 1 / d2;
            weightSum += w;
            valueSum += p.z * w;
          }
        }
      }

      const z = exact !== null ? exact : weightSum > 0 ? valueSum / weightSum : NaN;
      if (!Number.isNaN(z)) {
        values[j * nx + i] = z;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
    }
  }

  return { x0, y0, cellSize, nx, ny, values, minZ, maxZ };
}

/** One NaN-aware 3x3 binomial smoothing pass. */
export function smoothGrid(grid: ElevationGrid): ElevationGrid {
  const { nx, ny, values } = grid;
  const out = new Float64Array(nx * ny).fill(NaN);
  const kernel = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (Number.isNaN(values[j * nx + i])) continue;
      let sum = 0;
      let weight = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const jj = j + dj;
          const ii = i + di;
          if (jj < 0 || jj >= ny || ii < 0 || ii >= nx) continue;
          const v = values[jj * nx + ii];
          if (Number.isNaN(v)) continue;
          const k = kernel[(dj + 1) * 3 + (di + 1)];
          sum += v * k;
          weight += k;
        }
      }
      const z = sum / weight;
      out[j * nx + i] = z;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }

  return { ...grid, values: out, minZ, maxZ };
}

/** Terrain color ramp (low → high): deep green → lime → amber → brown → off-white. */
export function elevationToColor(t: number): string {
  const stops: [number, [number, number, number]][] = [
    [0, [22, 101, 52]],
    [0.25, [101, 163, 13]],
    [0.5, [234, 179, 8]],
    [0.75, [154, 84, 36]],
    [1, [245, 240, 230]],
  ];
  const clamped = Math.min(1, Math.max(0, t));
  for (let i = 1; i < stops.length; i++) {
    if (clamped <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const f = (clamped - t0) / (t1 - t0);
      const rgb = c0.map((c, ch) => Math.round(c + (c1[ch] - c) * f));
      return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    }
  }
  return "rgb(245,240,230)";
}

const SENTINEL_DROP = 100_000;

/**
 * Generate contour bands and isolines from the grid. NaN cells are replaced
 * with a deep sentinel so d3-contour can run; line segments that hug the
 * coverage edge (adjacent to NaN cells) are dropped so isolines only trace
 * real terrain.
 */
export function gridToContours(
  grid: ElevationGrid,
  proj: LocalProjection,
  intervalFt: number,
): ContourResult {
  const { nx, ny, values, x0, y0, cellSize, minZ, maxZ } = grid;
  if (nx === 0 || ny === 0 || !Number.isFinite(minZ)) {
    return {
      bands: { type: "FeatureCollection", features: [] },
      lines: { type: "FeatureCollection", features: [] },
      thresholds: [],
    };
  }

  const sentinel = minZ - SENTINEL_DROP;
  const data = new Array<number>(nx * ny);
  for (let k = 0; k < values.length; k++) {
    data[k] = Number.isNaN(values[k]) ? sentinel : values[k];
  }

  // Start at or below minZ so the lowest terrain always gets a band — with a
  // ceil() start, elevations in [minZ, start) would render transparent, and a
  // field with less relief than the interval would produce no contours at all.
  const thresholds: number[] = [];
  const start = Math.floor(minZ / intervalFt) * intervalFt;
  for (let t = start; t <= maxZ; t += intervalFt) thresholds.push(t);

  const generator = d3Contours().size([nx, ny]).thresholds(thresholds);
  const contourPolys = generator(data);

  const gridToLonLat = (gx: number, gy: number): Position => {
    // d3-contour coordinates are in grid-index space (x right, y down in
    // row order); our row 0 is the southernmost row, so y maps directly.
    return proj.toLonLat(x0 + gx * cellSize, y0 + gy * cellSize);
  };

  const hasNaNNear = (gx: number, gy: number): boolean => {
    const i = Math.round(gx);
    const j = Math.round(gy);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const ii = i + di;
        const jj = j + dj;
        if (ii < 0 || ii >= nx || jj < 0 || jj >= ny) return true;
        if (Number.isNaN(values[jj * nx + ii])) return true;
      }
    }
    return false;
  };

  const span = maxZ - minZ || 1;
  const bandFeatures: GeoJSON.Feature[] = [];
  const lineFeatures: GeoJSON.Feature[] = [];

  for (let ti = 0; ti < contourPolys.length; ti++) {
    const contour = contourPolys[ti];
    const low = contour.value;
    const high = ti + 1 < contourPolys.length ? contourPolys[ti + 1].value : maxZ;
    const mid = (low + Math.min(high, maxZ)) / 2;

    const lonLatCoords: Position[][][] = contour.coordinates.map((poly) =>
      poly.map((ring) => ring.map(([gx, gy]) => gridToLonLat(gx, gy))),
    );

    if (lonLatCoords.length > 0) {
      bandFeatures.push({
        type: "Feature",
        properties: {
          lowFt: low,
          highFt: high,
          midFt: mid,
          fill: elevationToColor((mid - minZ) / span),
        },
        geometry: { type: "MultiPolygon", coordinates: lonLatCoords },
      });
    }

    // Isolines: ring segments not riding the coverage edge.
    for (const poly of contour.coordinates) {
      for (const ring of poly) {
        let current: Position[] = [];
        for (const [gx, gy] of ring) {
          if (hasNaNNear(gx, gy)) {
            if (current.length >= 2) {
              lineFeatures.push({
                type: "Feature",
                properties: { elevationFt: low, label: `${Math.round(low)} ft` },
                geometry: { type: "LineString", coordinates: current },
              });
            }
            current = [];
          } else {
            current.push(gridToLonLat(gx, gy));
          }
        }
        if (current.length >= 2) {
          lineFeatures.push({
            type: "Feature",
            properties: { elevationFt: low, label: `${Math.round(low)} ft` },
            geometry: { type: "LineString", coordinates: current },
          });
        }
      }
    }
  }

  return {
    bands: { type: "FeatureCollection", features: bandFeatures },
    lines: { type: "FeatureCollection", features: lineFeatures },
    thresholds,
  };
}
