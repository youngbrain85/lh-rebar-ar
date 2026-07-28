import { describe, expect, it } from "vitest";
import { applyMat4 } from "./geom";
import { coarseCost, coarseRegister, isDegenerate } from "./registration";
import { jitterRebars, makeWallGrid, rigidMat4, transformRebars } from "./testFixtures";
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
