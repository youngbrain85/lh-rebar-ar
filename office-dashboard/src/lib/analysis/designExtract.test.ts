import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractCenterline, rebarsFromGroups, splitByConnectivity } from "./designExtract";
import { parseObjGroups } from "./objFixture";
import type { Vec3 } from "./types";

describe("extractCenterline", () => {
  it("axis-aligned cylinder point cloud → endpoints at ±1 on Y, radius≈0.01", () => {
    const pts: Vec3[] = [];
    for (let i = 0; i <= 40; i++)
      for (let a = 0; a < 8; a++) {
        const th = (a / 8) * Math.PI * 2;
        pts.push([0.01 * Math.cos(th), -1 + (2 * i) / 40, 0.01 * Math.sin(th)]);
      }
    const { centerline, radius } = extractCenterline(pts);
    const ys = [centerline[0][1], centerline[1][1]].sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(-1, 2);
    expect(ys[1]).toBeCloseTo(1, 2);
    expect(radius).toBeCloseTo(0.01, 3);
  });
});

describe("bundled design model OBJ", () => {
  const objPath = resolve(__dirname, "../../../../source-models/highlighted_design_model.obj");
  const groups = parseObjGroups(readFileSync(objPath, "utf8"));

  it("parses 27 rebar groups", () => {
    expect(groups.length).toBe(27);
    expect(groups.filter((g) => g.name.includes("MISSING")).length).toBe(1);
  });
  it("extracts 27 rebars with sane geometry", () => {
    const rebars = rebarsFromGroups(groups);
    expect(rebars.length).toBe(27);
    for (const r of rebars) {
      const [a, b] = r.centerline;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      expect(len).toBeGreaterThan(0.1);   // 철근은 10cm 이상
      expect(r.radius).toBeGreaterThan(0.001);
      expect(r.radius).toBeLessThan(0.05); // 반경 1–50mm 범위
    }
  });
});

describe("splitByConnectivity", () => {
  it("two disjoint triangles → two components", () => {
    const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 5, 5, 6, 5, 5, 5, 6, 5];
    const index = [0, 1, 2, 3, 4, 5];
    const parts = splitByConnectivity(positions, index);
    expect(parts.length).toBe(2);
    expect(parts[0].length).toBe(3);
  });
});
