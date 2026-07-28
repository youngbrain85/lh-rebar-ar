import { describe, expect, it } from "vitest";
import { applyMat4 } from "./geom";
import { coarseCost, coarseRegister, isDegenerate, icpRefine, registerScan } from "./registration";
import { jitterRebars, makeWallGrid, offsetRebar, rigidMat4, transformRebars } from "./testFixtures";
import type { Rebar } from "./types";

describe("coarseRegister", () => {
  // 4가지 요 각도(플립 후보를 강제로 밟는 각도들 포함) 전수
  for (const yaw of [0, 30, 90, 170]) {
    it(`recovers yaw=${yaw}° + translation to <20mm cost`, () => {
      const design = makeWallGrid();
      const scan = transformRebars(design, rigidMat4(yaw, [1.2, 0.4, -0.8]));
      const m = coarseRegister(scan, design);
      expect(coarseCost(scan, design, m)).toBeLessThan(0.02);
    });
  }
  it("works with 2mm noise", () => {
    const design = makeWallGrid();
    const scan = jitterRebars(transformRebars(design, rigidMat4(45, [0.5, -0.2, 0.3])), 0.002, 7);
    const m = coarseRegister(scan, design);
    expect(coarseCost(scan, design, m)).toBeLessThan(0.03);
  });
  it("asymmetric grid still registers (flip discrimination exercised)", () => {
    const design = offsetRebar(makeWallGrid(), "d-v-outer-0", [0, 0.4, 0]);
    const scan = transformRebars(design, rigidMat4(90, [1.2, 0.4, -0.8]));
    const m = coarseRegister(scan, design);
    expect(coarseCost(scan, design, m)).toBeLessThan(0.02);
  });
});

describe("isDegenerate", () => {
  it("single straight bar is degenerate", () => {
    const one: Rebar[] = [{ id: "a", radius: 0.008, centerline: [[0, 0, 0], [0, 1, 0], [0, 2, 0]] }];
    expect(isDegenerate(one)).toBe(true);
  });
  it("full grid is not", () => {
    expect(isDegenerate(makeWallGrid())).toBe(false);
  });
});

describe("icpRefine + registerScan", () => {
  it("recovers exact transform to <1mm RMS (noiseless)", () => {
    const design = makeWallGrid();
    const scan = transformRebars(design, rigidMat4(30, [1.2, 0.4, -0.8]));
    const { rmsMm } = icpRefine(scan, design, coarseRegister(scan, design));
    expect(rmsMm).toBeLessThan(1);
  });
  it("with 2mm noise converges to RMS < 5mm", () => {
    const design = makeWallGrid();
    const scan = jitterRebars(transformRebars(design, rigidMat4(60, [0.3, 0.1, -0.5])), 0.002, 3);
    const r = registerScan(scan, design);
    expect(r.failed).toBe(false);
    expect(r.method).toBe("auto");
    expect(r.rmsMm).toBeLessThan(5);
  });
  it("verifies recovered points land on design (round-trip <2mm)", () => {
    const design = offsetRebar(makeWallGrid(), "d-v-outer-0", [0, 0.4, 0]);
    const scan = transformRebars(design, rigidMat4(45, [2, -1, 0.7]));
    const { matrix } = icpRefine(scan, design, coarseRegister(scan, design));
    const p = applyMat4(matrix, scan[5].centerline[0]);
    const q = design[5].centerline[0];
    expect(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])).toBeLessThan(0.002);
  });
  it("degenerate input reports failed", () => {
    const one = makeWallGrid().slice(0, 1);
    const r = registerScan(one, makeWallGrid());
    expect(r.failed).toBe(true);
  });
  it("manualInit is honored and reported", () => {
    const design = makeWallGrid();
    const scan = transformRebars(design, rigidMat4(20, [0.5, 0, 0]));
    const init = coarseRegister(scan, design);
    const r = registerScan(scan, design, init);
    expect(r.method).toBe("manual");
    expect(r.rmsMm).toBeLessThan(1);
  });
});
