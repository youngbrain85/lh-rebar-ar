// 순수 기하 프리미티브. three.js 금지 — Vec3/Mat4는 plain array.
import type { Mat4, Vec3 } from "./types";

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a: Vec3): number => Math.sqrt(dot(a, a));
export const normalize = (a: Vec3): Vec3 => {
  const n = norm(a);
  return n === 0 ? [0, 0, 0] : scale(a, 1 / n);
};

export function pointToSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  if (len2 === 0) return norm(sub(p, a));
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / len2));
  return norm(sub(p, add(a, scale(ab, t))));
}

export function pointToPolyline(p: Vec3, line: Vec3[]): number {
  let min = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const d = pointToSegment(p, line[i], line[i + 1]);
    if (d < min) min = d;
  }
  return line.length === 1 ? norm(sub(p, line[0])) : min;
}

export function samplePolyline(line: Vec3[], n: number): Vec3[] {
  if (n <= 1 || line.length === 1) return [line[0]];
  const segLen: number[] = [];
  let total = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const l = norm(sub(line[i + 1], line[i]));
    segLen.push(l);
    total += l;
  }
  if (total === 0) return Array(n).fill(line[0]);
  const out: Vec3[] = [];
  for (let k = 0; k < n; k++) {
    let target = (total * k) / (n - 1);
    let i = 0;
    while (i < segLen.length - 1 && target > segLen[i]) {
      target -= segLen[i];
      i++;
    }
    const t = segLen[i] === 0 ? 0 : target / segLen[i];
    out.push(add(line[i], scale(sub(line[i + 1], line[i]), Math.min(1, t))));
  }
  return out;
}

/**
 * 철근 중심선의 호길이 중점. 2점짜리 중심선에서 `line[length/2]`는 끝점이므로
 * 반드시 이 함수를 쓸 것. classify·label·spacing·컨투어 위치 지표가 모두 공유한다.
 */
export function barMidpoint(r: { centerline: Vec3[] }): Vec3 {
  return samplePolyline(r.centerline, 3)[1];
}

/** 대칭 폴리라인 거리: a샘플→b 최소거리와 b샘플→a 최소거리의 전체 평균/최대 (미터) */
export function polylineDistance(a: Vec3[], b: Vec3[], samples = 16): { mean: number; max: number } {
  const ds: number[] = [];
  for (const p of samplePolyline(a, samples)) ds.push(pointToPolyline(p, b));
  for (const p of samplePolyline(b, samples)) ds.push(pointToPolyline(p, a));
  const mean = ds.reduce((s, d) => s + d, 0) / ds.length;
  return { mean, max: Math.max(...ds) };
}

export const mat4Identity = (): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function applyMat4(m: Mat4, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

/** r: row-major 3x3 (r[row*3+col]) + 평행이동 → column-major Mat4 */
export function mat4FromRotTrans(r: number[], t: Vec3): Mat4 {
  return [r[0], r[3], r[6], 0, r[1], r[4], r[7], 0, r[2], r[5], r[8], 0, t[0], t[1], t[2], 1];
}

/** 대칭행렬 Jacobi 고유분해. 고유값 내림차순, vectors[i] = i번째 고유벡터. */
export function jacobiEigen(a: number[][]): { values: number[]; vectors: number[][] } {
  const n = a.length;
  const m = a.map((row) => row.slice());
  const v: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += m[p][q] * m[p][q];
    if (off < 1e-18) break;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(m[p][q]) < 1e-15) continue;
        const theta = (m[q][q] - m[p][p]) / (2 * m[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const mkp = m[k][p], mkq = m[k][q];
          m[k][p] = c * mkp - s * mkq;
          m[k][q] = s * mkp + c * mkq;
        }
        for (let k = 0; k < n; k++) {
          const mpk = m[p][k], mqk = m[q][k];
          m[p][k] = c * mpk - s * mqk;
          m[q][k] = s * mpk + c * mqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((x, y) => m[y][y] - m[x][x]);
  return {
    values: order.map((i) => m[i][i]),
    vectors: order.map((i) => v.map((row) => row[i])),
  };
}

export function pca(points: Vec3[]): { mean: Vec3; axes: Vec3[]; values: number[] } {
  const n = points.length;
  const mean: Vec3 = [0, 0, 0];
  for (const p of points) {
    mean[0] += p[0] / n;
    mean[1] += p[1] / n;
    mean[2] += p[2] / n;
  }
  const c = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of points) {
    const d = sub(p, mean);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) c[i][j] += (d[i] * d[j]) / n;
  }
  const { values, vectors } = jacobiEigen(c);
  return { mean, axes: vectors.map((x) => normalize(x as Vec3)), values };
}
