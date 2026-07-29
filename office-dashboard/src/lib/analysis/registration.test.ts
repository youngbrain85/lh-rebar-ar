import { describe, expect, it } from "vitest";
import { applyMat4, pointToPolyline, samplePolyline, mat4Identity } from "./geom";
import { coarseCost, coarseRegister, isDegenerate, icpRefine, registerScan } from "./registration";
import { jitterRebars, makeWallGrid, offsetRebar, rigidMat4, transformRebars } from "./testFixtures";
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
  it("asymmetric grid still registers (flip discrimination exercised)", () => {
    const design = offsetRebar(makeWallGrid(), "d-v-outer-0", [0, 0.4, 0]);
    const scan = transformRebars(design, rigidMat4(90, [1.2, 0.4, -0.8]));
    const m = coarseRegister(scan, design);
    expect(coarseCost(scan, design, m)).toBeLessThan(0.02);
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

describe("icpRefine + registerScan", () => {
  it("recovers exact transform to <1mm RMS (noiseless)", () => {
    const design = makeWallGrid();
    const scan = transformRebars(design, rigidMat4(30, [1.2, 0.4, -0.8]));
    const { rmsMm } = icpRefine(scan, design, coarseRegister(scan, design));
    expect(rmsMm).toBeLessThan(1);
  });
  it("with 2mm noise converges to RMS < 5mm", () => {
    const design = makeWallGrid();
    const scan = jitterRebars(transformRebars(design, rigidMat4(60, [0.3, 0.1, -0.5])), 0.002, 3);
    const r = registerScan(scan, design);
    expect(r.failed).toBe(false);
    expect(r.method).toBe("auto");
    expect(r.rmsMm).toBeLessThan(5);
  });
  it("verifies recovered points land on design (round-trip <2mm)", () => {
    const design = offsetRebar(makeWallGrid(), "d-v-outer-0", [0, 0.4, 0]);
    const scan = transformRebars(design, rigidMat4(45, [2, -1, 0.7]));
    const { matrix } = icpRefine(scan, design, coarseRegister(scan, design));
    const p = applyMat4(matrix, scan[5].centerline[0]);
    const q = design[5].centerline[0];
    expect(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])).toBeLessThan(0.002);
  });
  it("degenerate input reports failed", () => {
    const one = makeWallGrid().slice(0, 1);
    const r = registerScan(one, makeWallGrid());
    expect(r.failed).toBe(true);
  });
  it("manualInit is honored and reported", () => {
    const design = makeWallGrid();
    const scan = transformRebars(design, rigidMat4(20, [0.5, 0, 0]));
    const init = coarseRegister(scan, design);
    const r = registerScan(scan, design, init);
    expect(r.method).toBe("manual");
    expect(r.rmsMm).toBeLessThan(1);
  });
  it("regression: 4-candidate ICP escapes the wrong basin that a single coarseRegister init fell into", () => {
    // coarseRegister(coarseCost 기준 최선 1후보)만으로 ICP를 돌리면 이 픽스처는
    // 약 31mm RMS의 잘못된 basin으로 수렴했다. 4후보 전부를 ICP로 정련해
    // 최종 RMS가 가장 낮은 결과를 채택해야 참 basin을 찾는다.
    const design = offsetRebar(makeWallGrid(), "d-v-outer-0", [0, 0.4, 0]);
    let scan = offsetRebar(makeWallGrid(), "d-v-outer-0", [0, 0.4, 0]).filter(
      (r) => r.id !== "d-v-outer-3",
    );
    scan = offsetRebar(scan, "d-h-inner-1", [0, 0, 0.015]);
    scan = jitterRebars(scan, 0.002, 99);
    scan = transformRebars(scan, rigidMat4(75, [3.1, -0.6, 1.4]));
    scan = scan.map((r, i) => ({ ...r, id: `s${i}` }));

    const result = registerScan(scan, design);
    expect(result.failed).toBe(false);
    expect(result.rmsMm).toBeLessThan(6);
  });
  it("returned rmsMm matches the final matrix (non-convergent path)", () => {
    // Regression: icpRefine must return rmsMm for the FINAL matrix, not intermediate state
    // Use bad init (identity) with large transformation to force non-early-convergence path
    const design = makeWallGrid();
    const scan = transformRebars(design, rigidMat4(170, [5, 2, -3]));
    const result = icpRefine(scan, design, mat4Identity());

    // Independently recompute RMS of the returned matrix
    const samples: any[] = [];
    for (const r of scan) samples.push(...samplePolyline(r.centerline, 8));
    let sum2 = 0;
    for (const p of samples) {
      const tp = applyMat4(result.matrix, p);
      let minDist = Infinity;
      for (const d of design) {
        const dist = pointToPolyline(tp, d.centerline);
        if (dist < minDist) minDist = dist;
      }
      sum2 += minDist * minDist;
    }
    const recomputedRms = Math.sqrt(sum2 / samples.length);
    const recomputedMm = recomputedRms * 1000;

    // rmsMm returned by icpRefine must match recomputed value
    expect(Math.abs(result.rmsMm - recomputedMm)).toBeLessThan(0.01);
  });

  it("legitimate extra bars do NOT trigger false registration failure", () => {
    // 도면 외 철근(설계에 없는 여분)이 몇 개 있어도 실제 구조물이 정합되면 통과해야 한다.
    // 회귀: 이전엔 전체 RMS를 써서 멀리 있는 여분 철근이 RMS를 부풀려 거짓 실패했음.
    const design = offsetRebar(makeWallGrid(), "d-v-outer-0", [0, 0.4, 0]);
    let scan: Rebar[] = offsetRebar(makeWallGrid(), "d-v-outer-0", [0, 0.4, 0]);
    // 벽 가장자리 바로 밖에 여분 수직근 추가 (스캔 좌표계에서 도면 외로 잡혀야 함)
    scan.push({ id: "extra-a", radius: 0.008, centerline: [[2.0, 0, 0], [2.0, 2, 0]] });
    scan = jitterRebars(transformRebars(scan, rigidMat4(35, [1.5, -0.5, 0.7])), 0.002, 17)
      .map((r, i) => ({ ...r, id: `s${i}` }));
    const result = registerScan(scan, design);
    // 전체 RMS라면 멀리 있는 여분 철근이 값을 부풀려 거짓 실패했을 것 — 트림 RMS로 통과해야 함
    expect(result.failed).toBe(false);
    expect(result.rmsMm).toBeLessThan(20);
  });

  it("global misalignment (wrong structure) still fails loudly", () => {
    // 안전장치: 완전히 다른 구조물이면 트림 후에도 RMS가 커서 실패로 잡혀야 한다.
    const design = offsetRebar(makeWallGrid(), "d-v-outer-0", [0, 0.4, 0]);
    const wrong: Rebar[] = [];
    for (let i = 0; i < 12; i++) {
      wrong.push({ id: `w${i}`, radius: 0.008, centerline: [[i * 0.5, 0, 10], [i * 0.5, 0, 13]] });
    }
    const result = registerScan(wrong, design);
    expect(result.failed).toBe(true);
    expect(result.rmsMm).toBeGreaterThan(30);
  });

});
