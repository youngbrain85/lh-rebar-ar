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
 * 고정돼 있지 않은 엔진 레벨 단위 테스트용. 사재는 레이어별로 서로 평행하게 나란히
 * 놓여 있어(정확히 45°) 정렬 결정성 테스트에도 쓴다. Task 8의 makeHaunchWall과는
 * 별개 — 이쪽은 direction/classify/judge/label 엔진 단위 테스트, 그쪽은 전체
 * 파이프라인 헌치 검증용이다.
 */
export function makeDiagonalFamilyGrid(opts: Partial<GridOpts> = {}): Rebar[] {
  const o = { ...DEFAULTS, ...opts };
  const out = makeWallGrid(opts);
  for (const [layer, z] of [["outer", 0], ["inner", -o.layerGap]] as const) {
    for (let i = 0; i < 3; i++) {
      const off = i * 0.15;
      out.push({
        id: `d-d-${layer}-${i}`, radius: o.radius,
        centerline: [[off, off, z], [off + 0.175, off + 0.175, z], [off + 0.35, off + 0.35, z]],
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
