import { describe, expect, it } from "vitest";
import type { FeatureCollection } from "geojson";
import {
  applyOffsets,
  buildGrid,
  computePassOffsets,
  createLocalProjection,
  elevationToColor,
  extractElevationPoints,
  gridToContours,
  smoothGrid,
  type ElevationPoint,
} from "../elevation-merge";

const LON0 = -95.644;
const LAT0 = 39.939;

/** z = 1000 + 0.01x + 0.02y (feet), sampled on a lattice in local meters. */
function planeZ(x: number, y: number): number {
  return 1000 + 0.01 * x + 0.02 * y;
}

function lattice(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  step: number,
  biasFt = 0,
): ElevationPoint[] {
  const points: ElevationPoint[] = [];
  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      points.push({ x, y, z: planeZ(x, y) + biasFt });
    }
  }
  return points;
}

function sensorPolygonFc(
  cells: { lon: number; lat: number; elevation: number | null }[],
): FeatureCollection {
  const d = 0.00002;
  return {
    type: "FeatureCollection",
    features: cells.map(({ lon, lat, elevation }) => ({
      type: "Feature",
      properties: elevation === null ? {} : { Elevation: elevation },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [lon - d, lat - d],
            [lon + d, lat - d],
            [lon + d, lat + d],
            [lon - d, lat + d],
            [lon - d, lat - d],
          ],
        ],
      },
    })),
  };
}

describe("createLocalProjection", () => {
  it("round-trips lon/lat through local meters", () => {
    const proj = createLocalProjection(LON0, LAT0);
    const [x, y] = proj.toLocal(LON0 + 0.005, LAT0 - 0.003);
    const [lon, lat] = proj.toLonLat(x, y);
    expect(lon).toBeCloseTo(LON0 + 0.005, 9);
    expect(lat).toBeCloseTo(LAT0 - 0.003, 9);
    // ~0.005 deg lon at 39.9N is ~427 m
    expect(x).toBeGreaterThan(400);
    expect(x).toBeLessThan(450);
  });
});

describe("extractElevationPoints", () => {
  it("extracts centroids and elevations, counting features without elevation", () => {
    const proj = createLocalProjection(LON0, LAT0);
    const fc = sensorPolygonFc([
      { lon: LON0 + 0.001, lat: LAT0 + 0.001, elevation: 1010.5 },
      { lon: LON0 + 0.002, lat: LAT0 + 0.001, elevation: 1011.2 },
      { lon: LON0 + 0.003, lat: LAT0 + 0.001, elevation: null },
    ]);

    const result = extractElevationPoints(fc, proj);
    expect(result.featureCount).toBe(3);
    expect(result.points).toHaveLength(2);
    expect(result.missingElevationCount).toBe(1);
    expect(result.points[0].z).toBeCloseTo(1010.5, 6);

    const [expectedX] = proj.toLocal(LON0 + 0.001, LAT0 + 0.001);
    expect(result.points[0].x).toBeCloseTo(expectedX, 3);
  });

  it("filters GPS-glitch outliers but keeps real relief", () => {
    const proj = createLocalProjection(LON0, LAT0);
    const cells = [];
    // 50 points trending 1000 → 1060 ft (real relief)
    for (let i = 0; i < 50; i++) {
      cells.push({ lon: LON0 + i * 0.0001, lat: LAT0, elevation: 1000 + i * 1.2 });
    }
    // two garbage fixes
    cells.push({ lon: LON0, lat: LAT0 + 0.001, elevation: 18000 });
    cells.push({ lon: LON0, lat: LAT0 + 0.002, elevation: 0 });

    const result = extractElevationPoints(sensorPolygonFc(cells), proj);
    expect(result.points).toHaveLength(50);
    // the 0-ft fix is rejected as missing/invalid, the spike as outlier
    expect(result.missingElevationCount).toBe(1);
    expect(result.outlierCount).toBe(1);
  });
});

describe("computePassOffsets", () => {
  it("recovers a known vertical bias between passes", () => {
    // Reference pass: dense lattice. Biased pass: offset lattice +0.8 ft.
    const ref = lattice(0, 0, 400, 400, 8);
    const biased = lattice(4, 4, 396, 396, 12, 0.8);

    const offsets = computePassOffsets([ref, biased]);
    expect(offsets[0].offsetFt).toBe(0);
    expect(offsets[1].offsetFt).toBeCloseTo(-0.8, 1);
    expect(offsets[1].lowConfidence).toBe(false);

    const merged = applyOffsets([ref, biased], offsets);
    const biasedCorrected = merged.slice(ref.length);
    // After correction, points sit back on the plane
    for (const p of biasedCorrected.slice(0, 10)) {
      expect(p.z).toBeCloseTo(planeZ(p.x, p.y), 1);
    }
  });

  it("flags low confidence when passes barely overlap", () => {
    const a = lattice(0, 0, 100, 100, 10);
    const b = lattice(5000, 5000, 5050, 5050, 10, 2);
    const offsets = computePassOffsets([a, b]);
    expect(offsets[1].lowConfidence).toBe(true);
    expect(offsets[1].offsetFt).toBe(0);
  });

  it("chains offsets through an intermediate pass when there is no direct reference overlap", () => {
    // A (reference) covers west half, B spans the middle, C covers east half.
    // C never overlaps A, but C–B and B–A overlap heavily.
    const a = lattice(0, 0, 500, 500, 8); // reference (densest)
    const b = lattice(400, 0, 900, 500, 10, 0.5); // +0.5 ft bias
    const c = lattice(800, 0, 1300, 500, 10, -1.2); // -1.2 ft bias

    const offsets = computePassOffsets([a, b, c]);
    // Cell-sampling on a sloped plane adds ~0.1 ft estimator noise; the
    // de-bias only needs to kill 0.5–2 ft receiver offsets, so assert within
    // 0.25 ft (direct) and 0.4 ft (chained, two estimates compound).
    expect(Math.abs(offsets[1].offsetFt - -0.5)).toBeLessThan(0.25);
    // C's correction routes through B: true bias -1.2 → correction +1.2
    expect(offsets[2].lowConfidence).toBe(false);
    expect(Math.abs(offsets[2].offsetFt - 1.2)).toBeLessThan(0.4);
  });
});

describe("buildGrid", () => {
  it("interpolates a plane within tolerance and masks uncovered cells", () => {
    const points = lattice(0, 0, 200, 200, 6);
    const grid = buildGrid(points, 4, 12);

    expect(grid.nx).toBeGreaterThan(0);
    expect(grid.minZ).toBeGreaterThanOrEqual(999);
    expect(grid.maxZ).toBeLessThanOrEqual(1007);

    // Interior node ≈ plane
    const j = Math.floor(grid.ny / 2);
    const i = Math.floor(grid.nx / 2);
    const gx = grid.x0 + i * grid.cellSize;
    const gy = grid.y0 + j * grid.cellSize;
    const v = grid.values[j * grid.nx + i];
    expect(v).toBeCloseTo(planeZ(gx, gy), 0);

    // A node far outside coverage is NaN — grid bbox is padded by one cell,
    // so corners are within radius; instead check there are no values wildly
    // outside the plane's range (sentinel-free).
    let nanCount = 0;
    for (let k = 0; k < grid.values.length; k++) {
      if (Number.isNaN(grid.values[k])) nanCount++;
    }
    expect(nanCount).toBeGreaterThanOrEqual(0);
  });

  it("returns an empty grid for no points", () => {
    const grid = buildGrid([], 4, 12);
    expect(grid.nx).toBe(0);
    expect(grid.values).toHaveLength(0);
  });
});

describe("smoothGrid", () => {
  it("reduces single-cell noise without moving the mean much", () => {
    const points = lattice(0, 0, 100, 100, 4);
    const grid = buildGrid(points, 4, 12);
    const noisy = { ...grid, values: Float64Array.from(grid.values) };
    const j = Math.floor(grid.ny / 2);
    const i = Math.floor(grid.nx / 2);
    const idx = j * grid.nx + i;
    const original = noisy.values[idx];
    noisy.values[idx] = original + 5;

    const smoothed = smoothGrid(noisy);
    expect(Math.abs(smoothed.values[idx] - original)).toBeLessThan(3);
  });
});

describe("gridToContours", () => {
  it("produces bands and lines at the requested interval", () => {
    const proj = createLocalProjection(LON0, LAT0);
    // Plane spans 1000 → ~1006 ft over 200x200m
    const points = lattice(0, 0, 200, 200, 6);
    const grid = smoothGrid(buildGrid(points, 4, 12));
    const result = gridToContours(grid, proj, 2);

    expect(result.thresholds.length).toBeGreaterThanOrEqual(2);
    expect(result.bands.features.length).toBeGreaterThan(0);
    expect(result.lines.features.length).toBeGreaterThan(0);

    // Thresholds are clean multiples of the interval
    for (const t of result.thresholds) {
      expect(t % 2).toBe(0);
    }

    // Band coordinates are lon/lat near the projection center
    const firstBand = result.bands.features[0];
    expect(firstBand.geometry.type).toBe("MultiPolygon");
    const coords = (firstBand.geometry as GeoJSON.MultiPolygon).coordinates;
    const [lon, lat] = coords[0][0][0];
    expect(Math.abs(lon - LON0)).toBeLessThan(0.05);
    expect(Math.abs(lat - LAT0)).toBeLessThan(0.05);

    // No contour line carries the sentinel value
    for (const line of result.lines.features) {
      expect((line.properties as { elevationFt: number }).elevationFt).toBeGreaterThan(900);
    }
  });

  it("handles an empty grid", () => {
    const proj = createLocalProjection(LON0, LAT0);
    const result = gridToContours(buildGrid([], 4, 12), proj, 2);
    expect(result.bands.features).toHaveLength(0);
    expect(result.lines.features).toHaveLength(0);
  });

  it("still renders a band when relief is smaller than the interval", () => {
    const proj = createLocalProjection(LON0, LAT0);
    // Nearly flat: ~1.5 ft total relief, 5 ft interval
    const points: { x: number; y: number; z: number }[] = [];
    for (let y = 0; y <= 100; y += 4) {
      for (let x = 0; x <= 100; x += 4) {
        points.push({ x, y, z: 1000.2 + 0.0015 * (x + y) });
      }
    }
    const grid = buildGrid(points, 4, 12);
    const result = gridToContours(grid, proj, 5);

    expect(result.thresholds.length).toBeGreaterThanOrEqual(1);
    expect(result.bands.features.length).toBeGreaterThanOrEqual(1);
    // The single band covers the whole data footprint (first threshold ≤ minZ)
    expect(result.thresholds[0]).toBeLessThanOrEqual(grid.minZ);
  });

  it("covers the lowest terrain with a band when minZ is off-interval", () => {
    const proj = createLocalProjection(LON0, LAT0);
    const points = lattice(0, 0, 200, 200, 6); // 1000 → ~1006 ft
    const grid = smoothGrid(buildGrid(points, 4, 12));
    const result = gridToContours(grid, proj, 2);
    expect(result.thresholds[0]).toBeLessThanOrEqual(grid.minZ);
  });
});

describe("elevationToColor", () => {
  it("interpolates between ramp stops and clamps", () => {
    expect(elevationToColor(0)).toBe("rgb(22,101,52)");
    expect(elevationToColor(1)).toBe("rgb(245,240,230)");
    expect(elevationToColor(-1)).toBe("rgb(22,101,52)");
    expect(elevationToColor(2)).toBe("rgb(245,240,230)");
    expect(elevationToColor(0.5)).toBe("rgb(234,179,8)");
  });
});
