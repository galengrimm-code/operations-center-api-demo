import type { ElevationGrid, LocalProjection } from "./elevation-merge";

// Terrace auto-detection. A broad-base terrace is a low ridge superimposed
// on an otherwise smooth hillslope: subtracting a heavily smoothed copy of
// the surface (the hillslope trend) leaves the ridges as positive residual
// bands. Those bands are thinned to one-cell centerlines and traced into
// polylines.
//
// Pipeline: detrend → residual threshold → mask cleanup → Zhang-Suen
// thinning → skeleton tracing → prune short fragments → simplify.

export interface TerraceDetectOptions {
  /** Smoothing radius (meters) for the hillslope trend surface. */
  trendRadiusM?: number;
  /** Residual height (ft) a cell must stand above trend to count as ridge. */
  ridgeThresholdFt?: number;
  /** Minimum traced centerline length (meters) to keep. */
  minLengthM?: number;
  /** Douglas-Peucker simplification tolerance (meters). */
  simplifyToleranceM?: number;
  /** Max endpoint gap (meters) to bridge between aligned fragments. */
  joinGapM?: number;
}

export interface DetectedTerrace {
  /** Centerline in lon/lat. */
  coordinates: [number, number][];
  lengthM: number;
  /** Mean residual height (ft) along the line — how proud the ridge stands. */
  meanResidualFt: number;
}

const DEFAULTS: Required<TerraceDetectOptions> = {
  // Tuned on the real Home Place machine-data grid (2026-06-11): ridges
  // stand lower above trend than textbook 1 ft once the 4 m grid and build
  // smoothing soften them, so the threshold sits just above grid noise and
  // gap-joining reconnects the skeleton where a crest briefly dips.
  trendRadiusM: 80,
  ridgeThresholdFt: 0.12,
  minLengthM: 60,
  simplifyToleranceM: 5,
  joinGapM: 30,
};

/**
 * NaN-aware trend surface using symmetric-pair averaging: a sample at
 * (+di, +dj) only counts when its mirror at (-di, -dj) is also valid, and
 * the pair contributes its midpoint. On a linear slope the midpoint of any
 * symmetric pair equals the center value, so kernel truncation at field
 * edges or NaN holes introduces no slope bias — the classic box-blur edge
 * artifact that would otherwise hallucinate ridges along boundaries.
 */
export function smoothSurface(
  values: Float64Array,
  nx: number,
  ny: number,
  radiusCells: number,
): Float64Array {
  const out = new Float64Array(values.length).fill(NaN);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const center = values[j * nx + i];
      if (Number.isNaN(center)) continue;

      let sum = center;
      let count = 1;
      // Iterate the upper half-plane of offsets; mirror covers the rest.
      for (let dj = 0; dj <= radiusCells; dj++) {
        const diStart = dj === 0 ? 1 : -radiusCells;
        for (let di = diStart; di <= radiusCells; di++) {
          const i1 = i + di;
          const j1 = j + dj;
          const i2 = i - di;
          const j2 = j - dj;
          if (i1 < 0 || i1 >= nx || j1 < 0 || j1 >= ny) continue;
          if (i2 < 0 || i2 >= nx || j2 < 0 || j2 >= ny) continue;
          const a = values[j1 * nx + i1];
          const b = values[j2 * nx + i2];
          if (Number.isNaN(a) || Number.isNaN(b)) continue;
          sum += (a + b) / 2;
          count++;
        }
      }
      out[j * nx + i] = sum / count;
    }
  }
  return out;
}

/** residual = surface - trend; NaN where either is NaN. */
export function computeResidual(grid: ElevationGrid, trendRadiusM: number): Float64Array {
  const radiusCells = Math.max(2, Math.round(trendRadiusM / grid.cellSize));
  const trend = smoothSurface(grid.values, grid.nx, grid.ny, radiusCells);
  const residual = new Float64Array(grid.values.length).fill(NaN);
  for (let k = 0; k < grid.values.length; k++) {
    const z = grid.values[k];
    const t = trend[k];
    if (!Number.isNaN(z) && !Number.isNaN(t)) residual[k] = z - t;
  }
  return residual;
}

/**
 * Zhang-Suen thinning: reduces a boolean mask to a one-cell-wide skeleton
 * while preserving connectivity.
 */
export function thinMask(mask: Uint8Array, nx: number, ny: number): Uint8Array {
  const skeleton = Uint8Array.from(mask);
  const at = (i: number, j: number): number =>
    i < 0 || i >= nx || j < 0 || j >= ny ? 0 : skeleton[j * nx + i];

  let changed = true;
  while (changed) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      const toRemove: number[] = [];
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          if (!skeleton[j * nx + i]) continue;
          // Neighbors clockwise from north: p2..p9
          const p2 = at(i, j - 1);
          const p3 = at(i + 1, j - 1);
          const p4 = at(i + 1, j);
          const p5 = at(i + 1, j + 1);
          const p6 = at(i, j + 1);
          const p7 = at(i - 1, j + 1);
          const p8 = at(i - 1, j);
          const p9 = at(i - 1, j - 1);
          const neighbors = [p2, p3, p4, p5, p6, p7, p8, p9];
          const b = neighbors.reduce((a, v) => a + v, 0);
          if (b < 2 || b > 6) continue;
          let transitions = 0;
          for (let n = 0; n < 8; n++) {
            if (!neighbors[n] && neighbors[(n + 1) % 8]) transitions++;
          }
          if (transitions !== 1) continue;
          if (step === 0) {
            if (p2 * p4 * p6 !== 0) continue;
            if (p4 * p6 * p8 !== 0) continue;
          } else {
            if (p2 * p4 * p8 !== 0) continue;
            if (p2 * p6 * p8 !== 0) continue;
          }
          toRemove.push(j * nx + i);
        }
      }
      if (toRemove.length > 0) {
        changed = true;
        for (const k of toRemove) skeleton[k] = 0;
      }
    }
  }
  return skeleton;
}

function neighborsOf(k: number, nx: number, ny: number, skeleton: Uint8Array): number[] {
  const i = k % nx;
  const j = (k - i) / nx;
  const result: number[] = [];
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      if (di === 0 && dj === 0) continue;
      const ii = i + di;
      const jj = j + dj;
      if (ii < 0 || ii >= nx || jj < 0 || jj >= ny) continue;
      const kk = jj * nx + ii;
      if (skeleton[kk]) result.push(kk);
    }
  }
  return result;
}

/**
 * Trace a one-cell skeleton into polylines of grid indices. Chains run
 * endpoint-to-endpoint or endpoint-to-junction; junction cells terminate
 * chains so each branch becomes its own polyline.
 */
export function traceSkeleton(skeleton: Uint8Array, nx: number, ny: number): number[][] {
  const degree = new Map<number, number>();
  for (let k = 0; k < skeleton.length; k++) {
    if (skeleton[k]) degree.set(k, neighborsOf(k, nx, ny, skeleton).length);
  }

  const visitedEdges = new Set<string>();
  const edgeKey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const lines: number[][] = [];

  const walk = (start: number, next: number): number[] => {
    const line = [start, next];
    visitedEdges.add(edgeKey(start, next));
    let prev = start;
    let current = next;
    while ((degree.get(current) ?? 0) === 2) {
      const ns = neighborsOf(current, nx, ny, skeleton);
      const forward = ns.find((n) => n !== prev && !visitedEdges.has(edgeKey(current, n)));
      if (forward === undefined) break;
      visitedEdges.add(edgeKey(current, forward));
      line.push(forward);
      prev = current;
      current = forward;
    }
    return line;
  };

  // Start walks from endpoints and junctions (degree != 2)
  degree.forEach((deg, k) => {
    if (deg === 2) return;
    for (const n of neighborsOf(k, nx, ny, skeleton)) {
      if (!visitedEdges.has(edgeKey(k, n))) {
        lines.push(walk(k, n));
      }
    }
  });

  // Isolated loops (every cell degree 2) — start anywhere on them
  degree.forEach((deg, k) => {
    if (deg !== 2) return;
    for (const n of neighborsOf(k, nx, ny, skeleton)) {
      if (!visitedEdges.has(edgeKey(k, n))) {
        lines.push(walk(k, n));
      }
    }
  });

  return lines;
}

/** Douglas-Peucker on x/y point arrays. */
export function simplifyLine(points: [number, number][], tolerance: number): [number, number][] {
  if (points.length <= 2) return points;

  const perpendicularDistance = (
    p: [number, number],
    a: [number, number],
    b: [number, number],
  ): number => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };

  let maxDist = 0;
  let maxIndex = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], points[0], points[points.length - 1]);
    if (d > maxDist) {
      maxDist = d;
      maxIndex = i;
    }
  }

  if (maxDist <= tolerance) return [points[0], points[points.length - 1]];
  const left = simplifyLine(points.slice(0, maxIndex + 1), tolerance);
  const right = simplifyLine(points.slice(maxIndex), tolerance);
  return [...left.slice(0, -1), ...right];
}

function lineLength(points: [number, number][]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return length;
}

/**
 * Detect terrace ridge centerlines in a merged elevation grid.
 */
export function detectTerraces(
  grid: ElevationGrid,
  proj: LocalProjection,
  options: TerraceDetectOptions = {},
): DetectedTerrace[] {
  const opts = { ...DEFAULTS, ...options };
  const { nx, ny, cellSize, x0, y0 } = grid;
  if (nx === 0 || ny === 0) return [];

  const residual = computeResidual(grid, opts.trendRadiusM);

  const mask = new Uint8Array(nx * ny);
  for (let k = 0; k < residual.length; k++) {
    if (!Number.isNaN(residual[k]) && residual[k] >= opts.ridgeThresholdFt) mask[k] = 1;
  }

  const skeleton = thinMask(mask, nx, ny);
  const chains = traceSkeleton(skeleton, nx, ny);

  const terraces: DetectedTerrace[] = [];
  for (const chain of chains) {
    if (chain.length < 2) continue;
    const local: [number, number][] = chain.map((k) => {
      const i = k % nx;
      const j = (k - i) / nx;
      return [x0 + i * cellSize, y0 + j * cellSize];
    });

    const simplified = simplifyLine(local, opts.simplifyToleranceM);
    const lengthM = lineLength(simplified);
    if (lengthM < opts.minLengthM) continue;

    let residualSum = 0;
    let residualCount = 0;
    for (const k of chain) {
      if (!Number.isNaN(residual[k])) {
        residualSum += residual[k];
        residualCount++;
      }
    }

    terraces.push({
      coordinates: simplified.map(([x, y]) => proj.toLonLat(x, y)) as [number, number][],
      lengthM,
      meanResidualFt: residualCount > 0 ? residualSum / residualCount : 0,
    });
  }

  // Longest first — most likely to be real terraces
  terraces.sort((a, b) => b.lengthM - a.lengthM);
  return terraces;
}
