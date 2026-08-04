// 발주처 요청 (1) — 직선 수직/수평이 아닌 철근이 섞인 벽을 끝까지 분석할 수 있는지.
import { describe, expect, it } from "vitest";
import { deriveDirectionFamilies } from "./direction";
import { runAnalysis } from "./pipeline";
import { makeHaunchWall } from "./testFixtures";
import { spacingGroupKey } from "./spacing";
import type { Vec3 } from "./types";

const UP: Vec3 = [0, 1, 0];

describe("헌치 경사 옹벽", () => {
  it("경사 주철근·수평 배력근·45° 사재를 세 방향군으로 나눈다", () => {
    const fams = deriveDirectionFamilies(makeHaunchWall(), UP);
    expect(fams.length).toBe(3);
    expect(fams.some((f) => f.label.startsWith("사재"))).toBe(true);
  });

  it("사재도 미시공/도면외로 흘리지 않고 정상 판정한다", () => {
    const design = makeHaunchWall();
    const scan = makeHaunchWall().map((b, i) => ({ ...b, id: `s${i}` }));
    const out = runAnalysis({ design, scan, toleranceMm: 10, up: UP });
    expect(out.registration.failed).toBe(false);
    expect(out.summary.missing).toBe(0);
    expect(out.summary.extra).toBe(0);
    expect(out.summary.matched).toBe(design.length);
  });

  it("방향군마다 간격을 따로 잰다", () => {
    const design = makeHaunchWall();
    const scan = makeHaunchWall().map((b, i) => ({ ...b, id: `s${i}` }));
    const out = runAnalysis({ design, scan, toleranceMm: 10, up: UP });
    const keys = new Set(out.spacing.gaps.map((g) => spacingGroupKey(g.direction, g.layer)));
    expect(keys.size).toBe(3);
    // 사재 3본 → 2구간
    const haunchKey = [...keys].find((k) => k.startsWith("d"))!;
    expect(out.spacing.gaps.filter((g) => spacingGroupKey(g.direction, g.layer) === haunchKey).length).toBe(2);
  });

  it("사재 한 본이 빠지면 미시공으로 잡힌다", () => {
    const design = makeHaunchWall();
    const scan = makeHaunchWall()
      .filter((b) => b.id !== "haunch-1")
      .map((b, i) => ({ ...b, id: `s${i}` }));
    const out = runAnalysis({ design, scan, toleranceMm: 10, up: UP });
    expect(out.summary.missing).toBe(1);
    const missing = out.rebars.find((r) => r.verdict === "missing")!;
    expect(missing.designId).toBe("haunch-1");
  });
});
