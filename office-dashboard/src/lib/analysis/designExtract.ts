// 설계모델 정점군 → 철근 중심선 — spec §5.1. 순수 함수 (three.js 금지).
import { dot, pca, sub } from "./geom";
import type { Rebar, Vec3 } from "./types";

export function extractCenterline(vertices: Vec3[]): { centerline: [Vec3, Vec3]; radius: number } {
  const { mean, axes } = pca(vertices);
  const axis = axes[0];
  let tMin = Infinity, tMax = -Infinity;
  const radial: number[] = [];
  for (const v of vertices) {
    const d = sub(v, mean);
    const t = dot(d, axis);
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
    const perp = Math.sqrt(Math.max(0, dot(d, d) - t * t));
    radial.push(perp);
  }
  radial.sort((a, b) => a - b);
  const radius = radial[Math.floor(radial.length / 2)];
  const p = (t: number): Vec3 => [
    mean[0] + axis[0] * t, mean[1] + axis[1] * t, mean[2] + axis[2] * t,
  ];
  return { centerline: [p(tMin), p(tMax)], radius };
}

export function rebarsFromGroups(groups: { name: string; vertices: Vec3[] }[]): Rebar[] {
  return groups
    .filter((g) => g.vertices.length >= 3)
    .map((g) => {
      const { centerline, radius } = extractCenterline(g.vertices);
      return { id: g.name, centerline, radius };
    });
}

/** 삼각형 인덱스 union-find 연결요소 분리 — 이름 없는 단일 메시 폴백 */
export function splitByConnectivity(positions: number[], index: number[]): Vec3[][] {
  const n = positions.length / 3;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i + 2 < index.length; i += 3) {
    union(index[i], index[i + 1]);
    union(index[i], index[i + 2]);
  }
  const comps = new Map<number, Vec3[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const arr = comps.get(root) ?? [];
    arr.push([positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]);
    comps.set(root, arr);
  }
  return [...comps.values()];
}
