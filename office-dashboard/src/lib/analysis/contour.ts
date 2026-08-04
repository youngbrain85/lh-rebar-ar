// 컨투어 — 편차 크기를 5단계 색으로 나타내고, 벽면 격자에 보간해 지도로 만든다.
// KDS에 오차 기준이 없어 합격/불합격 선을 그을 근거가 없으므로, 상한은 사용자가 정한다.
import { cross, dot, norm, normalize, samplePolyline, scale, sub } from "./geom";
import type { ClassifiedRebar, Vec3 } from "./types";

/** 청 → 적 5단계 (ColorBrewer RdYlBu 계열). 판정 색과 겹치지 않는 별도 체계 */
export const CONTOUR_COLORS = ["#2c7bb6", "#abd9e9", "#ffffbf", "#fdae61", "#d7191c"] as const;

/** 지표별 기본 상한 (mm) */
export const DEFAULT_CONTOUR_MAX = { spacing: 50, position: 30 } as const;

/** 0~상한을 5등분한 단계 인덱스 (0~4). 상한 이상은 4 */
export function contourBand(absMm: number, maxMm: number): number {
  if (!(maxMm > 0)) return CONTOUR_COLORS.length - 1;
  // NaN 편차로는 단계를 고를 수 없다. 막지 않으면 Math.floor(NaN)이 클램프를 통과해
  // CONTOUR_COLORS[NaN] → undefined가 되고, 반환 타입이 string인데 undefined가 나간다.
  // ★ isFinite로 막지 말 것 — ±Infinity까지 함께 걸려 "무한히 큰 편차"가 가장 안전한
  //   파란색으로 칠해진다. 무한대는 아래 계산이 그대로 마지막 단계로 보낸다.
  if (Number.isNaN(absMm)) return 0;
  const t = Math.abs(absMm) / maxMm;
  const band = Math.floor(t * CONTOUR_COLORS.length);
  return Math.max(0, Math.min(CONTOUR_COLORS.length - 1, band));
}

export function contourColor(absMm: number, maxMm: number): string {
  return CONTOUR_COLORS[contourBand(absMm, maxMm)];
}

export interface WallPlane {
  /** 평면의 좌하단 기준점 (설계 좌표) */
  origin: Vec3;
  /** 가로 방향 단위축 */
  axisU: Vec3;
  /** 세로 방향 단위축 */
  axisV: Vec3;
  /** 미터 */
  width: number;
  height: number;
}

/** 철근군을 감싸는 벽면 직사각형을 만든다 */
export function fitWallPlane(
  bars: ClassifiedRebar[],
  wallNormal: Vec3,
  up: Vec3,
  marginM = 0.05,
): WallPlane {
  const n = normalize(wallNormal);
  // up을 벽면에 투영해 세로축을 만들고, 그것과 법선의 외적으로 가로축을 만든다.
  // ★ 투영 전에 반드시 up을 정규화할 것. 정규화한 up에서 정규화하지 않은 up의 법선
  //   성분을 빼면 |up| ≠ 1일 때 axisV가 벽면 밖으로 나가고(|up|=2, 법선 [0,1,1]에서
  //   45° 이탈) 지도 전체가 기울어진 채 그려진다.
  const un = normalize(up);
  const upProj = sub(un, scale(n, dot(un, n)));
  const axisV: Vec3 = norm(upProj) > 1e-9 ? normalize(upProj) : [0, 1, 0];
  const axisU = normalize(cross(axisV, n));

  const pts: Vec3[] = [];
  for (const b of bars) pts.push(...samplePolyline(b.centerline, 8));
  if (pts.length === 0) {
    return { origin: [0, 0, 0], axisU, axisV, width: 0, height: 0 };
  }
  const c: Vec3 = [0, 0, 0];
  for (const p of pts) { c[0] += p[0] / pts.length; c[1] += p[1] / pts.length; c[2] += p[2] / pts.length; }

  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const p of pts) {
    const d = sub(p, c);
    const u = dot(d, axisU);
    const v = dot(d, axisV);
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  minU -= marginM; maxU += marginM; minV -= marginM; maxV += marginM;

  const origin: Vec3 = [
    c[0] + axisU[0] * minU + axisV[0] * minV,
    c[1] + axisU[1] * minU + axisV[1] * minV,
    c[2] + axisU[2] * minU + axisV[2] * minV,
  ];
  return { origin, axisU, axisV, width: maxU - minU, height: maxV - minV };
}

export interface ContourField {
  cols: number;
  rows: number;
  plane: WallPlane;
  /** rows*cols, 행 우선. 편차 절댓값(mm). 표본이 멀어 값이 없으면 null */
  values: (number | null)[];
}

/**
 * 보간 표본. 간격 지표는 `SpacingGap`이 그대로 이 형태를 만족하고,
 * 위치 지표는 화면에서 철근 중점 + 그 철근의 편차로 만들어 넘긴다.
 */
export interface ContourSample {
  midpoint: Vec3;
  deviationMm: number;
}

/**
 * 역거리가중(IDW) 보간. 값은 편차의 절댓값이다.
 * radiusM 밖에 표본이 하나도 없는 칸은 null로 남겨 렌더에서 비운다.
 */
export function buildContourField(
  samples: ContourSample[],
  plane: WallPlane,
  opts: { cols?: number; rows?: number; radiusM?: number; power?: number } = {},
): ContourField {
  const cols = opts.cols ?? 48;
  const rows = opts.rows ?? 32;
  const radiusM = opts.radiusM ?? 0.6;
  const power = opts.power ?? 2;

  // 표본을 평면 좌표(u,v)로 옮겨 둔다
  const pts = samples.map((s) => {
    const d = sub(s.midpoint, plane.origin);
    return { u: dot(d, plane.axisU), v: dot(d, plane.axisV), value: Math.abs(s.deviationMm) };
  });

  const values: (number | null)[] = new Array(rows * cols).fill(null);
  if (pts.length === 0 || plane.width <= 0 || plane.height <= 0) {
    return { cols, rows, plane, values };
  }

  // 행 우선, r=0이 v=0쪽(plane.origin이 있는 아래 모서리). three.js DataTexture는
  // flipY=false가 기본이고 PlaneGeometry는 아래 모서리가 v=0이라, 이 배열을 그대로
  // 올리면 방향이 맞는다 — Task 6에서 뒤집지 말 것.
  for (let r = 0; r < rows; r++) {
    const v = ((r + 0.5) / rows) * plane.height;
    for (let c = 0; c < cols; c++) {
      const u = ((c + 0.5) / cols) * plane.width;
      let num = 0;
      let den = 0;
      let exact: number | null = null;
      for (const p of pts) {
        const d = Math.hypot(p.u - u, p.v - v);
        if (d > radiusM) continue;
        if (d < 1e-6) { exact = p.value; break; }
        const w = 1 / Math.pow(d, power);
        num += w * p.value;
        den += w;
      }
      // exact가 0일 수 있으므로 `exact || …`로 줄이면 안 된다 (편차 0인 칸이 사라진다)
      values[r * cols + c] = exact != null ? exact : den > 0 ? num / den : null;
    }
  }
  return { cols, rows, plane, values };
}
