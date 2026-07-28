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

export interface MeshData {
  name: string;
  /** world-space, flat [x,y,z,...] */
  positions: number[];
  /** 삼각형 인덱스 — 없으면 메시 전체를 한 덩어리로 취급 */
  index: number[] | null;
}

export interface RebarFilter {
  /** 이 반경(m) 이상은 철근이 아닌 지오메트리(벽 등)로 보고 제외 */
  maxRadius?: number;
  /** 이 길이(m) 이하 조각(커플러 등)은 제외 */
  minLength?: number;
}

/**
 * 메시들 → 물리 철근 단위 Rebar[].
 * Revit류 내보내기는 철근 "세트"(한 명명 요소에 여러 가닥)를 쓰므로, 이름 그룹핑만으로는
 * 세트 전체가 한 덩어리가 된다 — 각 메시를 연결요소로 분리해 가닥 단위로 만든다.
 * 이름당 연결요소가 1개면 id는 이름 그대로(번들 샘플 호환), 여러 개면 `이름#k`.
 * 굵은 지오메트리(벽)와 짧은 조각은 필터로 제외한다 (곡선 철근은 v1 범위 외 — spec §9).
 */
export function rebarsFromMeshes(meshes: MeshData[], filter: RebarFilter = {}): Rebar[] {
  const maxRadius = filter.maxRadius ?? 0.05;
  const minLength = filter.minLength ?? 0.1;

  const byName = new Map<string, Vec3[][]>();
  for (const m of meshes) {
    const comps = m.index
      ? splitByConnectivity(m.positions, m.index)
      : [
          Array.from({ length: m.positions.length / 3 }, (_, i): Vec3 => [
            m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2],
          ]),
        ];
    const arr = byName.get(m.name) ?? [];
    arr.push(...comps.filter((c) => c.length >= 3));
    byName.set(m.name, arr);
  }

  const out: Rebar[] = [];
  for (const [name, comps] of byName) {
    comps.forEach((vertices, k) => {
      const { centerline, radius } = extractCenterline(vertices);
      const [a, b] = centerline;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      if (radius >= maxRadius || length <= minLength) return;
      out.push({ id: comps.length === 1 ? name : `${name}#${k}`, centerline, radius });
    });
  }
  return out;
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
