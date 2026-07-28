// 방향(수평/수직)·레이어(외측/내측) 분류 — spec §5.3
import { dot, normalize, pca, samplePolyline, sub } from "./geom";
import type { ClassifiedRebar, Rebar, Vec3 } from "./types";

/** 철근군 전체 샘플점 PCA의 최소 분산 축 = 벽면 법선 */
export function estimateWallNormal(rebars: Rebar[]): Vec3 {
  const pts: Vec3[] = [];
  for (const r of rebars) pts.push(...samplePolyline(r.centerline, 8));
  return pca(pts).axes[2];
}

export function classifyRebars(rebars: Rebar[], up: Vec3, wallNormal: Vec3): ClassifiedRebar[] {
  const u = normalize(up);
  const n = normalize(wallNormal);

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
    const ends = normalize(sub(r.centerline[r.centerline.length - 1], r.centerline[0]));
    const vertical = Math.abs(dot(ends, u)) > Math.SQRT1_2; // 45° 기준
    const layer = singleLayer
      ? "outer"
      : Math.abs(proj[i] - outerCenter) <= Math.abs(proj[i] - Math.min(c0, c1))
        ? "outer"
        : "inner";
    return { ...r, direction: vertical ? "vertical" : "horizontal", layer };
  });
}
