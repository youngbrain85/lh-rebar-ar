// 방향군·레이어(외측/내측) 분류 — 방향은 direction.ts가 뽑은 군에 배정한다
import { dot, normalize, pca, samplePolyline } from "./geom";
import { assignFamily, barAxis } from "./direction";
import type { ClassifiedRebar, DirectionFamily, Rebar, Vec3 } from "./types";

/** 철근군 전체 샘플점 PCA의 최소 분산 축 = 벽면 법선 */
export function estimateWallNormal(rebars: Rebar[]): Vec3 {
  const pts: Vec3[] = [];
  for (const r of rebars) pts.push(...samplePolyline(r.centerline, 8));
  return pca(pts).axes[2];
}

export function classifyRebars(
  rebars: Rebar[],
  up: Vec3,
  wallNormal: Vec3,
  families: DirectionFamily[],
): ClassifiedRebar[] {
  const n = normalize(wallNormal);
  const familyLabel = new Map(families.map((f) => [f.id, f.label]));

  // 1D 투영값으로 2-means
  const proj = rebars.map((r) => {
    const mid = samplePolyline(r.centerline, 3)[1];
    return dot(mid, n);
  });
  let c0 = Math.min(...proj), c1 = Math.max(...proj);
  for (let iter = 0; iter < 20; iter++) {
    const g0: number[] = [], g1: number[] = [];
    for (const p of proj) (Math.abs(p - c0) <= Math.abs(p - c1) ? g0 : g1).push(p);
    const m0 = g0.length ? g0.reduce((s, x) => s + x, 0) / g0.length : c0;
    const m1 = g1.length ? g1.reduce((s, x) => s + x, 0) / g1.length : c1;
    if (Math.abs(m0 - c0) + Math.abs(m1 - c1) < 1e-9) break;
    c0 = m0; c1 = m1;
  }
  const spread = (vals: number[], c: number) =>
    vals.length ? Math.sqrt(vals.reduce((s, x) => s + (x - c) ** 2, 0) / vals.length) : 0;
  const g0 = proj.filter((p) => Math.abs(p - c0) <= Math.abs(p - c1));
  const g1 = proj.filter((p) => Math.abs(p - c0) > Math.abs(p - c1));
  const singleLayer =
    g0.length === 0 || g1.length === 0 ||
    Math.abs(c1 - c0) < Math.max(0.02, 2 * Math.max(spread(g0, c0), spread(g1, c1)));
  const outerCenter = Math.max(c0, c1);

  return rebars.map((r, i) => {
    const direction = assignFamily(barAxis(r), families);
    // 분류 시점에 라벨을 같이 붙여둔다 — judge.ts가 요약을 만들 때는 families에 접근할
    // 수 없으므로, 여기서 확정해 둔 라벨을 RebarRecord까지 그대로 흘려보낸다
    const directionLabel = familyLabel.get(direction) ?? direction;
    const layer = singleLayer
      ? "outer"
      : Math.abs(proj[i] - outerCenter) <= Math.abs(proj[i] - Math.min(c0, c1))
        ? "outer"
        : "inner";
    return { ...r, direction, directionLabel, layer };
  });
}
