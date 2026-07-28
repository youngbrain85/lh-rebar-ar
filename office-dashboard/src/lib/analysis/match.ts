// (방향,레이어) 그룹 내 그리디 최소비용 1:1 매칭 — spec §5.4
import { polylineDistance } from "./geom";
import type { ClassifiedRebar, MatchPair, MatchResult } from "./types";

/** 그룹 내 설계 최근접 중심선 간격 중앙값 ÷ 2 (미터). 2개 미만 → 0.1m */
export function groupCutoffM(design: ClassifiedRebar[], idx: number[]): number {
  if (idx.length < 2) return 0.1;
  const nn: number[] = [];
  for (const i of idx) {
    let min = Infinity;
    for (const j of idx) {
      if (i === j) continue;
      const d = polylineDistance(design[i].centerline, design[j].centerline).mean;
      if (d < min) min = d;
    }
    nn.push(min);
  }
  nn.sort((a, b) => a - b);
  const mid = Math.floor(nn.length / 2);
  const median = nn.length % 2 ? nn[mid] : (nn[mid - 1] + nn[mid]) / 2;
  return median / 2;
}

export function matchRebars(design: ClassifiedRebar[], scan: ClassifiedRebar[]): MatchResult {
  const groups = new Map<string, { d: number[]; s: number[] }>();
  const key = (r: ClassifiedRebar) => `${r.direction}/${r.layer}`;
  design.forEach((r, i) => {
    const g = groups.get(key(r)) ?? { d: [], s: [] };
    g.d.push(i);
    groups.set(key(r), g);
  });
  scan.forEach((r, i) => {
    const g = groups.get(key(r)) ?? { d: [], s: [] };
    g.s.push(i);
    groups.set(key(r), g);
  });

  const pairs: MatchPair[] = [];
  const usedD = new Set<number>();
  const usedS = new Set<number>();
  for (const { d, s } of groups.values()) {
    const cutoff = groupCutoffM(design, d);
    const cands: { di: number; si: number; mean: number; max: number }[] = [];
    for (const di of d)
      for (const si of s) {
        const { mean, max } = polylineDistance(design[di].centerline, scan[si].centerline);
        if (mean <= cutoff) cands.push({ di, si, mean, max });
      }
    cands.sort((a, b) => a.mean - b.mean);
    for (const c of cands) {
      if (usedD.has(c.di) || usedS.has(c.si)) continue;
      usedD.add(c.di);
      usedS.add(c.si);
      pairs.push({ designIdx: c.di, scanIdx: c.si, meanMm: c.mean * 1000, maxMm: c.max * 1000 });
    }
  }
  return {
    pairs,
    missingDesign: design.map((_, i) => i).filter((i) => !usedD.has(i)),
    extraScan: scan.map((_, i) => i).filter((i) => !usedS.has(i)),
  };
}
