import { describe, expect, it } from "vitest";
import { jitterRebars, makeWallGrid, offsetRebar, rigidMat4, transformRebars } from "./testFixtures";

describe("makeWallGrid", () => {
  it("default grid has (7+5)*2 = 24 rebars", () => {
    expect(makeWallGrid().length).toBe(24);
  });
  it("vertical bars run along Y", () => {
    const v = makeWallGrid().find((r) => r.id === "d-v-outer-0")!;
    const [a, b] = [v.centerline[0], v.centerline[v.centerline.length - 1]];
    expect(Math.abs(b[1] - a[1])).toBeCloseTo(2, 6);
    expect(Math.abs(b[0] - a[0])).toBeLessThan(1e-9);
  });
});

describe("transform/jitter/offset", () => {
  it("rigid transform is recoverable: distances preserved", () => {
    const g = makeWallGrid();
    const t = transformRebars(g, rigidMat4(30, [1.2, 0.4, -0.8]));
    const d0 = Math.hypot(
      g[0].centerline[0][0] - g[1].centerline[0][0],
      g[0].centerline[0][1] - g[1].centerline[0][1],
      g[0].centerline[0][2] - g[1].centerline[0][2],
    );
    const d1 = Math.hypot(
      t[0].centerline[0][0] - t[1].centerline[0][0],
      t[0].centerline[0][1] - t[1].centerline[0][1],
      t[0].centerline[0][2] - t[1].centerline[0][2],
    );
    expect(d1).toBeCloseTo(d0, 8);
  });
  it("jitter is deterministic per seed and bounded", () => {
    const g = makeWallGrid();
    const j1 = jitterRebars(g, 0.002, 42);
    const j2 = jitterRebars(g, 0.002, 42);
    expect(j1[3].centerline[0]).toEqual(j2[3].centerline[0]);
    const d = Math.abs(j1[0].centerline[0][0] - g[0].centerline[0][0]);
    expect(d).toBeLessThan(0.01);
  });
  it("offsetRebar moves only the target", () => {
    const g = makeWallGrid();
    const o = offsetRebar(g, "d-v-outer-2", [0.015, 0, 0]);
    expect(o.find((r) => r.id === "d-v-outer-2")!.centerline[0][0]).toBeCloseTo(
      g.find((r) => r.id === "d-v-outer-2")!.centerline[0][0] + 0.015, 9);
    expect(o.find((r) => r.id === "d-v-outer-0")!.centerline[0][0]).toBeCloseTo(
      g.find((r) => r.id === "d-v-outer-0")!.centerline[0][0], 9);
  });
});
