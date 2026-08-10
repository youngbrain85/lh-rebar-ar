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
  /**
   * USDZ prim 절대 경로 (예: `/RebarModel/Wall_Front_Vert_01`). **필수**.
   *
   * 이름이 아니라 경로로 그룹핑하는 이유: `loadDesign`이 읽는 것은 오브젝트(부재)
   * 이름이 아니라 **메시 데이터블록 이름**이고, Blender USD 익스포터는 오브젝트
   * 이름에는 형제 중복 회피를 걸지만 메시 데이터 이름에는 걸지 않는다. 같은 규격
   * 철근이 지오메트리를 공유하면(FBX 인스턴싱) 이름이 대량 중복되고, 그러면 아래
   * 단일/다중 분기가 뒤집혀 **무고한 철근의 id까지 바뀐다**. 그 id는 분석 결과에
   * 저장돼 조인 키로 다시 쓰이므로 실패가 조용하다.
   *
   * optional + `path ?? name` 폴백으로 두지 않는 것도 같은 이유다 — 폴백은 그
   * 조용한 실패를 그대로 남긴다.
   */
  path: string;
  /** world-space, flat [x,y,z,...] */
  positions: number[];
  /** 삼각형 인덱스 — 없으면 메시 전체를 한 덩어리로 취급 */
  index: number[] | null;
}

export interface RebarsFromMeshesResult {
  rebars: Rebar[];
  /** 두 번 이상 나타난 prim 경로 — R1/R3 위반 신호. 비어 있어야 정상 */
  duplicatePaths: string[];
}

export interface RebarFilter {
  /** 이 반경(m) 이상은 철근이 아닌 지오메트리(벽 등)로 보고 제외 */
  maxRadius?: number;
  /** 이 길이(m) 이하 조각(커플러 등)은 제외 */
  minLength?: number;
}

/** 정점군의 산술 중심 — 연결요소 정렬 키 */
function centroid(vertices: Vec3[]): Vec3 {
  let x = 0, y = 0, z = 0;
  for (const v of vertices) { x += v[0]; y += v[1]; z += v[2]; }
  const n = vertices.length || 1;
  return [x / n, y / n, z / n];
}

/**
 * 메시들 → 물리 철근 단위 Rebar[].
 * Revit류 내보내기는 철근 "세트"(한 명명 요소에 여러 가닥)를 쓰므로, 그룹핑만으로는
 * 세트 전체가 한 덩어리가 된다 — 각 메시를 연결요소로 분리해 가닥 단위로 만든다.
 * 경로당 연결요소가 1개면 id는 경로 그대로, 여러 개면 `경로#k`.
 * 굵은 지오메트리(벽)와 짧은 조각은 필터로 제외한다 (곡선 철근은 v1 범위 외 — spec §9).
 *
 * ★ 순서가 중요하다: **필터 → 중심점 정렬 → k 부여**.
 *  - 필터를 뒤에 걸면(옛 동작) 짧은 파편 하나가 생기거나 사라질 때 무고한 철근의 id가
 *    `경로` ↔ `경로#1`로 뒤집힌다. 단일/다중 분기도 **필터 후** 개수로 판정해야 한다.
 *  - 중심점 정렬이 없으면 k가 `splitByConnectivity`의 정점 버퍼 순서에 의존해,
 *    모델을 다시 내보내는 것만으로 잎의 신원이 조용히 바뀐다.
 */
export function rebarsFromMeshes(
  meshes: MeshData[],
  filter: RebarFilter = {},
): RebarsFromMeshesResult {
  const maxRadius = filter.maxRadius ?? 0.05;
  const minLength = filter.minLength ?? 0.1;

  const byPath = new Map<string, Vec3[][]>();
  const duplicatePaths: string[] = [];
  for (const m of meshes) {
    const comps = m.index
      ? splitByConnectivity(m.positions, m.index)
      : [
          Array.from({ length: m.positions.length / 3 }, (_, i): Vec3 => [
            m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2],
          ]),
        ];
    if (byPath.has(m.path)) duplicatePaths.push(m.path);
    const arr = byPath.get(m.path) ?? [];
    arr.push(...comps.filter((c) => c.length >= 3));
    byPath.set(m.path, arr);
  }

  const out: Rebar[] = [];
  for (const [path, comps] of byPath) {
    // 1) 필터 먼저 — 살아남은 것만 k 부여 대상
    const kept = comps
      .map((vertices) => ({ vertices, ...extractCenterline(vertices) }))
      .filter(({ centerline, radius }) => {
        const [a, b] = centerline;
        const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        return radius < maxRadius && length > minLength;
      });
    // 2) 중심점 사전순 — 정점 버퍼 순서 의존 제거
    kept.sort((p, q) => {
      const cp = centroid(p.vertices), cq = centroid(q.vertices);
      return cp[0] - cq[0] || cp[1] - cq[1] || cp[2] - cq[2];
    });
    // 3) 필터 후 개수로 단일/다중 판정
    kept.forEach(({ centerline, radius }, k) => {
      out.push({ id: kept.length === 1 ? path : `${path}#${k}`, centerline, radius });
    });
  }

  if (duplicatePaths.length > 0) {
    console.warn(
      `[designExtract] 중복 prim 경로 ${duplicatePaths.length}건 — 철근 id가 뒤섞일 수 있습니다`,
      duplicatePaths,
    );
  }
  return { rebars: out, duplicatePaths };
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
