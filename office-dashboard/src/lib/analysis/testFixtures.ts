// 테스트 전용 합성 데이터 생성기. 프로덕션 번들에서 import 금지.
import { applyMat4, mat4FromRotTrans } from "./geom";
import type { Mat4, Rebar, Vec3 } from "./types";

export interface GridOpts {
  nV: number; nH: number;
  spacingV: number; spacingH: number;
  lenV: number; lenH: number;
  layerGap: number; radius: number;
}

const DEFAULTS: GridOpts = {
  nV: 7, nH: 5, spacingV: 0.3, spacingH: 0.4,
  lenV: 2, lenH: 1.8, layerGap: 0.06, radius: 0.008,
};

/** 벽체 철근망: XY 평면, 법선 Z. 외측 z=0, 내측 z=-layerGap. 중심선은 3점(중간점 포함). */
export function makeWallGrid(opts: Partial<GridOpts> = {}): Rebar[] {
  const o = { ...DEFAULTS, ...opts };
  const out: Rebar[] = [];
  for (const [layer, z] of [["outer", 0], ["inner", -o.layerGap]] as const) {
    for (let i = 0; i < o.nV; i++) {
      const x = i * o.spacingV;
      out.push({
        id: `d-v-${layer}-${i}`, radius: o.radius,
        centerline: [[x, 0, z], [x, o.lenV / 2, z], [x, o.lenV, z]],
      });
    }
    for (let j = 0; j < o.nH; j++) {
      const y = 0.2 + j * o.spacingH;
      out.push({
        id: `d-h-${layer}-${j}`, radius: o.radius,
        centerline: [[0, y, z], [o.lenH / 2, y, z], [o.lenH, y, z]],
      });
    }
  }
  return out;
}

/**
 * makeWallGrid에 45° 사재군(세 번째 방향군)을 더한 벽체 — 방향군이 2개(세로/가로)로
 * 고정돼 있지 않은 엔진 레벨 단위 테스트용. Task 8의 makeHaunchWall과는 별개 — 이쪽은
 * direction/classify/judge/label 엔진 단위 테스트, 그쪽은 전체 파이프라인 헌치 검증용이다.
 *
 * 사재 축은 (1,1,0)/√2(정확히 45°) — 세 개가 축과 나란히, 축에 "수직"인 방향
 * (1,-1,0)으로 서로 0.15m씩 떨어져 있다. 즉 서로 평행한 개별 철근이며, 축을 따라
 * 한 줄로 이어 그린 게 아니다(그렇게 그리면 y=x 위에서 mid[0]===mid[1]이 되어,
 * "축에 수직한 성분으로 정렬"하는지 "세계 x/y 중 하나로 정렬"하는지를 구별하는
 * 테스트가 무력화된다). 이 배치라면 x로 정렬한 순서와 y로 정렬한 순서가 서로
 * 반대가 되므로, 정렬 축 선택 버그가 있으면 반드시 순서가 뒤집혀 드러난다.
 */
export function makeDiagonalFamilyGrid(opts: Partial<GridOpts> = {}): Rebar[] {
  const o = { ...DEFAULTS, ...opts };
  const out = makeWallGrid(opts);
  for (const [layer, z] of [["outer", 0], ["inner", -o.layerGap]] as const) {
    for (let i = 0; i < 3; i++) {
      const sx = i * 0.15, sy = -i * 0.15; // 축에 수직 방향(1,-1,0)으로 나란히 오프셋
      out.push({
        id: `d-d-${layer}-${i}`, radius: o.radius,
        centerline: [[sx, sy, z], [sx + 0.175, sy + 0.175, z], [sx + 0.35, sy + 0.35, z]],
      });
    }
  }
  return out;
}

export function rigidMat4(yawDeg: number, t: Vec3): Mat4 {
  const a = (yawDeg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  // Y축(up) 회전, row-major 3x3
  return mat4FromRotTrans([c, 0, s, 0, 1, 0, -s, 0, c], t);
}

export function transformRebars(rebars: Rebar[], m: Mat4): Rebar[] {
  return rebars.map((r) => ({ ...r, centerline: r.centerline.map((p) => applyMat4(m, p)) }));
}

/** 결정적 LCG 기반 노이즈 (합 3개 균등분포 ≈ 가우시안) */
export function jitterRebars(rebars: Rebar[], sigmaM: number, seed: number): Rebar[] {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff - 0.5;
  };
  const g = () => (rnd() + rnd() + rnd()) * 2 * sigmaM;
  return rebars.map((r) => ({
    ...r,
    centerline: r.centerline.map((p): Vec3 => [p[0] + g(), p[1] + g(), p[2] + g()]),
  }));
}

export function offsetRebar(rebars: Rebar[], id: string, offset: Vec3): Rebar[] {
  return rebars.map((r) =>
    r.id !== id ? r : {
      ...r,
      centerline: r.centerline.map((p): Vec3 => [p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]]),
    },
  );
}
