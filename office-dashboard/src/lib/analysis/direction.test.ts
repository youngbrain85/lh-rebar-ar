import { describe, expect, it } from "vitest";
import { assignFamily, axisAngleDeg, barAxis, canonicalAxis, deriveDirectionFamilies } from "./direction";
import type { Rebar, Vec3 } from "./types";

const UP: Vec3 = [0, 1, 0];
const bar = (id: string, a: Vec3, b: Vec3): Rebar => ({ id, radius: 0.008, centerline: [a, b] });

describe("canonicalAxis", () => {
  it("반대로 그린 축을 같은 방향으로 모은다", () => {
    expect(canonicalAxis([0, -1, 0])).toEqual([0, 1, 0]);
    expect(canonicalAxis([0, 1, 0])).toEqual([0, 1, 0]);
  });
  it("수평 축은 x 부호로 정규화", () => {
    expect(canonicalAxis([-1, 0, 0])).toEqual([1, 0, 0]);
  });
});

describe("axisAngleDeg", () => {
  it("직교축은 90도", () => {
    expect(axisAngleDeg([0, 1, 0], [1, 0, 0])).toBeCloseTo(90, 6);
  });
  it("반대 방향도 0도로 본다", () => {
    expect(axisAngleDeg([0, 1, 0], [0, -1, 0])).toBeCloseTo(0, 6);
  });
});

describe("deriveDirectionFamilies", () => {
  it("수직·수평만 있으면 두 군", () => {
    const bars = [
      bar("v1", [0, 0, 0], [0, 2, 0]),
      bar("v2", [0.2, 0, 0], [0.2, 2, 0]),
      bar("h1", [0, 0.5, 0], [1.8, 0.5, 0]),
      bar("h2", [0, 1.0, 0], [1.8, 1.0, 0]),
    ];
    const fams = deriveDirectionFamilies(bars, UP);
    expect(fams.length).toBe(2);
    expect(fams.map((f) => f.label).sort()).toEqual(["가로", "세로"]);
  });

  it("살짝 기운 주철근은 세로군에 흡수된다 (경사 옹벽)", () => {
    const tilt = (x: number): Rebar => bar(`t${x}`, [x, 0, 0], [x + 0.12, 2, 0]); // 약 3.4°
    const bars = [tilt(0), tilt(0.2), tilt(0.4), bar("h1", [0, 0.5, 0], [1.8, 0.5, 0]), bar("h2", [0, 1, 0], [1.8, 1, 0])];
    const fams = deriveDirectionFamilies(bars, UP);
    expect(fams.length).toBe(2);
    const v = fams.find((f) => f.label === "세로")!;
    expect(axisAngleDeg(v.axis, [0, 1, 0])).toBeLessThan(10);
  });

  it("헌치 45° 사재는 독립 군이 되고 각도가 이름에 붙는다", () => {
    const bars = [
      bar("v1", [0, 0, 0], [0, 2, 0]),
      bar("v2", [0.2, 0, 0], [0.2, 2, 0]),
      bar("h1", [0, 0.5, 0], [1.8, 0.5, 0]),
      bar("h2", [0, 1, 0], [1.8, 1, 0]),
      bar("d1", [0, 0, 0], [0.7, 0.7, 0]),
      bar("d2", [0.1, 0, 0], [0.8, 0.7, 0]),
    ];
    const fams = deriveDirectionFamilies(bars, UP);
    expect(fams.length).toBe(3);
    expect(fams.some((f) => f.label === "사재 45°")).toBe(true);
  });

  it("개수가 minCount 미만인 군은 흡수된다", () => {
    const bars = [
      bar("v1", [0, 0, 0], [0, 2, 0]),
      bar("v2", [0.2, 0, 0], [0.2, 2, 0]),
      bar("v3", [0.4, 0, 0], [0.4, 2, 0]),
      bar("stray", [0, 0, 0], [0.55, 0.7, 0]),
    ];
    const fams = deriveDirectionFamilies(bars, UP);
    expect(fams.length).toBe(1);
  });

  it("모든 군이 minCount 미만이면 하나만 남기지 않고 전부 보존한다", () => {
    // 세 방향(수직/수평/45도)이 각각 단일 철근뿐이라 어느 군도 minCount(2)에 못 미친다.
    // 이때 흡수할 "나머지 군"이 아예 없으므로, 입력에 있던 방향이 하나라도 사라지면 안 된다.
    const bars = [
      bar("v", [0, 0, 0], [0, 2, 0]),
      bar("h", [0, 0.5, 0], [1.8, 0.5, 0]),
      bar("d", [0, 0, 0], [0.7, 0.7, 0]),
    ];
    const fams = deriveDirectionFamilies(bars, UP);
    expect(fams.length).toBe(3);
    // 개수만이 아니라 각도로 확인 — id가 뒤섞여도 놓치지 못하게, 원래 철근 축으로
    // assignFamily를 되돌려서 실제로 자기 방향에 가까운 군에 붙는지 검증한다.
    for (const b of bars) {
      const axis = barAxis(b);
      const famId = assignFamily(axis, fams);
      const fam = fams.find((f) => f.id === famId)!;
      expect(axisAngleDeg(fam.axis, axis)).toBeLessThan(20);
    }
  });
});

describe("assignFamily", () => {
  it("각도상 가장 가까운 군을 고른다", () => {
    const fams = deriveDirectionFamilies(
      [
        bar("v1", [0, 0, 0], [0, 2, 0]),
        bar("v2", [0.2, 0, 0], [0.2, 2, 0]),
        bar("h1", [0, 0.5, 0], [1.8, 0.5, 0]),
        bar("h2", [0, 1, 0], [1.8, 1, 0]),
      ],
      UP,
    );
    const vId = fams.find((f) => f.label === "세로")!.id;
    const hId = fams.find((f) => f.label === "가로")!.id;
    expect(assignFamily(barAxis(bar("x", [0, 0, 0], [0.05, 2, 0])), fams)).toBe(vId);
    expect(assignFamily(barAxis(bar("y", [0, 0, 0], [1.8, 0.05, 0])), fams)).toBe(hId);
  });
});
