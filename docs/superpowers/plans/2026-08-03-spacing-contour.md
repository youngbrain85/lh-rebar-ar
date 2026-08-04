# 간격 편차 컨투어 + 방향군 자동 분류 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 발주처 요청 반영 — 철근 **간격 편차**를 기본 지표로 삼아 벽면 보간 컨투어 지도로 보여주고(위치 편차는 토글로 유지), 경사·대각선 철근을 담을 수 있도록 방향 분류를 고정 45° 임계에서 **방향군 자동 추출**로 바꾼다.

**Architecture:** 순수 TS 엔진(`src/lib/analysis/`)에 방향군(`direction.ts`)·간격(`spacing.ts`)·컨투어(`contour.ts`) 모듈을 추가하고, 파이프라인이 이를 산출물에 실어 준다. 뷰어는 벽면에 평면 메시 + DataTexture로 보간 지도를 렌더하고, UI는 지표 토글·요구 간격 입력·컬러바 범례를 제공한다.

**Tech Stack:** Next 16.2.7, React 19, Mantine 9, three 0.185, vitest. 신규 의존성 없음.

## Global Constraints

- 작업 브랜치: `feat/spacing-contour` (Task 1에서 생성). 커밋 메시지는 각 태스크 마지막 스텝 그대로.
- `src/lib/analysis/**`는 순수 TS — three.js/DOM/Next import 금지. three 의존 코드는 `src/components/analysis/`에만.
- 내부 단위는 **미터**, 직렬화·표시용 `*Mm` 필드는 **밀리미터**. `Mat4`는 길이 16 column-major.
- **컨투어 색 5단계**(0~상한 균등 5분할, 마지막은 상한 초과 포함): `["#2c7bb6","#abd9e9","#ffffbf","#fdae61","#d7191c"]`.
- **기본 상한**: 간격 편차 `50`mm, 위치 편차 `30`mm.
- **기본 지표는 간격 편차**(`metric: "spacing"`), 위치 편차는 토글.
- 방향군 병합 임계 **20°**, 군 최소 개수 **2**(미만이면 최근접 군에 흡수).
- 저장 결과 스키마는 **version 2**로 올린다. version 1 결과는 무시하고 재분석을 유도한다(현재 저장된 실데이터는 테스트 스캔 1건뿐).
- 판정 색(정상/허용초과/미시공/도면외)은 기존 값 유지 — 컨투어 색과 **별도 체계**다.
- vitest는 타입 검사를 하지 않는다. 커밋 전 반드시 `npx tsc --noEmit` + `npm test` + `npm run build`.
- npm 명령은 `D:\Projects\LH\AR\office-dashboard`, git 명령은 `D:\Projects\LH\AR`에서 실행.
- Next 16 주의: 확신 없는 API는 `node_modules/next/dist/docs/` 확인.

---

### Task 1: 방향군 자동 추출 (direction.ts)

**Files:**
- Create: `office-dashboard/src/lib/analysis/direction.ts`
- Test: `office-dashboard/src/lib/analysis/direction.test.ts`
- Modify: `office-dashboard/src/lib/analysis/types.ts` (DirectionId/DirectionFamily 추가)

**Interfaces:**
- Consumes: `Rebar`, `Vec3` (types.ts), `cross/dot/normalize/samplePolyline/sub` (geom.ts)
- Produces:
  - `type DirectionId = string`
  - `interface DirectionFamily { id: DirectionId; label: string; axis: Vec3 }`
  - `barAxis(r: Rebar): Vec3`
  - `canonicalAxis(a: Vec3): Vec3`
  - `axisAngleDeg(a: Vec3, b: Vec3): number` — 0~90, 부호 무시
  - `deriveDirectionFamilies(rebars: Rebar[], up: Vec3, opts?: { mergeDeg?: number; minCount?: number }): DirectionFamily[]`
  - `assignFamily(axis: Vec3, families: DirectionFamily[]): DirectionId`

- [ ] **Step 1: 브랜치 생성**

```bash
cd /d/Projects/LH/AR && git checkout -b feat/spacing-contour
```

- [ ] **Step 2: types.ts에 방향군 타입 추가**

`office-dashboard/src/lib/analysis/types.ts`에서 `export type Direction = "horizontal" | "vertical";` 줄을 아래로 교체:

```ts
/** 방향군 식별자 — "v1"(세로) "h1"(가로) "d1"(사재) 형태. 설계모델에서 자동 추출된다. */
export type DirectionId = string;

/** 방향군: 대표 축과 표시 이름 */
export interface DirectionFamily {
  id: DirectionId;
  /** "세로" | "가로" | "사재 45°" 등 표시용 */
  label: string;
  /** 부호 정규화된 단위 축 */
  axis: Vec3;
}
```

- [ ] **Step 3: 실패하는 테스트 작성**

```ts
// office-dashboard/src/lib/analysis/direction.test.ts
import { describe, expect, it } from "vitest";
import { assignFamily, axisAngleDeg, barAxis, canonicalAxis, deriveDirectionFamilies } from "./direction";
import type { Rebar, Vec3 } from "./types";

const UP: Vec3 = [0, 1, 0];
const bar = (id: string, a: Vec3, b: Vec3): Rebar => ({ id, radius: 0.008, centerline: [a, b] });

describe("canonicalAxis", () => {
  it("반대로 그린 축을 같은 방향으로 모은다", () => {
    expect(canonicalAxis([0, -1, 0])).toEqual([0, 1, 0]);
    expect(canonicalAxis([0, 1, 0])).toEqual([0, 1, 0]);
  });
  it("수평 축은 x 부호로 정규화", () => {
    expect(canonicalAxis([-1, 0, 0])).toEqual([1, 0, 0]);
  });
});

describe("axisAngleDeg", () => {
  it("직교축은 90도", () => {
    expect(axisAngleDeg([0, 1, 0], [1, 0, 0])).toBeCloseTo(90, 6);
  });
  it("반대 방향도 0도로 본다", () => {
    expect(axisAngleDeg([0, 1, 0], [0, -1, 0])).toBeCloseTo(0, 6);
  });
});

describe("deriveDirectionFamilies", () => {
  it("수직·수평만 있으면 두 군", () => {
    const bars = [
      bar("v1", [0, 0, 0], [0, 2, 0]),
      bar("v2", [0.2, 0, 0], [0.2, 2, 0]),
      bar("h1", [0, 0.5, 0], [1.8, 0.5, 0]),
      bar("h2", [0, 1.0, 0], [1.8, 1.0, 0]),
    ];
    const fams = deriveDirectionFamilies(bars, UP);
    expect(fams.length).toBe(2);
    expect(fams.map((f) => f.label).sort()).toEqual(["가로", "세로"]);
  });

  it("살짝 기운 주철근은 세로군에 흡수된다 (경사 옹벽)", () => {
    const tilt = (x: number): Rebar => bar(`t${x}`, [x, 0, 0], [x + 0.12, 2, 0]); // 약 3.4°
    const bars = [tilt(0), tilt(0.2), tilt(0.4), bar("h1", [0, 0.5, 0], [1.8, 0.5, 0]), bar("h2", [0, 1, 0], [1.8, 1, 0])];
    const fams = deriveDirectionFamilies(bars, UP);
    expect(fams.length).toBe(2);
    const v = fams.find((f) => f.label === "세로")!;
    expect(axisAngleDeg(v.axis, [0, 1, 0])).toBeLessThan(10);
  });

  it("헌치 45° 사재는 독립 군이 되고 각도가 이름에 붙는다", () => {
    const bars = [
      bar("v1", [0, 0, 0], [0, 2, 0]),
      bar("v2", [0.2, 0, 0], [0.2, 2, 0]),
      bar("h1", [0, 0.5, 0], [1.8, 0.5, 0]),
      bar("h2", [0, 1, 0], [1.8, 1, 0]),
      bar("d1", [0, 0, 0], [0.7, 0.7, 0]),
      bar("d2", [0.1, 0, 0], [0.8, 0.7, 0]),
    ];
    const fams = deriveDirectionFamilies(bars, UP);
    expect(fams.length).toBe(3);
    expect(fams.some((f) => f.label === "사재 45°")).toBe(true);
  });

  it("개수가 minCount 미만인 군은 흡수된다", () => {
    const bars = [
      bar("v1", [0, 0, 0], [0, 2, 0]),
      bar("v2", [0.2, 0, 0], [0.2, 2, 0]),
      bar("v3", [0.4, 0, 0], [0.4, 2, 0]),
      bar("stray", [0, 0, 0], [0.55, 0.7, 0]),
    ];
    const fams = deriveDirectionFamilies(bars, UP);
    expect(fams.length).toBe(1);
  });
});

describe("assignFamily", () => {
  it("각도상 가장 가까운 군을 고른다", () => {
    const fams = deriveDirectionFamilies(
      [
        bar("v1", [0, 0, 0], [0, 2, 0]),
        bar("v2", [0.2, 0, 0], [0.2, 2, 0]),
        bar("h1", [0, 0.5, 0], [1.8, 0.5, 0]),
        bar("h2", [0, 1, 0], [1.8, 1, 0]),
      ],
      UP,
    );
    const vId = fams.find((f) => f.label === "세로")!.id;
    const hId = fams.find((f) => f.label === "가로")!.id;
    expect(assignFamily(barAxis(bar("x", [0, 0, 0], [0.05, 2, 0])), fams)).toBe(vId);
    expect(assignFamily(barAxis(bar("y", [0, 0, 0], [1.8, 0.05, 0])), fams)).toBe(hId);
  });
});
```

- [ ] **Step 4: 실행해서 실패 확인**

Run: `npx vitest run src/lib/analysis/direction.test.ts`
Expected: FAIL — `Cannot find module './direction'`

- [ ] **Step 5: direction.ts 구현**

```ts
// office-dashboard/src/lib/analysis/direction.ts
// 방향군 자동 추출 — 옹벽의 경사 주철근과 헌치 사재를 담기 위해, 고정 45° 임계 대신
// 설계모델의 실제 축 분포에서 방향군을 뽑는다. 군이 세로/가로 둘뿐이면 기존 동작과 같다.
import { dot, normalize, sub } from "./geom";
import type { DirectionFamily, DirectionId, Rebar, Vec3 } from "./types";

/** 중심선 양 끝점으로 만든 대표 단위 축 */
export function barAxis(r: Rebar): Vec3 {
  return normalize(sub(r.centerline[r.centerline.length - 1], r.centerline[0]));
}

/** 부호 정규화 — 반대로 그린 철근이 다른 군으로 갈라지지 않게 한다 */
export function canonicalAxis(a: Vec3): Vec3 {
  const eps = 1e-9;
  const flip = (v: Vec3): Vec3 => [-v[0], -v[1], -v[2]];
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
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `npx vitest run src/lib/analysis/direction.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 7: 커밋**

```bash
cd /d/Projects/LH/AR && git add office-dashboard/src/lib/analysis/direction.ts office-dashboard/src/lib/analysis/direction.test.ts office-dashboard/src/lib/analysis/types.ts
git commit -m "feat: derive rebar direction families instead of a fixed 45deg split"
```

---

### Task 2: 분류·매칭·판정을 방향군 기반으로 전환

**Files:**
- Modify: `office-dashboard/src/lib/analysis/classify.ts`
- Modify: `office-dashboard/src/lib/analysis/types.ts`
- Modify: `office-dashboard/src/lib/analysis/judge.ts`
- Modify: `office-dashboard/src/lib/analysis/label.ts`
- Modify: `office-dashboard/src/lib/analysis/classify.test.ts`
- Modify: `office-dashboard/src/lib/analysis/label.test.ts`

**Interfaces:**
- Consumes: Task 1의 `DirectionFamily`, `assignFamily`, `barAxis`, `deriveDirectionFamilies`
- Produces:
  - `classifyRebars(rebars: Rebar[], up: Vec3, wallNormal: Vec3, families: DirectionFamily[]): ClassifiedRebar[]` — 시그니처에 families 추가
  - `RebarRecord.direction: DirectionId`, `RebarRecord.directionLabel?: string`
  - `GroupSummary.direction: DirectionId`, `GroupSummary.directionLabel: string`
  - `assignLabels(records: RebarRecord[], design: ClassifiedRebar[], scan: ClassifiedRebar[], families: DirectionFamily[]): RebarRecord[]`

- [ ] **Step 1: types.ts의 레코드 타입 갱신**

`RebarRecord`와 `GroupSummary`를 아래로 교체:

```ts
export interface RebarRecord {
  designId: string | null; // null = 도면 외
  scanId: string | null;   // null = 미시공
  direction: DirectionId;
  /** 표시용 방향군 이름 ("세로" / "사재 45°") */
  directionLabel?: string;
  layer: Layer;
  deviationMm: { mean: number; max: number } | null;
  verdict: Verdict;
  /** 표시용 간략명 (예: "세로-내측-1") */
  label?: string;
}

export interface GroupSummary {
  direction: DirectionId;
  directionLabel: string;
  layer: Layer;
  designCount: number;
  scanCount: number;
  missing: number;
  outOfTolerance: number;
  meanDeviationMm: number | null;
}
```

- [ ] **Step 2: classify.test.ts를 새 시그니처로 수정**

파일 상단 import에 `deriveDirectionFamilies`를 추가하고, `classifyRebars(g, UP, estimateWallNormal(g))` 형태의 호출을 모두 families를 넘기도록 바꾼다:

```ts
import { deriveDirectionFamilies } from "./direction";

const fams = (r = makeWallGrid()) => deriveDirectionFamilies(r, UP);
```

그리고 각 테스트의 기대값에서 `direction`을 문자열 비교 대신 라벨로 확인하도록 바꾼다. 예를 들어 "classifies direction and layer for the full grid" 테스트는:

```ts
  it("classifies direction and layer for the full grid", () => {
    const g = makeWallGrid();
    const f = deriveDirectionFamilies(g, UP);
    const c = classifyRebars(g, UP, estimateWallNormal(g), f);
    const byId = new Map(f.map((x) => [x.id, x.label]));
    const v = c.find((r) => r.id === "d-v-outer-0")!;
    expect(byId.get(v.direction)).toBe("세로");
    expect(v.layer).toBe("outer");
    const hInner = c.find((r) => r.id === "d-h-inner-2")!;
    expect(byId.get(hInner.direction)).toBe("가로");
    expect(hInner.layer).toBe("inner");
  });
```

"single-layer grid → everything outer" 테스트도 같은 방식으로 families 인자를 추가한다.

- [ ] **Step 3: 실행해서 실패 확인**

Run: `npx vitest run src/lib/analysis/classify.test.ts`
Expected: FAIL — `classifyRebars` 인자 개수 불일치로 direction이 families id가 아님

- [ ] **Step 4: classify.ts 구현 수정**

`classifyRebars`의 시그니처와 방향 판정 부분만 바꾼다(레이어 2-means 로직은 그대로 유지):

```ts
// 방향군·레이어(외측/내측) 분류 — 방향은 direction.ts가 뽑은 군에 배정한다
import { dot, normalize, pca, samplePolyline } from "./geom";
import { assignFamily, barAxis } from "./direction";
import type { ClassifiedRebar, DirectionFamily, Rebar, Vec3 } from "./types";
```

`sub` import는 더 이상 쓰지 않으면 지운다. 함수 시그니처:

```ts
export function classifyRebars(
  rebars: Rebar[],
  up: Vec3,
  wallNormal: Vec3,
  families: DirectionFamily[],
): ClassifiedRebar[] {
```

`const u = normalize(up);` 줄은 삭제(더 이상 쓰지 않는다). 마지막 return 블록을 아래로 교체:

```ts
  return rebars.map((r, i) => {
    const direction = assignFamily(barAxis(r), families);
    const layer = singleLayer
      ? "outer"
      : Math.abs(proj[i] - outerCenter) <= Math.abs(proj[i] - Math.min(c0, c1))
        ? "outer"
        : "inner";
    return { ...r, direction, layer };
  });
```

- [ ] **Step 5: judge.ts를 실제 존재하는 그룹 기준으로 수정**

`rejudgeRecords`의 byGroup 계산부에서 하드코딩된 `["horizontal","vertical"]` 이중 루프를 제거하고, 레코드에 실제로 존재하는 (direction, layer) 조합만 순회하도록 바꾼다:

```ts
  const matched = rebars.filter((r) => r.deviationMm != null);
  const groups: GroupSummary[] = [];
  const seen = new Map<string, { direction: string; directionLabel: string; layer: Layer }>();
  for (const r of rebars) {
    const key = `${r.direction}/${r.layer}`;
    if (!seen.has(key)) {
      seen.set(key, {
        direction: r.direction,
        directionLabel: r.directionLabel ?? r.direction,
        layer: r.layer,
      });
    }
  }
  for (const { direction, directionLabel, layer } of seen.values()) {
    const g = rebars.filter((r) => r.direction === direction && r.layer === layer);
    const gm = g.filter((r) => r.deviationMm != null);
    groups.push({
      direction,
      directionLabel,
      layer,
      designCount: g.filter((r) => r.designId != null).length,
      scanCount: g.filter((r) => r.scanId != null).length,
      missing: g.filter((r) => r.verdict === "missing").length,
      outOfTolerance: g.filter((r) => r.verdict === "out_of_tolerance").length,
      meanDeviationMm: gm.length
        ? gm.reduce((s, r) => s + r.deviationMm!.mean, 0) / gm.length
        : null,
    });
  }
```

`judge.ts` 상단 import에서 이제 쓰지 않는 `Direction` 타입 import를 제거하고 `Layer`는 유지한다.

- [ ] **Step 6: label.ts를 방향군 라벨 기반으로 수정**

`DIRECTION_KO` 상수를 지우고, `assignLabels`가 families를 받아 라벨을 붙이도록 바꾼다:

```ts
import { samplePolyline } from "./geom";
import type { ClassifiedRebar, DirectionFamily, RebarRecord } from "./types";

const LAYER_KO = { inner: "내측", outer: "외측" } as const;

export function assignLabels(
  records: RebarRecord[],
  design: ClassifiedRebar[],
  scan: ClassifiedRebar[],
  families: DirectionFamily[],
): RebarRecord[] {
  const familyLabel = new Map(families.map((f) => [f.id, f.label]));
```

정렬 비교부에서 `a.rec.direction === "vertical"` 같은 비교를 방향군 id 사전순으로 바꾼다(그룹이 뭉쳐 있기만 하면 되므로):

```ts
  withPos.sort((a, b) => {
    if (a.rec.direction !== b.rec.direction) return a.rec.direction < b.rec.direction ? -1 : 1;
    if (a.rec.layer !== b.rec.layer) return a.rec.layer === "outer" ? -1 : 1;
    return a.pos - b.pos;
  });
```

정렬 위치값(`sortPos`)의 `rec.direction === "vertical" ? mid[0] : mid[1]` 판단은 방향군 축을 이용하도록 바꾼다:

```ts
  const axisOf = new Map(families.map((f) => [f.id, f.axis]));
  const sortPos = (rec: RebarRecord): number => {
    const rebar =
      (rec.designId != null ? designById.get(rec.designId) : undefined) ??
      (rec.scanId != null ? scanById.get(rec.scanId) : undefined);
    if (!rebar) return Number.POSITIVE_INFINITY;
    const mid = samplePolyline(rebar.centerline, 3)[1];
    const ax = axisOf.get(rec.direction);
    // 철근이 뻗은 방향이 수직에 가까우면 x로, 아니면 y로 줄을 세운다
    const vertical = ax ? Math.abs(ax[1]) > Math.SQRT1_2 : true;
    return vertical ? mid[0] : mid[1];
  };
```

마지막 반환부에서 방향군 라벨을 함께 채운다:

```ts
  return withPos.map(({ rec }) => {
    const groupKey = `${rec.direction}/${rec.layer}`;
    const n = (counters.get(groupKey) ?? 0) + 1;
    counters.set(groupKey, n);
    const dirLabel = familyLabel.get(rec.direction) ?? rec.direction;
    return {
      ...rec,
      directionLabel: dirLabel,
      label: `${dirLabel}-${LAYER_KO[rec.layer]}-${n}`,
    };
  });
```

- [ ] **Step 7: label.test.ts를 새 시그니처로 수정**

`assignLabels(rebars, d, s)` 호출을 `assignLabels(rebars, d, s, fams)`로 바꾸고, 상단에 families 생성을 추가한다:

```ts
import { deriveDirectionFamilies } from "./direction";

const grid = makeWallGrid();
const fams = deriveDirectionFamilies(grid, UP);
const classify = (r = grid) => classifyRebars(r, UP, estimateWallNormal(r), fams);
```

라벨 정규식 기대값은 그대로 둔다(`/^수(직|평)-(내|외)측-\d+$/` → `/^(세로|가로)-(내|외)측-\d+$/`로 교체).

- [ ] **Step 8: 남은 호출부 컴파일 오류 정리**

`pipeline.ts`가 `classifyRebars`를 families 없이 호출하고 있으므로 임시로 families를 만들어 넘긴다(Task 5에서 정식 배선):

```ts
import { deriveDirectionFamilies } from "./direction";
...
  const families = deriveDirectionFamilies(input.design, input.up);
  const designClassified = classifyRebars(input.design, input.up, wallNormal, families);
  const scanTransformed = classifyRebars(transformed, input.up, wallNormal, families);
```

- [ ] **Step 9: 전체 테스트·타입 확인**

Run: `npm test` 그리고 `npx tsc --noEmit`
Expected: 전부 PASS, tsc 무출력

- [ ] **Step 10: 커밋**

```bash
cd /d/Projects/LH/AR && git add office-dashboard/src/lib/analysis
git commit -m "refactor: classify, match and judge by derived direction family"
```

---

### Task 3: 간격 계산 (spacing.ts)

**Files:**
- Create: `office-dashboard/src/lib/analysis/spacing.ts`
- Test: `office-dashboard/src/lib/analysis/spacing.test.ts`

**Interfaces:**
- Consumes: `ClassifiedRebar`, `DirectionFamily`, `Vec3`; `cross/dot/normalize/polylineDistance/samplePolyline/sub` (geom.ts)
- Produces:
  - `spacingGroupKey(direction: DirectionId, layer: Layer): string` — `` `${direction}/${layer}` ``
  - `interface SpacingGap { aId: string; bId: string; direction: DirectionId; layer: Layer; spacingMm: number; requiredMm: number; deviationMm: number; midpoint: Vec3 }`
  - `interface SpacingGroupStat { direction: DirectionId; layer: Layer; medianMm: number; count: number }`
  - `interface SpacingResult { gaps: SpacingGap[]; groups: SpacingGroupStat[] }`
  - `computeSpacing(bars: ClassifiedRebar[], families: DirectionFamily[], wallNormal: Vec3, requiredMm: Record<string, number>): SpacingResult`
  - `suggestRequiredSpacing(stats: SpacingGroupStat[]): Record<string, number>` — 중앙값을 5mm 단위로 반올림

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// office-dashboard/src/lib/analysis/spacing.test.ts
import { describe, expect, it } from "vitest";
import { classifyRebars, estimateWallNormal } from "./classify";
import { deriveDirectionFamilies } from "./direction";
import { computeSpacing, spacingGroupKey, suggestRequiredSpacing } from "./spacing";
import type { Rebar, Vec3 } from "./types";

const UP: Vec3 = [0, 1, 0];
const bar = (id: string, x: number, z = 0): Rebar => ({
  id, radius: 0.008, centerline: [[x, 0, z], [x, 2, z]],
});

/** 세로근만 있는 한 겹 벽 — x가 간격이 된다 */
function wall(xs: number[]): Rebar[] {
  return xs.map((x, i) => bar(`v${i}`, x));
}

function classified(bars: Rebar[]) {
  const fams = deriveDirectionFamilies(bars, UP);
  const n = estimateWallNormal(bars);
  return { bars: classifyRebars(bars, UP, n, fams), fams, n };
}

describe("computeSpacing", () => {
  it("등간격 200mm면 편차 0", () => {
    const { bars, fams, n } = classified(wall([0, 0.2, 0.4, 0.6]));
    const key = spacingGroupKey(bars[0].direction, bars[0].layer);
    const r = computeSpacing(bars, fams, n, { [key]: 200 });
    expect(r.gaps.length).toBe(3);
    for (const g of r.gaps) {
      expect(g.spacingMm).toBeCloseTo(200, 3);
      expect(g.deviationMm).toBeCloseTo(0, 3);
    }
  });

  it("벌어진 구간의 편차를 부호까지 잡아낸다", () => {
    // 간격 200 / 240 / 150 → 편차 0 / +40 / -50. 세 값의 크기가 모두 달라
    // 구간 순서가 뒤바뀌면 반드시 실패한다
    const { bars, fams, n } = classified(wall([0, 0.2, 0.44, 0.59]));
    const key = spacingGroupKey(bars[0].direction, bars[0].layer);
    const r = computeSpacing(bars, fams, n, { [key]: 200 });
    const devs = r.gaps.map((g) => Math.round(g.deviationMm));
    expect(devs).toEqual([0, 40, -50]);
  });

  it("간격은 위치 순서대로 잰다 (입력 순서와 무관)", () => {
    const shuffled = [bar("c", 0.4), bar("a", 0), bar("b", 0.2)];
    const { bars, fams, n } = classified(shuffled);
    const key = spacingGroupKey(bars[0].direction, bars[0].layer);
    const r = computeSpacing(bars, fams, n, { [key]: 200 });
    expect(r.gaps.length).toBe(2);
    for (const g of r.gaps) expect(g.spacingMm).toBeCloseTo(200, 3);
  });

  it("그룹이 다르면 간격을 재지 않는다 (세로 vs 가로)", () => {
    const bars: Rebar[] = [
      ...wall([0, 0.2, 0.4]),
      { id: "h0", radius: 0.008, centerline: [[0, 0.5, 0], [1.5, 0.5, 0]] },
      { id: "h1", radius: 0.008, centerline: [[0, 0.8, 0], [1.5, 0.8, 0]] },
    ];
    const { bars: c, fams, n } = classified(bars);
    const r = computeSpacing(c, fams, n, {});
    const dirs = new Set(r.gaps.map((g) => g.direction));
    expect(dirs.size).toBe(2);
    // 세로 3개 → 2구간, 가로 2개 → 1구간
    expect(r.gaps.length).toBe(3);
  });

  it("철근이 1개뿐인 그룹은 구간이 없다", () => {
    const { bars, fams, n } = classified(wall([0]));
    const r = computeSpacing(bars, fams, n, {});
    expect(r.gaps.length).toBe(0);
  });

  it("요구 간격 미지정이면 그룹 중앙값을 기준으로 삼는다", () => {
    // 간격 200 / 260 / 300 → 중앙값 260. 평균(253.3)·최솟값(200)·최댓값(300)·
    // 첫 구간(200)이 모두 다른 값이라, 기본값이 중앙값이 아니면 반드시 실패한다
    const { bars, fams, n } = classified(wall([0, 0.2, 0.46, 0.76]));
    const r = computeSpacing(bars, fams, n, {});
    expect(r.groups[0].medianMm).toBeCloseTo(260, 3);
    expect(r.gaps.map((g) => Math.round(g.deviationMm))).toEqual([-60, 0, 40]);
  });

  it("레이어가 다르면 같은 방향이라도 간격을 따로 잰다", () => {
    // 앞열(z=0) 3본 200mm 등간격 + 뒷열(z=0.15) 2본 300mm.
    // 레이어를 무시하고 묶으면 x 순서로 50/150/150/50이 나와 반드시 실패한다.
    //
    // ★ 두 레이어의 x 평균을 반드시 같게 둘 것(여기서는 둘 다 0.2).
    //   다르면 PCA 표본에 가짜 x–z 상관이 생겨 estimateWallNormal이 z축에서 몇 도
    //   기울고, 정렬 축도 함께 기울어 간격이 199/299처럼 조금씩 짧게 나온다.
    const bars: Rebar[] = [
      bar("f0", 0), bar("f1", 0.2), bar("f2", 0.4),
      bar("b0", 0.05, 0.15), bar("b1", 0.35, 0.15),
    ];
    const { bars: c, fams, n } = classified(bars);
    const r = computeSpacing(c, fams, n, {});
    expect(new Set(c.map((b) => b.direction)).size).toBe(1); // 방향군은 하나
    const byKey = new Map<string, number[]>();
    for (const g of r.gaps) {
      const k = spacingGroupKey(g.direction, g.layer);
      byKey.set(k, [...(byKey.get(k) ?? []), Math.round(g.spacingMm)]);
    }
    // 레이어 이름(외측/내측)이 어느 z에 붙는지는 클러스터링이 정하므로 이름 대신 형태로 본다
    expect([...byKey.values()].map((v) => v.join(",")).sort()).toEqual(["200,200", "300"]);
  });

  it("길이가 다른 이웃 철근도 간격을 부풀리지 않는다", () => {
    // 실제 간격 200mm. 짧은 쪽이 절반 길이여도 200이어야 한다.
    // polylineDistance(...).mean으로 재면 296.6이 나온다 (긴 쪽 여분이 끝점 거리로 잡힘)
    const bars: Rebar[] = [
      { id: "long", radius: 0.008, centerline: [[0, 0, 0], [0, 2, 0]] },
      { id: "short", radius: 0.008, centerline: [[0.2, 0, 0], [0.2, 1, 0]] },
    ];
    const { bars: c, fams, n } = classified(bars);
    const r = computeSpacing(c, fams, n, {});
    expect(r.gaps.length).toBe(1);
    expect(r.gaps[0].spacingMm).toBeCloseTo(200, 3);
  });

  it("벽을 관통하는 방향군은 면 위 순서가 없으므로 간격을 재지 않는다", () => {
    // 벽면은 xy 평면(법선 z). z축을 따라 놓인 타이 2본은 면 위 정렬축이 정의되지 않는다.
    const bars: Rebar[] = [
      ...wall([0, 0.2, 0.4, 0.6]),
      { id: "tie0", radius: 0.008, centerline: [[0.1, 1, -0.1], [0.1, 1, 0.1]] },
      { id: "tie1", radius: 0.008, centerline: [[0.3, 1, -0.1], [0.3, 1, 0.1]] },
    ];
    const { bars: c, fams, n } = classified(bars);
    const r = computeSpacing(c, fams, n, {});
    const tieDir = c.find((b) => b.id === "tie0")!.direction;
    expect(r.gaps.some((g) => g.direction === tieDir)).toBe(false);
    // 벽면 철근 쪽은 그대로 측정된다
    expect(r.gaps.length).toBeGreaterThan(0);
  });

  it("살짝 기운 관통 방향군도 건너뛴다 (임계가 1e-9이 아니라 0.05인 이유)", () => {
    // 법선에서 약 2° 기운 타이 2본. |cross| ≈ 0.035 < ORDER_MIN_SIN이라 걸러진다.
    // 임계가 1e-9이면 order가 ±x로 잡혀 두 타이 사이에 200mm짜리 가짜 간격이 생긴다.
    const t = Math.tan((2 * Math.PI) / 180) * 0.2; // z로 0.2 갈 때 y 변위
    const tie = (id: string, x: number): Rebar => ({
      id, radius: 0.008, centerline: [[x, 1, -0.1], [x, 1 + t, 0.1]],
    });
    const { bars: c, fams, n } = classified([...wall([0, 0.2, 0.4, 0.6]), tie("t0", 0.1), tie("t1", 0.3)]);
    const r = computeSpacing(c, fams, n, {});
    const tieDir = c.find((b) => b.id === "t0")!.direction;
    expect(tieDir).not.toBe(c.find((b) => b.id === "v0")!.direction); // 별도 방향군
    expect(r.gaps.some((g) => g.direction === tieDir)).toBe(false);
  });

  it("10° 기울어도, 기운 방향에 상관없이 관통 방향군은 건너뛴다", () => {
    // |cross| = sin10° ≈ 0.174 < ORDER_MIN_SIN(0.5). 임계가 0.05(≈3°)였을 때는
    // 이 군이 통과해서, 같은 타이가 기운 방향에 따라 다른 값을 냈다 —
    // x–z로 기울면 정렬축이 ±y라 0mm, y–z로 기울면 ±x라 200mm짜리 가짜 간격.
    const d = 0.2 * Math.tan((10 * Math.PI) / 180);
    const cases: [string, (x: number) => Vec3[]][] = [
      ["x-z", (x) => [[x, 1, -0.1], [x + d, 1, 0.1]]],
      ["y-z", (x) => [[x, 1, -0.1], [x, 1 + d, 0.1]]],
    ];
    for (const [name, line] of cases) {
      const tie = (id: string, x: number): Rebar => ({ id, radius: 0.008, centerline: line(x) });
      const { bars: c, fams, n } = classified([
        ...wall([0, 0.2, 0.4, 0.6]), tie("t0", 0.1), tie("t1", 0.3),
      ]);
      const r = computeSpacing(c, fams, n, {});
      const tieDir = c.find((b) => b.id === "t0")!.direction;
      expect(r.gaps.some((g) => g.direction === tieDir), name).toBe(false);
      expect(r.gaps.length, name).toBeGreaterThan(0); // 벽면 철근은 그대로 측정된다
    }
  });

  it("접촉이음(철근이 맞닿은 이음)도 간격으로 세지 않는다", () => {
    // D25(반지름 12.5mm) 두 본이 맞닿으면 중심거리가 곧 지름 25mm — 중심거리에
    // 20mm 고정 하한을 두면 통과해버린다. 순간격(25-25=0)으로 재야 걸린다.
    const R = 0.0125;
    const bars: Rebar[] = [
      { id: "lower", radius: R, centerline: [[0, 0, 0], [0, 2, 0]] },
      { id: "upper", radius: R, centerline: [[0.025, 1.8, 0], [0.025, 3.8, 0]] },
      { id: "nbr", radius: R, centerline: [[0.225, 0, 0], [0.225, 3.8, 0]] },
    ];
    const { bars: c, fams, n } = classified(bars);
    const r = computeSpacing(c, fams, n, {});
    expect(r.gaps.map((g) => Math.round(g.spacingMm))).toEqual([200]);
  });

  it("겹침이음처럼 같은 자리에 있는 두 철근은 간격으로 세지 않는다", () => {
    // x=0에서 하부근과 상부근이 겹쳐 이어지고, 이웃 철근이 200mm 떨어져 있다.
    // 0mm 구간을 세면 중앙값이 100mm로 내려가 요구간격 기본값까지 망가진다
    const bars: Rebar[] = [
      { id: "lower", radius: 0.008, centerline: [[0, 0, 0], [0, 2, 0]] },
      { id: "upper", radius: 0.008, centerline: [[0, 1.8, 0], [0, 3.8, 0]] },
      { id: "nbr", radius: 0.008, centerline: [[0.2, 0, 0], [0.2, 3.8, 0]] },
    ];
    const { bars: c, fams, n } = classified(bars);
    const r = computeSpacing(c, fams, n, {});
    expect(r.gaps.map((g) => Math.round(g.spacingMm))).toEqual([200]);
    expect(r.groups[0].medianMm).toBeCloseTo(200, 3);
  });

  it("중점은 두 철근 사이에 놓인다", () => {
    const { bars, fams, n } = classified(wall([0, 0.2]));
    const r = computeSpacing(bars, fams, n, {});
    expect(r.gaps[0].midpoint[0]).toBeCloseTo(0.1, 6);
  });
});

describe("suggestRequiredSpacing", () => {
  it("중앙값을 5mm 단위로 반올림해 제안한다", () => {
    const out = suggestRequiredSpacing([
      { direction: "v1", layer: "outer", medianMm: 203.2, count: 5 },
      { direction: "h1", layer: "outer", medianMm: 297.6, count: 4 },
    ]);
    expect(out["v1/outer"]).toBe(205);
    expect(out["h1/outer"]).toBe(300);
  });
});
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npx vitest run src/lib/analysis/spacing.test.ts`
Expected: FAIL — `Cannot find module './spacing'`

- [ ] **Step 3: spacing.ts 구현**

```ts
// office-dashboard/src/lib/analysis/spacing.ts
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
```

`midpointOf`는 `samplePolyline(line, 3)[1]` — 호길이 기준 중점이다(직선이 아닌 사재에서도 가운데가 나온다).

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/analysis/spacing.test.ts`
Expected: PASS (15 tests)

- [ ] **Step 5: 커밋**

```bash
cd /d/Projects/LH/AR && git add office-dashboard/src/lib/analysis/spacing.ts office-dashboard/src/lib/analysis/spacing.test.ts
git commit -m "feat: measure rebar-to-rebar spacing per direction and layer"
```

---

### Task 4: 컨투어 색 단계와 벽면 보간 필드 (contour.ts)

**Files:**
- Create: `office-dashboard/src/lib/analysis/contour.ts`
- Test: `office-dashboard/src/lib/analysis/contour.test.ts`

**Interfaces:**
- Consumes: `ClassifiedRebar`, `Vec3`, `SpacingGap`; `cross/dot/normalize/samplePolyline/sub` (geom.ts)
- Produces:
  - `CONTOUR_COLORS: readonly string[]` — 5단계 `["#2c7bb6","#abd9e9","#ffffbf","#fdae61","#d7191c"]`
  - `DEFAULT_CONTOUR_MAX = { spacing: 50, position: 30 }`
  - `contourBand(absMm: number, maxMm: number): number` — 0~4
  - `contourColor(absMm: number, maxMm: number): string`
  - `interface WallPlane { origin: Vec3; axisU: Vec3; axisV: Vec3; width: number; height: number }`
  - `fitWallPlane(bars: ClassifiedRebar[], wallNormal: Vec3, up: Vec3, marginM?: number): WallPlane`
  - `interface ContourSample { midpoint: Vec3; deviationMm: number }` — `SpacingGap`이 구조적으로 이 형태를 만족하므로 `SpacingGap[]`을 그대로 넘길 수 있다. 위치 편차 지표는 화면에서 철근 중점 + 편차로 직접 만든다.
  - `interface ContourField { cols: number; rows: number; plane: WallPlane; values: (number | null)[] }`
  - `buildContourField(samples: ContourSample[], plane: WallPlane, opts?: { cols?: number; rows?: number; radiusM?: number; power?: number }): ContourField`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// office-dashboard/src/lib/analysis/contour.test.ts
import { describe, expect, it } from "vitest";
import {
  buildContourField, contourBand, contourColor, CONTOUR_COLORS, fitWallPlane,
} from "./contour";
import { cross, dot, normalize } from "./geom";
import type { ClassifiedRebar, Vec3 } from "./types";
import type { SpacingGap } from "./spacing";

const UP: Vec3 = [0, 1, 0];
const NORMAL: Vec3 = [0, 0, 1];

// `directionLabel`은 Task 2에서 ClassifiedRebar의 필수 필드가 됐다 — 리터럴에 빠뜨리면 tsc가 깨진다
const bars: ClassifiedRebar[] = [0, 0.2, 0.4, 0.6].map((x, i) => ({
  id: `v${i}`, radius: 0.008, direction: "v1", directionLabel: "세로", layer: "outer",
  centerline: [[x, 0, 0], [x, 2, 0]] as Vec3[],
}));

const gap = (x: number, y: number, dev: number): SpacingGap => ({
  aId: "a", bId: "b", direction: "v1", layer: "outer",
  spacingMm: 200 + dev, requiredMm: 200, deviationMm: dev, midpoint: [x, y, 0],
});

describe("contourBand", () => {
  it("0은 첫 단계, 상한 이상은 마지막 단계", () => {
    expect(contourBand(0, 50)).toBe(0);
    expect(contourBand(50, 50)).toBe(4);
    expect(contourBand(999, 50)).toBe(4);
  });
  it("상한을 5등분한다", () => {
    expect(contourBand(9, 50)).toBe(0);   // 0~10
    expect(contourBand(11, 50)).toBe(1);  // 10~20
    expect(contourBand(25, 50)).toBe(2);  // 20~30
    expect(contourBand(35, 50)).toBe(3);  // 30~40
    expect(contourBand(45, 50)).toBe(4);  // 40~
  });
  it("경계값은 위쪽 단계에 속한다", () => {
    // 경계를 정확히 밟는 값이 없으면 `<`와 `<=` 구현을 구분하지 못한다
    expect(contourBand(10, 50)).toBe(1);
    expect(contourBand(20, 50)).toBe(2);
    expect(contourBand(40, 50)).toBe(4);
  });
  it("상한이 0 이하여도 깨지지 않는다", () => {
    expect(contourBand(5, 0)).toBe(4);
  });
});

describe("contourColor", () => {
  it("단계에 맞는 색을 준다", () => {
    expect(contourColor(0, 50)).toBe(CONTOUR_COLORS[0]);
    expect(contourColor(100, 50)).toBe(CONTOUR_COLORS[4]);
  });
  it("NaN 편차에도 색을 돌려준다 (undefined 반환 금지)", () => {
    expect(contourColor(NaN, 50)).toBe(CONTOUR_COLORS[0]);
  });
  it("무한대 편차는 NaN과 달리 마지막 단계다", () => {
    // isFinite로 한꺼번에 막으면 무한히 큰 편차가 가장 안전한 파란색으로 칠해진다
    expect(contourBand(Infinity, 50)).toBe(4);
    expect(contourBand(-Infinity, 50)).toBe(4);
  });
});

describe("fitWallPlane", () => {
  it("철근군을 감싸는 평면을 만든다", () => {
    const p = fitWallPlane(bars, NORMAL, UP, 0);
    expect(p.width).toBeCloseTo(0.6, 6);
    expect(p.height).toBeCloseTo(2, 6);
  });
  it("여유(margin)를 주면 그만큼 넓어진다", () => {
    const p = fitWallPlane(bars, NORMAL, UP, 0.1);
    expect(p.width).toBeCloseTo(0.8, 6);
    expect(p.height).toBeCloseTo(2.2, 6);
  });

  it("축과 원점을 고정한다 — Task 6이 텍스처를 얹는 기준", () => {
    // width/height만 검사하면 axisV를 뒤집어도 필드가 자기 안에서 일관돼 전부 통과한다.
    // 그러면 지도가 상하 반전된 채 그려지므로 축 자체를 못 박는다.
    const p = fitWallPlane(bars, NORMAL, UP, 0);
    expect(p.axisU).toEqual([1, 0, 0]);
    expect(p.axisV).toEqual([0, 1, 0]);
    expect(p.origin).toEqual([0, 0, 0]); // 최소 u·최소 v 모서리 = values[0]이 가리키는 칸
    const h = cross(p.axisU, p.axisV);   // 오른손 좌표계여야 한다
    expect(h[0]).toBeCloseTo(NORMAL[0], 9);
    expect(h[1]).toBeCloseTo(NORMAL[1], 9);
    expect(h[2]).toBeCloseTo(NORMAL[2], 9);
  });

  it("up의 크기가 1이 아니어도 세로축은 벽면 안에 남는다", () => {
    const tilted = normalize([0, 1, 1] as Vec3);
    const p1 = fitWallPlane(bars, tilted, [0, 1, 0], 0);
    const p2 = fitWallPlane(bars, tilted, [0, 2, 0], 0); // 같은 방향, 길이만 2배
    expect(dot(p2.axisV, tilted)).toBeCloseTo(0, 9);     // 벽면을 벗어나지 않는다
    expect(p2.axisV[0]).toBeCloseTo(p1.axisV[0], 9);     // 길이는 결과에 영향이 없다
    expect(p2.axisV[1]).toBeCloseTo(p1.axisV[1], 9);
    expect(p2.axisV[2]).toBeCloseTo(p1.axisV[2], 9);
  });
});

describe("buildContourField", () => {
  const plane = fitWallPlane(bars, NORMAL, UP, 0.05);

  it("표본 근처 칸은 그 표본 값을 따라간다", () => {
    const f = buildContourField([gap(0.1, 1.0, 40)], plane, { cols: 8, rows: 8, radiusM: 5 });
    const filled = f.values.filter((v): v is number => v != null);
    expect(filled.length).toBeGreaterThan(0);
    for (const v of filled) expect(v).toBeCloseTo(40, 6);
  });

  it("반경 밖 칸은 null로 남는다", () => {
    const f = buildContourField([gap(0.05, 0.05, 30)], plane, { cols: 8, rows: 8, radiusM: 0.1 });
    expect(f.values.some((v) => v == null)).toBe(true);
    expect(f.values.some((v) => v != null)).toBe(true);
  });

  it("두 표본 사이 값은 거리에 반비례해 보간된다", () => {
    // 범위만 검사하면(0~60 사이, 중간값 존재) 균등 평균도, 가중치를 뒤집은
    // 좌우 반전 필드도 전부 통과한다 — 편차 핫스팟이 반대쪽 벽에 찍혀도 못 잡는다.
    // 그래서 실제 IDW 값을 못 박는다.
    const f = buildContourField(
      [gap(0.0, 1.0, 0), gap(0.6, 1.0, 60)],
      plane, { cols: 7, rows: 3, radiusM: 5 },
    );
    const row = f.values.slice(7, 14); // 표본이 놓인 가운데 행(r=1)
    expect(row.every((v) => v != null)).toBe(true);
    expect(row[0]).toBeCloseTo(0, 6);        // 표본에 정확히 걸린 칸
    expect(row[1]).toBeCloseTo(2.3077, 3);   // 균등 평균이면 30, 반전이면 57.69
    expect(row[3]).toBeCloseTo(30, 6);       // 두 표본에서 등거리
    expect(row[5]).toBeCloseTo(57.6923, 3);
    expect(row[6]).toBeCloseTo(60, 6);
  });

  it("values의 0행은 v=0쪽 — 평면 원점이 있는 아래 모서리다", () => {
    // Task 6이 이 배열을 그대로 DataTexture로 올린다. 행 순서가 뒤집히면 지도가
    // 상하 반전되는데, 나머지 필드 테스트는 전부 상하 대칭이라 하나도 걸리지 않는다.
    const f = buildContourField([gap(0.3, 0.1, 40)], plane, { cols: 2, rows: 2, radiusM: 0.5 });
    expect(f.values.slice(0, 2).some((v) => v != null)).toBe(true);  // 아래 행 = 표본이 있는 쪽
    expect(f.values.slice(2, 4).every((v) => v == null)).toBe(true); // 위 행 = 반경 밖
  });

  it("표본이 없으면 전부 null", () => {
    const f = buildContourField([], plane, { cols: 4, rows: 4 });
    expect(f.values.every((v) => v == null)).toBe(true);
    expect(f.values.length).toBe(16);
  });

  it("편차의 절댓값을 쓴다 (좁아도 벌어져도 색이 든다)", () => {
    const f = buildContourField([gap(0.3, 1.0, -40)], plane, { cols: 4, rows: 4, radiusM: 5 });
    const filled = f.values.filter((v): v is number => v != null);
    for (const v of filled) expect(v).toBeCloseTo(40, 6);
  });
});
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npx vitest run src/lib/analysis/contour.test.ts`
Expected: FAIL — `Cannot find module './contour'`

- [ ] **Step 3: contour.ts 구현**

```ts
// office-dashboard/src/lib/analysis/contour.ts
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/analysis/contour.test.ts`
Expected: PASS (17 tests)

- [ ] **Step 5: 커밋**

```bash
cd /d/Projects/LH/AR && git add office-dashboard/src/lib/analysis/contour.ts office-dashboard/src/lib/analysis/contour.test.ts
git commit -m "feat: contour colour bands and IDW wall field"
```

---

### Task 5: 파이프라인 배선 + 결과 스키마 v2

**Files:**
- Modify: `office-dashboard/src/lib/analysis/pipeline.ts`
- Modify: `office-dashboard/src/lib/analysis/types.ts`
- Test: `office-dashboard/src/lib/analysis/pipeline.test.ts` (테스트 추가)

**Interfaces:**
- Consumes: Task 1·3·4의 `deriveDirectionFamilies`, `computeSpacing`, `suggestRequiredSpacing`, `fitWallPlane`
- Produces:
  - `AnalysisInput`에 `requiredSpacingMm?: Record<string, number>` 추가
  - `AnalysisOutput`에 `families: DirectionFamily[]`, `wallNormal: Vec3`, `spacing: SpacingResult`, `plane: WallPlane` 추가
  - `AnalysisResult.version: 2`, `families`, `requiredSpacingMm`, `spacingGroups` 추가

- [ ] **Step 1: types.ts의 AnalysisResult를 v2로 갱신**

```ts
export interface AnalysisResult {
  version: 2;
  scanId: string;
  arId: string;
  registration: RegistrationResult;
  /** 위치 편차 판정용 허용오차 (mm) */
  toleranceMm: number;
  /**
   * 방향군. 라벨 자체는 이미 RebarRecord.label/directionLabel에 구워져 저장되므로
   * "라벨 복원"용이 아니다 — 재방문 시 **그룹 정렬 순서**(각도순, id 사전순이 아님)와
   * 요구간격 입력칸 이름에 쓴다.
   */
  families: DirectionFamily[];
  /** 그룹별 요구 간격 (mm). key = `${direction}/${layer}` */
  requiredSpacingMm: Record<string, number>;
  /** 그룹별 실측 간격 중앙값 */
  spacingGroups: { direction: DirectionId; layer: Layer; medianMm: number; count: number }[];
  rebars: RebarRecord[];
  summary: AnalysisSummary;
}
```

- [ ] **Step 2: 실패하는 테스트 추가 (pipeline.test.ts 하단)**

```ts
import { mat4Identity } from "./geom";
import { spacingGroupKey } from "./spacing";

describe("runAnalysis: 방향군과 간격", () => {
  it("방향군을 산출하고 간격 구간을 만든다", () => {
    const design = makeWallGrid();
    const scan = transformRebars(makeWallGrid(), rigidMat4(20, [0.4, 0, 0]))
      .map((r, i) => ({ ...r, id: `s${i}` }));
    const out = runAnalysis({ design, scan, toleranceMm: 10, up: UP });
    expect(out.families.length).toBeGreaterThanOrEqual(2);
    expect(out.spacing.gaps.length).toBeGreaterThan(0);
    expect(out.spacing.groups.every((g) => g.medianMm > 0)).toBe(true);
    expect(out.plane.width).toBeGreaterThan(0);
    // ★ 위 네 단언은 설계/스캔을 뒤바꿔 배선해도 전부 통과한다(픽스처가 합동이므로).
    //   간격은 반드시 시공 스캔에서 재야 하므로 id로 못 박는다 — 스캔 id는 s*, 설계는 d-*.
    expect(out.spacing.gaps.every((g) => g.aId.startsWith("s") && g.bId.startsWith("s"))).toBe(true);
  });

  it("컨투어 평면은 설계가 아니라 시공 스캔에 맞춘다", () => {
    // makeWallGrid의 x 범위는 0~1.8. 스캔에만 있는 도면 외 철근을 x=2.4에 세우면
    // 스캔에 맞춘 평면은 그만큼 넓어지고, 설계에 맞췄다면 두 평면의 폭이 같다.
    //
    // ★ manualInit=단위행렬로 코스 정합을 건너뛴다(registerScan은 manualInit이 있으면
    //   coarseCandidates를 생략하고 바로 ICP로 간다). 이 테스트의 대상은 fitWallPlane의
    //   배선이지 정합이 아니다. 자동 코스 정합을 태우면 makeWallGrid의 x/y 분산이
    //   0.383 대 0.355로 가까워서 추가 철근 한 본이 PCA 고유벡터 순서를 뒤집고,
    //   축을 위치로 짝짓는 coarseCandidates가 90° 어긋난 초기값을 준다.
    const design = makeWallGrid();
    const plain = makeWallGrid().map((r, i) => ({ ...r, id: `s${i}` }));
    const withExtra: Rebar[] = [
      ...plain,
      { id: "s-extra", radius: 0.008, centerline: [[2.4, 0, 0], [2.4, 1, 0], [2.4, 2, 0]] },
    ];
    const base = { design, toleranceMm: 10, up: UP, manualInit: mat4Identity() };
    const a = runAnalysis({ ...base, scan: plain });
    const b = runAnalysis({ ...base, scan: withExtra });
    expect(a.registration.failed).toBe(false);
    expect(b.registration.failed).toBe(false);
    expect(b.plane.width).toBeGreaterThan(a.plane.width + 0.4);
  });

  it("요구 간격을 주면 그 값으로 편차를 잰다", () => {
    const design = makeWallGrid();
    const scan = makeWallGrid().map((r, i) => ({ ...r, id: `s${i}` }));
    const base = runAnalysis({ design, scan, toleranceMm: 10, up: UP });
    const key = spacingGroupKey(base.spacing.groups[0].direction, base.spacing.groups[0].layer);
    const out = runAnalysis({
      design, scan, toleranceMm: 10, up: UP,
      requiredSpacingMm: { [key]: 100 },
    });
    const g = out.spacing.gaps.find((x) => spacingGroupKey(x.direction, x.layer) === key)!;
    expect(g.requiredMm).toBe(100);
    expect(g.deviationMm).toBeCloseTo(g.spacingMm - 100, 6);
  });
});
```

- [ ] **Step 3: 실행해서 실패 확인**

Run: `npx vitest run src/lib/analysis/pipeline.test.ts`
Expected: FAIL — `out.families` / `out.spacing` 이 undefined

- [ ] **Step 4: pipeline.ts 구현**

```ts
// 분석 파이프라인 진입점 — spec §5. useAnalysis 훅(메인스레드)이 이 함수만 호출한다.
import { classifyRebars, estimateWallNormal } from "./classify";
import { fitWallPlane, type WallPlane } from "./contour";
import { deriveDirectionFamilies } from "./direction";
import { applyMat4 } from "./geom";
import { judge } from "./judge";
import { matchRebars } from "./match";
import { registerScan } from "./registration";
import { computeSpacing, type SpacingResult } from "./spacing";
import type {
  AnalysisSummary, ClassifiedRebar, DirectionFamily, Mat4, Rebar, RebarRecord, Vec3,
} from "./types";

export interface AnalysisInput {
  design: Rebar[];
  scan: Rebar[];
  toleranceMm: number;
  up: Vec3;
  manualInit?: Mat4;
  /** 그룹별 요구 간격 (mm). 없으면 그룹 실측 중앙값을 기준으로 삼는다 */
  requiredSpacingMm?: Record<string, number>;
}

export interface AnalysisOutput {
  registration: { matrix: Mat4; rmsMm: number; method: "auto" | "manual"; failed: boolean };
  rebars: RebarRecord[];
  summary: AnalysisSummary;
  designClassified: ClassifiedRebar[];
  scanTransformed: ClassifiedRebar[];
  families: DirectionFamily[];
  wallNormal: Vec3;
  /** 시공(as-built) 철근 기준 간격 결과 */
  spacing: SpacingResult;
  /** 컨투어를 그릴 벽면 */
  plane: WallPlane;
}

export function runAnalysis(input: AnalysisInput): AnalysisOutput {
  const registration = registerScan(input.scan, input.design, input.manualInit);
  const transformed: Rebar[] = input.scan.map((r) => ({
    ...r,
    centerline: r.centerline.map((p) => applyMat4(registration.matrix, p)),
  }));
  const wallNormal = estimateWallNormal(input.design);
  // 방향군은 설계모델에서 뽑아 설계·스캔 양쪽에 같은 기준을 적용한다
  const families = deriveDirectionFamilies(input.design, input.up);
  const designClassified = classifyRebars(input.design, input.up, wallNormal, families);
  const scanTransformed = classifyRebars(transformed, input.up, wallNormal, families);
  const match = matchRebars(designClassified, scanTransformed);
  const { rebars, summary } = judge(designClassified, scanTransformed, match, input.toleranceMm);
  const spacing = computeSpacing(scanTransformed, families, wallNormal, input.requiredSpacingMm ?? {});
  const plane = fitWallPlane(scanTransformed, wallNormal, input.up);
  return {
    registration, rebars, summary, designClassified, scanTransformed,
    families, wallNormal, spacing, plane,
  };
}
```

- [ ] **Step 5: 전체 테스트·타입·빌드 확인**

Run: `npm test` → 전부 PASS, `npx tsc --noEmit` → 무출력, `npm run build` → 성공

- [ ] **Step 6: 커밋**

```bash
cd /d/Projects/LH/AR && git add office-dashboard/src/lib/analysis
git commit -m "feat: pipeline emits direction families, spacing gaps and wall plane"
```

---

### Task 6: 뷰어 컨투어 평면 (AnalysisViewer)

**Files:**
- Modify: `office-dashboard/src/components/analysis/AnalysisViewer.tsx`

**Interfaces:**
- Consumes: `ContourField`, `contourColor` (contour.ts)
- Produces: `ViewerProps`에 `contour: ContourField | null`, `contourMax: number` 추가 (null이면 평면을 그리지 않는다)

- [ ] **Step 1: import와 props 확장**

`AnalysisViewer.tsx` 상단 import에 추가:

```ts
import { contourColor, type ContourField } from "../../lib/analysis/contour";
```

`ViewerProps` 인터페이스 끝(`focusKey: string | null;` 앞)에 추가:

```ts
  /** 간격/위치 편차 보간 지도. null이면 그리지 않는다 */
  contour: ContourField | null;
  /** 컨투어 색 상한 (mm) */
  contourMax: number;
```

함수 시그니처의 구조분해에 `contour, contourMax,`를 추가한다.

- [ ] **Step 2: 컨투어 레이어 그룹 추가**

`sceneRef`의 타입에 `contourLayer: THREE.Group;`을 `meshLayer` 다음에 추가하고, 부트스트랩 이펙트에서:

```ts
    const overlay = new THREE.Group();
    const meshLayer = new THREE.Group();
    const contourLayer = new THREE.Group();
    scene.add(overlay, meshLayer, contourLayer);
    sceneRef.current = { scene, camera, controls, overlay, meshLayer, contourLayer, keyed: new Map() };
```

- [ ] **Step 3: 평면 메시 빌더 추가**

`rebarGroup` 함수 아래에 추가:

```ts
/**
 * 편차 보간 지도를 벽면 평면에 붙인다.
 * 텍스처 필터를 NearestFilter로 두어 색이 부드럽게 섞이지 않고 **계단 띠**로 보이게 한다
 * (등고선처럼 읽혀야 어느 구간이 어느 단계인지 눈으로 셀 수 있다).
 */
function contourMesh(field: ContourField, maxMm: number): THREE.Mesh {
  const { cols, rows, plane, values } = field;
  const data = new Uint8Array(cols * rows * 4);
  const c = new THREE.Color();
  for (let i = 0; i < cols * rows; i++) {
    const v = values[i];
    if (v == null) continue; // alpha 0 = 표본이 없는 자리는 비운다
    c.set(contourColor(v, maxMm));
    data[i * 4] = Math.round(c.r * 255);
    data[i * 4 + 1] = Math.round(c.g * 255);
    data[i * 4 + 2] = Math.round(c.b * 255);
    data[i * 4 + 3] = 205;
  }
  const tex = new THREE.DataTexture(data, cols, rows, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  // ★ 행을 뒤집지 말 것. DataTexture는 flipY가 기본 false(일반 Texture는 true)이고
  //   PlaneGeometry는 아래 모서리가 v=0이다. field.values의 0행도 v=0(평면 origin)
  //   쪽이므로 그대로 올리면 방향이 맞는다. 뒤집으면 지도가 상하 반전된다.

  const geo = new THREE.PlaneGeometry(Math.max(plane.width, 1e-3), Math.max(plane.height, 1e-3));
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  const u = new THREE.Vector3(...plane.axisU);
  const v = new THREE.Vector3(...plane.axisV);
  const n = new THREE.Vector3().crossVectors(u, v).normalize();
  mesh.setRotationFromMatrix(new THREE.Matrix4().makeBasis(u, v, n));
  // PlaneGeometry는 중심 기준이라 origin(좌하단)에서 절반씩 이동시킨다
  mesh.position.set(
    plane.origin[0] + u.x * plane.width / 2 + v.x * plane.height / 2,
    plane.origin[1] + u.y * plane.width / 2 + v.y * plane.height / 2,
    plane.origin[2] + u.z * plane.width / 2 + v.z * plane.height / 2,
  );
  mesh.renderOrder = -1; // 철근 원통보다 먼저 그려 뒤로 깔린다
  return mesh;
}
```

- [ ] **Step 4: 컨투어 이펙트 추가**

`// ---- 스캔 메시 토글 ----` 이펙트 바로 앞에 삽입:

```ts
  // ---- 컨투어 평면 ----
  // 정합이 실패했을 때는 호출부(Task 7)가 contour에 null을 넘긴다. 실패한 정합의
  // scanTransformed는 엉뚱한 자리에 놓인 점군이라 그 위에서 잰 간격·평면은 부정확한
  // 게 아니라 무의미하다 — 확신에 찬 쓰레기 지도를 그리느니 아무것도 안 그리는 게 맞다.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    disposeChildren(s.contourLayer);
    if (!contour) return;
    s.contourLayer.add(contourMesh(contour, contourMax));
  }, [contour, contourMax]);
```

- [ ] **Step 5: AnalysisView에 임시 전달값 추가 (빌드를 깨지 않기 위해)**

새 prop이 필수라서 `AnalysisView.tsx`가 컴파일되지 않는다. Task 7이 진짜 값을 배선할
때까지 자리만 채운다 — `<AnalysisViewer ... />`에 두 줄 추가:

```tsx
          contour={null}
          contourMax={DEFAULT_CONTOUR_MAX.spacing}
```

그리고 import에 `import { DEFAULT_CONTOUR_MAX } from "../../lib/analysis/contour";`를 더한다.
**이게 Task 6이 AnalysisView에 하는 전부다.** 지표 토글·요구간격 입력·컬러바는 Task 7 몫이다.

- [ ] **Step 6: 타입·테스트·빌드 확인**

Run: `cd /d/Projects/LH/AR/office-dashboard && npx tsc --noEmit && npm test -- --run && npm run build`
Expected: 타입 오류 0, 테스트 전부 PASS(128), 빌드 성공

- [ ] **Step 7: 커밋**

```bash
cd /d/Projects/LH/AR && git add office-dashboard/src/components/analysis
git commit -m "feat: render deviation contour plane in the 3D viewer"
```

---

### Task 7: 분석 화면 — 지표 전환 · 요구 간격 입력 · 컬러바

**Files:**
- Modify: `office-dashboard/src/components/analysis/AnalysisView.tsx`

**Interfaces:**
- Consumes: Task 3~6 전부 (`computeSpacing`, `spacingGroupKey`, `suggestRequiredSpacing`, `buildContourField`, `CONTOUR_COLORS`, `DEFAULT_CONTOUR_MAX`, `contourColor`, 뷰어의 `contour`/`contourMax` prop)
- Produces: 화면 전용 — 외부에 노출하는 새 심볼 없음

- [ ] **Step 0: spacing.ts에 중점 헬퍼를 공개한다**

`spacing.ts`의 파일 내부 함수 `midpointOf`를 `barMidpoint`라는 이름으로 export하고,
기존 호출부를 새 이름으로 바꾼다. 위치 지표와 간격 지표가 **같은** 중점 정의를 쓰게
하려는 것이다 — 각자 구현하면 갈라지고, 실제로 갈라져서 위치 지도가 끝점에 찍혔다.

```ts
/**
 * 철근 중심선의 호길이 중점. 2점짜리 중심선에서 `line[length/2]`는 끝점이므로
 * 반드시 이 함수를 쓸 것. 간격·위치 두 지표가 공유한다.
 */
export function barMidpoint(r: { centerline: Vec3[] }): Vec3 {
  return samplePolyline(r.centerline, 3)[1];
}
```

- [ ] **Step 1: import 교체**

```ts
import {
  buildContourField, CONTOUR_COLORS, contourColor, DEFAULT_CONTOUR_MAX, type ContourSample,
} from "../../lib/analysis/contour";
import {
  barMidpoint, computeSpacing, spacingGroupKey, suggestRequiredSpacing,
} from "../../lib/analysis/spacing";
```

Mantine import에 `SegmentedControl`을 추가한다.

- [ ] **Step 2: 상태 추가**

`const [nudge, setNudge] = useState(...)` 다음 줄에 추가:

```ts
  // 지표: 간격 편차(기본) ↔ 위치 편차
  const [metric, setMetric] = useState<"spacing" | "position">("spacing");
  const [showContour, setShowContour] = useState(true);
  const [contourMax, setContourMax] = useState<number>(DEFAULT_CONTOUR_MAX.spacing);
  /** 그룹별 요구 간격 (mm). key = `${direction}/${layer}` */
  const [requiredSpacing, setRequiredSpacing] = useState<Record<string, number>>({});
```

- [ ] **Step 3: 지표 전환 시 상한 기본값 재설정**

`analyze` 콜백 정의 아래에 추가:

```ts
  const changeMetric = useCallback((v: string) => {
    const m = v === "position" ? "position" : "spacing";
    setMetric(m);
    setContourMax(DEFAULT_CONTOUR_MAX[m]);
  }, []);
```

- [ ] **Step 4: 저장 결과 로드/저장을 version 2로**

로드부의 `prev.version === 1` 검사를 아래로 교체:

```ts
          if (
            !cancelled &&
            prev.version === 2 &&
            Array.isArray(prev.rebars) &&
            typeof prev.toleranceMm === "number"
          ) {
            setSavedRecords(prev.rebars);
            setTolerance(prev.toleranceMm);
            if (prev.requiredSpacingMm) setRequiredSpacing(prev.requiredSpacingMm);
            if (Array.isArray(prev.registration?.matrix) && prev.registration.matrix.length === 16) {
              setSavedMatrix(prev.registration.matrix);
            }
          }
```

저장부의 결과 객체를 아래로 교체(`analyze` 안):

```ts
          const suggested = suggestRequiredSpacing(out.spacing.groups);
          const merged = { ...suggested, ...requiredSpacing };
          setRequiredSpacing(merged);
          const result: AnalysisResult = {
            version: 2, scanId: scan.scan_id, arId,
            registration: {
              matrix: out.registration.matrix,
              rmsMm: out.registration.rmsMm,
              method: out.registration.method,
            },
            toleranceMm: tolerance,
            families: out.families,
            requiredSpacingMm: merged,
            spacingGroups: out.spacing.groups,
            rebars: out.rebars,
            summary: out.summary,
          };
```

`analyze`의 의존성 배열에 `requiredSpacing`을 추가한다. `run(...)` 호출에는 `requiredSpacingMm: requiredSpacing`를 넘긴다.

- [ ] **Step 5: 간격·컨투어 파생값 계산**

`const view = useMemo(...)` 아래에 추가:

```ts
  /**
   * 요구 간격이 바뀌면 정합을 다시 돌리지 않고 간격만 다시 잰다.
   * 정합 실패 시 null — 컨투어와 같은 기준이다. 실패한 정합의 scanTransformed는 엉뚱한
   * 자리라 간격도 무의미하므로, 지도만 끄고 표에는 숫자를 남기면 안 된다.
   */
  const spacing = useMemo(() => {
    if (!output || output.registration.failed) return null;
    return computeSpacing(output.scanTransformed, output.families, output.wallNormal, requiredSpacing);
  }, [output, requiredSpacing]);

  /** 위치 편차 지표의 표본: 시공 철근 중점 + 그 철근의 편차 */
  const positionSamples = useMemo<ContourSample[]>(() => {
    if (!output || !view) return [];
    const byId = new Map(output.scanTransformed.map((r) => [r.id, r]));
    const out: ContourSample[] = [];
    for (const rec of view.rebars) {
      if (!rec.scanId || !rec.deviationMm) continue;
      const bar = byId.get(rec.scanId);
      if (!bar) continue;
      // ★ 중심선은 보통 2점이다. line[Math.floor(length/2)]는 중점이 아니라 **끝점**이라
      //   모든 표본이 벽 한쪽 모서리에 몰리고, IDW 반경(0.6m) 밖은 전부 비어 지도가
      //   가느다란 띠 하나로 나온다. 간격 지표와 같은 호길이 중점을 공유해야 두 지표가
      //   같은 자리를 가리킨다.
      out.push({ midpoint: barMidpoint(bar), deviationMm: rec.deviationMm.mean });
    }
    return out;
  }, [output, view]);

  // ★ 반드시 useMemo로 감쌀 것. 뷰어의 컨투어 이펙트는 이 값의 identity로 갱신을 판단하고,
  //   갱신 때마다 DataTexture·지오메트리·머티리얼을 dispose하고 새로 만든다. 렌더마다 새
  //   ContourField를 만들면 요구간격 입력에 한 글자 칠 때마다 GPU 자원이 갈린다.
  const contour = useMemo(() => {
    // 정합 실패 시 scanTransformed는 엉뚱한 자리라 간격·평면이 무의미하다 — 지도를 끈다
    if (!output || !showContour || output.registration.failed) return null;
    const samples: ContourSample[] = metric === "spacing" ? spacing?.gaps ?? [] : positionSamples;
    if (samples.length === 0) return null;
    return buildContourField(samples, output.plane);
  }, [output, showContour, metric, spacing, positionSamples]);

  /** 요구 간격 입력 폼에 띄울 그룹 목록 */
  const spacingGroups = spacing?.groups.filter((g) => g.count > 0) ?? [];
  const familyLabel = useCallback(
    (id: string) => output?.families.find((f) => f.id === id)?.label ?? id,
    [output],
  );
```

- [ ] **Step 6: 뷰어에 prop 전달 + 컨투어 칩**

`<AnalysisViewer ... />`에 두 줄 추가:

```tsx
          contour={contour}
          contourMax={contourMax}
```

레이어 토글 `<Group gap={6}>` 안, 스캔 메시 칩 뒤에 추가:

```tsx
            {/* 정합 실패 시엔 아예 내보내지 않는다. 칩만 남기면 눌러도 지도는 안 뜨는데
                설계 고스트만 사라져, 수동 초기정합에 필요한 참조가 화면에서 없어진다. */}
            {output && !output.registration.failed && (
              <Chip
                size="xs" color="grape" checked={showContour}
                onChange={(on) => {
                  setShowContour(on);
                  // 지도를 켜면 설계 고스트를 내린다. 고스트는 depthWrite:false + 렌더순서상
                  // 평면보다 뒤에 있어도 위에 덮여 그려지므로(순서 무관 투명의 한계), 회색이
                  // 색 띠를 씌워 단계 구분을 흐린다. 사용자가 칩으로 다시 켤 수 있다.
                  if (on) setShowDesign(false);
                }}
              >
                편차 지도
              </Chip>
            )}
```

- [ ] **Step 7: 범례를 컬러바로 교체**

색상 범례 `<Paper>` 안, `<Text size="xs" fw={700} mb={4}>색상 안내</Text>` 아래 `<Stack>` **앞**에 컬러바를 삽입한다:

```tsx
          {/* 지도가 실제로 그려질 때만 — 눈금만 뜨고 색은 없는 상태를 만들지 않는다 */}
          {contour && (
            <Box mb={8}>
              <Text size="xs" fw={600} mb={3}>
                {metric === "spacing" ? "간격 편차" : "위치 편차"} (mm)
              </Text>
              <Group gap={0} wrap="nowrap">
                {CONTOUR_COLORS.map((c) => (
                  <Box key={c} h={10} style={{ flex: 1, background: c }} />
                ))}
              </Group>
              <Group justify="space-between">
                <Text size="10px" ff="monospace">0</Text>
                <Text size="10px" ff="monospace">≥{contourMax}</Text>
              </Group>
            </Box>
          )}
```

- [ ] **Step 8: 우측 패널에 지표 전환 + 상한 + 요구 간격 입력**

허용오차 슬라이더 `<Box>`를 아래 블록으로 교체:

```tsx
            <SegmentedControl
              size="xs" fullWidth value={metric} onChange={changeMetric}
              data={[
                { value: "spacing", label: "간격 편차" },
                { value: "position", label: "위치 편차" },
              ]}
            />

            <Box>
              <Text size="xs" fw={600} mb={2}>
                컨투어 상한 {contourMax}mm — 이 값 이상은 모두 최상위 색
              </Text>
              <Slider min={5} max={200} step={5} value={contourMax} onChange={setContourMax}
                marks={[{ value: 30 }, { value: 50 }, { value: 100 }]} size="sm" />
              <Text size="xs" c="dimmed" mt={2}>
                KDS 10 20 50은 최소 간격만 규정하고 오차 기준이 없어 상한은 사용자가 정합니다.
              </Text>
            </Box>

            {metric === "spacing" ? (
              <Box>
                <Text size="xs" fw={600} mb={4}>요구 간격 (mm)</Text>
                <Stack gap={4}>
                  {spacingGroups.map((g) => {
                    const key = spacingGroupKey(g.direction, g.layer);
                    return (
                      <Group key={key} gap={6} wrap="nowrap">
                        <Text size="xs" style={{ flex: 1 }}>
                          {familyLabel(g.direction)}·{g.layer === "outer" ? "외측" : "내측"}
                          <Text span size="xs" c="dimmed"> (실측 중앙값 {g.medianMm.toFixed(0)})</Text>
                        </Text>
                        <NumberInput
                          size="xs" w={92} step={5} min={10}
                          value={requiredSpacing[key] ?? Math.round(g.medianMm / 5) * 5}
                          onChange={(v) => {
                            const n = Number(v);
                            setRequiredSpacing((prev) => {
                              // 빈칸·0·음수는 "지정 안 함"으로 되돌려 중앙값 폴백을 살린다.
                              // 0을 저장하면 computeSpacing의 `?? med`가 0을 유효값으로 받아
                              // (?? 는 0을 통과시킨다) 그룹 전체가 최상위 색으로 포화된다.
                              if (!Number.isFinite(n) || n <= 0) {
                                const next = { ...prev };
                                delete next[key];
                                return next;
                              }
                              return { ...prev, [key]: n };
                            });
                          }}
                        />
                      </Group>
                    );
                  })}
                </Stack>
              </Box>
            ) : (
              <Box>
                <Text size="xs" fw={600} mb={2}>허용오차 ±{tolerance}mm</Text>
                <Slider min={1} max={50} value={tolerance} onChange={setTolerance}
                  marks={[{ value: 10 }, { value: 25 }, { value: 50 }]} size="sm" />
              </Box>
            )}
```

- [ ] **Step 9: 표를 지표에 맞춰 전환**

기존 표 `<Paper withBorder radius="md" style={{ flex: 1, minHeight: 0 }}>` 블록을 아래로 교체한다. 위치 편차 표는 기존과 같고, 간격 편차 표가 추가된다.

```tsx
            <Paper withBorder radius="md" style={{ flex: 1, minHeight: 0 }}>
              <ScrollArea h="100%">
                {metric === "spacing" && !spacing ? (
                  <Text size="xs" c="dimmed" p="sm">
                    {output?.registration.failed
                      ? "정합에 실패해 간격을 신뢰할 수 없습니다 — 수동 초기정합으로 다시 분석하세요."
                      : "간격은 저장되지 않습니다 — 「재분석」을 눌러야 표시됩니다."}
                  </Text>
                ) : metric === "spacing" ? (
                  <Table striped highlightOnHover stickyHeader verticalSpacing={4} fz="xs">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>구간</Table.Th>
                        <Table.Th ta="right">실측</Table.Th>
                        <Table.Th ta="right">요구</Table.Th>
                        <Table.Th ta="right">편차</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {(spacing?.gaps ?? []).map((g) => (
                        <Table.Tr key={`${g.aId}|${g.bId}`}>
                          <Table.Td>
                            {familyLabel(g.direction)}·{g.layer === "outer" ? "외측" : "내측"}
                          </Table.Td>
                          <Table.Td ta="right" ff="monospace">{g.spacingMm.toFixed(0)}</Table.Td>
                          <Table.Td ta="right" ff="monospace">{g.requiredMm.toFixed(0)}</Table.Td>
                          <Table.Td ta="right" ff="monospace"
                            style={{ color: contourColor(Math.abs(g.deviationMm), contourMax) }}>
                            {g.deviationMm > 0 ? "+" : ""}{g.deviationMm.toFixed(0)}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                ) : (
                  <Table striped highlightOnHover stickyHeader verticalSpacing={4} fz="xs">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>철근</Table.Th>
                        <Table.Th>분류</Table.Th>
                        <Table.Th ta="right">편차(mm)</Table.Th>
                        <Table.Th>판정</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {view.rebars.map((r) => {
                        const key = r.designId ?? r.scanId ?? "";
                        return (
                          <Table.Tr key={key} style={{ cursor: "pointer" }}
                            bg={focusKey === key ? "var(--mantine-color-yellow-0)" : undefined}
                            onClick={() => setFocusKey(key)}>
                            <Table.Td title={key}>{r.label ?? key}</Table.Td>
                            <Table.Td>
                              {familyLabel(r.direction)}·{r.layer === "outer" ? "외측" : "내측"}
                            </Table.Td>
                            <Table.Td ta="right" ff="monospace">
                              {r.deviationMm ? r.deviationMm.mean.toFixed(1) : "—"}
                            </Table.Td>
                            <Table.Td>
                              <Badge size="xs" color={VERDICT_BADGE[r.verdict]} variant="light">
                                {VERDICT_LABEL[r.verdict]}
                              </Badge>
                            </Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                )}
              </ScrollArea>
            </Paper>
```

- [ ] **Step 10: 타입 + 빌드 + 전체 테스트**

Run:
```bash
cd /d/Projects/LH/AR/office-dashboard && npx tsc --noEmit && npm test -- --run && npm run build
```
Expected: 타입 오류 0, 테스트 전부 PASS, 빌드 성공

- [ ] **Step 11: 커밋**

```bash
cd /d/Projects/LH/AR && git add office-dashboard/src/components/analysis/AnalysisView.tsx
git commit -m "feat: metric toggle, required spacing inputs and contour colourbar"
```

---

### Task 8: 경사·헌치 철근 통합 검증

발주처 요청 (1)에 대한 근거를 남기는 태스크다. 기울어진 주철근과 45° 헌치 사재가 섞인 벽을 픽스처로 만들고, 파이프라인 전체가 이를 **세 개의 방향군**으로 갈라 각각 간격을 재는지 검증한다.

**Files:**
- Modify: `office-dashboard/src/lib/analysis/testFixtures.ts`
- Test: `office-dashboard/src/lib/analysis/haunch.test.ts` (신규)

**Interfaces:**
- Consumes: `runAnalysis` (pipeline.ts), `deriveDirectionFamilies` (direction.ts)
- Produces: `makeHaunchWall(): Rebar[]` — testFixtures.ts에서 export

- [ ] **Step 1: 픽스처 추가**

`testFixtures.ts` 하단에 추가:

```ts
/**
 * 헌치가 있는 경사 옹벽 — 발주처 Mock-up 모사.
 *  · 주철근: 약 8° 기운 세로근 6본 (벽이 위로 갈수록 얇아진다)
 *  · 배력근: 수평근 4본
 *  · 헌치 사재: 저판부 45° 대각근 3본
 */
export function makeHaunchWall(): Rebar[] {
  const bars: Rebar[] = [];
  const r = 0.008;
  // 경사 주철근 (아래 x → 위 x+0.28, 높이 2m ⇒ 약 8°)
  for (let i = 0; i < 6; i++) {
    const x = i * 0.2;
    bars.push({ id: `main-${i}`, radius: r, centerline: [[x, 0.4, 0], [x + 0.28, 2.4, 0]] });
  }
  // 수평 배력근
  for (let i = 0; i < 4; i++) {
    const y = 0.6 + i * 0.5;
    bars.push({ id: `horz-${i}`, radius: r, centerline: [[0, y, 0], [1.3, y, 0]] });
  }
  // 헌치 45° 사재
  for (let i = 0; i < 3; i++) {
    const x = i * 0.25;
    bars.push({ id: `haunch-${i}`, radius: r, centerline: [[x, 0.0, 0], [x + 0.4, 0.4, 0]] });
  }
  return bars;
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

```ts
// office-dashboard/src/lib/analysis/haunch.test.ts
// 발주처 요청 (1) — 직선 수직/수평이 아닌 철근이 섞인 벽을 끝까지 분석할 수 있는지.
import { describe, expect, it } from "vitest";
import { axisAngleDeg, deriveDirectionFamilies } from "./direction";
import { runAnalysis } from "./pipeline";
import { jitterRebars, makeHaunchWall, rigidMat4, transformRebars } from "./testFixtures";
import { spacingGroupKey } from "./spacing";
import type { Vec3 } from "./types";

const UP: Vec3 = [0, 1, 0];

/** 사재군을 라벨로 찾는다 — id 체계("d1")에 테스트를 묶지 않기 위해 */
const haunchIdOf = (fams: { id: string; label: string }[]) =>
  fams.find((f) => f.label.startsWith("사재"))!.id;

describe("헌치 경사 옹벽", () => {
  it("경사 주철근·수평 배력근·45° 사재를 세 방향군으로 나눈다", () => {
    const fams = deriveDirectionFamilies(makeHaunchWall(), UP);
    expect(fams.length).toBe(3);
    expect(fams.some((f) => f.label.startsWith("사재"))).toBe(true);
    // 이 픽스처의 핵심은 8° 기운 주철근이 45° 사재와 **공존**하는 것이다.
    // 주철근이 수직으로 뭉뚱그려지면 이 단언이 깨진다.
    const v = fams.find((f) => f.label === "세로")!;
    expect(axisAngleDeg(v.axis, UP)).toBeGreaterThan(3);
    expect(axisAngleDeg(v.axis, UP)).toBeLessThan(12);
  });

  it("사재도 미시공/도면외로 흘리지 않고 정상 판정한다", () => {
    const design = makeHaunchWall();
    const scan = makeHaunchWall().map((b, i) => ({ ...b, id: `s${i}` }));
    const out = runAnalysis({ design, scan, toleranceMm: 10, up: UP });
    expect(out.registration.failed).toBe(false);
    expect(out.summary.missing).toBe(0);
    expect(out.summary.extra).toBe(0);
    expect(out.summary.matched).toBe(design.length);
    // ★ 위 세 줄만으로는 근거가 못 된다. 스캔이 좌표까지 같은 복사본이라 매칭이 거리 0으로
    //   먼저 짝지어지고, 방향군을 어떻게 나누든(옛 2군 엔진에서도) 통과한다.
    //   사재가 실제로 자기 군으로 서 있는지를 따로 못 박는다.
    const haunch = out.summary.byGroup.find((g) => g.directionLabel.startsWith("사재"));
    expect(haunch).toBeDefined();
    expect(haunch!.designCount).toBe(3);
    expect(haunch!.scanCount).toBe(3);
    expect(haunch!.missing).toBe(0);
  });

  it("방향군마다 간격을 따로, 그 군의 좌표계로 잰다", () => {
    const design = makeHaunchWall();
    const scan = makeHaunchWall().map((b, i) => ({ ...b, id: `s${i}` }));
    const out = runAnalysis({ design, scan, toleranceMm: 10, up: UP });
    const keys = new Set(out.spacing.gaps.map((g) => spacingGroupKey(g.direction, g.layer)));
    expect(keys.size).toBe(3);
    const haunchGaps = out.spacing.gaps.filter((g) => g.direction === haunchIdOf(out.families));
    expect(haunchGaps.length).toBe(2); // 사재 3본 → 2구간
    // ★ 개수만으로는 부족하다. 사재는 x로 250mm씩 놓였지만 축이 45°라 면 위 실제 간격은
    //   250 × sin45° = 176.78mm다. 세계 x축으로 재는 회귀가 있으면 250이 나오는데
    //   개수 단언은 그대로 통과한다 — 이 숫자가 "방향군 자기 좌표계로 잰다"는 주장의 근거다.
    for (const g of haunchGaps) expect(g.spacingMm).toBeCloseTo(176.78, 1);
  });

  it("사재 한 본이 빠지면 사재군의 미시공으로 잡힌다", () => {
    const design = makeHaunchWall();
    const scan = makeHaunchWall()
      .filter((b) => b.id !== "haunch-1")
      .map((b, i) => ({ ...b, id: `s${i}` }));
    const out = runAnalysis({ design, scan, toleranceMm: 10, up: UP });
    expect(out.summary.missing).toBe(1);
    const missing = out.rebars.find((r) => r.verdict === "missing")!;
    expect(missing.designId).toBe("haunch-1");
    // ★ 위 두 줄은 옛 2방향군 엔진에서도 통과한다 — 거리 0 매칭이 남긴 것을 집을 뿐이다.
    //   빠진 철근이 사재군으로 분류돼 있어야 이 태스크의 근거가 된다.
    expect(missing.directionLabel).toMatch(/^사재/);
  });

  it("회전·노이즈가 섞인 스캔에서도 사재군을 잃지 않는다", () => {
    // 앞의 네 건은 스캔이 설계의 좌표 복사본이라 정합이 항등으로 수렴한다. 즉 코스 정합과
    // 노이즈 내성이 헌치 형상에서 한 번도 시험되지 않는다. 실제 스캔에 가깝게 만든다.
    const design = makeHaunchWall();
    const scan = jitterRebars(
      transformRebars(makeHaunchWall(), rigidMat4(35, [1.2, 0, 0.6])),
      0.002, 4242,
    ).map((b, i) => ({ ...b, id: `s${i}` }));
    const out = runAnalysis({ design, scan, toleranceMm: 15, up: UP });
    expect(out.registration.failed).toBe(false);
    expect(out.summary.missing).toBe(0);
    expect(out.summary.extra).toBe(0);
    const haunch = out.summary.byGroup.find((g) => g.directionLabel.startsWith("사재"));
    expect(haunch?.designCount).toBe(3);
  });
});
```

- [ ] **Step 3: 실행해서 실패 확인**

Run: `cd /d/Projects/LH/AR/office-dashboard && npx vitest run src/lib/analysis/haunch.test.ts`
Expected: FAIL — `makeHaunchWall` 미정의 (Step 1 전이라면) 또는 방향군 개수 불일치

- [ ] **Step 4: 실패 원인 분석 후 최소 수정**

방향군이 3개로 갈리지 않으면 `deriveDirectionFamilies`의 `mergeDeg`(기본 20°) 때문이다. 픽스처 각도는 세로 8° · 수평 0° · 사재 45°로 서로 **20° 이상** 떨어져 있으므로 기본값으로 갈려야 한다. 갈리지 않으면 Task 1의 병합 로직이 각도 계산에서 부호를 잘못 다루는 것이므로 `axisAngleDeg`부터 확인한다.

매칭에서 사재가 흘러 나가면 `match.ts`의 `groupCutoffM`이 사재 군의 간격을 세로군 기준으로 잡은 것이다 — `matchRebars`가 그룹 키를 `${direction}/${layer}`로 쓰는지 확인한다(Task 2에서 이미 그렇게 바뀌어 있어야 한다).

**픽스처를 테스트에 맞추려고 각도를 조정하지 말 것.** 픽스처는 발주처 Mock-up을 모사한 것이므로, 통과시키기 위해 기울기를 바꾸면 검증의 의미가 사라진다.

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run src/lib/analysis/haunch.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: 전체 테스트**

Run: `npm test -- --run`
Expected: 전부 PASS

- [ ] **Step 7: 커밋**

```bash
cd /d/Projects/LH/AR && git add office-dashboard/src/lib/analysis/testFixtures.ts office-dashboard/src/lib/analysis/haunch.test.ts
git commit -m "test: verify inclined main bars and 45deg haunch diagonals end to end"
```

---

### Task 9: 문서 갱신 · 실데이터 검증 · 배포

**Files:**
- Modify: `D:\Projects\LH\AR\CLAUDE.md`
- Modify: `D:\Projects\LH\AR\docs\design-system.md`
- Modify: `office-dashboard/public/brand/briconlab.css`
- Modify: `office-dashboard/scripts/make-demo-scan.mjs`

- [ ] **Step 1: 컨투어 색을 디자인 시스템에 편입**

`briconlab.css`의 판정 색 블록 아래에 추가:

```css
  /* 컨투어 색 — 편차 크기 5단계. 판정 색과 다른 체계이며 두 앱에서 동일하게 쓴다 */
  --bl-contour-1: #2c7bb6;
  --bl-contour-2: #abd9e9;
  --bl-contour-3: #ffffbf;
  --bl-contour-4: #fdae61;
  --bl-contour-5: #d7191c;
```

`docs/design-system.md` §2 "판정 색" 표 아래에 절을 추가한다:

```markdown
### 컨투어 색 — 편차 크기 5단계

판정(합격/불합격)이 아니라 **편차의 크기**를 나타내는 색이다. KDS 10 20 50에 철근 간격
오차 기준이 없어 합격선을 그을 근거가 없으므로, 상한은 화면에서 사용자가 정한다.

| 단계 | 토큰 | 값 | 뜻 |
|---|---|---|---|
| 1 | `--bl-contour-1` | `#2c7bb6` | 0 ~ 상한×0.2 |
| 2 | `--bl-contour-2` | `#abd9e9` | ~ 상한×0.4 |
| 3 | `--bl-contour-3` | `#ffffbf` | ~ 상한×0.6 |
| 4 | `--bl-contour-4` | `#fdae61` | ~ 상한×0.8 |
| 5 | `--bl-contour-5` | `#d7191c` | **상한×0.8 이상** (상한 초과 포함) |

**규칙**: 판정 색과 같은 화면에 놓을 때는 반드시 컬러바(0 ~ ≥상한)를 함께 띄운다.
색만으로는 두 체계를 구분할 수 없다.
```

`docs/design-system.md` §10 버전 표에 행을 추가:

```markdown
| v1.1 | 2026-08-03 | 컨투어 색 5단계 추가 (편차 크기 — 판정 색과 별도 체계) |
```

- [ ] **Step 2: 데모 스크립트의 토큰 강제 해제**

업로드 토큰은 이미 선택 사항이 됐는데 `make-demo-scan.mjs`는 아직 없으면 던진다. 해당 줄을 교체:

```js
  const token = process.env.SCAN_UPLOAD_TOKEN;
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${base}/api/scan-upload`, {
    method: "POST",
    headers,
    body: form,
  });
```

상단 사용법 주석의 `// 환경: SCAN_UPLOAD_TOKEN (업로드 시 필수, .env.local과 동일 값)` 줄도
`// 환경: SCAN_UPLOAD_TOKEN (선택 — 서버에 설정돼 있을 때만 필요)`로 고친다.

> **헌치 데모 스캔은 만들지 않는다.** 분석은 설계모델과의 비교이므로, 경사·사재가 있는
> *설계* USDZ가 BriconLab에 올라오기 전에는 브라우저 E2E로 확인할 대상이 없다.
> 경사·사재 경로의 검증은 Task 8(엔진 단 통합 테스트)이 담당하고, Mock-up 설계모델이
> 등록되면 Step 3의 절차를 그 모델로 한 번 더 돌린다.

- [ ] **Step 3: 실데이터 E2E 검증**

```bash
cd /d/Projects/LH/AR/office-dashboard && npm run dev
```
브라우저에서 `http://localhost:3000` → 현장 관리 → 시공 분석 → 저장된 27본 스캔 선택 → 설계모델 `built-in` 선택 → **분석 실행**.

확인 항목 (각각 화면 캡처로 근거를 남긴다):
1. 정합 RMS 배지가 표시되고 실패가 아니다
2. "편차 지도" 칩을 켜면 벽면에 5단계 색 띠가 깔린다
3. 지표를 "위치 편차"로 바꾸면 지도와 표가 함께 바뀌고 상한 기본값이 30mm가 된다
4. 요구 간격 숫자를 바꾸면 **재분석 없이** 지도·표의 편차가 즉시 바뀐다
5. 컨투어 상한을 낮추면 붉은 영역이 넓어진다
6. 새로고침 후 재진입하면 저장된 요구 간격이 복원된다

- [ ] **Step 4: CLAUDE.md 갱신**

§3 "대시보드" 항목의 **시공 분석** 설명에 간격 컨투어를 추가하고, §8 "Open items"에서 해당 항목을 지운다. §5 gotchas에 한 줄 추가:

```markdown
12. **컨투어 텍스처는 `NearestFilter`로 둔다.** 선형 보간을 켜면 색이 섞여 단계 경계가 사라지고, "몇 단계인가"를 눈으로 셀 수 없게 된다. 보간은 값(IDW)에서 이미 끝났고 색은 계단이어야 한다.
```

- [ ] **Step 5: 최종 검증**

```bash
cd /d/Projects/LH/AR/office-dashboard && npx tsc --noEmit && npm test -- --run && npm run build
```
Expected: 셋 다 통과

- [ ] **Step 6: 커밋 + PR**

```bash
cd /d/Projects/LH/AR && git add -A
git commit -m "docs: contour colour scale in design system and project notes"
git push -u origin feat/spacing-contour
gh pr create --title "feat: spacing-deviation contour map and automatic direction families" --body "발주처 요청 (1) 경사·헌치 철근 지원, (2) 임계값 판정 → 편차 컨투어 지도로 대체"
```

- [ ] **Step 7: 머지 후 배포**

```bash
cd /d/Projects/LH/AR/office-dashboard && npx vercel deploy --prod --yes
```
배포 URL에서 Step 3의 확인 항목 1~6을 다시 한 번 확인한다.

