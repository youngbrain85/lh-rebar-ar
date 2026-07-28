import { describe, expect, it } from "vitest";
import {
  applyMat4, jacobiEigen, mat4FromRotTrans, mat4Identity, mat4Multiply,
  pca, pointToPolyline, pointToSegment, polylineDistance, samplePolyline,
} from "./geom";
import type { Vec3 } from "./types";

describe("pointToSegment", () => {
  it("perpendicular distance to segment interior", () => {
    expect(pointToSegment([0, 1, 0], [-1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 10);
  });
  it("clamps to endpoint outside segment range", () => {
    expect(pointToSegment([3, 4, 0], [-1, 0, 0], [1, 0, 0])).toBeCloseTo(Math.hypot(2, 4), 10);
  });
  it("degenerate zero-length segment = point distance", () => {
    expect(pointToSegment([0, 3, 4], [0, 0, 0], [0, 0, 0])).toBeCloseTo(5, 10);
  });
});

describe("samplePolyline", () => {
  it("uniform arc-length samples over a bent polyline", () => {
    const line: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0]]; // 길이 2
    const s = samplePolyline(line, 5);
    expect(s.length).toBe(5);
    expect(s[0]).toEqual([0, 0, 0]);
    expect(s[4]).toEqual([1, 1, 0]);
    expect(s[2][0]).toBeCloseTo(1, 10); // 중간점 = 꺾임점
    expect(s[2][1]).toBeCloseTo(0, 10);
  });
  it("n=1 returns midpoint-ish single sample (start)", () => {
    expect(samplePolyline([[0, 0, 0], [2, 0, 0]], 1).length).toBe(1);
  });
});

describe("polylineDistance", () => {
  it("two parallel lines offset by d have mean≈max≈d", () => {
    const a: Vec3[] = [[0, 0, 0], [1, 0, 0]];
    const b: Vec3[] = [[0, 0.05, 0], [1, 0.05, 0]];
    const { mean, max } = polylineDistance(a, b);
    expect(mean).toBeCloseTo(0.05, 6);
    expect(max).toBeCloseTo(0.05, 6);
  });
  it("is symmetric", () => {
    const a: Vec3[] = [[0, 0, 0], [1, 0, 0]];
    const b: Vec3[] = [[0, 0.02, 0], [2, 0.02, 0]]; // b가 더 김
    expect(polylineDistance(a, b).mean).toBeCloseTo(polylineDistance(b, a).mean, 10);
  });
});

describe("mat4", () => {
  it("identity leaves point unchanged", () => {
    expect(applyMat4(mat4Identity(), [1, 2, 3])).toEqual([1, 2, 3]);
  });
  it("rot+trans composes: 90° yaw then translate", () => {
    // Y축(up) 기준 +90°: x→-z, z→x (row-major R)
    const r = [0, 0, 1, 0, 1, 0, -1, 0, 0];
    const m = mat4FromRotTrans(r, [10, 0, 0]);
    const p = applyMat4(m, [1, 0, 0]);
    expect(p[0]).toBeCloseTo(10, 10);
    expect(p[2]).toBeCloseTo(-1, 10);
  });
  it("multiply order: (A·B)p = A(Bp)", () => {
    const a = mat4FromRotTrans([1, 0, 0, 0, 1, 0, 0, 0, 1], [1, 0, 0]);
    const b = mat4FromRotTrans([0, 0, 1, 0, 1, 0, -1, 0, 0], [0, 0, 0]);
    const ab = mat4Multiply(a, b);
    const p: Vec3 = [1, 2, 3];
    expect(applyMat4(ab, p)).toEqual(applyMat4(a, applyMat4(b, p)));
  });
});

describe("jacobiEigen / pca", () => {
  it("diagonal matrix eigenvalues sorted desc", () => {
    const { values } = jacobiEigen([[1, 0, 0], [0, 5, 0], [0, 0, 3]]);
    expect(values[0]).toBeCloseTo(5, 8);
    expect(values[1]).toBeCloseTo(3, 8);
    expect(values[2]).toBeCloseTo(1, 8);
  });
  it("pca of points along X finds X as principal axis", () => {
    const pts: Vec3[] = [];
    for (let i = 0; i < 50; i++) pts.push([i * 0.1, (i % 3) * 0.001, 0]);
    const { axes } = pca(pts);
    expect(Math.abs(axes[0][0])).toBeGreaterThan(0.999);
  });
});
