import { describe, expect, it } from "vitest";
import { createLocalProjection, type ElevationGrid } from "../elevation-merge";
import {
  computeResidual,
  detectTerraces,
  simplifyLine,
  smoothSurface,
  thinMask,
  traceSkeleton,
} from "../terrace-detect";

const LON0 = -95.644;
const LAT0 = 39.939;

/**
 * Synthetic terraced hillslope: 600m x 400m at 4m cells, 2% slope in +y,
 * three east-west terrace ridges (gaussian cross-section, 1.0 ft proud,
 * ~12 m half-width) at y = 80, 200, 320 m. Ridge crests meander slightly
 * in y as x varies, like real contour-built terraces.
 */
function syntheticTerracedGrid(): ElevationGrid {
  const cellSize = 4;
  const nx = 150; // 600 m
  const ny = 100; // 400 m
  const values = new Float64Array(nx * ny);
  const ridgeYs = [80, 200, 320];

  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = i * cellSize;
      const y = j * cellSize;
      let z = 1000 + 0.02 * y * 3.28084; // 2% slope, feet
      for (const ridgeY of ridgeYs) {
        const meander = 8 * Math.sin((x / 600) * Math.PI * 2);
        const dy = y - (ridgeY + meander);
        z += 1.0 * Math.exp(-(dy * dy) / (2 * 12 * 12));
      }
      values[j * nx + i] = z;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  return { x0: 0, y0: 0, cellSize, nx, ny, values, minZ, maxZ };
}

describe("smoothSurface", () => {
  it("preserves NaN cells and does not bleed into them", () => {
    const nx = 10;
    const ny = 10;
    const values = new Float64Array(nx * ny).fill(100);
    values[5 * nx + 5] = NaN;
    const smoothed = smoothSurface(values, nx, ny, 2);
    expect(Number.isNaN(smoothed[5 * nx + 5])).toBe(true);
    expect(smoothed[0]).toBeCloseTo(100, 6);
  });
});

describe("computeResidual", () => {
  it("isolates ridges from the hillslope trend", () => {
    const grid = syntheticTerracedGrid();
    const residual = computeResidual(grid, 60);

    // On a ridge crest (y=200m → j=50, mid-field x where meander≈0)
    const onRidge = residual[50 * grid.nx + 75];
    // Between ridges (y=140m → j=35)
    const offRidge = residual[35 * grid.nx + 75];

    expect(onRidge).toBeGreaterThan(0.4);
    expect(offRidge).toBeLessThan(0.15);
  });
});

describe("thinMask + traceSkeleton", () => {
  it("reduces a thick band to a single traced chain", () => {
    const nx = 40;
    const ny = 20;
    const mask = new Uint8Array(nx * ny);
    // 5-cell-thick horizontal band
    for (let j = 8; j <= 12; j++) {
      for (let i = 2; i < 38; i++) mask[j * nx + i] = 1;
    }
    const skeleton = thinMask(mask, nx, ny);
    const skeletonCount = skeleton.reduce((a, v) => a + v, 0);
    expect(skeletonCount).toBeLessThan(40); // thinned to ~1 cell wide
    expect(skeletonCount).toBeGreaterThan(25);

    const chains = traceSkeleton(skeleton, nx, ny);
    const longest = chains.reduce((a, c) => (c.length > a.length ? c : a), [] as number[]);
    expect(longest.length).toBeGreaterThan(25);
  });
});

describe("simplifyLine", () => {
  it("collapses collinear points and keeps corners", () => {
    const line: [number, number][] = [
      [0, 0],
      [10, 0.01],
      [20, 0],
      [20.01, 10],
      [20, 20],
    ];
    const simplified = simplifyLine(line, 0.5);
    expect(simplified.length).toBe(3);
    expect(simplified[0]).toEqual([0, 0]);
    expect(simplified[2]).toEqual([20, 20]);
  });
});

describe("detectTerraces", () => {
  it("finds the three synthetic terraces near their true positions", () => {
    const grid = syntheticTerracedGrid();
    const proj = createLocalProjection(LON0, LAT0);
    const terraces = detectTerraces(grid, proj, {
      trendRadiusM: 60,
      ridgeThresholdFt: 0.3,
      minLengthM: 100,
    });

    expect(terraces.length).toBeGreaterThanOrEqual(3);
    // The three longest should each span most of the field width
    for (const t of terraces.slice(0, 3)) {
      expect(t.lengthM).toBeGreaterThan(400);
      expect(t.meanResidualFt).toBeGreaterThan(0.3);
    }

    // Each true ridge should have a detected polyline passing within 12 m of
    // its mid-field crest point (segment distance — simplification may leave
    // no vertex near the probe x).
    const distToSegment = (
      p: [number, number],
      a: [number, number],
      b: [number, number],
    ): number => {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const lengthSq = dx * dx + dy * dy;
      const t =
        lengthSq === 0
          ? 0
          : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq));
      return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
    };

    const ridgeYs = [80, 200, 320];
    for (const ridgeY of ridgeYs) {
      const probe: [number, number] = [300, ridgeY];
      const hits = terraces.filter((t) => {
        const local = t.coordinates.map(([lon, lat]) => proj.toLocal(lon, lat));
        for (let i = 1; i < local.length; i++) {
          if (distToSegment(probe, local[i - 1], local[i]) < 12) return true;
        }
        return false;
      });
      expect(hits.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("returns nothing on a smooth slope with no terraces", () => {
    const cellSize = 4;
    const nx = 100;
    const ny = 80;
    const values = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        values[j * nx + i] = 1000 + 0.05 * j * cellSize;
      }
    }
    const grid: ElevationGrid = {
      x0: 0,
      y0: 0,
      cellSize,
      nx,
      ny,
      values,
      minZ: 1000,
      maxZ: 1000 + 0.05 * ny * cellSize,
    };
    const proj = createLocalProjection(LON0, LAT0);
    expect(detectTerraces(grid, proj)).toHaveLength(0);
  });

  it("handles an empty grid", () => {
    const proj = createLocalProjection(LON0, LAT0);
    const grid: ElevationGrid = {
      x0: 0,
      y0: 0,
      cellSize: 4,
      nx: 0,
      ny: 0,
      values: new Float64Array(0),
      minZ: 0,
      maxZ: 0,
    };
    expect(detectTerraces(grid, proj)).toHaveLength(0);
  });
});
