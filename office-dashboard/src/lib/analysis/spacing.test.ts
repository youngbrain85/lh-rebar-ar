import { describe, expect, it } from "vitest";
import { classifyRebars, estimateWallNormal } from "./classify";
import { deriveDirectionFamilies } from "./direction";
import { computeSpacing, spacingGroupKey, suggestRequiredSpacing } from "./spacing";
import type { Rebar, Vec3 } from "./types";

const UP: Vec3 = [0, 1, 0];
const bar = (id: string, x: number, z = 0): Rebar => ({
  id, radius: 0.008, centerline: [[x, 0, z], [x, 2, z]],
});

/** 세로근만 있는 한 겹 벽 — x가 간격이 된다 */
function wall(xs: number[]): Rebar[] {
  return xs.map((x, i) => bar(`v${i}`, x));
}

function classified(bars: Rebar[]) {
  const fams = deriveDirectionFamilies(bars, UP);
  const n = estimateWallNormal(bars);
  return { bars: classifyRebars(bars, UP, n, fams), fams, n };
}

describe("computeSpacing", () => {
  it("등간격 200mm면 편차 0", () => {
    const { bars, fams, n } = classified(wall([0, 0.2, 0.4, 0.6]));
    const key = spacingGroupKey(bars[0].direction, bars[0].layer);
    const r = computeSpacing(bars, fams, n, { [key]: 200 });
    expect(r.gaps.length).toBe(3);
    for (const g of r.gaps) {
      expect(g.spacingMm).toBeCloseTo(200, 3);
      expect(g.deviationMm).toBeCloseTo(0, 3);
    }
  });

  it("벌어진 구간의 편차를 부호까지 잡아낸다", () => {
    // 간격 200 / 240 / 150 → 편차 0 / +40 / -50. 세 값의 크기가 모두 달라
    // 구간 순서가 뒤바뀌면 반드시 실패한다
    const { bars, fams, n } = classified(wall([0, 0.2, 0.44, 0.59]));
    const key = spacingGroupKey(bars[0].direction, bars[0].layer);
    const r = computeSpacing(bars, fams, n, { [key]: 200 });
    const devs = r.gaps.map((g) => Math.round(g.deviationMm));
    expect(devs).toEqual([0, 40, -50]);
  });

  it("간격은 위치 순서대로 잰다 (입력 순서와 무관)", () => {
    const shuffled = [bar("c", 0.4), bar("a", 0), bar("b", 0.2)];
    const { bars, fams, n } = classified(shuffled);
    const key = spacingGroupKey(bars[0].direction, bars[0].layer);
    const r = computeSpacing(bars, fams, n, { [key]: 200 });
    expect(r.gaps.length).toBe(2);
    for (const g of r.gaps) expect(g.spacingMm).toBeCloseTo(200, 3);
  });

  it("그룹이 다르면 간격을 재지 않는다 (세로 vs 가로)", () => {
    const bars: Rebar[] = [
      ...wall([0, 0.2, 0.4]),
      { id: "h0", radius: 0.008, centerline: [[0, 0.5, 0], [1.5, 0.5, 0]] },
      { id: "h1", radius: 0.008, centerline: [[0, 0.8, 0], [1.5, 0.8, 0]] },
    ];
    const { bars: c, fams, n } = classified(bars);
    const r = computeSpacing(c, fams, n, {});
    const dirs = new Set(r.gaps.map((g) => g.direction));
    expect(dirs.size).toBe(2);
    // 세로 3개 → 2구간, 가로 2개 → 1구간
    expect(r.gaps.length).toBe(3);
  });

  it("철근이 1개뿐인 그룹은 구간이 없다", () => {
    const { bars, fams, n } = classified(wall([0]));
    const r = computeSpacing(bars, fams, n, {});
    expect(r.gaps.length).toBe(0);
  });

  it("요구 간격 미지정이면 그룹 중앙값을 기준으로 삼는다", () => {
    // 간격 200 / 260 / 300 → 중앙값 260. 평균(253.3)·최솟값(200)·최댓값(300)·
    // 첫 구간(200)이 모두 다른 값이라, 기본값이 중앙값이 아니면 반드시 실패한다
    const { bars, fams, n } = classified(wall([0, 0.2, 0.46, 0.76]));
    const r = computeSpacing(bars, fams, n, {});
    expect(r.groups[0].medianMm).toBeCloseTo(260, 3);
    expect(r.gaps.map((g) => Math.round(g.deviationMm))).toEqual([-60, 0, 40]);
  });

  it("레이어가 다르면 같은 방향이라도 간격을 따로 잰다", () => {
    // 앞열(z=0) 3본 200mm 등간격 + 뒷열(z=0.15) 2본 300mm.
    // 레이어를 무시하고 묶으면 x 순서로 50/150/150/50이 나와 반드시 실패한다.
    //
    // ★ 두 레이어의 x 평균을 반드시 같게 둘 것(여기서는 둘 다 0.2).
    //   다르면 PCA 표본에 가짜 x–z 상관이 생겨 estimateWallNormal이 z축에서 몇 도
    //   기울고, 정렬 축도 함께 기울어 간격이 199/299처럼 조금씩 짧게 나온다.
    const bars: Rebar[] = [
      bar("f0", 0), bar("f1", 0.2), bar("f2", 0.4),
      bar("b0", 0.05, 0.15), bar("b1", 0.35, 0.15),
    ];
    const { bars: c, fams, n } = classified(bars);
    const r = computeSpacing(c, fams, n, {});
    expect(new Set(c.map((b) => b.direction)).size).toBe(1); // 방향군은 하나
    const byKey = new Map<string, number[]>();
    for (const g of r.gaps) {
      const k = spacingGroupKey(g.direction, g.layer);
      byKey.set(k, [...(byKey.get(k) ?? []), Math.round(g.spacingMm)]);
    }
    // 레이어 이름(외측/내측)이 어느 z에 붙는지는 클러스터링이 정하므로 이름 대신 형태로 본다
    expect([...byKey.values()].map((v) => v.join(",")).sort()).toEqual(["200,200", "300"]);
  });

  it("길이가 다른 이웃 철근도 간격을 부풀리지 않는다", () => {
    // 실제 간격 200mm. 짧은 쪽이 절반 길이여도 200이어야 한다.
    // polylineDistance(...).mean으로 재면 296.6이 나온다 (긴 쪽 여분이 끝점 거리로 잡힘)
    const bars: Rebar[] = [
      { id: "long", radius: 0.008, centerline: [[0, 0, 0], [0, 2, 0]] },
      { id: "short", radius: 0.008, centerline: [[0.2, 0, 0], [0.2, 1, 0]] },
    ];
    const { bars: c, fams, n } = classified(bars);
    const r = computeSpacing(c, fams, n, {});
    expect(r.gaps.length).toBe(1);
    expect(r.gaps[0].spacingMm).toBeCloseTo(200, 3);
  });

  it("벽을 관통하는 방향군은 면 위 순서가 없으므로 간격을 재지 않는다", () => {
    // 벽면은 xy 평면(법선 z). z축을 따라 놓인 타이 2본은 면 위 정렬축이 정의되지 않는다.
    const bars: Rebar[] = [
      ...wall([0, 0.2, 0.4, 0.6]),
      { id: "tie0", radius: 0.008, centerline: [[0.1, 1, -0.1], [0.1, 1, 0.1]] },
      { id: "tie1", radius: 0.008, centerline: [[0.3, 1, -0.1], [0.3, 1, 0.1]] },
    ];
    const { bars: c, fams, n } = classified(bars);
    const r = computeSpacing(c, fams, n, {});
    const tieDir = c.find((b) => b.id === "tie0")!.direction;
    expect(r.gaps.some((g) => g.direction === tieDir)).toBe(false);
    // 벽면 철근 쪽은 그대로 측정된다
    expect(r.gaps.length).toBeGreaterThan(0);
  });

  it("살짝 기운 관통 방향군도 건너뛴다 (임계가 1e-9이 아니라 0.05인 이유)", () => {
    // 법선에서 약 2° 기운 타이 2본. |cross| ≈ 0.035 < ORDER_MIN_SIN이라 걸러진다.
    // 임계가 1e-9이면 order가 ±x로 잡혀 두 타이 사이에 200mm짜리 가짜 간격이 생긴다.
    const t = Math.tan((2 * Math.PI) / 180) * 0.2; // z로 0.2 갈 때 y 변위
    const tie = (id: string, x: number): Rebar => ({
      id, radius: 0.008, centerline: [[x, 1, -0.1], [x, 1 + t, 0.1]],
    });
    const { bars: c, fams, n } = classified([...wall([0, 0.2, 0.4, 0.6]), tie("t0", 0.1), tie("t1", 0.3)]);
    const r = computeSpacing(c, fams, n, {});
    const tieDir = c.find((b) => b.id === "t0")!.direction;
    expect(tieDir).not.toBe(c.find((b) => b.id === "v0")!.direction); // 별도 방향군
    expect(r.gaps.some((g) => g.direction === tieDir)).toBe(false);
  });

  it("겹침이음처럼 같은 자리에 있는 두 철근은 간격으로 세지 않는다", () => {
    // x=0에서 하부근과 상부근이 겹쳐 이어지고, 이웃 철근이 200mm 떨어져 있다.
    // 0mm 구간을 세면 중앙값이 100mm로 내려가 요구간격 기본값까지 망가진다
    const bars: Rebar[] = [
      { id: "lower", radius: 0.008, centerline: [[0, 0, 0], [0, 2, 0]] },
      { id: "upper", radius: 0.008, centerline: [[0, 1.8, 0], [0, 3.8, 0]] },
      { id: "nbr", radius: 0.008, centerline: [[0.2, 0, 0], [0.2, 3.8, 0]] },
    ];
    const { bars: c, fams, n } = classified(bars);
    const r = computeSpacing(c, fams, n, {});
    expect(r.gaps.map((g) => Math.round(g.spacingMm))).toEqual([200]);
    expect(r.groups[0].medianMm).toBeCloseTo(200, 3);
  });

  it("중점은 두 철근 사이에 놓인다", () => {
    const { bars, fams, n } = classified(wall([0, 0.2]));
    const r = computeSpacing(bars, fams, n, {});
    expect(r.gaps[0].midpoint[0]).toBeCloseTo(0.1, 6);
  });
});

describe("suggestRequiredSpacing", () => {
  it("중앙값을 5mm 단위로 반올림해 제안한다", () => {
    const out = suggestRequiredSpacing([
      { direction: "v1", layer: "outer", medianMm: 203.2, count: 5 },
      { direction: "h1", layer: "outer", medianMm: 297.6, count: 4 },
    ]);
    expect(out["v1/outer"]).toBe(205);
    expect(out["h1/outer"]).toBe(300);
  });
});
