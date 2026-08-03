// 인접 철근 간격 계산 — 같은 (방향군, 레이어) 안에서 벽면을 가로지르는 순서로 줄을 세우고
// 이웃한 두 철근 사이 거리를 잰다. KDS가 규정하는 것이 간격이므로 이 값이 기본 지표다.
import { cross, dot, normalize, polylineDistance, samplePolyline } from "./geom";
import type { ClassifiedRebar, DirectionFamily, DirectionId, Layer, Vec3 } from "./types";

export function spacingGroupKey(direction: DirectionId, layer: Layer): string {
  return `${direction}/${layer}`;
}

export interface SpacingGap {
  aId: string;
  bId: string;
  direction: DirectionId;
  layer: Layer;
  /** 실측 간격 (mm) */
  spacingMm: number;
  /** 요구 간격 (mm) */
  requiredMm: number;
  /** spacing - required. 양수면 벌어짐, 음수면 좁음 */
  deviationMm: number;
  /** 두 철근 중점의 평균 — 컨투어 보간의 표본 위치 */
  midpoint: Vec3;
}

export interface SpacingGroupStat {
  direction: DirectionId;
  layer: Layer;
  /** 실측 간격 중앙값 (mm) */
  medianMm: number;
  /** 구간 개수 */
  count: number;
}

export interface SpacingResult {
  gaps: SpacingGap[];
  groups: SpacingGroupStat[];
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function midpointOf(r: ClassifiedRebar): Vec3 {
  return samplePolyline(r.centerline, 3)[1];
}

export function computeSpacing(
  bars: ClassifiedRebar[],
  families: DirectionFamily[],
  wallNormal: Vec3,
  requiredMm: Record<string, number>,
): SpacingResult {
  const n = normalize(wallNormal);
  const axisOf = new Map(families.map((f) => [f.id, f.axis]));

  const byGroup = new Map<string, ClassifiedRebar[]>();
  for (const b of bars) {
    const k = spacingGroupKey(b.direction, b.layer);
    const arr = byGroup.get(k) ?? [];
    arr.push(b);
    byGroup.set(k, arr);
  }

  // 1차: 그룹별 실측 간격을 모은다 (요구 간격 기본값 산정을 위해 먼저 계산)
  type Raw = { a: ClassifiedRebar; b: ClassifiedRebar; spacingMm: number; midpoint: Vec3 };
  const rawByGroup = new Map<string, Raw[]>();

  for (const [key, group] of byGroup) {
    if (group.length < 2) { rawByGroup.set(key, []); continue; }
    const famAxis = axisOf.get(group[0].direction) ?? [0, 1, 0];
    // 철근 방향과 벽면 법선에 모두 수직인 축 = 철근들이 늘어선 방향
    let order = cross(famAxis, n);
    if (Math.hypot(order[0], order[1], order[2]) < 1e-9) order = [1, 0, 0];
    order = normalize(order);

    const sorted = [...group]
      .map((b) => ({ b, t: dot(midpointOf(b), order) }))
      .sort((x, y) => x.t - y.t)
      .map((x) => x.b);

    const raws: Raw[] = [];
    for (let i = 0; i + 1 < sorted.length; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      const spacingMm = polylineDistance(a.centerline, b.centerline).mean * 1000;
      const ma = midpointOf(a);
      const mb = midpointOf(b);
      raws.push({
        a, b, spacingMm,
        midpoint: [(ma[0] + mb[0]) / 2, (ma[1] + mb[1]) / 2, (ma[2] + mb[2]) / 2],
      });
    }
    rawByGroup.set(key, raws);
  }

  const groups: SpacingGroupStat[] = [];
  const gaps: SpacingGap[] = [];

  for (const [key, raws] of rawByGroup) {
    const [direction, layer] = key.split("/") as [DirectionId, Layer];
    const med = median(raws.map((r) => r.spacingMm));
    groups.push({ direction, layer, medianMm: med, count: raws.length });
    const required = requiredMm[key] ?? med;
    for (const r of raws) {
      gaps.push({
        aId: r.a.id, bId: r.b.id, direction, layer,
        spacingMm: r.spacingMm,
        requiredMm: required,
        deviationMm: r.spacingMm - required,
        midpoint: r.midpoint,
      });
    }
  }

  return { gaps, groups };
}

/** 실측 중앙값을 5mm 단위로 반올림해 요구 간격 기본값으로 제안한다 */
export function suggestRequiredSpacing(stats: SpacingGroupStat[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of stats) {
    if (s.count === 0) continue;
    out[spacingGroupKey(s.direction, s.layer)] = Math.round(s.medianMm / 5) * 5;
  }
  return out;
}
