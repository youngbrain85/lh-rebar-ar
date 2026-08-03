// 컨투어 — 편차 크기를 5단계 색으로 나타내고, 벽면 격자에 보간해 지도로 만든다.
// KDS에 오차 기준이 없어 합격/불합격 선을 그을 근거가 없으므로, 상한은 사용자가 정한다.
import { cross, dot, normalize, samplePolyline, sub } from "./geom";
import type { ClassifiedRebar, Vec3 } from "./types";

/** 청 → 적 5단계 (ColorBrewer RdYlBu 계열). 판정 색과 겹치지 않는 별도 체계 */
export const CONTOUR_COLORS = ["#2c7bb6", "#abd9e9", "#ffffbf", "#fdae61", "#d7191c"] as const;

/** 지표별 기본 상한 (mm) */
export const DEFAULT_CONTOUR_MAX = { spacing: 50, position: 30 } as const;

/** 0~상한을 5등분한 단계 인덱스 (0~4). 상한 이상은 4 */
export function contourBand(absMm: number, maxMm: number): number {
  if (!(maxMm > 0)) return CONTOUR_COLORS.length - 1;
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
  // up을 벽면에 투영해 세로축을 만들고, 그것과 법선의 외적으로 가로축을 만든다
  const upProj = sub(normalize(up), [n[0] * dot(up, n), n[1] * dot(up, n), n[2] * dot(up, n)]);
  const axisV: Vec3 = Math.hypot(upProj[0], upProj[1], upProj[2]) > 1e-9 ? normalize(upProj) : [0, 1, 0];
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
  gaps: ContourSample[],
  plane: WallPlane,
  opts: { cols?: number; rows?: number; radiusM?: number; power?: number } = {},
): ContourField {
  const cols = opts.cols ?? 48;
  const rows = opts.rows ?? 32;
  const radiusM = opts.radiusM ?? 0.6;
  const power = opts.power ?? 2;

  // 표본을 평면 좌표(u,v)로 옮겨 둔다
  const samples = gaps.map((g) => {
    const d = sub(g.midpoint, plane.origin);
    return { u: dot(d, plane.axisU), v: dot(d, plane.axisV), value: Math.abs(g.deviationMm) };
  });

  const values: (number | null)[] = new Array(rows * cols).fill(null);
  if (samples.length === 0 || plane.width <= 0 || plane.height <= 0) {
    return { cols, rows, plane, values };
  }

  for (let r = 0; r < rows; r++) {
    const v = ((r + 0.5) / rows) * plane.height;
    for (let c = 0; c < cols; c++) {
      const u = ((c + 0.5) / cols) * plane.width;
      let num = 0;
      let den = 0;
      let exact: number | null = null;
      for (const s of samples) {
        const d = Math.hypot(s.u - u, s.v - v);
        if (d > radiusM) continue;
        if (d < 1e-6) { exact = s.value; break; }
        const w = 1 / Math.pow(d, power);
        num += w * s.value;
        den += w;
      }
      values[r * cols + c] = exact != null ? exact : den > 0 ? num / den : null;
    }
  }
  return { cols, rows, plane, values };
}
