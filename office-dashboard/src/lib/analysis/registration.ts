// 정합 — spec §5.2. 코스: PCA 주축 + 4플립 채점. (파인 ICP는 Task 6에서 추가)
import {
  applyMat4, cross, dot, mat4FromRotTrans, normalize, pca,
  pointToPolyline, samplePolyline, scale, sub,
} from "./geom";
import type { Mat4, Rebar, Vec3 } from "./types";

function allSamples(rebars: Rebar[], n = 8): Vec3[] {
  const pts: Vec3[] = [];
  for (const r of rebars) pts.push(...samplePolyline(r.centerline, n));
  return pts;
}

/** scan 각 철근 샘플의 최근접 design 폴리라인 거리 평균 (미터) */
export function coarseCost(scan: Rebar[], design: Rebar[], m: Mat4): number {
  let sum = 0, count = 0;
  for (const r of scan) {
    for (const p of samplePolyline(r.centerline, 6)) {
      const tp = applyMat4(m, p);
      let min = Infinity;
      for (const d of design) {
        const dist = pointToPolyline(tp, d.centerline);
        if (dist < min) min = dist;
      }
      sum += min;
      count++;
    }
  }
  return count ? sum / count : Infinity;
}

export function isDegenerate(rebars: Rebar[]): boolean {
  const { values } = pca(allSamples(rebars));
  return values[0] <= 0 || values[1] / values[0] < 1e-6;
}

/** 직교화: a축 기준으로 b를 그람-슈미트, c = a×b */
function orthoBasis(axes: Vec3[]): Vec3[] {
  const a = normalize(axes[0]);
  let b = sub(axes[1], scale(a, dot(axes[1], a)));
  b = normalize(b);
  const c = cross(a, b);
  return [a, b, c];
}

export function coarseRegister(scan: Rebar[], design: Rebar[]): Mat4 {
  const ps = allSamples(scan);
  const pd = allSamples(design);
  const s = pca(ps), d = pca(pd);
  const sa = orthoBasis(s.axes), da = orthoBasis(d.axes);

  // 부호 플립 (s1,s2)∈{±1}², s3 = s1·s2 로 det=+1 보장 → 4후보
  let best: Mat4 | null = null;
  let bestCost = Infinity;
  for (const f1 of [1, -1]) {
    for (const f2 of [1, -1]) {
      const f3 = f1 * f2;
      const flipped = [scale(sa[0], f1), scale(sa[1], f2), scale(sa[2], f3)];
      // R = Da · Fsᵀ : scan 축 성분 → design 축 성분 (row-major 3x3)
      const r: number[] = new Array(9);
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++)
          r[i * 3 + j] =
            da[0][i] * flipped[0][j] + da[1][i] * flipped[1][j] + da[2][i] * flipped[2][j];
      const rotMean: Vec3 = [
        r[0] * s.mean[0] + r[1] * s.mean[1] + r[2] * s.mean[2],
        r[3] * s.mean[0] + r[4] * s.mean[1] + r[5] * s.mean[2],
        r[6] * s.mean[0] + r[7] * s.mean[1] + r[8] * s.mean[2],
      ];
      const t = sub(d.mean, rotMean);
      const m = mat4FromRotTrans(r, t);
      const cost = coarseCost(scan, design, m);
      if (cost < bestCost) {
        bestCost = cost;
        best = m;
      }
    }
  }
  return best!;
}
