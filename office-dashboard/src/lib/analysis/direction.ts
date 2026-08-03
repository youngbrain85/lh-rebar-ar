// 방향군 자동 추출 — 옹벽의 경사 주철근과 헌치 사재를 담기 위해, 고정 45° 임계 대신
// 설계모델의 실제 축 분포에서 방향군을 뽑는다. 군이 세로/가로 둘뿐이면 기존 동작과 같다.
import { dot, normalize, sub } from "./geom";
import type { DirectionFamily, DirectionId, Rebar, Vec3 } from "./types";

/** 중심선 양 끝점으로 만든 대표 단위 축 */
export function barAxis(r: Rebar): Vec3 {
  return normalize(sub(r.centerline[r.centerline.length - 1], r.centerline[0]));
}

/** -0을 +0으로 정규화 — toEqual이 부호 있는 0을 다르게 취급해 축 비교가 깨지는 것을 막는다 */
const posZero = (n: number): number => (n === 0 ? 0 : n);

/** 부호 정규화 — 반대로 그린 철근이 다른 군으로 갈라지지 않게 한다 */
export function canonicalAxis(a: Vec3): Vec3 {
  const eps = 1e-9;
  const flip = (v: Vec3): Vec3 => [posZero(-v[0]), posZero(-v[1]), posZero(-v[2])];
  if (a[1] > eps) return a;
  if (a[1] < -eps) return flip(a);
  if (a[0] > eps) return a;
  if (a[0] < -eps) return flip(a);
  return a[2] >= 0 ? a : flip(a);
}

/** 두 축 사이 각도(도). 부호 무시하므로 0~90 범위 */
export function axisAngleDeg(a: Vec3, b: Vec3): number {
  const c = Math.min(1, Math.abs(dot(normalize(a), normalize(b))));
  return (Math.acos(c) * 180) / Math.PI;
}

export interface DeriveOptions {
  /** 같은 군으로 묶을 최대 각도차 (기본 20°) */
  mergeDeg?: number;
  /** 이 개수 미만인 군은 최근접 군에 흡수 (기본 2) */
  minCount?: number;
}

const round5 = (x: number) => Math.round(x / 5) * 5;

export function deriveDirectionFamilies(
  rebars: Rebar[],
  up: Vec3,
  opts: DeriveOptions = {},
): DirectionFamily[] {
  const mergeDeg = opts.mergeDeg ?? 20;
  const minCount = opts.minCount ?? 2;
  const u = normalize(up);

  // 1) 그리디 군집 — 기존 군과 mergeDeg 이내면 흡수하며 평균축을 갱신
  const clusters: { sum: Vec3; axis: Vec3; count: number }[] = [];
  for (const r of rebars) {
    const a = canonicalAxis(barAxis(r));
    let best = -1;
    let bestAngle = Infinity;
    clusters.forEach((c, i) => {
      const ang = axisAngleDeg(a, c.axis);
      if (ang < bestAngle) { bestAngle = ang; best = i; }
    });
    if (best >= 0 && bestAngle <= mergeDeg) {
      const c = clusters[best];
      // 평균 낼 때 부호가 반대면 뒤집어 더한다
      const s = dot(a, c.axis) >= 0 ? 1 : -1;
      c.sum = [c.sum[0] + a[0] * s, c.sum[1] + a[1] * s, c.sum[2] + a[2] * s];
      c.count += 1;
      c.axis = canonicalAxis(normalize(c.sum));
    } else {
      clusters.push({ sum: a, axis: a, count: 1 });
    }
  }

  // 2) 소수 군 흡수
  const keep = clusters.filter((c) => c.count >= minCount);
  const pool = keep.length > 0 ? keep : clusters.slice(0, 1);

  // 3) up과의 각도로 분류하고 이름을 붙인다
  const withAngle = pool.map((c) => ({ ...c, toUp: axisAngleDeg(c.axis, u) }));
  withAngle.sort((a, b) => a.toUp - b.toUp);

  const counters: Record<string, number> = { v: 0, h: 0, d: 0 };
  const catOf = (toUp: number) => (toUp < 30 ? "v" : toUp > 60 ? "h" : "d");
  const catCount: Record<string, number> = { v: 0, h: 0, d: 0 };
  for (const c of withAngle) catCount[catOf(c.toUp)] += 1;

  return withAngle.map((c) => {
    const cat = catOf(c.toUp);
    counters[cat] += 1;
    const n = counters[cat];
    let label: string;
    if (cat === "d") {
      label = `사재 ${round5(90 - c.toUp)}°`;
    } else if (catCount[cat] > 1) {
      const tilt = cat === "v" ? c.toUp : 90 - c.toUp;
      label = `${cat === "v" ? "세로" : "가로"}(${round5(tilt)}°)`;
    } else {
      label = cat === "v" ? "세로" : "가로";
    }
    return { id: `${cat}${n}` as DirectionId, label, axis: c.axis };
  });
}

/** 축에 가장 가까운 방향군 id. families가 비면 "v1" */
export function assignFamily(axis: Vec3, families: DirectionFamily[]): DirectionId {
  if (families.length === 0) return "v1";
  let best = families[0];
  let bestAngle = Infinity;
  for (const f of families) {
    const ang = axisAngleDeg(axis, f.axis);
    if (ang < bestAngle) { bestAngle = ang; best = f; }
  }
  return best.id;
}
