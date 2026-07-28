import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractCenterline, rebarsFromGroups, rebarsFromMeshes, splitByConnectivity,
} from "./designExtract";
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

describe("rebarsFromMeshes", () => {
  // 가느다란 막대(길이 1m, 반경 ~5mm) 하나를 삼각형 2개짜리 미니 메시로 표현
  const bar = (ox: number, oz: number, base: number) => ({
    positions: [
      ox, 0, oz, ox + 0.005, 0, oz, ox, 1, oz,
      ox + 0.005, 1, oz + 0.005,
    ].flat(),
    index: [base + 0, base + 1, base + 2, base + 1, base + 3, base + 2].map((i) => i - base),
  });

  it("splits a rebar-set mesh into per-bar components with #k ids", () => {
    // 한 명명 메시 안에 서로 떨어진 막대 2개 (Revit 세트 시뮬레이션)
    const b1 = bar(0, 0, 0);
    const b2 = bar(0.3, 0, 0);
    const mesh = {
      name: "Rebar_Set",
      positions: [...b1.positions, ...b2.positions],
      index: [...b1.index, ...b2.index.map((i) => i + 4)],
    };
    const rebars = rebarsFromMeshes([mesh]);
    expect(rebars.length).toBe(2);
    expect(rebars.map((r) => r.id).sort()).toEqual(["Rebar_Set#0", "Rebar_Set#1"]);
    for (const r of rebars) {
      const [a, b] = r.centerline;
      expect(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])).toBeGreaterThan(0.9);
      expect(r.radius).toBeLessThan(0.05);
    }
  });

  it("keeps the bare name for single-component groups", () => {
    const rebars = rebarsFromMeshes([{ name: "rebar_0_PASS", ...bar(0, 0, 0) }]);
    expect(rebars.length).toBe(1);
    expect(rebars[0].id).toBe("rebar_0_PASS");
  });

  it("filters out fat (wall-like) and short components", () => {
    // 벽: 1m x 1m x 0.28m 박스 꼭짓점(반경이 maxRadius를 초과)
    const wall = {
      name: "Basic_Wall",
      positions: [
        0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
        0, 0, 0.28, 1, 0, 0.28, 1, 1, 0.28, 0, 1, 0.28,
      ],
      index: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4],
    };
    const stub = { name: "stub", positions: [0, 0, 0, 0.005, 0, 0, 0, 0.05, 0], index: [0, 1, 2] };
    const rebars = rebarsFromMeshes([wall, stub, { name: "bar", ...bar(0, 0, 0) }]);
    expect(rebars.map((r) => r.id)).toEqual(["bar"]);
  });

  it("bundled OBJ groups (no index) still yield 27 bare-named rebars", () => {
    const objPath = resolve(__dirname, "../../../../source-models/highlighted_design_model.obj");
    const groups = parseObjGroups(readFileSync(objPath, "utf8"));
    const rebars = rebarsFromMeshes(
      groups.map((g) => ({ name: g.name, positions: g.vertices.flat(), index: null })),
    );
    expect(rebars.length).toBe(27);
    expect(rebars.every((r) => !r.id.includes("#"))).toBe(true);
  });
});
