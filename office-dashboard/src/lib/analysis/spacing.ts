// 인접 철근 간격 계산 — 같은 (방향군, 레이어) 안에서 벽면을 가로지르는 순서로 줄을 세우고
// 이웃한 두 철근 사이 거리를 잰다. KDS가 규정하는 것이 간격이므로 이 값이 기본 지표다.
import { canonicalAxis } from "./direction";
import { cross, dot, norm, normalize, samplePolyline } from "./geom";
import type { ClassifiedRebar, DirectionFamily, DirectionId, Layer, Vec3 } from "./types";

/**
 * 방향군이 "벽면 안에 있는가"를 가르는 값 = sin 30°.
 *
 * 판정 대상은 수치 노이즈가 아니라 **기하**다. 면 위 철근군은 법선과 90°를 이루므로
 * |cross| ≈ 1이고(벽 법선 추정이 몇 도 기울어도 0.99 아래로 내려가지 않는다),
 * 벽을 관통하는 타이·연결철근은 0~15°라 0.26을 넘지 못한다. 그 사이 어디에 그어도
 * 되므로 30°로 넉넉히 잡는다.
 *
 * 이 값을 노이즈 기준(3° 등)으로 잡으면 안 된다: 스캔 노이즈만으로도 실제 타이가
 * 3~15° 범위에 들어오고, 그러면 같은 타이가 **기운 방향에 따라** 다른 값을 낸다 —
 * x–z로 기울면 정렬축이 ±y라 0mm, y–z로 기울면 ±x라 200mm짜리 가짜 간격.
 */
const ORDER_MIN_SIN = 0.5;

/**
 * 두 철근의 **순간격**(중심거리 − 반지름 합)이 이 값 미만이면 간격이 아니다 —
 * 겹침·접촉 이음이거나 면 밖 방향군의 잔여 성분이다. KDS 최소 순간격이 25mm이므로
 * 실제 이웃 철근은 어떤 배근에서도 이보다 좁을 수 없다.
 *
 * 중심거리에 고정 하한을 두면 안 된다: 접촉이음의 중심거리는 곧 철근 지름이라
 * D22 이상이면 22·25·29mm로 20mm 하한을 통과해버린다. 순간격으로 재면 지름과
 * 무관하게 걸린다. 세면 컨투어에 가짜 최대편차가 찍히고 그룹 중앙값까지 끌어내려
 * 요구간격 기본값이 망가진다.
 */
const MIN_CLEAR_MM = 20;

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
    // 철근 방향과 벽면 법선에 모두 수직인 축 = 철근들이 면 위에 늘어선 방향.
    // 방향군 축이 벽 법선과 거의 나란하면(벽을 관통하는 타이·연결철근) 이 축이
    // 노이즈로 정해져 임의의 순서가 나온다. 그런 군은 면 위 간격이 정의되지 않으므로
    // 지어내지 말고 건너뛴다.
    const rawOrder = cross(famAxis, n);
    if (norm(rawOrder) < ORDER_MIN_SIN) { rawByGroup.set(key, []); continue; }
    // 부호 정규화: cross의 부호는 wallNormal(PCA 고유벡터)의 부호를 물려받는데
    // 고유벡터 부호는 규약이 없다. 정규화하지 않으면 gaps 배열 순서가 뒤집힌다.
    const order = canonicalAxis(normalize(rawOrder));

    const sorted = [...group]
      .map((b) => {
        const mid = midpointOf(b);
        return { b, mid, t: dot(mid, order) };
      })
      .sort((x, y) => x.t - y.t);

    const raws: Raw[] = [];
    for (let i = 0; i + 1 < sorted.length; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      // 간격 = 정렬 축 위의 거리. 검측자가 면을 가로질러 실제로 재는 값이다.
      // polylineDistance(...).mean을 쓰면 안 된다 — 길이가 다르거나 이음이 엇갈린
      // 두 철근에서 긴 쪽의 여분 구간이 짧은 쪽 끝점까지의 거리로 잡혀 간격이
      // 부풀려진다(2m 대 1m, 실제 200mm → 296.6mm).
      const spacingMm = Math.abs(b.t - a.t) * 1000;
      // 겹침·접촉 이음과 면 밖 잔여 성분은 구간으로 세지 않는다. 이 쌍만 건너뛰므로
      // 다음 쌍(b ↔ 그 다음 철근)에서 진짜 간격이 이어서 잡힌다.
      const clearMm = spacingMm - (a.b.radius + b.b.radius) * 1000;
      if (clearMm < MIN_CLEAR_MM) continue;
      raws.push({
        a: a.b, b: b.b, spacingMm,
        midpoint: [
          (a.mid[0] + b.mid[0]) / 2,
          (a.mid[1] + b.mid[1]) / 2,
          (a.mid[2] + b.mid[2]) / 2,
        ],
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
