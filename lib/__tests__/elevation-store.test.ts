import { describe, expect, it } from "vitest";
import { buildGrid, createLocalProjection } from "../elevation-merge";
import { deserializeGrid, serializeGrid } from "../elevation-store";

describe("grid serialization", () => {
  it("round-trips a grid through jsonb shape with 0.01 ft precision", () => {
    const proj = createLocalProjection(-95.644, 39.939);
    const points = [];
    for (let y = 0; y <= 60; y += 5) {
      for (let x = 0; x <= 60; x += 5) {
        points.push({ x, y, z: 1000 + 0.013 * x + 0.027 * y });
      }
    }
    const grid = buildGrid(points, 4, 12);

    const serialized = serializeGrid(grid, proj);
    expect(serialized.lon0).toBe(-95.644);
    expect(serialized.values).toHaveLength(grid.values.length);

    const { grid: restored, proj: restoredProj } = deserializeGrid(serialized);
    expect(restored.nx).toBe(grid.nx);
    expect(restored.ny).toBe(grid.ny);
    expect(restored.cellSize).toBe(grid.cellSize);
    expect(restored.minZ).toBeCloseTo(grid.minZ, 1);
    expect(restored.maxZ).toBeCloseTo(grid.maxZ, 1);
    expect(restoredProj.lat0).toBe(proj.lat0);

    // Values match within rounding; NaN coverage mask survives
    for (let i = 0; i < grid.values.length; i++) {
      if (Number.isNaN(grid.values[i])) {
        expect(Number.isNaN(restored.values[i])).toBe(true);
      } else {
        expect(restored.values[i]).toBeCloseTo(grid.values[i], 2);
      }
    }
  });

  it("serializes NaN cells as null", () => {
    const proj = createLocalProjection(-95.644, 39.939);
    // Two distant clusters guarantee uncovered cells between them
    const points = [
      { x: 0, y: 0, z: 1000 },
      { x: 0, y: 4, z: 1000 },
      { x: 200, y: 200, z: 1010 },
      { x: 200, y: 204, z: 1010 },
    ];
    const grid = buildGrid(points, 4, 12);
    const serialized = serializeGrid(grid, proj);
    expect(serialized.values.some((v) => v === null)).toBe(true);
  });
});
