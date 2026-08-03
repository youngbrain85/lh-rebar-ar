import { describe, expect, it } from "vitest";
import {
  buildContourField, contourBand, contourColor, CONTOUR_COLORS, fitWallPlane,
} from "./contour";
import type { ClassifiedRebar, Vec3 } from "./types";
import type { SpacingGap } from "./spacing";

const UP: Vec3 = [0, 1, 0];
const NORMAL: Vec3 = [0, 0, 1];

// `directionLabel`은 Task 2에서 ClassifiedRebar의 필수 필드가 됐다 — 리터럴에 빠뜨리면 tsc가 깨진다
const bars: ClassifiedRebar[] = [0, 0.2, 0.4, 0.6].map((x, i) => ({
  id: `v${i}`, radius: 0.008, direction: "v1", directionLabel: "세로", layer: "outer",
  centerline: [[x, 0, 0], [x, 2, 0]] as Vec3[],
}));

const gap = (x: number, y: number, dev: number): SpacingGap => ({
  aId: "a", bId: "b", direction: "v1", layer: "outer",
  spacingMm: 200 + dev, requiredMm: 200, deviationMm: dev, midpoint: [x, y, 0],
});

describe("contourBand", () => {
  it("0은 첫 단계, 상한 이상은 마지막 단계", () => {
    expect(contourBand(0, 50)).toBe(0);
    expect(contourBand(50, 50)).toBe(4);
    expect(contourBand(999, 50)).toBe(4);
  });
  it("상한을 5등분한다", () => {
    expect(contourBand(9, 50)).toBe(0);   // 0~10
    expect(contourBand(11, 50)).toBe(1);  // 10~20
    expect(contourBand(25, 50)).toBe(2);  // 20~30
    expect(contourBand(35, 50)).toBe(3);  // 30~40
    expect(contourBand(45, 50)).toBe(4);  // 40~
  });
  it("상한이 0 이하여도 깨지지 않는다", () => {
    expect(contourBand(5, 0)).toBe(4);
  });
});

describe("contourColor", () => {
  it("단계에 맞는 색을 준다", () => {
    expect(contourColor(0, 50)).toBe(CONTOUR_COLORS[0]);
    expect(contourColor(100, 50)).toBe(CONTOUR_COLORS[4]);
  });
});

describe("fitWallPlane", () => {
  it("철근군을 감싸는 평면을 만든다", () => {
    const p = fitWallPlane(bars, NORMAL, UP, 0);
    expect(p.width).toBeCloseTo(0.6, 6);
    expect(p.height).toBeCloseTo(2, 6);
  });
  it("여유(margin)를 주면 그만큼 넓어진다", () => {
    const p = fitWallPlane(bars, NORMAL, UP, 0.1);
    expect(p.width).toBeCloseTo(0.8, 6);
    expect(p.height).toBeCloseTo(2.2, 6);
  });
});

describe("buildContourField", () => {
  const plane = fitWallPlane(bars, NORMAL, UP, 0.05);

  it("표본 근처 칸은 그 표본 값을 따라간다", () => {
    const f = buildContourField([gap(0.1, 1.0, 40)], plane, { cols: 8, rows: 8, radiusM: 5 });
    const filled = f.values.filter((v): v is number => v != null);
    expect(filled.length).toBeGreaterThan(0);
    for (const v of filled) expect(v).toBeCloseTo(40, 6);
  });

  it("반경 밖 칸은 null로 남는다", () => {
    const f = buildContourField([gap(0.05, 0.05, 30)], plane, { cols: 8, rows: 8, radiusM: 0.1 });
    expect(f.values.some((v) => v == null)).toBe(true);
    expect(f.values.some((v) => v != null)).toBe(true);
  });

  it("두 표본 사이 값은 그 사이로 보간된다", () => {
    const f = buildContourField(
      [gap(0.0, 1.0, 0), gap(0.6, 1.0, 60)],
      plane, { cols: 7, rows: 3, radiusM: 5 },
    );
    const filled = f.values.filter((v): v is number => v != null);
    expect(Math.min(...filled)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...filled)).toBeLessThanOrEqual(60);
    expect(filled.some((v) => v > 5 && v < 55)).toBe(true);
  });

  it("표본이 없으면 전부 null", () => {
    const f = buildContourField([], plane, { cols: 4, rows: 4 });
    expect(f.values.every((v) => v == null)).toBe(true);
    expect(f.values.length).toBe(16);
  });

  it("편차의 절댓값을 쓴다 (좁아도 벌어져도 색이 든다)", () => {
    const f = buildContourField([gap(0.3, 1.0, -40)], plane, { cols: 4, rows: 4, radiusM: 5 });
    const filled = f.values.filter((v): v is number => v != null);
    for (const v of filled) expect(v).toBeCloseTo(40, 6);
  });
});
