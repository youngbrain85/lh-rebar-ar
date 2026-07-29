// 정합 — spec §5.2. 코스: PCA 주축 + 4플립 채점. (파인 ICP는 Task 6에서 추가)
import {
  add, applyMat4, cross, dot, mat4FromRotTrans, mat4Multiply, normalize, pca,
  pointToPolyline, samplePolyline, scale, sub, jacobiEigen,
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

/** PCA 주축 부호 플립 4후보 (det=+1 보장) — coarseCost로 채점하기 전의 원재료 */
export function coarseCandidates(scan: Rebar[], design: Rebar[]): Mat4[] {
  const ps = allSamples(scan);
  const pd = allSamples(design);
  const s = pca(ps), d = pca(pd);
  const sa = orthoBasis(s.axes), da = orthoBasis(d.axes);

  // 부호 플립 (s1,s2)∈{±1}², s3 = s1·s2 로 det=+1 보장 → 4후보
  const candidates: Mat4[] = [];
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
      candidates.push(mat4FromRotTrans(r, t));
    }
  }
  return candidates;
}

export function coarseRegister(scan: Rebar[], design: Rebar[]): Mat4 {
  let best: Mat4 | null = null;
  let bestCost = Infinity;
  for (const m of coarseCandidates(scan, design)) {
    const cost = coarseCost(scan, design, m);
    if (cost < bestCost) {
      bestCost = cost;
      best = m;
    }
  }
  return best!;
}

/** 최근접점: p에서 design 전체 폴리라인 중 가장 가까운 점 (선분 위 투영점) */
function closestPointOnDesign(p: Vec3, design: Rebar[]): Vec3 {
  let best: Vec3 = design[0].centerline[0];
  let bestD = Infinity;
  for (const r of design) {
    const line = r.centerline;
    if (line.length === 1) {
      const d2 = dot(sub(p, line[0]), sub(p, line[0]));
      if (d2 < bestD) {
        bestD = d2;
        best = line[0];
      }
    } else {
      for (let i = 0; i + 1 < line.length; i++) {
        const a = line[i], b = line[i + 1];
        const ab = sub(b, a);
        const len2 = dot(ab, ab);
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / len2));
        const q = add(a, scale(ab, t));
        const d2 = dot(sub(p, q), sub(p, q));
        if (d2 < bestD) {
          bestD = d2;
          best = q;
        }
      }
    }
  }
  return best;
}

/** Horn 쿼터니언 절대정위: 대응점쌍 최적 강체변환 (row-major 3x3 R + t) */
function hornRigid(from: Vec3[], to: Vec3[]): { r: number[]; t: Vec3 } {
  const n = from.length;
  const cf: Vec3 = [0, 0, 0], ct: Vec3 = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      cf[k] += from[i][k] / n;
      ct[k] += to[i][k] / n;
    }
  }
  // 교차공분산 S
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) {
    const a = sub(from[i], cf), b = sub(to[i], ct);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r][c] += a[r] * b[c];
  }
  const [Sxx, Sxy, Sxz] = S[0], [Syx, Syy, Syz] = S[1], [Szx, Szy, Szz] = S[2];
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ];
  const { vectors } = jacobiEigen(N);
  const [w, x, y, z] = vectors[0]; // 최대 고유값의 고유벡터 = 최적 쿼터니언
  const r = [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
  const rc: Vec3 = [
    r[0] * cf[0] + r[1] * cf[1] + r[2] * cf[2],
    r[3] * cf[0] + r[4] * cf[1] + r[5] * cf[2],
    r[6] * cf[0] + r[7] * cf[1] + r[8] * cf[2],
  ];
  return { r, t: sub(ct, rc) };
}

/** 각 샘플의 최근접 설계점 거리 제곱 (오름차순 정렬) */
function sortedSqDistances(samples: Vec3[], matrix: Mat4, design: Rebar[]): number[] {
  const sq: number[] = [];
  for (const p of samples) {
    const tp = applyMat4(matrix, p);
    const d = sub(tp, closestPointOnDesign(tp, design));
    sq.push(dot(d, d));
  }
  return sq.sort((a, b) => a - b);
}

/** 전체 RMS (meters) — basin 판별(후보 선택)용. 이상치까지 포함해 전역 오정합을 벌준다. */
function computeIcpRms(samples: Vec3[], matrix: Mat4, design: Rebar[]): number {
  if (samples.length === 0) return 0;
  const sq = sortedSqDistances(samples, matrix, design);
  const sum2 = sq.reduce((s, v) => s + v, 0);
  return Math.sqrt(sum2 / sq.length);
}

/**
 * 트림 RMS (meters): 가장 먼 20% 점을 버린 RMS — 실패 판정·표시용.
 * 정당한 "도면 외" 철근(설계에 없는 여분)이나 소수 이상치가 실제 구조물의 정합 품질을
 * 오염시켜 거짓 실패를 내는 것을 막는다. 전역 오정합은 대부분 점이 멀어 트림 후에도 큰 값.
 */
function computeIcpRmsTrimmed(samples: Vec3[], matrix: Mat4, design: Rebar[]): number {
  if (samples.length === 0) return 0;
  const sq = sortedSqDistances(samples, matrix, design);
  const keep = Math.max(1, Math.ceil(sq.length * 0.8));
  let sum2 = 0;
  for (let i = 0; i < keep; i++) sum2 += sq[i];
  return Math.sqrt(sum2 / keep);
}

/** 스캔 철근을 8점씩 샘플링 */
function scanSamples(scan: Rebar[]): Vec3[] {
  const s: Vec3[] = [];
  for (const r of scan) s.push(...samplePolyline(r.centerline, 8));
  return s;
}

export function icpRefine(
  scan: Rebar[], design: Rebar[], init: Mat4,
): { matrix: Mat4; rmsMm: number; iterations: number } {
  const samples: Vec3[] = [];
  for (const r of scan) samples.push(...samplePolyline(r.centerline, 8));
  let m = init;
  let prevRms = Infinity;
  let iterations = 0;
  for (let iter = 0; iter < 20; iter++) {
    iterations = iter + 1;
    const from: Vec3[] = [];
    const to: Vec3[] = [];
    let sum2 = 0;
    for (const p of samples) {
      const tp = applyMat4(m, p);
      const q = closestPointOnDesign(tp, design);
      from.push(tp);
      to.push(q);
      const d = sub(tp, q);
      sum2 += dot(d, d);
    }
    const rms = Math.sqrt(sum2 / samples.length);
    if (Math.abs(prevRms - rms) < 0.0001) { // ΔRMS < 0.1mm
      prevRms = rms;
      break;
    }
    prevRms = rms;
    const { r, t } = hornRigid(from, to);
    m = mat4Multiply(mat4FromRotTrans(r, t), m);
  }

  // 2단계 정련: 위 전체-ICP가 basin을 확정한 뒤(주기 구조에서 한 칸 미끄러지는 것을 방지),
  // 정합된 포즈에서 시작해 최근접 80% 대응점만으로 몇 번 더 정련한다 — 도면 외/이상치 철근이
  // Horn 솔브를 끌어당겨 실제 구조물 편차를 부풀리는 것을 제거한다.
  for (let iter = 0; iter < 6; iter++) {
    const corr: { from: Vec3; to: Vec3; d2: number }[] = [];
    for (const p of samples) {
      const tp = applyMat4(m, p);
      const q = closestPointOnDesign(tp, design);
      corr.push({ from: tp, to: q, d2: dot(sub(tp, q), sub(tp, q)) });
    }
    corr.sort((a, b) => a.d2 - b.d2);
    const inliers = corr.slice(0, Math.max(3, Math.ceil(corr.length * 0.8)));
    const rms = Math.sqrt(inliers.reduce((s, c) => s + c.d2, 0) / inliers.length);
    if (Math.abs(prevRms - rms) < 0.0001) { prevRms = rms; break; }
    prevRms = rms;
    const { r, t } = hornRigid(inliers.map((c) => c.from), inliers.map((c) => c.to));
    m = mat4Multiply(mat4FromRotTrans(r, t), m);
  }

  // 반환 rmsMm은 최종 행렬 기준 전체 RMS (basin 판별용) — registerScan이 트림 게이트를 별도 적용
  const finalRms = computeIcpRms(samples, m, design);
  return { matrix: m, rmsMm: finalRms * 1000, iterations };
}

export function registerScan(
  scan: Rebar[], design: Rebar[], manualInit?: Mat4,
): { matrix: Mat4; rmsMm: number; method: "auto" | "manual"; failed: boolean } {
  if (isDegenerate(scan) || isDegenerate(design)) {
    return { matrix: manualInit ?? coarseInitSafe(scan, design), rmsMm: Infinity, method: manualInit ? "manual" : "auto", failed: true };
  }
  // 표시·실패판정은 트림 RMS(이상치·도면외 철근에 강건), 후보 선택은 전체 RMS(basin 판별).
  const gate = (matrix: Mat4, method: "auto" | "manual") => {
    const trimMm = computeIcpRmsTrimmed(scanSamples(scan), matrix, design) * 1000;
    return { matrix, rmsMm: trimMm, method, failed: trimMm > 30 };
  };
  if (manualInit) {
    return gate(icpRefine(scan, design, manualInit).matrix, "manual");
  }
  // 4가지 플립 후보 전부를 ICP로 정련해 전체 RMS가 가장 낮은 basin을 채택 —
  // coarseCost(선형 근사) 기준 최선 후보가 잘못된 basin으로 수렴하는 경우를 방지.
  let best: { matrix: Mat4; rmsMm: number } | null = null;
  for (const init of coarseCandidates(scan, design)) {
    const refined = icpRefine(scan, design, init);
    if (!best || refined.rmsMm < best.rmsMm) best = refined;
  }
  return gate(best!.matrix, "auto");
}

/** 퇴화 시에도 안전한 초기값: 평균점 이동만 */
function coarseInitSafe(scan: Rebar[], design: Rebar[]): Mat4 {
  const s = pca(allSamples(scan)).mean;
  const d = pca(allSamples(design)).mean;
  return mat4FromRotTrans([1, 0, 0, 0, 1, 0, 0, 0, 1], sub(d, s));
}
