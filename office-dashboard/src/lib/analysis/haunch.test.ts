// 발주처 요청 (1) — 직선 수직/수평이 아닌 철근이 섞인 벽을 끝까지 분석할 수 있는지.
import { describe, expect, it } from "vitest";
import { axisAngleDeg, deriveDirectionFamilies } from "./direction";
import { runAnalysis } from "./pipeline";
import { jitterRebars, makeHaunchWall, rigidMat4, transformRebars } from "./testFixtures";
import { spacingGroupKey } from "./spacing";
import type { Vec3 } from "./types";

const UP: Vec3 = [0, 1, 0];

/** 사재군을 라벨로 찾는다 — id 체계("d1")에 테스트를 묶지 않기 위해 */
const haunchIdOf = (fams: { id: string; label: string }[]) =>
  fams.find((f) => f.label.startsWith("사재"))!.id;

describe("헌치 경사 옹벽", () => {
  it("경사 주철근·수평 배력근·45° 사재를 세 방향군으로 나눈다", () => {
    const fams = deriveDirectionFamilies(makeHaunchWall(), UP);
    expect(fams.length).toBe(3);
    expect(fams.some((f) => f.label.startsWith("사재"))).toBe(true);
    // 이 픽스처의 핵심은 8° 기운 주철근이 45° 사재와 **공존**하는 것이다.
    // 주철근이 수직으로 뭉뚱그려지면 이 단언이 깨진다.
    const v = fams.find((f) => f.label === "세로")!;
    expect(axisAngleDeg(v.axis, UP)).toBeGreaterThan(3);
    expect(axisAngleDeg(v.axis, UP)).toBeLessThan(12);
  });

  it("사재도 미시공/도면외로 흘리지 않고 정상 판정한다", () => {
    const design = makeHaunchWall();
    const scan = makeHaunchWall().map((b, i) => ({ ...b, id: `s${i}` }));
    const out = runAnalysis({ design, scan, toleranceMm: 10, up: UP });
    expect(out.registration.failed).toBe(false);
    expect(out.summary.missing).toBe(0);
    expect(out.summary.extra).toBe(0);
    expect(out.summary.matched).toBe(design.length);
    // ★ 위 세 줄만으로는 근거가 못 된다. 스캔이 좌표까지 같은 복사본이라 매칭이 거리 0으로
    //   먼저 짝지어지고, 방향군을 어떻게 나누든(옛 2군 엔진에서도) 통과한다.
    //   사재가 실제로 자기 군으로 서 있는지를 따로 못 박는다.
    const haunch = out.summary.byGroup.find((g) => g.directionLabel.startsWith("사재"));
    expect(haunch).toBeDefined();
    expect(haunch!.designCount).toBe(3);
    expect(haunch!.scanCount).toBe(3);
    expect(haunch!.missing).toBe(0);
  });

  it("방향군마다 간격을 따로, 그 군의 좌표계로 잰다", () => {
    const design = makeHaunchWall();
    const scan = makeHaunchWall().map((b, i) => ({ ...b, id: `s${i}` }));
    const out = runAnalysis({ design, scan, toleranceMm: 10, up: UP });
    const keys = new Set(out.spacing.gaps.map((g) => spacingGroupKey(g.direction, g.layer)));
    expect(keys.size).toBe(3);
    const haunchGaps = out.spacing.gaps.filter((g) => g.direction === haunchIdOf(out.families));
    expect(haunchGaps.length).toBe(2); // 사재 3본 → 2구간
    // ★ 개수만으로는 부족하다. 사재는 x로 250mm씩 놓였지만 축이 45°라 면 위 실제 간격은
    //   250 × sin45° = 176.78mm다. 세계 x축으로 재는 회귀가 있으면 250이 나오는데
    //   개수 단언은 그대로 통과한다 — 이 숫자가 "방향군 자기 좌표계로 잰다"는 주장의 근거다.
    for (const g of haunchGaps) expect(g.spacingMm).toBeCloseTo(176.78, 1);
  });

  it("사재 한 본이 빠지면 사재군의 미시공으로 잡힌다", () => {
    const design = makeHaunchWall();
    const scan = makeHaunchWall()
      .filter((b) => b.id !== "haunch-1")
      .map((b, i) => ({ ...b, id: `s${i}` }));
    const out = runAnalysis({ design, scan, toleranceMm: 10, up: UP });
    expect(out.summary.missing).toBe(1);
    const missing = out.rebars.find((r) => r.verdict === "missing")!;
    expect(missing.designId).toBe("haunch-1");
    // ★ 위 두 줄은 옛 2방향군 엔진에서도 통과한다 — 거리 0 매칭이 남긴 것을 집을 뿐이다.
    //   빠진 철근이 사재군으로 분류돼 있어야 이 태스크의 근거가 된다.
    expect(missing.directionLabel).toMatch(/^사재/);
  });

  it("회전·노이즈가 섞인 스캔에서도 사재군을 잃지 않는다", () => {
    // 앞의 네 건은 스캔이 설계의 좌표 복사본이라 정합이 항등으로 수렴한다. 즉 코스 정합과
    // 노이즈 내성이 헌치 형상에서 한 번도 시험되지 않는다. 실제 스캔에 가깝게 만든다.
    const design = makeHaunchWall();
    const scan = jitterRebars(
      transformRebars(makeHaunchWall(), rigidMat4(35, [1.2, 0, 0.6])),
      0.002, 4242,
    ).map((b, i) => ({ ...b, id: `s${i}` }));
    const out = runAnalysis({ design, scan, toleranceMm: 15, up: UP });
    expect(out.registration.failed).toBe(false);
    expect(out.summary.missing).toBe(0);
    expect(out.summary.extra).toBe(0);
    const haunch = out.summary.byGroup.find((g) => g.directionLabel.startsWith("사재"));
    expect(haunch?.designCount).toBe(3);
  });
});
