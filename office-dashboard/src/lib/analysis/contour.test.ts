import { describe, expect, it } from "vitest";
import {
  buildContourField, contourBand, contourColor, CONTOUR_COLORS, fitWallPlane,
} from "./contour";
import { cross, dot, normalize } from "./geom";
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
  it("경계값은 위쪽 단계에 속한다", () => {
    // 경계를 정확히 밟는 값이 없으면 `<`와 `<=` 구현을 구분하지 못한다
    expect(contourBand(10, 50)).toBe(1);
    expect(contourBand(20, 50)).toBe(2);
    expect(contourBand(40, 50)).toBe(4);
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
  it("NaN 편차에도 색을 돌려준다 (undefined 반환 금지)", () => {
    expect(contourColor(NaN, 50)).toBe(CONTOUR_COLORS[0]);
  });
  it("무한대 편차는 NaN과 달리 마지막 단계다", () => {
    // isFinite로 한꺼번에 막으면 무한히 큰 편차가 가장 안전한 파란색으로 칠해진다
    expect(contourBand(Infinity, 50)).toBe(4);
    expect(contourBand(-Infinity, 50)).toBe(4);
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

  it("축과 원점을 고정한다 — Task 6이 텍스처를 얹는 기준", () => {
    // width/height만 검사하면 axisV를 뒤집어도 필드가 자기 안에서 일관돼 전부 통과한다.
    // 그러면 지도가 상하 반전된 채 그려지므로 축 자체를 못 박는다.
    const p = fitWallPlane(bars, NORMAL, UP, 0);
    expect(p.axisU).toEqual([1, 0, 0]);
    expect(p.axisV).toEqual([0, 1, 0]);
    expect(p.origin).toEqual([0, 0, 0]); // 최소 u·최소 v 모서리 = values[0]이 가리키는 칸
    const h = cross(p.axisU, p.axisV);   // 오른손 좌표계여야 한다
    expect(h[0]).toBeCloseTo(NORMAL[0], 9);
    expect(h[1]).toBeCloseTo(NORMAL[1], 9);
    expect(h[2]).toBeCloseTo(NORMAL[2], 9);
  });

  it("up의 크기가 1이 아니어도 세로축은 벽면 안에 남는다", () => {
    const tilted = normalize([0, 1, 1] as Vec3);
    const p1 = fitWallPlane(bars, tilted, [0, 1, 0], 0);
    const p2 = fitWallPlane(bars, tilted, [0, 2, 0], 0); // 같은 방향, 길이만 2배
    expect(dot(p2.axisV, tilted)).toBeCloseTo(0, 9);     // 벽면을 벗어나지 않는다
    expect(p2.axisV[0]).toBeCloseTo(p1.axisV[0], 9);     // 길이는 결과에 영향이 없다
    expect(p2.axisV[1]).toBeCloseTo(p1.axisV[1], 9);
    expect(p2.axisV[2]).toBeCloseTo(p1.axisV[2], 9);
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

  it("두 표본 사이 값은 거리에 반비례해 보간된다", () => {
    // 범위만 검사하면(0~60 사이, 중간값 존재) 균등 평균도, 가중치를 뒤집은
    // 좌우 반전 필드도 전부 통과한다 — 편차 핫스팟이 반대쪽 벽에 찍혀도 못 잡는다.
    // 그래서 실제 IDW 값을 못 박는다.
    const f = buildContourField(
      [gap(0.0, 1.0, 0), gap(0.6, 1.0, 60)],
      plane, { cols: 7, rows: 3, radiusM: 5 },
    );
    const row = f.values.slice(7, 14); // 표본이 놓인 가운데 행(r=1)
    expect(row.every((v) => v != null)).toBe(true);
    expect(row[0]).toBeCloseTo(0, 6);        // 표본에 정확히 걸린 칸
    expect(row[1]).toBeCloseTo(2.3077, 3);   // 균등 평균이면 30, 반전이면 57.69
    expect(row[3]).toBeCloseTo(30, 6);       // 두 표본에서 등거리
    expect(row[5]).toBeCloseTo(57.6923, 3);
    expect(row[6]).toBeCloseTo(60, 6);
  });

  it("values의 0행은 v=0쪽 — 평면 원점이 있는 아래 모서리다", () => {
    // Task 6이 이 배열을 그대로 DataTexture로 올린다. 행 순서가 뒤집히면 지도가
    // 상하 반전되는데, 나머지 필드 테스트는 전부 상하 대칭이라 하나도 걸리지 않는다.
    const f = buildContourField([gap(0.3, 0.1, 40)], plane, { cols: 2, rows: 2, radiusM: 0.5 });
    expect(f.values.slice(0, 2).some((v) => v != null)).toBe(true);  // 아래 행 = 표본이 있는 쪽
    expect(f.values.slice(2, 4).every((v) => v == null)).toBe(true); // 위 행 = 반경 밖
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
