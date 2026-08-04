import { describe, expect, it } from "vitest";
import { runAnalysis } from "./pipeline";
import { spacingGroupKey } from "./spacing";
import { jitterRebars, makeWallGrid, offsetRebar, rigidMat4, transformRebars } from "./testFixtures";

const UP: [number, number, number] = [0, 1, 0];

describe("runAnalysis end-to-end", () => {
  it("full scenario: transform+noise+1 missing+1 offset → correct verdicts", () => {
    // 대칭 격자는 정합이 거울 대칭해로 수렴할 수 있어 코너 스텁으로 대칭을 깬다 (Task 5/6과 동일 원칙)
    const STUB = {
      id: "asym-stub",
      radius: 0.008,
      centerline: [[-0.25, 0, 0], [-0.25, 0.4, 0]] as [number, number, number][],
    };
    const design = [...makeWallGrid(), STUB];
    // 시공 시나리오: d-v-outer-3 미시공, d-h-inner-1 15mm 오프셋, 2mm 노이즈, 임의 배치
    let scan = [...makeWallGrid(), STUB].filter((r) => r.id !== "d-v-outer-3");
    scan = offsetRebar(scan, "d-h-inner-1", [0, 0, 0.015]);
    scan = jitterRebars(scan, 0.002, 99);
    scan = transformRebars(scan, rigidMat4(75, [3.1, -0.6, 1.4]));
    // 스캔 id는 라이다 앱 임의 명명 시뮬레이션
    scan = scan.map((r, i) => ({ ...r, id: `s${i}` }));

    const out = runAnalysis({ design, scan, toleranceMm: 10, up: UP });

    expect(out.registration.failed).toBe(false);
    expect(out.registration.rmsMm).toBeLessThan(6);
    expect(out.summary.designCount).toBe(25);
    expect(out.summary.scanCount).toBe(24);
    expect(out.summary.missing).toBe(1);
    expect(out.rebars.find((r) => r.verdict === "missing")!.designId).toBe("d-v-outer-3");
    const oot = out.rebars.filter((r) => r.verdict === "out_of_tolerance");
    expect(oot.length).toBe(1);
    expect(oot[0].designId).toBe("d-h-inner-1");
    expect(out.summary.extra).toBe(0);
  });

  it("scanTransformed lands on design frame (bbox overlaps design bbox)", () => {
    const design = makeWallGrid();
    const scan = transformRebars(makeWallGrid(), rigidMat4(30, [5, 0, -2]));
    const out = runAnalysis({ design, scan, toleranceMm: 10, up: UP });
    const xs = out.scanTransformed.flatMap((r) => r.centerline.map((p) => p[0]));
    expect(Math.min(...xs)).toBeGreaterThan(-0.1);
    expect(Math.max(...xs)).toBeLessThan(1.9);
  });

  it("degenerate scan → failed registration, no throw", () => {
    const out = runAnalysis({
      design: makeWallGrid(),
      scan: makeWallGrid().slice(0, 1),
      toleranceMm: 10, up: UP,
    });
    expect(out.registration.failed).toBe(true);
  });
});

describe("runAnalysis: 방향군과 간격", () => {
  it("방향군을 산출하고 간격 구간을 만든다", () => {
    const design = makeWallGrid();
    const scan = transformRebars(makeWallGrid(), rigidMat4(20, [0.4, 0, 0]))
      .map((r, i) => ({ ...r, id: `s${i}` }));
    const out = runAnalysis({ design, scan, toleranceMm: 10, up: UP });
    expect(out.families.length).toBeGreaterThanOrEqual(2);
    expect(out.spacing.gaps.length).toBeGreaterThan(0);
    expect(out.spacing.groups.every((g) => g.medianMm > 0)).toBe(true);
    expect(out.plane.width).toBeGreaterThan(0);
  });

  it("요구 간격을 주면 그 값으로 편차를 잰다", () => {
    const design = makeWallGrid();
    const scan = makeWallGrid().map((r, i) => ({ ...r, id: `s${i}` }));
    const base = runAnalysis({ design, scan, toleranceMm: 10, up: UP });
    const key = spacingGroupKey(base.spacing.groups[0].direction, base.spacing.groups[0].layer);
    const out = runAnalysis({
      design, scan, toleranceMm: 10, up: UP,
      requiredSpacingMm: { [key]: 100 },
    });
    const g = out.spacing.gaps.find((x) => spacingGroupKey(x.direction, x.layer) === key)!;
    expect(g.requiredMm).toBe(100);
    expect(g.deviationMm).toBeCloseTo(g.spacingMm - 100, 6);
  });
});
