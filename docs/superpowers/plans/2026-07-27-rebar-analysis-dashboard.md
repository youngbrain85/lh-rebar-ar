# 시공 분석 대시보드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** office-dashboard에 "시공 분석" 탭 추가 — 라이다 앱이 업로드한 as-built 철근(중심선 JSON)을 설계모델(USDZ)과 브라우저에서 정합·비교분석하여 미시공/허용초과/도면외 철근을 3D로 시각화.

**Architecture:** 순수 TS 분석 엔진(`src/lib/analysis/`, three.js 의존 금지)을 Web Worker에서 실행. 저장은 Vercel Blob(키: `scans/<site_id>/<scan_id>/…`). 설계모델은 기존 `/api/model` USDZ를 three USDLoader로 로드해 이름 있는 서브오브젝트에서 중심선을 추출. UI는 기존 Mantine + three.js 패턴 재사용.

**Tech Stack:** Next 16.2.7 (App Router), React 19, Mantine 9, three 0.185 (USDLoader), @vercel/blob, zod, vitest.

**Spec:** `docs/superpowers/specs/2026-07-27-rebar-analysis-dashboard-design.md` (승인됨 — 모든 수치·스키마의 원전)

## Global Constraints

- 작업 브랜치: `feat/dashboard-analysis` (Task 1에서 생성). 커밋은 각 태스크 마지막 스텝의 메시지 그대로.
- 추가 허용 의존성은 정확히 3개: `@vercel/blob`, `zod`, `vitest`(dev). 그 외 추가 금지.
- `src/lib/analysis/**`는 순수 TS — three.js/DOM/Next import 금지 (`designExtract.ts` 포함). three.js 의존 코드는 `src/components/analysis/`에만.
- 좌표·거리는 내부적으로 **미터**, 직렬화(`*Mm` 필드)와 UI 표시는 **밀리미터**. 허용오차 기본 10mm, UI 범위 1–50mm.
- `Mat4`는 길이 16 배열, **column-major** (three.js `Matrix4.elements` 호환).
- 분석은 전부 설계 좌표계에서 수행. up 축은 호출부가 명시적으로 전달 (three 씬은 Y-up).
- API 라우트는 기존 패턴 준수: `export const dynamic = "force-dynamic"`, `NextResponse.json`, 실패 시 `{ status:"error", message }`. 환경변수 누락은 **500 + 명시적 message** (조용히 삼키지 않기 — CLAUDE.md의 `/api/live` 침묵 실패 전철 금지).
- 환경변수: `BLOB_READ_WRITE_TOKEN`(Vercel Blob 연결), `SCAN_UPLOAD_TOKEN`(라이다 앱과 공유할 임의 시크릿) — `office-dashboard/.env.local`에 추가. Vercel 프로젝트에는 배포 전 동일하게 설정.
- 모든 명령은 `D:\Projects\LH\AR\office-dashboard`에서 실행 (별도 표기 없으면).
- UI 문구는 한국어, 기존 네이비 브랜드(`brand` 팔레트) 유지.
- Next 16 주의: `office-dashboard/AGENTS.md` — 확신 없는 API는 `node_modules/next/dist/docs/` 확인. 라우트 핸들러는 기존 4개 라우트와 동일 관례면 안전.

---

### Task 1: vitest 인프라 + 분석 타입

**Files:**
- Modify: `office-dashboard/package.json` (scripts.test, devDependencies)
- Create: `office-dashboard/vitest.config.ts`
- Create: `office-dashboard/src/lib/analysis/types.ts`
- Test: `office-dashboard/src/lib/analysis/types.test.ts`

**Interfaces:**
- Consumes: 없음 (최초 태스크)
- Produces: 이후 모든 태스크가 쓰는 타입 — `Vec3`, `Mat4`, `Rebar`, `Direction`, `Layer`, `ClassifiedRebar`, `RegistrationResult`, `MatchPair`, `MatchResult`, `Verdict`, `RebarRecord`, `GroupSummary`, `AnalysisSummary`, `AnalysisResult`, `RebarsFile` (아래 정의 그대로)

- [ ] **Step 1: 브랜치 생성 + vitest 설치**

```bash
cd /d/Projects/LH/AR && git checkout -b feat/dashboard-analysis
cd office-dashboard && npm install -D vitest
```

- [ ] **Step 2: package.json에 test 스크립트 추가**

`office-dashboard/package.json`의 scripts를:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 3: vitest.config.ts 작성**

```ts
// office-dashboard/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 4: 실패하는 테스트 작성** (타입 모듈이 아직 없어 컴파일 실패 = RED)

```ts
// office-dashboard/src/lib/analysis/types.test.ts
import { describe, expect, it } from "vitest";
import type { AnalysisResult, Rebar } from "./types";

describe("analysis types", () => {
  it("Rebar shape compiles and holds data", () => {
    const r: Rebar = { id: "r0", centerline: [[0, 0, 0], [0, 1, 0]], radius: 0.008 };
    expect(r.centerline.length).toBe(2);
  });

  it("AnalysisResult version literal is 1", () => {
    const v: AnalysisResult["version"] = 1;
    expect(v).toBe(1);
  });
});
```

- [ ] **Step 5: 실행해서 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './types'`

- [ ] **Step 6: types.ts 작성**

```ts
// office-dashboard/src/lib/analysis/types.ts
// 분석 엔진 공용 타입. 이 파일은 순수 타입만 — 런타임 코드 금지.

export type Vec3 = [number, number, number];
/** 길이 16, column-major (three.js Matrix4.elements 호환) */
export type Mat4 = number[];

export interface Rebar {
  id: string;
  /** 2점 이상, 미터 단위 */
  centerline: Vec3[];
  /** 미터 단위 */
  radius: number;
}

export type Direction = "horizontal" | "vertical";
export type Layer = "outer" | "inner";
export type ClassifiedRebar = Rebar & { direction: Direction; layer: Layer };

export interface RegistrationResult {
  matrix: Mat4;
  rmsMm: number;
  method: "auto" | "manual";
}

export interface MatchPair {
  designIdx: number;
  scanIdx: number;
  meanMm: number;
  maxMm: number;
}

export interface MatchResult {
  pairs: MatchPair[];
  missingDesign: number[]; // 매칭 안 된 설계 철근 인덱스 → 미시공
  extraScan: number[];     // 매칭 안 된 스캔 철근 인덱스 → 도면 외
}

export type Verdict = "pass" | "out_of_tolerance" | "missing" | "extra";

export interface RebarRecord {
  designId: string | null; // null = 도면 외
  scanId: string | null;   // null = 미시공
  direction: Direction;
  layer: Layer;
  deviationMm: { mean: number; max: number } | null;
  verdict: Verdict;
}

export interface GroupSummary {
  direction: Direction;
  layer: Layer;
  designCount: number;
  scanCount: number;
  missing: number;
  outOfTolerance: number;
  meanDeviationMm: number | null;
}

export interface AnalysisSummary {
  designCount: number;
  scanCount: number;
  matched: number;
  missing: number;
  extra: number;
  outOfTolerance: number;
  deviationMm: { mean: number; max: number } | null;
  byGroup: GroupSummary[];
}

export interface AnalysisResult {
  version: 1;
  scanId: string;
  arId: string;
  registration: RegistrationResult;
  toleranceMm: number;
  rebars: RebarRecord[];
  summary: AnalysisSummary;
}

/** 라이다 앱이 업로드하는 rebars.json (spec §4) */
export interface RebarsFile {
  version: 1;
  unit: "m";
  rebars: { id: string; centerline: Vec3[]; radius: number }[];
}
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `npm test`
Expected: PASS (2 tests)

- [ ] **Step 8: 커밋**

```bash
cd /d/Projects/LH/AR && git add office-dashboard/package.json office-dashboard/package-lock.json office-dashboard/vitest.config.ts office-dashboard/src/lib/analysis/
git commit -m "test: add vitest infra and analysis engine types"
```

---

### Task 2: 기하 프리미티브 (geom.ts)

**Files:**
- Create: `office-dashboard/src/lib/analysis/geom.ts`
- Test: `office-dashboard/src/lib/analysis/geom.test.ts`

**Interfaces:**
- Consumes: `Vec3`, `Mat4` (Task 1)
- Produces (이후 모든 분석 태스크가 사용):
  - `sub/add/scale/dot/cross/norm/normalize(v: Vec3 …): Vec3|number`
  - `pointToSegment(p: Vec3, a: Vec3, b: Vec3): number`
  - `samplePolyline(line: Vec3[], n: number): Vec3[]` — 호길이 균등 n점
  - `pointToPolyline(p: Vec3, line: Vec3[]): number` — 전 선분 최소거리
  - `polylineDistance(a: Vec3[], b: Vec3[], samples?: number): { mean: number; max: number }` — 대칭(양방향 평균), 미터
  - `applyMat4(m: Mat4, p: Vec3): Vec3`
  - `mat4Identity(): Mat4`
  - `mat4Multiply(a: Mat4, b: Mat4): Mat4` — a·b
  - `mat4FromRotTrans(r: number[], t: Vec3): Mat4` — r은 row-major 3×3(길이 9)
  - `jacobiEigen(a: number[][]): { values: number[]; vectors: number[][] }` — 대칭행렬, 고유값 내림차순, `vectors[i]`가 i번째 고유벡터
  - `pca(points: Vec3[]): { mean: Vec3; axes: Vec3[]; values: number[] }` — axes 내림차순 3개

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// office-dashboard/src/lib/analysis/geom.test.ts
import { describe, expect, it } from "vitest";
import {
  applyMat4, jacobiEigen, mat4FromRotTrans, mat4Identity, mat4Multiply,
  pca, pointToPolyline, pointToSegment, polylineDistance, samplePolyline,
} from "./geom";
import type { Vec3 } from "./types";

describe("pointToSegment", () => {
  it("perpendicular distance to segment interior", () => {
    expect(pointToSegment([0, 1, 0], [-1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 10);
  });
  it("clamps to endpoint outside segment range", () => {
    expect(pointToSegment([3, 4, 0], [-1, 0, 0], [1, 0, 0])).toBeCloseTo(Math.hypot(2, 4), 10);
  });
  it("degenerate zero-length segment = point distance", () => {
    expect(pointToSegment([0, 3, 4], [0, 0, 0], [0, 0, 0])).toBeCloseTo(5, 10);
  });
});

describe("samplePolyline", () => {
  it("uniform arc-length samples over a bent polyline", () => {
    const line: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0]]; // 길이 2
    const s = samplePolyline(line, 5);
    expect(s.length).toBe(5);
    expect(s[0]).toEqual([0, 0, 0]);
    expect(s[4]).toEqual([1, 1, 0]);
    expect(s[2][0]).toBeCloseTo(1, 10); // 중간점 = 꺾임점
    expect(s[2][1]).toBeCloseTo(0, 10);
  });
  it("n=1 returns midpoint-ish single sample (start)", () => {
    expect(samplePolyline([[0, 0, 0], [2, 0, 0]], 1).length).toBe(1);
  });
});

describe("polylineDistance", () => {
  it("two parallel lines offset by d have mean≈max≈d", () => {
    const a: Vec3[] = [[0, 0, 0], [1, 0, 0]];
    const b: Vec3[] = [[0, 0.05, 0], [1, 0.05, 0]];
    const { mean, max } = polylineDistance(a, b);
    expect(mean).toBeCloseTo(0.05, 6);
    expect(max).toBeCloseTo(0.05, 6);
  });
  it("is symmetric", () => {
    const a: Vec3[] = [[0, 0, 0], [1, 0, 0]];
    const b: Vec3[] = [[0, 0.02, 0], [2, 0.02, 0]]; // b가 더 김
    expect(polylineDistance(a, b).mean).toBeCloseTo(polylineDistance(b, a).mean, 10);
  });
});

describe("mat4", () => {
  it("identity leaves point unchanged", () => {
    expect(applyMat4(mat4Identity(), [1, 2, 3])).toEqual([1, 2, 3]);
  });
  it("rot+trans composes: 90° yaw then translate", () => {
    // Y축(up) 기준 +90°: x→-z, z→x (row-major R)
    const r = [0, 0, 1, 0, 1, 0, -1, 0, 0];
    const m = mat4FromRotTrans(r, [10, 0, 0]);
    const p = applyMat4(m, [1, 0, 0]);
    expect(p[0]).toBeCloseTo(10, 10);
    expect(p[2]).toBeCloseTo(-1, 10);
  });
  it("multiply order: (A·B)p = A(Bp)", () => {
    const a = mat4FromRotTrans([1, 0, 0, 0, 1, 0, 0, 0, 1], [1, 0, 0]);
    const b = mat4FromRotTrans([0, 0, 1, 0, 1, 0, -1, 0, 0], [0, 0, 0]);
    const ab = mat4Multiply(a, b);
    const p: Vec3 = [1, 2, 3];
    expect(applyMat4(ab, p)).toEqual(applyMat4(a, applyMat4(b, p)));
  });
});

describe("jacobiEigen / pca", () => {
  it("diagonal matrix eigenvalues sorted desc", () => {
    const { values } = jacobiEigen([[1, 0, 0], [0, 5, 0], [0, 0, 3]]);
    expect(values[0]).toBeCloseTo(5, 8);
    expect(values[1]).toBeCloseTo(3, 8);
    expect(values[2]).toBeCloseTo(1, 8);
  });
  it("pca of points along X finds X as principal axis", () => {
    const pts: Vec3[] = [];
    for (let i = 0; i < 50; i++) pts.push([i * 0.1, (i % 3) * 0.001, 0]);
    const { axes } = pca(pts);
    expect(Math.abs(axes[0][0])).toBeGreaterThan(0.999);
  });
});
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './geom'`

- [ ] **Step 3: geom.ts 구현**

```ts
// office-dashboard/src/lib/analysis/geom.ts
// 순수 기하 프리미티브. three.js 금지 — Vec3/Mat4는 plain array.
import type { Mat4, Vec3 } from "./types";

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a: Vec3): number => Math.sqrt(dot(a, a));
export const normalize = (a: Vec3): Vec3 => {
  const n = norm(a);
  return n === 0 ? [0, 0, 0] : scale(a, 1 / n);
};

export function pointToSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  if (len2 === 0) return norm(sub(p, a));
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / len2));
  return norm(sub(p, add(a, scale(ab, t))));
}

export function pointToPolyline(p: Vec3, line: Vec3[]): number {
  let min = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const d = pointToSegment(p, line[i], line[i + 1]);
    if (d < min) min = d;
  }
  return line.length === 1 ? norm(sub(p, line[0])) : min;
}

export function samplePolyline(line: Vec3[], n: number): Vec3[] {
  if (n <= 1 || line.length === 1) return [line[0]];
  const segLen: number[] = [];
  let total = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const l = norm(sub(line[i + 1], line[i]));
    segLen.push(l);
    total += l;
  }
  if (total === 0) return Array(n).fill(line[0]);
  const out: Vec3[] = [];
  for (let k = 0; k < n; k++) {
    let target = (total * k) / (n - 1);
    let i = 0;
    while (i < segLen.length - 1 && target > segLen[i]) {
      target -= segLen[i];
      i++;
    }
    const t = segLen[i] === 0 ? 0 : target / segLen[i];
    out.push(add(line[i], scale(sub(line[i + 1], line[i]), Math.min(1, t))));
  }
  return out;
}

/** 대칭 폴리라인 거리: a샘플→b 최소거리와 b샘플→a 최소거리의 전체 평균/최대 (미터) */
export function polylineDistance(a: Vec3[], b: Vec3[], samples = 16): { mean: number; max: number } {
  const ds: number[] = [];
  for (const p of samplePolyline(a, samples)) ds.push(pointToPolyline(p, b));
  for (const p of samplePolyline(b, samples)) ds.push(pointToPolyline(p, a));
  const mean = ds.reduce((s, d) => s + d, 0) / ds.length;
  return { mean, max: Math.max(...ds) };
}

export const mat4Identity = (): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function applyMat4(m: Mat4, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

/** r: row-major 3x3 (r[row*3+col]) + 평행이동 → column-major Mat4 */
export function mat4FromRotTrans(r: number[], t: Vec3): Mat4 {
  return [r[0], r[3], r[6], 0, r[1], r[4], r[7], 0, r[2], r[5], r[8], 0, t[0], t[1], t[2], 1];
}

/** 대칭행렬 Jacobi 고유분해. 고유값 내림차순, vectors[i] = i번째 고유벡터. */
export function jacobiEigen(a: number[][]): { values: number[]; vectors: number[][] } {
  const n = a.length;
  const m = a.map((row) => row.slice());
  let v = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += m[p][q] * m[p][q];
    if (off < 1e-18) break;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(m[p][q]) < 1e-15) continue;
        const theta = (m[q][q] - m[p][p]) / (2 * m[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const mkp = m[k][p], mkq = m[k][q];
          m[k][p] = c * mkp - s * mkq;
          m[k][q] = s * mkp + c * mkq;
        }
        for (let k = 0; k < n; k++) {
          const mpk = m[p][k], mqk = m[q][k];
          m[p][k] = c * mpk - s * mqk;
          m[q][k] = s * mpk + c * mqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((x, y) => m[y][y] - m[x][x]);
  return {
    values: order.map((i) => m[i][i]),
    vectors: order.map((i) => v.map((row) => row[i])),
  };
}

export function pca(points: Vec3[]): { mean: Vec3; axes: Vec3[]; values: number[] } {
  const n = points.length;
  const mean: Vec3 = [0, 0, 0];
  for (const p of points) {
    mean[0] += p[0] / n;
    mean[1] += p[1] / n;
    mean[2] += p[2] / n;
  }
  const c = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of points) {
    const d = sub(p, mean);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) c[i][j] += (d[i] * d[j]) / n;
  }
  const { values, vectors } = jacobiEigen(c);
  return { mean, axes: vectors.map((x) => normalize(x as Vec3)), values };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS (모든 geom 테스트)

- [ ] **Step 5: 커밋**

```bash
cd /d/Projects/LH/AR && git add office-dashboard/src/lib/analysis/geom.ts office-dashboard/src/lib/analysis/geom.test.ts
git commit -m "feat: geometry primitives for rebar analysis (PCA, polyline distance, mat4)"
```

---

### Task 3: 합성 픽스처 생성기 (테스트 유틸)

**Files:**
- Create: `office-dashboard/src/lib/analysis/testFixtures.ts` (테스트 전용 유틸 — 프로덕션 코드에서 import 금지)
- Test: `office-dashboard/src/lib/analysis/testFixtures.test.ts`

**Interfaces:**
- Consumes: `Rebar`, `Vec3`, `Mat4` (Task 1), `applyMat4`, `mat4FromRotTrans` (Task 2)
- Produces (Task 4–9의 테스트가 사용):
  - `makeWallGrid(opts?: Partial<GridOpts>): Rebar[]` — 벽체 철근망. 기본: 수직근 7개(X 0..1.8m, 0.3m 간격, 길이 2m, Y방향), 수평근 5개(Y 0.2..1.8m, 0.4m 간격, 길이 1.8m, X방향), 레이어 2겹(z=0 외측, z=-0.06 내측 — 양쪽 방향 모두), 반경 0.008. id는 `d-v-<layer>-<i>` / `d-h-<layer>-<i>`
  - `rigidMat4(yawDeg: number, t: Vec3): Mat4` — Y축(up) 회전 + 평행이동
  - `transformRebars(rebars: Rebar[], m: Mat4): Rebar[]` (id 유지)
  - `jitterRebars(rebars: Rebar[], sigmaM: number, seed: number): Rebar[]` — 결정적(LCG) 가우시안 근사 노이즈
  - `offsetRebar(rebars: Rebar[], id: string, offset: Vec3): Rebar[]` — 특정 철근만 평행이동
  - `GridOpts = { nV: number; nH: number; spacingV: number; spacingH: number; lenV: number; lenH: number; layerGap: number; radius: number }`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// office-dashboard/src/lib/analysis/testFixtures.test.ts
import { describe, expect, it } from "vitest";
import { jitterRebars, makeWallGrid, offsetRebar, rigidMat4, transformRebars } from "./testFixtures";

describe("makeWallGrid", () => {
  it("default grid has (7+5)*2 = 24 rebars", () => {
    expect(makeWallGrid().length).toBe(24);
  });
  it("vertical bars run along Y", () => {
    const v = makeWallGrid().find((r) => r.id === "d-v-outer-0")!;
    const [a, b] = [v.centerline[0], v.centerline[v.centerline.length - 1]];
    expect(Math.abs(b[1] - a[1])).toBeCloseTo(2, 6);
    expect(Math.abs(b[0] - a[0])).toBeLessThan(1e-9);
  });
});

describe("transform/jitter/offset", () => {
  it("rigid transform is recoverable: distances preserved", () => {
    const g = makeWallGrid();
    const t = transformRebars(g, rigidMat4(30, [1.2, 0.4, -0.8]));
    const d0 = Math.hypot(
      g[0].centerline[0][0] - g[1].centerline[0][0],
      g[0].centerline[0][1] - g[1].centerline[0][1],
      g[0].centerline[0][2] - g[1].centerline[0][2],
    );
    const d1 = Math.hypot(
      t[0].centerline[0][0] - t[1].centerline[0][0],
      t[0].centerline[0][1] - t[1].centerline[0][1],
      t[0].centerline[0][2] - t[1].centerline[0][2],
    );
    expect(d1).toBeCloseTo(d0, 8);
  });
  it("jitter is deterministic per seed and bounded", () => {
    const g = makeWallGrid();
    const j1 = jitterRebars(g, 0.002, 42);
    const j2 = jitterRebars(g, 0.002, 42);
    expect(j1[3].centerline[0]).toEqual(j2[3].centerline[0]);
    const d = Math.abs(j1[0].centerline[0][0] - g[0].centerline[0][0]);
    expect(d).toBeLessThan(0.01);
  });
  it("offsetRebar moves only the target", () => {
    const g = makeWallGrid();
    const o = offsetRebar(g, "d-v-outer-2", [0.015, 0, 0]);
    expect(o.find((r) => r.id === "d-v-outer-2")!.centerline[0][0]).toBeCloseTo(
      g.find((r) => r.id === "d-v-outer-2")!.centerline[0][0] + 0.015, 9);
    expect(o.find((r) => r.id === "d-v-outer-0")!.centerline[0][0]).toBeCloseTo(
      g.find((r) => r.id === "d-v-outer-0")!.centerline[0][0], 9);
  });
});
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './testFixtures'`

- [ ] **Step 3: testFixtures.ts 구현**

```ts
// office-dashboard/src/lib/analysis/testFixtures.ts
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
cd /d/Projects/LH/AR && git add office-dashboard/src/lib/analysis/testFixtures.ts office-dashboard/src/lib/analysis/testFixtures.test.ts
git commit -m "test: synthetic wall-grid fixture generator for analysis tests"
```

---

### Task 4: 분류 (classify.ts)

**Files:**
- Create: `office-dashboard/src/lib/analysis/classify.ts`
- Test: `office-dashboard/src/lib/analysis/classify.test.ts`

**Interfaces:**
- Consumes: `Rebar`, `ClassifiedRebar`, `Vec3` (Task 1); `dot`, `normalize`, `sub`, `pca`, `samplePolyline` (Task 2); `makeWallGrid` (Task 3)
- Produces:
  - `estimateWallNormal(rebars: Rebar[]): Vec3` — 전체 샘플점 PCA 최소축
  - `classifyRebars(rebars: Rebar[], up: Vec3, wallNormal: Vec3): ClassifiedRebar[]`
  - 규칙(spec §5.3): 방향 = 중심선 끝점 벡터와 up의 각도 45° 기준(가까우면 vertical). 레이어 = 중점의 wallNormal 투영 1D 2-means; 클러스터 중심 간 거리 < max(0.02m, 군내 표준편차×2)이면 전부 outer; 아니면 투영값 큰 클러스터 = outer

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// office-dashboard/src/lib/analysis/classify.test.ts
import { describe, expect, it } from "vitest";
import { classifyRebars, estimateWallNormal } from "./classify";
import { makeWallGrid } from "./testFixtures";

const UP: [number, number, number] = [0, 1, 0];

describe("estimateWallNormal", () => {
  it("finds Z for an XY-plane wall grid", () => {
    const n = estimateWallNormal(makeWallGrid());
    expect(Math.abs(n[2])).toBeGreaterThan(0.99);
  });
});

describe("classifyRebars", () => {
  it("classifies direction and layer for the full grid", () => {
    const g = makeWallGrid();
    const c = classifyRebars(g, UP, estimateWallNormal(g));
    const v = c.find((r) => r.id === "d-v-outer-0")!;
    expect(v.direction).toBe("vertical");
    expect(v.layer).toBe("outer");
    const hInner = c.find((r) => r.id === "d-h-inner-2")!;
    expect(hInner.direction).toBe("horizontal");
    expect(hInner.layer).toBe("inner");
  });
  it("single-layer grid → everything outer", () => {
    const g = makeWallGrid().filter((r) => r.id.includes("-outer-"));
    const c = classifyRebars(g, UP, estimateWallNormal(makeWallGrid()));
    expect(c.every((r) => r.layer === "outer")).toBe(true);
  });
});
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './classify'`

- [ ] **Step 3: classify.ts 구현**

```ts
// office-dashboard/src/lib/analysis/classify.ts
// 방향(수평/수직)·레이어(외측/내측) 분류 — spec §5.3
import { dot, normalize, pca, samplePolyline, sub } from "./geom";
import type { ClassifiedRebar, Rebar, Vec3 } from "./types";

/** 철근군 전체 샘플점 PCA의 최소 분산 축 = 벽면 법선 */
export function estimateWallNormal(rebars: Rebar[]): Vec3 {
  const pts: Vec3[] = [];
  for (const r of rebars) pts.push(...samplePolyline(r.centerline, 8));
  return pca(pts).axes[2];
}

export function classifyRebars(rebars: Rebar[], up: Vec3, wallNormal: Vec3): ClassifiedRebar[] {
  const u = normalize(up);
  const n = normalize(wallNormal);

  // 1D 투영값으로 2-means
  const proj = rebars.map((r) => {
    const mid = samplePolyline(r.centerline, 3)[1];
    return dot(mid, n);
  });
  let c0 = Math.min(...proj), c1 = Math.max(...proj);
  for (let iter = 0; iter < 20; iter++) {
    const g0: number[] = [], g1: number[] = [];
    for (const p of proj) (Math.abs(p - c0) <= Math.abs(p - c1) ? g0 : g1).push(p);
    const m0 = g0.length ? g0.reduce((s, x) => s + x, 0) / g0.length : c0;
    const m1 = g1.length ? g1.reduce((s, x) => s + x, 0) / g1.length : c1;
    if (Math.abs(m0 - c0) + Math.abs(m1 - c1) < 1e-9) break;
    c0 = m0; c1 = m1;
  }
  const spread = (vals: number[], c: number) =>
    vals.length ? Math.sqrt(vals.reduce((s, x) => s + (x - c) ** 2, 0) / vals.length) : 0;
  const g0 = proj.filter((p) => Math.abs(p - c0) <= Math.abs(p - c1));
  const g1 = proj.filter((p) => Math.abs(p - c0) > Math.abs(p - c1));
  const singleLayer =
    g0.length === 0 || g1.length === 0 ||
    Math.abs(c1 - c0) < Math.max(0.02, 2 * Math.max(spread(g0, c0), spread(g1, c1)));
  const outerCenter = Math.max(c0, c1);

  return rebars.map((r, i) => {
    const ends = normalize(sub(r.centerline[r.centerline.length - 1], r.centerline[0]));
    const vertical = Math.abs(dot(ends, u)) > Math.SQRT1_2; // 45° 기준
    const layer = singleLayer
      ? "outer"
      : Math.abs(proj[i] - outerCenter) <= Math.abs(proj[i] - Math.min(c0, c1))
        ? "outer"
        : "inner";
    return { ...r, direction: vertical ? "vertical" : "horizontal", layer };
  });
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
cd /d/Projects/LH/AR && git add office-dashboard/src/lib/analysis/classify.ts office-dashboard/src/lib/analysis/classify.test.ts
git commit -m "feat: rebar direction/layer classification"
```

---

### Task 5: 코스 정합 (registration.ts 1/2)

**Files:**
- Create: `office-dashboard/src/lib/analysis/registration.ts`
- Test: `office-dashboard/src/lib/analysis/registration.test.ts`

**Interfaces:**
- Consumes: Task 1–3의 타입·geom·픽스처
- Produces:
  - `coarseRegister(scan: Rebar[], design: Rebar[]): Mat4` — scan좌표→design좌표. PCA 주축 정렬 + det=+1인 4가지 부호 후보를 매칭 비용으로 채점(spec §5.2)
  - `coarseCost(scan: Rebar[], design: Rebar[], m: Mat4): number` — scan 각 철근의 최근접 design 폴리라인 평균거리의 평균 (테스트·ICP 재사용)
  - `isDegenerate(rebars: Rebar[]): boolean` — PCA 고유값 λ2/λ0 < 1e-6 (모든 점이 사실상 일직선)

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// office-dashboard/src/lib/analysis/registration.test.ts
import { describe, expect, it } from "vitest";
import { applyMat4 } from "./geom";
import { coarseCost, coarseRegister, isDegenerate } from "./registration";
import { jitterRebars, makeWallGrid, rigidMat4, transformRebars } from "./testFixtures";
import type { Rebar } from "./types";

describe("coarseRegister", () => {
  // 4가지 요 각도(플립 후보를 강제로 밟는 각도들 포함) 전수
  for (const yaw of [0, 30, 90, 170]) {
    it(`recovers yaw=${yaw}° + translation to <20mm cost`, () => {
      const design = makeWallGrid();
      const scan = transformRebars(design, rigidMat4(yaw, [1.2, 0.4, -0.8]));
      const m = coarseRegister(scan, design);
      expect(coarseCost(scan, design, m)).toBeLessThan(0.02);
    });
  }
  it("works with 2mm noise", () => {
    const design = makeWallGrid();
    const scan = jitterRebars(transformRebars(design, rigidMat4(45, [0.5, -0.2, 0.3])), 0.002, 7);
    const m = coarseRegister(scan, design);
    expect(coarseCost(scan, design, m)).toBeLessThan(0.03);
  });
});

describe("isDegenerate", () => {
  it("single straight bar is degenerate", () => {
    const one: Rebar[] = [{ id: "a", radius: 0.008, centerline: [[0, 0, 0], [0, 1, 0], [0, 2, 0]] }];
    expect(isDegenerate(one)).toBe(true);
  });
  it("full grid is not", () => {
    expect(isDegenerate(makeWallGrid())).toBe(false);
  });
});
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './registration'`

- [ ] **Step 3: registration.ts 구현 (코스 부분)**

```ts
// office-dashboard/src/lib/analysis/registration.ts
// 정합 — spec §5.2. 코스: PCA 주축 + 4플립 채점. (파인 ICP는 Task 6에서 추가)
import {
  applyMat4, cross, dot, mat4FromRotTrans, normalize, pca,
  pointToPolyline, samplePolyline, scale, sub,
} from "./geom";
import type { Mat4, Rebar, Vec3 } from "./types";

function allSamples(rebars: Rebar[], n = 8): Vec3[] {
  const pts: Vec3[] = [];
  for (const r of rebars) pts.push(...samplePolyline(r.centerline, n));
  return pts;
}

/** scan 각 철근 샘플의 최근접 design 폴리라인 거리 평균 (미터) */
export function coarseCost(scan: Rebar[], design: Rebar[], m: Mat4): number {
  let sum = 0, count = 0;
  for (const r of scan) {
    for (const p of samplePolyline(r.centerline, 6)) {
      const tp = applyMat4(m, p);
      let min = Infinity;
      for (const d of design) {
        const dist = pointToPolyline(tp, d.centerline);
        if (dist < min) min = dist;
      }
      sum += min;
      count++;
    }
  }
  return count ? sum / count : Infinity;
}

export function isDegenerate(rebars: Rebar[]): boolean {
  const { values } = pca(allSamples(rebars));
  return values[0] <= 0 || values[1] / values[0] < 1e-6;
}

/** 직교화: a축 기준으로 b를 그람-슈미트, c = a×b */
function orthoBasis(axes: Vec3[]): Vec3[] {
  const a = normalize(axes[0]);
  let b = sub(axes[1], scale(a, dot(axes[1], a)));
  b = normalize(b);
  const c = cross(a, b);
  return [a, b, c];
}

export function coarseRegister(scan: Rebar[], design: Rebar[]): Mat4 {
  const ps = allSamples(scan);
  const pd = allSamples(design);
  const s = pca(ps), d = pca(pd);
  const sa = orthoBasis(s.axes), da = orthoBasis(d.axes);

  // 부호 플립 (s1,s2)∈{±1}², s3 = s1·s2 로 det=+1 보장 → 4후보
  let best: Mat4 | null = null;
  let bestCost = Infinity;
  for (const f1 of [1, -1]) {
    for (const f2 of [1, -1]) {
      const f3 = f1 * f2;
      const flipped = [scale(sa[0], f1), scale(sa[1], f2), scale(sa[2], f3)];
      // R = Da · Fsᵀ : scan 축 성분 → design 축 성분 (row-major 3x3)
      const r: number[] = new Array(9);
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++)
          r[i * 3 + j] =
            da[0][i] * flipped[0][j] + da[1][i] * flipped[1][j] + da[2][i] * flipped[2][j];
      const rotMean: Vec3 = [
        r[0] * s.mean[0] + r[1] * s.mean[1] + r[2] * s.mean[2],
        r[3] * s.mean[0] + r[4] * s.mean[1] + r[5] * s.mean[2],
        r[6] * s.mean[0] + r[7] * s.mean[1] + r[8] * s.mean[2],
      ];
      const t = sub(d.mean, rotMean);
      const m = mat4FromRotTrans(r, t);
      const cost = coarseCost(scan, design, m);
      if (cost < bestCost) {
        bestCost = cost;
        best = m;
      }
    }
  }
  return best!;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS (yaw 0/30/90/170 + noise + degenerate 전부)

- [ ] **Step 5: 커밋**

```bash
cd /d/Projects/LH/AR && git add office-dashboard/src/lib/analysis/registration.ts office-dashboard/src/lib/analysis/registration.test.ts
git commit -m "feat: coarse registration via PCA axis alignment with flip scoring"
```

---

### Task 6: 파인 ICP (registration.ts 2/2)

**Files:**
- Modify: `office-dashboard/src/lib/analysis/registration.ts` (함수 추가)
- Test: `office-dashboard/src/lib/analysis/registration.test.ts` (테스트 추가)

**Interfaces:**
- Consumes: Task 5의 `coarseRegister`, `coarseCost`, `isDegenerate`; geom의 `jacobiEigen`
- Produces:
  - `icpRefine(scan: Rebar[], design: Rebar[], init: Mat4): { matrix: Mat4; rmsMm: number; iterations: number }` — point-to-segment ICP, 최대 20회, ΔRMS<0.1mm 수렴 (spec §5.2)
  - `registerScan(scan: Rebar[], design: Rebar[], manualInit?: Mat4): { matrix: Mat4; rmsMm: number; method: "auto" | "manual"; failed: boolean }` — 파이프라인 진입점. `failed` = 퇴화 또는 RMS>30mm (spec §5.2 실패 판정)

- [ ] **Step 1: 실패하는 테스트 추가** (registration.test.ts 하단에)

```ts
import { icpRefine, registerScan } from "./registration";

describe("icpRefine + registerScan", () => {
  it("recovers exact transform to <1mm RMS (noiseless)", () => {
    const design = makeWallGrid();
    const scan = transformRebars(design, rigidMat4(30, [1.2, 0.4, -0.8]));
    const { rmsMm } = icpRefine(scan, design, coarseRegister(scan, design));
    expect(rmsMm).toBeLessThan(1);
  });
  it("with 2mm noise converges to RMS < 5mm", () => {
    const design = makeWallGrid();
    const scan = jitterRebars(transformRebars(design, rigidMat4(60, [0.3, 0.1, -0.5])), 0.002, 3);
    const r = registerScan(scan, design);
    expect(r.failed).toBe(false);
    expect(r.method).toBe("auto");
    expect(r.rmsMm).toBeLessThan(5);
  });
  it("verifies recovered points land on design (round-trip <2mm)", () => {
    const design = makeWallGrid();
    const scan = transformRebars(design, rigidMat4(45, [2, -1, 0.7]));
    const { matrix } = icpRefine(scan, design, coarseRegister(scan, design));
    const p = applyMat4(matrix, scan[5].centerline[0]);
    const q = design[5].centerline[0];
    expect(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])).toBeLessThan(0.002);
  });
  it("degenerate input reports failed", () => {
    const one = makeWallGrid().slice(0, 1);
    const r = registerScan(one, makeWallGrid());
    expect(r.failed).toBe(true);
  });
  it("manualInit is honored and reported", () => {
    const design = makeWallGrid();
    const scan = transformRebars(design, rigidMat4(20, [0.5, 0, 0]));
    const init = coarseRegister(scan, design);
    const r = registerScan(scan, design, init);
    expect(r.method).toBe("manual");
    expect(r.rmsMm).toBeLessThan(1);
  });
});
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npm test`
Expected: FAIL — `icpRefine is not a function` (또는 export 없음)

- [ ] **Step 3: registration.ts에 ICP 추가**

```ts
// registration.ts 하단에 추가
import { add, mat4Multiply } from "./geom"; // 파일 상단 import에 병합할 것

/** 최근접점: p에서 design 전체 폴리라인 중 가장 가까운 점 (선분 위 투영점) */
function closestPointOnDesign(p: Vec3, design: Rebar[]): Vec3 {
  let best: Vec3 = design[0].centerline[0];
  let bestD = Infinity;
  for (const r of design) {
    const line = r.centerline;
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i], b = line[i + 1];
      const ab = sub(b, a);
      const len2 = dot(ab, ab);
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / len2));
      const q = add(a, scale(ab, t));
      const d2 = dot(sub(p, q), sub(p, q));
      if (d2 < bestD) {
        bestD = d2;
        best = q;
      }
    }
  }
  return best;
}

/** Horn 쿼터니언 절대정위: 대응점쌍 최적 강체변환 (row-major 3x3 R + t) */
function hornRigid(from: Vec3[], to: Vec3[]): { r: number[]; t: Vec3 } {
  const n = from.length;
  const cf: Vec3 = [0, 0, 0], ct: Vec3 = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      cf[k] += from[i][k] / n;
      ct[k] += to[i][k] / n;
    }
  }
  // 교차공분산 S
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) {
    const a = sub(from[i], cf), b = sub(to[i], ct);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r][c] += a[r] * b[c];
  }
  const [Sxx, Sxy, Sxz] = S[0], [Syx, Syy, Syz] = S[1], [Szx, Szy, Szz] = S[2];
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ];
  const { vectors } = jacobiEigen(N);
  const [w, x, y, z] = vectors[0]; // 최대 고유값의 고유벡터 = 최적 쿼터니언
  const r = [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
  const rc: Vec3 = [
    r[0] * cf[0] + r[1] * cf[1] + r[2] * cf[2],
    r[3] * cf[0] + r[4] * cf[1] + r[5] * cf[2],
    r[6] * cf[0] + r[7] * cf[1] + r[8] * cf[2],
  ];
  return { r, t: sub(ct, rc) };
}

export function icpRefine(
  scan: Rebar[], design: Rebar[], init: Mat4,
): { matrix: Mat4; rmsMm: number; iterations: number } {
  const samples: Vec3[] = [];
  for (const r of scan) samples.push(...samplePolyline(r.centerline, 8));
  let m = init;
  let prevRms = Infinity;
  let iterations = 0;
  for (let iter = 0; iter < 20; iter++) {
    iterations = iter + 1;
    const from: Vec3[] = [];
    const to: Vec3[] = [];
    let sum2 = 0;
    for (const p of samples) {
      const tp = applyMat4(m, p);
      const q = closestPointOnDesign(tp, design);
      from.push(tp);
      to.push(q);
      const d = sub(tp, q);
      sum2 += dot(d, d);
    }
    const rms = Math.sqrt(sum2 / samples.length);
    if (Math.abs(prevRms - rms) < 0.0001) { // ΔRMS < 0.1mm
      prevRms = rms;
      break;
    }
    prevRms = rms;
    const { r, t } = hornRigid(from, to);
    m = mat4Multiply(mat4FromRotTrans(r, t), m);
  }
  return { matrix: m, rmsMm: prevRms * 1000, iterations };
}

export function registerScan(
  scan: Rebar[], design: Rebar[], manualInit?: Mat4,
): { matrix: Mat4; rmsMm: number; method: "auto" | "manual"; failed: boolean } {
  if (isDegenerate(scan) || isDegenerate(design)) {
    return { matrix: manualInit ?? coarseInitSafe(scan, design), rmsMm: Infinity, method: manualInit ? "manual" : "auto", failed: true };
  }
  const init = manualInit ?? coarseRegister(scan, design);
  const { matrix, rmsMm } = icpRefine(scan, design, init);
  return { matrix, rmsMm, method: manualInit ? "manual" : "auto", failed: rmsMm > 30 };
}

/** 퇴화 시에도 안전한 초기값: 평균점 이동만 */
function coarseInitSafe(scan: Rebar[], design: Rebar[]): Mat4 {
  const s = pca(allSamples(scan)).mean;
  const d = pca(allSamples(design)).mean;
  return mat4FromRotTrans([1, 0, 0, 0, 1, 0, 0, 0, 1], sub(d, s));
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS (전체)

- [ ] **Step 5: 커밋**

```bash
cd /d/Projects/LH/AR && git add office-dashboard/src/lib/analysis/registration.ts office-dashboard/src/lib/analysis/registration.test.ts
git commit -m "feat: fine ICP registration with Horn quaternion rigid solve"
```

---

### Task 7: 매칭 (match.ts)

**Files:**
- Create: `office-dashboard/src/lib/analysis/match.ts`
- Test: `office-dashboard/src/lib/analysis/match.test.ts`

**Interfaces:**
- Consumes: `ClassifiedRebar`, `MatchResult`, `MatchPair` (Task 1); `polylineDistance` (Task 2); Task 3·4 픽스처/분류
- Produces:
  - `matchRebars(design: ClassifiedRebar[], scan: ClassifiedRebar[]): MatchResult` — (방향,레이어) 그룹별 그리디 최소비용 1:1 (spec §5.4). 인덱스는 입력 배열 기준
  - `groupCutoffM(design: ClassifiedRebar[], idx: number[]): number` — 그룹 내 설계 최근접 간격 중앙값 ÷ 2 (미터). 설계 2개 미만이면 0.1m

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// office-dashboard/src/lib/analysis/match.test.ts
import { describe, expect, it } from "vitest";
import { classifyRebars, estimateWallNormal } from "./classify";
import { groupCutoffM, matchRebars } from "./match";
import { jitterRebars, makeWallGrid, offsetRebar } from "./testFixtures";
import type { ClassifiedRebar } from "./types";

const UP: [number, number, number] = [0, 1, 0];

function classified(rebars = makeWallGrid()): ClassifiedRebar[] {
  return classifyRebars(rebars, UP, estimateWallNormal(rebars));
}

describe("groupCutoffM", () => {
  it("vertical-outer cutoff = spacing/2 = 0.15m", () => {
    const d = classified();
    const idx = d.map((r, i) => (r.direction === "vertical" && r.layer === "outer" ? i : -1)).filter((i) => i >= 0);
    expect(groupCutoffM(d, idx)).toBeCloseTo(0.15, 3);
  });
  it("fewer than 2 design bars → 0.1m fallback", () => {
    const d = classified();
    expect(groupCutoffM(d, [0])).toBe(0.1);
  });
});

describe("matchRebars", () => {
  it("identical sets → all matched, no missing/extra", () => {
    const d = classified();
    const s = classified(jitterRebars(makeWallGrid(), 0.002, 11));
    const m = matchRebars(d, s);
    expect(m.pairs.length).toBe(24);
    expect(m.missingDesign).toEqual([]);
    expect(m.extraScan).toEqual([]);
  });
  it("removed scan bar → exactly that design bar missing", () => {
    const d = classified();
    const scanRebars = makeWallGrid().filter((r) => r.id !== "d-v-outer-3");
    const s = classified(scanRebars);
    const m = matchRebars(d, s);
    expect(m.missingDesign.length).toBe(1);
    expect(d[m.missingDesign[0]].id).toBe("d-v-outer-3");
    expect(m.extraScan).toEqual([]);
  });
  it("extra scan bar → reported as extra", () => {
    const d = classified();
    const extra = makeWallGrid();
    extra.push({ id: "ghost", radius: 0.008, centerline: [[0.95, 0, 0], [0.95, 1, 0], [0.95, 2, 0]] });
    const s = classified(extra);
    const m = matchRebars(d, s);
    expect(m.extraScan.length).toBe(1);
    expect(s[m.extraScan[0]].id).toBe("ghost");
  });
  it("15mm-offset bar still matches (within 150mm cutoff) with meanMm≈15", () => {
    const d = classified();
    const s = classified(offsetRebar(makeWallGrid(), "d-v-outer-2", [0.015, 0, 0]));
    const m = matchRebars(d, s);
    const pair = m.pairs.find((p) => d[p.designIdx].id === "d-v-outer-2")!;
    expect(pair.meanMm).toBeGreaterThan(10);
    expect(pair.meanMm).toBeLessThan(20);
  });
  it("does not match across groups (vertical bar never pairs with horizontal)", () => {
    const d = classified();
    const s = classified();
    for (const p of matchRebars(d, s).pairs) {
      expect(d[p.designIdx].direction).toBe(s[p.scanIdx].direction);
      expect(d[p.designIdx].layer).toBe(s[p.scanIdx].layer);
    }
  });
});
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './match'`

- [ ] **Step 3: match.ts 구현**

```ts
// office-dashboard/src/lib/analysis/match.ts
// (방향,레이어) 그룹 내 그리디 최소비용 1:1 매칭 — spec §5.4
import { polylineDistance } from "./geom";
import type { ClassifiedRebar, MatchPair, MatchResult } from "./types";

/** 그룹 내 설계 최근접 중심선 간격 중앙값 ÷ 2 (미터). 2개 미만 → 0.1m */
export function groupCutoffM(design: ClassifiedRebar[], idx: number[]): number {
  if (idx.length < 2) return 0.1;
  const nn: number[] = [];
  for (const i of idx) {
    let min = Infinity;
    for (const j of idx) {
      if (i === j) continue;
      const d = polylineDistance(design[i].centerline, design[j].centerline).mean;
      if (d < min) min = d;
    }
    nn.push(min);
  }
  nn.sort((a, b) => a - b);
  const mid = Math.floor(nn.length / 2);
  const median = nn.length % 2 ? nn[mid] : (nn[mid - 1] + nn[mid]) / 2;
  return median / 2;
}

export function matchRebars(design: ClassifiedRebar[], scan: ClassifiedRebar[]): MatchResult {
  const groups = new Map<string, { d: number[]; s: number[] }>();
  const key = (r: ClassifiedRebar) => `${r.direction}/${r.layer}`;
  design.forEach((r, i) => {
    const g = groups.get(key(r)) ?? { d: [], s: [] };
    g.d.push(i);
    groups.set(key(r), g);
  });
  scan.forEach((r, i) => {
    const g = groups.get(key(r)) ?? { d: [], s: [] };
    g.s.push(i);
    groups.set(key(r), g);
  });

  const pairs: MatchPair[] = [];
  const usedD = new Set<number>();
  const usedS = new Set<number>();
  for (const { d, s } of groups.values()) {
    const cutoff = groupCutoffM(design, d);
    const cands: { di: number; si: number; mean: number; max: number }[] = [];
    for (const di of d)
      for (const si of s) {
        const { mean, max } = polylineDistance(design[di].centerline, scan[si].centerline);
        if (mean <= cutoff) cands.push({ di, si, mean, max });
      }
    cands.sort((a, b) => a.mean - b.mean);
    for (const c of cands) {
      if (usedD.has(c.di) || usedS.has(c.si)) continue;
      usedD.add(c.di);
      usedS.add(c.si);
      pairs.push({ designIdx: c.di, scanIdx: c.si, meanMm: c.mean * 1000, maxMm: c.max * 1000 });
    }
  }
  return {
    pairs,
    missingDesign: design.map((_, i) => i).filter((i) => !usedD.has(i)),
    extraScan: scan.map((_, i) => i).filter((i) => !usedS.has(i)),
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
cd /d/Projects/LH/AR && git add office-dashboard/src/lib/analysis/match.ts office-dashboard/src/lib/analysis/match.test.ts
git commit -m "feat: per-group greedy rebar matching with spacing-derived cutoff"
```

---

### Task 8: 판정 + 요약 (judge.ts)

**Files:**
- Create: `office-dashboard/src/lib/analysis/judge.ts`
- Test: `office-dashboard/src/lib/analysis/judge.test.ts`

**Interfaces:**
- Consumes: Task 1 타입, Task 7 `matchRebars` 출력
- Produces:
  - `buildRecords(design: ClassifiedRebar[], scan: ClassifiedRebar[], match: MatchResult): RebarRecord[]` — verdict는 임시 "pass"로 생성 (tolerance 미적용 상태)
  - `rejudgeRecords(records: RebarRecord[], toleranceMm: number): { rebars: RebarRecord[]; summary: AnalysisSummary }` — deviation 있는 레코드만 pass/out_of_tolerance 재판정 + 요약 재계산. **UI 슬라이더가 직접 호출** (spec §5.5: judge만 재실행)
  - `judge(design, scan, match, toleranceMm)` = `rejudgeRecords(buildRecords(…), toleranceMm)` 편의 함수

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// office-dashboard/src/lib/analysis/judge.test.ts
import { describe, expect, it } from "vitest";
import { classifyRebars, estimateWallNormal } from "./classify";
import { judge, rejudgeRecords } from "./judge";
import { matchRebars } from "./match";
import { makeWallGrid, offsetRebar } from "./testFixtures";

const UP: [number, number, number] = [0, 1, 0];
const classify = (r = makeWallGrid()) => classifyRebars(r, UP, estimateWallNormal(r));

describe("judge", () => {
  it("clean scan → all pass, summary counts correct", () => {
    const d = classify();
    const s = classify();
    const { rebars, summary } = judge(d, s, matchRebars(d, s), 10);
    expect(rebars.filter((r) => r.verdict === "pass").length).toBe(24);
    expect(summary).toMatchObject({ designCount: 24, scanCount: 24, matched: 24, missing: 0, extra: 0, outOfTolerance: 0 });
    expect(summary.byGroup.length).toBe(4); // 2방향 × 2레이어
  });
  it("15mm offset bar → out_of_tolerance at 10mm, pass at 20mm", () => {
    const d = classify();
    const s = classify(offsetRebar(makeWallGrid(), "d-v-outer-2", [0.015, 0, 0]));
    const m = matchRebars(d, s);
    const at10 = judge(d, s, m, 10);
    expect(at10.summary.outOfTolerance).toBe(1);
    const bad = at10.rebars.find((r) => r.verdict === "out_of_tolerance")!;
    expect(bad.designId).toBe("d-v-outer-2");
    expect(bad.deviationMm!.mean).toBeGreaterThan(10);
    // 재판정만으로 통과로 바뀜
    const at20 = rejudgeRecords(at10.rebars, 20);
    expect(at20.summary.outOfTolerance).toBe(0);
  });
  it("missing design bar → verdict missing with scanId null", () => {
    const d = classify();
    const s = classify(makeWallGrid().filter((r) => r.id !== "d-h-inner-1"));
    const { rebars, summary } = judge(d, s, matchRebars(d, s), 10);
    expect(summary.missing).toBe(1);
    const miss = rebars.find((r) => r.verdict === "missing")!;
    expect(miss.designId).toBe("d-h-inner-1");
    expect(miss.scanId).toBeNull();
    expect(miss.deviationMm).toBeNull();
  });
  it("summary deviation aggregates over matched only", () => {
    const d = classify();
    const s = classify();
    const { summary } = judge(d, s, matchRebars(d, s), 10);
    expect(summary.deviationMm!.mean).toBeLessThan(1);
    expect(summary.deviationMm!.max).toBeLessThan(1);
  });
});
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './judge'`

- [ ] **Step 3: judge.ts 구현**

```ts
// office-dashboard/src/lib/analysis/judge.ts
// 허용오차 판정 + 요약 — spec §5.5. rejudgeRecords는 저장된 결과에도 그대로 적용 가능.
import type {
  AnalysisSummary, ClassifiedRebar, Direction, GroupSummary, Layer,
  MatchResult, RebarRecord,
} from "./types";

export function buildRecords(
  design: ClassifiedRebar[], scan: ClassifiedRebar[], match: MatchResult,
): RebarRecord[] {
  const records: RebarRecord[] = [];
  for (const p of match.pairs) {
    const d = design[p.designIdx];
    records.push({
      designId: d.id, scanId: scan[p.scanIdx].id,
      direction: d.direction, layer: d.layer,
      deviationMm: { mean: p.meanMm, max: p.maxMm },
      verdict: "pass",
    });
  }
  for (const i of match.missingDesign) {
    const d = design[i];
    records.push({
      designId: d.id, scanId: null, direction: d.direction, layer: d.layer,
      deviationMm: null, verdict: "missing",
    });
  }
  for (const i of match.extraScan) {
    const s = scan[i];
    records.push({
      designId: null, scanId: s.id, direction: s.direction, layer: s.layer,
      deviationMm: null, verdict: "extra",
    });
  }
  return records;
}

export function rejudgeRecords(
  records: RebarRecord[], toleranceMm: number,
): { rebars: RebarRecord[]; summary: AnalysisSummary } {
  const rebars: RebarRecord[] = records.map((r) =>
    r.deviationMm == null
      ? r
      : { ...r, verdict: r.deviationMm.mean > toleranceMm ? "out_of_tolerance" : "pass" },
  );

  const matched = rebars.filter((r) => r.deviationMm != null);
  const groups: GroupSummary[] = [];
  for (const direction of ["horizontal", "vertical"] as Direction[]) {
    for (const layer of ["outer", "inner"] as Layer[]) {
      const g = rebars.filter((r) => r.direction === direction && r.layer === layer);
      if (g.length === 0) continue;
      const gm = g.filter((r) => r.deviationMm != null);
      groups.push({
        direction, layer,
        designCount: g.filter((r) => r.designId != null).length,
        scanCount: g.filter((r) => r.scanId != null).length,
        missing: g.filter((r) => r.verdict === "missing").length,
        outOfTolerance: g.filter((r) => r.verdict === "out_of_tolerance").length,
        meanDeviationMm: gm.length
          ? gm.reduce((s, r) => s + r.deviationMm!.mean, 0) / gm.length
          : null,
      });
    }
  }
  const summary: AnalysisSummary = {
    designCount: rebars.filter((r) => r.designId != null).length,
    scanCount: rebars.filter((r) => r.scanId != null).length,
    matched: matched.length,
    missing: rebars.filter((r) => r.verdict === "missing").length,
    extra: rebars.filter((r) => r.verdict === "extra").length,
    outOfTolerance: rebars.filter((r) => r.verdict === "out_of_tolerance").length,
    deviationMm: matched.length
      ? {
          mean: matched.reduce((s, r) => s + r.deviationMm!.mean, 0) / matched.length,
          max: Math.max(...matched.map((r) => r.deviationMm!.max)),
        }
      : null,
    byGroup: groups,
  };
  return { rebars, summary };
}

export function judge(
  design: ClassifiedRebar[], scan: ClassifiedRebar[], match: MatchResult, toleranceMm: number,
): { rebars: RebarRecord[]; summary: AnalysisSummary } {
  return rejudgeRecords(buildRecords(design, scan, match), toleranceMm);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
cd /d/Projects/LH/AR && git add office-dashboard/src/lib/analysis/judge.ts office-dashboard/src/lib/analysis/judge.test.ts
git commit -m "feat: tolerance judgement and summary aggregation"
```

---

### Task 9: 파이프라인 (pipeline.ts) — 엔드투엔드 합성 테스트

**Files:**
- Create: `office-dashboard/src/lib/analysis/pipeline.ts`
- Test: `office-dashboard/src/lib/analysis/pipeline.test.ts`

**Interfaces:**
- Consumes: Task 4–8의 `estimateWallNormal`, `classifyRebars`, `registerScan`, `matchRebars`, `judge`; geom `applyMat4`
- Produces (worker와 UI가 사용하는 단일 진입점):

```ts
export interface AnalysisInput {
  design: Rebar[];       // 설계 좌표계
  scan: Rebar[];         // 스캔 좌표계 (미정합)
  toleranceMm: number;
  up: Vec3;              // 설계 좌표계 up (three 씬 = [0,1,0])
  manualInit?: Mat4;     // 수동 폴백 초기정합
}
export interface AnalysisOutput {
  registration: { matrix: Mat4; rmsMm: number; method: "auto" | "manual"; failed: boolean };
  rebars: RebarRecord[];
  summary: AnalysisSummary;
  designClassified: ClassifiedRebar[];  // 뷰어 렌더용 (설계 좌표)
  scanTransformed: ClassifiedRebar[];   // 뷰어 렌더용 (설계 좌표로 변환+분류 완료)
}
export function runAnalysis(input: AnalysisInput): AnalysisOutput
```

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// office-dashboard/src/lib/analysis/pipeline.test.ts
import { describe, expect, it } from "vitest";
import { runAnalysis } from "./pipeline";
import { jitterRebars, makeWallGrid, offsetRebar, rigidMat4, transformRebars } from "./testFixtures";

const UP: [number, number, number] = [0, 1, 0];

describe("runAnalysis end-to-end", () => {
  it("full scenario: transform+noise+1 missing+1 offset → correct verdicts", () => {
    const design = makeWallGrid();
    // 시공 시나리오: d-v-outer-3 미시공, d-h-inner-1 15mm 오프셋, 2mm 노이즈, 임의 배치
    let scan = makeWallGrid().filter((r) => r.id !== "d-v-outer-3");
    scan = offsetRebar(scan, "d-h-inner-1", [0, 0, 0.015]);
    scan = jitterRebars(scan, 0.002, 99);
    scan = transformRebars(scan, rigidMat4(75, [3.1, -0.6, 1.4]));
    // 스캔 id는 라이다 앱 임의 명명 시뮬레이션
    scan = scan.map((r, i) => ({ ...r, id: `s${i}` }));

    const out = runAnalysis({ design, scan, toleranceMm: 10, up: UP });

    expect(out.registration.failed).toBe(false);
    expect(out.registration.rmsMm).toBeLessThan(6);
    expect(out.summary.designCount).toBe(24);
    expect(out.summary.scanCount).toBe(23);
    expect(out.summary.missing).toBe(1);
    expect(out.rebars.find((r) => r.verdict === "missing")!.designId).toBe("d-v-outer-3");
    const oot = out.rebars.filter((r) => r.verdict === "out_of_tolerance");
    expect(oot.length).toBe(1);
    expect(oot[0].designId).toBe("d-h-inner-1");
    expect(out.summary.extra).toBe(0);
  });

  it("scanTransformed lands on design frame (bbox overlaps design bbox)", () => {
    const design = makeWallGrid();
    const scan = transformRebars(makeWallGrid(), rigidMat4(30, [5, 0, -2]));
    const out = runAnalysis({ design, scan, toleranceMm: 10, up: UP });
    const xs = out.scanTransformed.flatMap((r) => r.centerline.map((p) => p[0]));
    expect(Math.min(...xs)).toBeGreaterThan(-0.1);
    expect(Math.max(...xs)).toBeLessThan(1.9);
  });

  it("degenerate scan → failed registration, no throw", () => {
    const out = runAnalysis({
      design: makeWallGrid(),
      scan: makeWallGrid().slice(0, 1),
      toleranceMm: 10, up: UP,
    });
    expect(out.registration.failed).toBe(true);
  });
});
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './pipeline'`

- [ ] **Step 3: pipeline.ts 구현**

```ts
// office-dashboard/src/lib/analysis/pipeline.ts
// 분석 파이프라인 진입점 — spec §5. worker.ts와 UI가 이 함수만 호출한다.
import { classifyRebars, estimateWallNormal } from "./classify";
import { applyMat4 } from "./geom";
import { judge } from "./judge";
import { matchRebars } from "./match";
import { registerScan } from "./registration";
import type {
  AnalysisSummary, ClassifiedRebar, Mat4, Rebar, RebarRecord, Vec3,
} from "./types";

export interface AnalysisInput {
  design: Rebar[];
  scan: Rebar[];
  toleranceMm: number;
  up: Vec3;
  manualInit?: Mat4;
}

export interface AnalysisOutput {
  registration: { matrix: Mat4; rmsMm: number; method: "auto" | "manual"; failed: boolean };
  rebars: RebarRecord[];
  summary: AnalysisSummary;
  designClassified: ClassifiedRebar[];
  scanTransformed: ClassifiedRebar[];
}

export function runAnalysis(input: AnalysisInput): AnalysisOutput {
  const registration = registerScan(input.scan, input.design, input.manualInit);
  const transformed: Rebar[] = input.scan.map((r) => ({
    ...r,
    centerline: r.centerline.map((p) => applyMat4(registration.matrix, p)),
  }));
  const wallNormal = estimateWallNormal(input.design);
  const designClassified = classifyRebars(input.design, input.up, wallNormal);
  const scanTransformed = classifyRebars(transformed, input.up, wallNormal);
  const match = matchRebars(designClassified, scanTransformed);
  const { rebars, summary } = judge(designClassified, scanTransformed, match, input.toleranceMm);
  return { registration, rebars, summary, designClassified, scanTransformed };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS — 특히 첫 시나리오 테스트가 미시공/허용초과를 정확히 골라내야 함

- [ ] **Step 5: 커밋**

```bash
cd /d/Projects/LH/AR && git add office-dashboard/src/lib/analysis/pipeline.ts office-dashboard/src/lib/analysis/pipeline.test.ts
git commit -m "feat: end-to-end analysis pipeline (register, classify, match, judge)"
```

---

### Task 10: 설계 중심선 추출 (designExtract.ts) + 실제 OBJ 픽스처 테스트

**Files:**
- Create: `office-dashboard/src/lib/analysis/designExtract.ts`
- Create: `office-dashboard/src/lib/analysis/objFixture.ts` (테스트 전용 미니 OBJ 파서)
- Test: `office-dashboard/src/lib/analysis/designExtract.test.ts`

**Interfaces:**
- Consumes: geom `pca`, `dot`, `sub`; 리포 루트의 `source-models/highlighted_design_model.obj` (27개 `o rebar_N_*` 그룹 — 테스트에서 `node:fs`로 읽음. vitest는 node 환경이라 가능. 프로덕션 코드는 fs 금지, objFixture는 테스트 전용)
- Produces:
  - `extractCenterline(vertices: Vec3[]): { centerline: [Vec3, Vec3]; radius: number }` — PCA 주축 투영 min/max 끝점, 반경 = 직교거리 중앙값 (spec §5.1)
  - `rebarsFromGroups(groups: { name: string; vertices: Vec3[] }[]): Rebar[]` — 그룹당 1개 Rebar, id = name
  - `splitByConnectivity(positions: number[], index: number[]): Vec3[][]` — union-find로 삼각형 연결요소 분리 (이름 없는 모델 폴백)
  - objFixture: `parseObjGroups(text: string): { name: string; vertices: Vec3[] }[]`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// office-dashboard/src/lib/analysis/designExtract.test.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractCenterline, rebarsFromGroups, splitByConnectivity } from "./designExtract";
import { parseObjGroups } from "./objFixture";
import type { Vec3 } from "./types";

describe("extractCenterline", () => {
  it("axis-aligned cylinder point cloud → endpoints at ±1 on Y, radius≈0.01", () => {
    const pts: Vec3[] = [];
    for (let i = 0; i <= 40; i++)
      for (let a = 0; a < 8; a++) {
        const th = (a / 8) * Math.PI * 2;
        pts.push([0.01 * Math.cos(th), -1 + (2 * i) / 40, 0.01 * Math.sin(th)]);
      }
    const { centerline, radius } = extractCenterline(pts);
    const ys = [centerline[0][1], centerline[1][1]].sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(-1, 2);
    expect(ys[1]).toBeCloseTo(1, 2);
    expect(radius).toBeCloseTo(0.01, 3);
  });
});

describe("bundled design model OBJ", () => {
  const objPath = resolve(__dirname, "../../../../source-models/highlighted_design_model.obj");
  const groups = parseObjGroups(readFileSync(objPath, "utf8"));

  it("parses 27 rebar groups", () => {
    expect(groups.length).toBe(27);
    expect(groups.filter((g) => g.name.includes("MISSING")).length).toBe(1);
  });
  it("extracts 27 rebars with sane geometry", () => {
    const rebars = rebarsFromGroups(groups);
    expect(rebars.length).toBe(27);
    for (const r of rebars) {
      const [a, b] = r.centerline;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      expect(len).toBeGreaterThan(0.1);   // 철근은 10cm 이상
      expect(r.radius).toBeGreaterThan(0.001);
      expect(r.radius).toBeLessThan(0.05); // 반경 1–50mm 범위
    }
  });
});

describe("splitByConnectivity", () => {
  it("two disjoint triangles → two components", () => {
    const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 5, 5, 6, 5, 5, 5, 6, 5];
    const index = [0, 1, 2, 3, 4, 5];
    const parts = splitByConnectivity(positions, index);
    expect(parts.length).toBe(2);
    expect(parts[0].length).toBe(3);
  });
});
```

- [ ] **Step 2: objFixture.ts 작성** (테스트 유틸이므로 테스트와 함께)

```ts
// office-dashboard/src/lib/analysis/objFixture.ts
// 테스트 전용 미니 OBJ 파서: o 그룹별 정점만 수집 (면/노멀 무시).
// 주의: OBJ의 v 인덱스는 전역이지만, 이 모델은 그룹별로 정점을 순서대로 선언하므로
// "직전 o 이후 선언된 v"를 그 그룹 소속으로 본다.
import type { Vec3 } from "./types";

export function parseObjGroups(text: string): { name: string; vertices: Vec3[] }[] {
  const groups: { name: string; vertices: Vec3[] }[] = [];
  let current: { name: string; vertices: Vec3[] } | null = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("o ")) {
      current = { name: line.slice(2).trim(), vertices: [] };
      groups.push(current);
    } else if (line.startsWith("v ") && current) {
      const [x, y, z] = line.slice(2).trim().split(/\s+/).map(Number);
      current.vertices.push([x, y, z]);
    }
  }
  return groups.filter((g) => g.vertices.length > 0);
}
```

- [ ] **Step 3: 실행해서 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './designExtract'`

- [ ] **Step 4: designExtract.ts 구현**

```ts
// office-dashboard/src/lib/analysis/designExtract.ts
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
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test`
Expected: PASS — 실제 번들 OBJ에서 27개 철근 추출 성공

- [ ] **Step 6: 커밋**

```bash
cd /d/Projects/LH/AR && git add office-dashboard/src/lib/analysis/designExtract.ts office-dashboard/src/lib/analysis/objFixture.ts office-dashboard/src/lib/analysis/designExtract.test.ts
git commit -m "feat: design centerline extraction with real OBJ fixture test"
```

---

### Task 11: 업로드 스키마 + /api/scan-upload

**Files:**
- Create: `office-dashboard/src/lib/analysis/rebarsSchema.ts`
- Test: `office-dashboard/src/lib/analysis/rebarsSchema.test.ts`
- Create: `office-dashboard/src/app/api/scan-upload/route.ts`
- Modify: `office-dashboard/.env.local` (없으면 생성 — gitignore됨, 커밋 금지)

**Interfaces:**
- Consumes: `RebarsFile` (Task 1)
- Produces:
  - `parseRebarsJson(text: string): { ok: true; data: RebarsFile } | { ok: false; errors: string[] }` — zod 검증 + 유한수/고유 id 검사 (spec §4)
  - HTTP: `POST /api/scan-upload` (Bearer `SCAN_UPLOAD_TOKEN`) → `{ status:"success", scan_id, rebar_count }`. Blob 키: `scans/<site_id>/<scan_id>/rebars.json`, `meta.json`, `mesh.glb`(선택). meta.json = `{ scan_id, site_id, captured_at, uploaded_at, rebar_count, has_mesh }` (Task 12·13이 이 형태에 의존)

- [ ] **Step 1: zod, @vercel/blob 설치**

```bash
npm install zod @vercel/blob
```

- [ ] **Step 2: 실패하는 스키마 테스트 작성**

```ts
// office-dashboard/src/lib/analysis/rebarsSchema.test.ts
import { describe, expect, it } from "vitest";
import { parseRebarsJson } from "./rebarsSchema";

const valid = JSON.stringify({
  version: 1, unit: "m",
  rebars: [
    { id: "r0", centerline: [[0, 0, 0], [0, 2, 0]], radius: 0.008 },
    { id: "r1", centerline: [[0.3, 0, 0], [0.3, 2, 0]], radius: 0.008 },
  ],
});

describe("parseRebarsJson", () => {
  it("accepts a valid file", () => {
    const r = parseRebarsJson(valid);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.rebars.length).toBe(2);
  });
  it("rejects malformed JSON", () => {
    expect(parseRebarsJson("{oops").ok).toBe(false);
  });
  it("rejects wrong unit", () => {
    const r = parseRebarsJson(valid.replace('"m"', '"mm"'));
    expect(r.ok).toBe(false);
  });
  it("rejects single-point centerline", () => {
    const bad = JSON.stringify({
      version: 1, unit: "m", rebars: [{ id: "r0", centerline: [[0, 0, 0]], radius: 0.008 }],
    });
    expect(parseRebarsJson(bad).ok).toBe(false);
  });
  it("rejects NaN coordinates", () => {
    const bad = valid.replace("0.3", "null");
    expect(parseRebarsJson(bad).ok).toBe(false);
  });
  it("rejects duplicate ids", () => {
    const bad = valid.replaceAll('"r1"', '"r0"');
    const r = parseRebarsJson(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain("중복");
  });
  it("rejects empty rebars array", () => {
    const bad = JSON.stringify({ version: 1, unit: "m", rebars: [] });
    expect(parseRebarsJson(bad).ok).toBe(false);
  });
  it("rejects radius out of range", () => {
    const bad = valid.replaceAll("0.008", "0.2");
    expect(parseRebarsJson(bad).ok).toBe(false);
  });
});
```

- [ ] **Step 3: 실행해서 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './rebarsSchema'`

- [ ] **Step 4: rebarsSchema.ts 구현**

```ts
// office-dashboard/src/lib/analysis/rebarsSchema.ts
// rebars.json 검증 — spec §4. 라이다 앱 디버깅을 위해 오류를 필드별 한국어 메시지로.
import { z } from "zod";
import type { RebarsFile } from "./types";

const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

const schema = z.object({
  version: z.literal(1),
  unit: z.literal("m"),
  rebars: z
    .array(
      z.object({
        id: z.string().min(1),
        centerline: z.array(vec3).min(2, "centerline은 2점 이상"),
        radius: z.number().finite().gt(0).lt(0.1, "radius는 0–0.1m 범위"),
      }),
    )
    .min(1, "rebars가 비어 있음"),
});

export function parseRebarsJson(
  text: string,
): { ok: true; data: RebarsFile } | { ok: false; errors: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["JSON 파싱 실패"] };
  }
  const r = schema.safeParse(json);
  if (!r.success) {
    return {
      ok: false,
      errors: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }
  const ids = new Set<string>();
  for (const rb of r.data.rebars) {
    if (ids.has(rb.id)) return { ok: false, errors: [`중복 id: ${rb.id}`] };
    ids.add(rb.id);
  }
  return { ok: true, data: r.data as RebarsFile };
}
```

- [ ] **Step 5: 스키마 테스트 통과 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: scan-upload 라우트 작성** (라우트는 Blob 의존이라 수동 검증 — Task 13의 데모 스크립트가 E2E 역할)

```ts
// office-dashboard/src/app/api/scan-upload/route.ts
import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { parseRebarsJson } from "../../../lib/analysis/rebarsSchema";

// 라이다 스캔 앱이 as-built 철근 번들을 올리는 엔드포인트 (spec §4).
// BriconLab에 동일 스펙 요청 중 (api/SCAN_STORAGE_REQUEST.md) — 구현되면
// 이 라우트 내부만 프록시로 교체한다.
export const dynamic = "force-dynamic";

function err(status: number, message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ status: "error", message, ...extra }, { status });
}

export async function POST(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return err(500, "BLOB_READ_WRITE_TOKEN이 설정되지 않았습니다 (Vercel Blob 연결 필요)");
  }
  const token = process.env.SCAN_UPLOAD_TOKEN;
  if (!token) return err(500, "SCAN_UPLOAD_TOKEN이 설정되지 않았습니다");
  if (req.headers.get("authorization") !== `Bearer ${token}`) {
    return err(401, "인증 실패");
  }

  const form = await req.formData();
  const siteId = form.get("site_id");
  const capturedAt = form.get("captured_at");
  const rebarsFile = form.get("rebars");
  const meshFile = form.get("mesh");
  if (typeof siteId !== "string" || !/^\d+$/.test(siteId)) return err(400, "site_id가 없거나 숫자가 아닙니다");
  if (typeof capturedAt !== "string" || Number.isNaN(Date.parse(capturedAt))) {
    return err(400, "captured_at이 없거나 ISO8601이 아닙니다");
  }
  if (!(rebarsFile instanceof File)) return err(400, "rebars 파일이 없습니다");

  const parsed = parseRebarsJson(await rebarsFile.text());
  if (!parsed.ok) return err(400, "rebars.json 검증 실패", { errors: parsed.errors });

  const scanId = crypto.randomUUID();
  const base = `scans/${siteId}/${scanId}`;
  const opts = { access: "public" as const, addRandomSuffix: false };
  await put(`${base}/rebars.json`, JSON.stringify(parsed.data), {
    ...opts, contentType: "application/json",
  });
  const hasMesh = meshFile instanceof File && meshFile.size > 0;
  if (hasMesh) {
    await put(`${base}/mesh.glb`, meshFile, { ...opts, contentType: "model/gltf-binary" });
  }
  const meta = {
    scan_id: scanId,
    site_id: Number(siteId),
    captured_at: capturedAt,
    uploaded_at: new Date().toISOString(),
    rebar_count: parsed.data.rebars.length,
    has_mesh: hasMesh,
  };
  await put(`${base}/meta.json`, JSON.stringify(meta), {
    ...opts, contentType: "application/json",
  });
  return NextResponse.json({ status: "success", scan_id: scanId, rebar_count: meta.rebar_count });
}
```

- [ ] **Step 7: .env.local에 환경변수 추가** (커밋 금지 — gitignore 확인)

`office-dashboard/.env.local`에 추가 (파일이 없으면 생성; 기존 LiveKit 변수는 원본 머신에서 복원 대상이므로 건드리지 않음):

```
# Vercel Blob (vercel.com → Storage → Blob store 생성 후 토큰 복사, 또는 `npx vercel env pull`)
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_XXXX
# 라이다 앱과 공유하는 업로드 시크릿 (임의 긴 문자열)
SCAN_UPLOAD_TOKEN=<openssl rand -hex 24 결과>
```

- [ ] **Step 8: 타입 체크 + 커밋**

Run: `npm run build` — 컴파일 오류 없어야 함 (Blob 토큰 없이도 빌드는 성공)

```bash
cd /d/Projects/LH/AR && git add office-dashboard/src/lib/analysis/rebarsSchema.ts office-dashboard/src/lib/analysis/rebarsSchema.test.ts office-dashboard/src/app/api/scan-upload/ office-dashboard/package.json office-dashboard/package-lock.json
git commit -m "feat: scan upload endpoint with zod validation and Vercel Blob storage"
```

---

### Task 12: 조회 라우트 3개 (/api/scans, /api/scan, /api/analysis-result)

**Files:**
- Create: `office-dashboard/src/app/api/scans/route.ts`
- Create: `office-dashboard/src/app/api/scan/route.ts`
- Create: `office-dashboard/src/app/api/analysis-result/route.ts`

**Interfaces:**
- Consumes: Task 11의 Blob 키 구조와 meta.json 형태
- Produces (Task 14·16의 UI가 호출):
  - `GET /api/scans?site_id=5` → `{ status:"success", scans: Meta[] }` (uploaded_at 내림차순; `Meta` = meta.json 형태)
  - `GET /api/scan?site_id=5&scan_id=<uuid>` → `{ status:"success", rebars_url, mesh_url | null, meta }`
  - `PUT /api/analysis-result?site_id=5&scan_id=<uuid>` (body = AnalysisResult JSON) → `{ status:"success" }`
  - `GET /api/analysis-result?site_id=5&scan_id=<uuid>` → AnalysisResult JSON 또는 404 `{ status:"error" }`

- [ ] **Step 1: scans 라우트 작성**

```ts
// office-dashboard/src/app/api/scans/route.ts
import { list } from "@vercel/blob";
import { NextResponse } from "next/server";

// 사이트별 as-built 스캔 목록: scans/<site_id>/*/meta.json을 나열해 메타를 취합.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { status: "error", message: "BLOB_READ_WRITE_TOKEN이 설정되지 않았습니다", scans: [] },
      { status: 500 },
    );
  }
  const siteId = new URL(req.url).searchParams.get("site_id");
  if (!siteId || !/^\d+$/.test(siteId)) {
    return NextResponse.json({ status: "error", message: "site_id 필요", scans: [] }, { status: 400 });
  }
  try {
    const { blobs } = await list({ prefix: `scans/${siteId}/` });
    const metas = blobs.filter((b) => b.pathname.endsWith("/meta.json"));
    const scans = await Promise.all(
      metas.map(async (b) => (await fetch(b.url, { cache: "no-store" })).json()),
    );
    scans.sort((a, b) => String(b.uploaded_at).localeCompare(String(a.uploaded_at)));
    return NextResponse.json({ status: "success", scans });
  } catch (e) {
    return NextResponse.json(
      { status: "error", message: e instanceof Error ? e.message : String(e), scans: [] },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 2: scan 라우트 작성**

```ts
// office-dashboard/src/app/api/scan/route.ts
import { list } from "@vercel/blob";
import { NextResponse } from "next/server";

// 단일 스캔의 파일 URL 해석. Blob public URL을 그대로 반환한다 (CORS 허용됨).
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { status: "error", message: "BLOB_READ_WRITE_TOKEN이 설정되지 않았습니다" },
      { status: 500 },
    );
  }
  const params = new URL(req.url).searchParams;
  const siteId = params.get("site_id");
  const scanId = params.get("scan_id");
  if (!siteId || !scanId) {
    return NextResponse.json({ status: "error", message: "site_id, scan_id 필요" }, { status: 400 });
  }
  try {
    const { blobs } = await list({ prefix: `scans/${siteId}/${scanId}/` });
    const find = (suffix: string) => blobs.find((b) => b.pathname.endsWith(suffix))?.url ?? null;
    const rebarsUrl = find("/rebars.json");
    const metaUrl = find("/meta.json");
    if (!rebarsUrl || !metaUrl) {
      return NextResponse.json({ status: "error", message: "스캔을 찾을 수 없습니다" }, { status: 404 });
    }
    const meta = await (await fetch(metaUrl, { cache: "no-store" })).json();
    return NextResponse.json({
      status: "success",
      rebars_url: rebarsUrl,
      mesh_url: find("/mesh.glb"),
      meta,
    });
  } catch (e) {
    return NextResponse.json(
      { status: "error", message: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 3: analysis-result 라우트 작성**

```ts
// office-dashboard/src/app/api/analysis-result/route.ts
import { list, put } from "@vercel/blob";
import { NextResponse } from "next/server";

// 분석결과 JSON 저장/로드 — 재방문 시 재계산을 생략하기 위함 (spec §5.6).
export const dynamic = "force-dynamic";

function keyOf(req: Request): { siteId: string; scanId: string } | null {
  const p = new URL(req.url).searchParams;
  const siteId = p.get("site_id");
  const scanId = p.get("scan_id");
  return siteId && scanId ? { siteId, scanId } : null;
}

function noToken() {
  return NextResponse.json(
    { status: "error", message: "BLOB_READ_WRITE_TOKEN이 설정되지 않았습니다" },
    { status: 500 },
  );
}

export async function PUT(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return noToken();
  const k = keyOf(req);
  if (!k) return NextResponse.json({ status: "error", message: "site_id, scan_id 필요" }, { status: 400 });
  const body = await req.text();
  try {
    JSON.parse(body);
  } catch {
    return NextResponse.json({ status: "error", message: "JSON 본문이 아닙니다" }, { status: 400 });
  }
  await put(`scans/${k.siteId}/${k.scanId}/analysis-result.json`, body, {
    access: "public", addRandomSuffix: false, contentType: "application/json",
  });
  return NextResponse.json({ status: "success" });
}

export async function GET(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return noToken();
  const k = keyOf(req);
  if (!k) return NextResponse.json({ status: "error", message: "site_id, scan_id 필요" }, { status: 400 });
  try {
    const { blobs } = await list({ prefix: `scans/${k.siteId}/${k.scanId}/` });
    const hit = blobs.find((b) => b.pathname.endsWith("/analysis-result.json"));
    if (!hit) return NextResponse.json({ status: "error", message: "결과 없음" }, { status: 404 });
    const data = await (await fetch(hit.url, { cache: "no-store" })).json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { status: "error", message: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 4: 빌드 확인 + 커밋**

Run: `npm run build`
Expected: 컴파일 성공

```bash
cd /d/Projects/LH/AR && git add office-dashboard/src/app/api/scans/ office-dashboard/src/app/api/scan/ office-dashboard/src/app/api/analysis-result/
git commit -m "feat: scan list/detail and analysis-result storage routes"
```

---

### Task 13: 데모 스캔 생성 스크립트 (라이다 앱 대역)

**Files:**
- Create: `office-dashboard/scripts/make-demo-scan.mjs`

**Interfaces:**
- Consumes: 리포 루트 `source-models/highlighted_design_model.obj`; Task 11의 업로드 계약
- Produces: `node scripts/make-demo-scan.mjs [--upload URL] [--site 5]` — 설계 OBJ에서 중심선 추출 → `rebar_12_MISSING` 제거(미시공 시뮬) + 1개 15mm 오프셋 + 2mm 노이즈 + 임의 강체변환 → `scratch/demo-rebars.json` 저장, `--upload` 시 POST. 라이다 앱이 없는 동안의 E2E 대역 (self-contained — src/ import 없이 단독 실행)

- [ ] **Step 1: 스크립트 작성**

```js
// office-dashboard/scripts/make-demo-scan.mjs
// 라이다 앱 대역: 설계 OBJ를 교란해 as-built 데모 스캔을 만들어 업로드한다.
// 사용: node scripts/make-demo-scan.mjs                       → scratch/demo-rebars.json만 생성
//       node scripts/make-demo-scan.mjs --upload http://localhost:3000 --site 5
// 환경: SCAN_UPLOAD_TOKEN (업로드 시 필수, .env.local과 동일 값)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const objPath = resolve(here, "../../source-models/highlighted_design_model.obj");

// --- 미니 OBJ 파서 (o 그룹별 정점) ---
const groups = [];
let cur = null;
for (const line of readFileSync(objPath, "utf8").split("\n")) {
  if (line.startsWith("o ")) {
    cur = { name: line.slice(2).trim(), vertices: [] };
    groups.push(cur);
  } else if (line.startsWith("v ") && cur) {
    cur.vertices.push(line.slice(2).trim().split(/\s+/).map(Number));
  }
}

// --- PCA 중심선 추출 (designExtract.ts와 동일 알고리즘의 단독 구현) ---
function centerlineOf(verts) {
  const n = verts.length;
  const mean = [0, 0, 0];
  for (const v of verts) for (let k = 0; k < 3; k++) mean[k] += v[k] / n;
  const c = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const v of verts) {
    const d = [v[0] - mean[0], v[1] - mean[1], v[2] - mean[2]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) c[i][j] += (d[i] * d[j]) / n;
  }
  // 멱승법으로 주축 (합성 데이터라 충분)
  let a = [1, 1, 1];
  for (let it = 0; it < 100; it++) {
    const b = [
      c[0][0] * a[0] + c[0][1] * a[1] + c[0][2] * a[2],
      c[1][0] * a[0] + c[1][1] * a[1] + c[1][2] * a[2],
      c[2][0] * a[0] + c[2][1] * a[1] + c[2][2] * a[2],
    ];
    const l = Math.hypot(...b);
    a = b.map((x) => x / l);
  }
  let tMin = Infinity, tMax = -Infinity;
  const radial = [];
  for (const v of verts) {
    const d = [v[0] - mean[0], v[1] - mean[1], v[2] - mean[2]];
    const t = d[0] * a[0] + d[1] * a[1] + d[2] * a[2];
    tMin = Math.min(tMin, t);
    tMax = Math.max(tMax, t);
    radial.push(Math.sqrt(Math.max(0, d[0] ** 2 + d[1] ** 2 + d[2] ** 2 - t * t)));
  }
  radial.sort((x, y) => x - y);
  const p = (t) => [mean[0] + a[0] * t, mean[1] + a[1] * t, mean[2] + a[2] * t];
  return { centerline: [p(tMin), p(tMax)], radius: radial[Math.floor(radial.length / 2)] };
}

// --- 교란: MISSING 제거, rebar_3 15mm 오프셋, 2mm 노이즈, 강체변환 ---
let seed = 12345;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0xffffffff - 0.5;
};
const gauss = (s) => (rnd() + rnd() + rnd()) * 2 * s;
const yaw = (40 * Math.PI) / 180;
const R = [[Math.cos(yaw), 0, Math.sin(yaw)], [0, 1, 0], [-Math.sin(yaw), 0, Math.cos(yaw)]];
const T = [2.5, -0.3, 1.1];
const xform = (p) => {
  const q = [
    R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2] + T[0],
    R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2] + T[1],
    R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2] + T[2],
  ];
  return q.map((x) => x + gauss(0.002));
};

const rebars = [];
let i = 0;
for (const g of groups) {
  if (g.vertices.length < 3) continue;
  if (g.name.includes("MISSING")) continue; // 미시공 시뮬레이션
  const { centerline, radius } = centerlineOf(g.vertices);
  let line = centerline;
  if (g.name.startsWith("rebar_3_")) {
    line = line.map((p) => [p[0] + 0.015, p[1], p[2]]); // 허용초과 시뮬레이션
  }
  rebars.push({ id: `s${i++}`, centerline: line.map(xform), radius });
}

const file = { version: 1, unit: "m", rebars };
mkdirSync(resolve(here, "../scratch"), { recursive: true });
const outPath = resolve(here, "../scratch/demo-rebars.json");
writeFileSync(outPath, JSON.stringify(file));
console.log(`wrote ${outPath} (${rebars.length} rebars)`);

// --- 업로드 ---
const uploadIdx = process.argv.indexOf("--upload");
if (uploadIdx > 0) {
  const base = process.argv[uploadIdx + 1];
  const siteIdx = process.argv.indexOf("--site");
  const site = siteIdx > 0 ? process.argv[siteIdx + 1] : "5";
  const token = process.env.SCAN_UPLOAD_TOKEN;
  if (!token) throw new Error("SCAN_UPLOAD_TOKEN 환경변수 필요");
  const form = new FormData();
  form.set("site_id", site);
  form.set("captured_at", new Date().toISOString());
  form.set("rebars", new Blob([JSON.stringify(file)], { type: "application/json" }), "rebars.json");
  const res = await fetch(`${base}/api/scan-upload`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  console.log(res.status, await res.text());
}
```

- [ ] **Step 2: 로컬 생성 실행으로 검증**

Run: `node scripts/make-demo-scan.mjs`
Expected: `wrote …/scratch/demo-rebars.json (26 rebars)` — 27개 중 MISSING 1개 제외

- [ ] **Step 3: scratch/ gitignore 추가**

`office-dashboard/.gitignore`에 한 줄 추가:

```
/scratch
```

- [ ] **Step 4: 커밋**

```bash
cd /d/Projects/LH/AR && git add office-dashboard/scripts/make-demo-scan.mjs office-dashboard/.gitignore
git commit -m "feat: demo scan generator standing in for the LiDAR app"
```

---

### Task 14: 내비게이션 + 스캔 목록 UI (AnalysisTab, ScanList)

**Files:**
- Modify: `office-dashboard/src/app/page.tsx` (43행 `type View`, 84–107행 Navbar, 109–122행 Main 분기)
- Create: `office-dashboard/src/components/analysis/AnalysisTab.tsx`
- Create: `office-dashboard/src/components/analysis/ScanList.tsx`

**Interfaces:**
- Consumes: `GET /api/sites` (기존), `GET /api/models?site_id=` (기존), `GET /api/scans?site_id=` (Task 12)
- Produces:
  - `AnalysisTab` (default export, props 없음) — 현장 선택 → 스캔 목록 → `AnalysisView` 진입까지의 컨테이너
  - `ScanList({ siteId, onOpen }: { siteId: number; onOpen: (scan: ScanMeta, arId: string) => void })`
  - `export type ScanMeta = { scan_id: string; site_id: number; captured_at: string; uploaded_at: string; rebar_count: number; has_mesh: boolean }` (ScanList.tsx에서 export — Task 16이 사용)
  - page.tsx의 `View`가 `"sites" | "live" | "analysis"`로 확장

- [ ] **Step 1: page.tsx 수정**

43행 View 타입을:

```ts
type View = "sites" | "live" | "analysis";
```

Navbar의 라이브 협업 NavLink(92–98행) 뒤에 추가:

```tsx
<NavLink
  label="시공 분석"
  description="설계 vs 시공 비교"
  active={view === "analysis"}
  onClick={() => setView("analysis")}
  leftSection={<Text size="sm">▥</Text>}
/>
```

Main 분기(110–121행)를 3분기로:

```tsx
{view === "sites" ? (
  <SitesView
    onLive={(room) => {
      setLiveRoom(room);
      setView("live");
    }}
  />
) : view === "analysis" ? (
  <AnalysisTab />
) : (
  <Box h="calc(100dvh - 58px - 2 * var(--mantine-spacing-md))">
    <LiveSession room={liveRoom} onLeave={() => setView("sites")} />
  </Box>
)}
```

상단 import에 추가 (LiveSession import 아래):

```tsx
import AnalysisTab from "../components/analysis/AnalysisTab";
```

- [ ] **Step 2: ScanList.tsx 작성**

```tsx
// office-dashboard/src/components/analysis/ScanList.tsx
"use client";

import { Alert, Badge, Button, Card, Center, Group, Loader, Stack, Text } from "@mantine/core";
import { useEffect, useState } from "react";

export type ScanMeta = {
  scan_id: string;
  site_id: number;
  captured_at: string;
  uploaded_at: string;
  rebar_count: number;
  has_mesh: boolean;
};

type ARModel = { ar_id: string; ar_filename: string; upload_at: string };

/// 사이트의 as-built 스캔 목록. 설계모델(ar-list 첫 항목)을 함께 해석해서
/// onOpen(scan, arId)으로 분석 화면에 넘긴다.
export default function ScanList({
  siteId,
  onOpen,
}: {
  siteId: number;
  onOpen: (scan: ScanMeta, arId: string) => void;
}) {
  const [scans, setScans] = useState<ScanMeta[] | null>(null);
  const [arId, setArId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setScans(null);
    setError(null);
    (async () => {
      try {
        const [scansRes, modelsRes] = await Promise.all([
          fetch(`/api/scans?site_id=${siteId}`),
          fetch(`/api/models?site_id=${siteId}`),
        ]);
        const scansData = await scansRes.json();
        if (scansData.status !== "success") throw new Error(scansData.message || "스캔 조회 실패");
        const modelsData = await modelsRes.json();
        const models: ARModel[] = modelsData.ar_list || [];
        setArId(models.length > 0 ? models[0].ar_id : null);
        setScans(scansData.scans || []);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [siteId]);

  if (error) return <Alert color="red" title="스캔 목록을 불러오지 못했습니다">{error}</Alert>;
  if (scans == null)
    return (
      <Center py="xl">
        <Loader size="sm" />
      </Center>
    );
  if (scans.length === 0)
    return (
      <Alert color="gray" variant="light">
        이 현장에 업로드된 스캔이 없습니다. 라이다 앱에서 업로드하거나
        데모 스크립트(scripts/make-demo-scan.mjs --upload)를 사용하세요.
      </Alert>
    );
  return (
    <Stack gap="sm">
      {arId == null && (
        <Alert color="yellow" variant="light">
          이 현장에 설계모델(AR 모델)이 없어 분석을 실행할 수 없습니다
        </Alert>
      )}
      {scans.map((s) => (
        <Card key={s.scan_id} withBorder radius="md" padding="sm">
          <Group justify="space-between" wrap="nowrap">
            <div style={{ minWidth: 0 }}>
              <Text size="sm" fw={600} ff="monospace" truncate>
                {s.scan_id.slice(0, 8)}
              </Text>
              <Group gap={6} mt={2}>
                <Badge size="xs" variant="light" color="brand">
                  철근 {s.rebar_count}개
                </Badge>
                <Text size="xs" c="dimmed">
                  촬영 {s.captured_at} · 업로드 {s.uploaded_at.slice(0, 19).replace("T", " ")}
                </Text>
              </Group>
            </div>
            <Button size="xs" disabled={arId == null} onClick={() => arId && onOpen(s, arId)}>
              분석
            </Button>
          </Group>
        </Card>
      ))}
    </Stack>
  );
}
```

- [ ] **Step 3: AnalysisTab.tsx 작성** (AnalysisView는 Task 16에서 — 우선 자리표시 Alert로 컴파일 확보 후 Task 16이 교체)

```tsx
// office-dashboard/src/components/analysis/AnalysisTab.tsx
"use client";

import { Alert, Button, Group, Select, Stack, Text, Title } from "@mantine/core";
import { useEffect, useState } from "react";
import ScanList, { type ScanMeta } from "./ScanList";

type Site = { site_id: number; site_name: string };

/// 시공 분석 탭 컨테이너: 현장 선택 → 스캔 목록 → 분석 화면.
export default function AnalysisTab() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [open, setOpen] = useState<{ scan: ScanMeta; arId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const d = await (await fetch("/api/sites")).json();
        if (d.status !== "success") throw new Error(d.message || "현장 조회 실패");
        setSites(d.site_list || []);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  if (open) {
    return (
      <Stack gap="sm" h="100%">
        <Group justify="space-between">
          <Title order={4}>
            시공 분석 — 스캔 {open.scan.scan_id.slice(0, 8)}
          </Title>
          <Button variant="default" size="xs" onClick={() => setOpen(null)}>
            ← 목록으로
          </Button>
        </Group>
        {/* Task 17에서 <AnalysisView …/>로 교체 */}
        <Alert color="gray">분석 화면은 Task 17에서 구현됩니다</Alert>
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <div>
        <Title order={4}>시공 분석</Title>
        <Text size="sm" c="dimmed">
          라이다 스캔(as-built)을 설계모델과 비교해 미시공·허용초과 철근을 찾습니다
        </Text>
      </div>
      {error && <Alert color="red">{error}</Alert>}
      <Select
        label="현장"
        placeholder="현장을 선택하세요"
        searchable
        data={sites.map((s) => ({ value: String(s.site_id), label: `${s.site_id} · ${s.site_name}` }))}
        value={siteId == null ? null : String(siteId)}
        onChange={(v) => setSiteId(v == null ? null : Number(v))}
        maw={420}
      />
      {siteId != null && (
        <ScanList siteId={siteId} onOpen={(scan, arId) => setOpen({ scan, arId })} />
      )}
    </Stack>
  );
}
```

- [ ] **Step 4: 빌드 + 수동 확인**

Run: `npm run build` → 성공. `npm run dev` 후 브라우저에서 시공 분석 탭 → 현장 선택 → (Blob 미설정이면) 명시적 에러 배너 확인.

- [ ] **Step 5: 커밋**

```bash
cd /d/Projects/LH/AR && git add office-dashboard/src/app/page.tsx office-dashboard/src/components/analysis/
git commit -m "feat: analysis tab navigation and scan list UI"
```

---

### Task 15: 설계모델 로더 + 분석 Web Worker

**Files:**
- Create: `office-dashboard/src/components/analysis/loadDesign.ts`
- Create: `office-dashboard/src/lib/analysis/worker.ts`
- Create: `office-dashboard/src/components/analysis/useAnalysis.ts`

**Interfaces:**
- Consumes: three USDLoader (ModelViewer.tsx:6과 동일 import), `rebarsFromGroups`, `splitByConnectivity`, `extractCenterline` (Task 10), `runAnalysis`/`AnalysisInput`/`AnalysisOutput` (Task 9)
- Produces:
  - `loadDesign(arId: string): Promise<{ object: THREE.Object3D; rebars: Rebar[] }>` — USDZ 1회 로드로 뷰어용 씬과 분석용 중심선 동시 확보. 이름 있는 메시 그룹 우선, 없으면 연결요소 폴백, 그래도 1개면 throw `Error("설계모델에서 철근을 분리할 수 없습니다")`
  - worker 프로토콜: `postMessage(AnalysisInput)` 수신 → `{ type:"progress", stage: "register"|"classify"|"match"|"judge" }` 중간 보고 → `{ type:"done", output: AnalysisOutput }` / `{ type:"error", message: string }`
  - `useAnalysis(): { run(input: AnalysisInput): Promise<AnalysisOutput>; stage: string | null }` — React 훅. Worker 생성 실패 시(구버전 브라우저 등) 메인스레드 폴백

- [ ] **Step 1: loadDesign.ts 작성**

```ts
// office-dashboard/src/components/analysis/loadDesign.ts
"use client";

// 설계 USDZ 1회 로드 → (뷰어용 Object3D, 분석용 Rebar[]) 동시 산출 — spec §5.1.
// three 의존은 components/ 아래에만 둔다 (lib/analysis는 순수 TS).
import * as THREE from "three";
import { USDLoader } from "three/addons/loaders/USDLoader.js";
import {
  extractCenterline, rebarsFromGroups, splitByConnectivity,
} from "../../lib/analysis/designExtract";
import type { Rebar, Vec3 } from "../../lib/analysis/types";

function worldVertices(mesh: THREE.Mesh): Vec3[] {
  const pos = mesh.geometry.getAttribute("position");
  const out: Vec3[] = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos as THREE.BufferAttribute, i).applyMatrix4(mesh.matrixWorld);
    out.push([v.x, v.y, v.z]);
  }
  return out;
}

export async function loadDesign(arId: string): Promise<{ object: THREE.Object3D; rebars: Rebar[] }> {
  const loader = new USDLoader();
  const object: THREE.Object3D = await loader.loadAsync(
    `/api/model?ar_id=${encodeURIComponent(arId)}`,
  );
  object.updateMatrixWorld(true);

  // 1차: 이름 있는 메시들을 상위 오브젝트 이름으로 그룹핑
  const groups = new Map<string, Vec3[]>();
  const meshes: THREE.Mesh[] = [];
  object.traverse((n) => {
    if ((n as THREE.Mesh).isMesh) meshes.push(n as THREE.Mesh);
  });
  for (const mesh of meshes) {
    // rebar_N 같은 이름은 메시 자신 또는 부모 프림에 있다
    let name = mesh.name;
    let p: THREE.Object3D | null = mesh.parent;
    while ((!name || name === "") && p) {
      name = p.name;
      p = p.parent;
    }
    if (!name) name = `mesh_${meshes.indexOf(mesh)}`;
    const arr = groups.get(name) ?? [];
    arr.push(...worldVertices(mesh));
    groups.set(name, arr);
  }

  let rebars: Rebar[] = rebarsFromGroups(
    [...groups.entries()].map(([name, vertices]) => ({ name, vertices })),
  );

  // 폴백: 그룹이 1개뿐이면 연결요소 분리 시도
  if (rebars.length <= 1 && meshes.length > 0) {
    const parts: Vec3[][] = [];
    for (const mesh of meshes) {
      const pos = mesh.geometry.getAttribute("position");
      const idx = mesh.geometry.getIndex();
      if (!idx) continue;
      const flat: number[] = [];
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos as THREE.BufferAttribute, i).applyMatrix4(mesh.matrixWorld);
        flat.push(v.x, v.y, v.z);
      }
      parts.push(...splitByConnectivity(flat, Array.from(idx.array)));
    }
    rebars = parts
      .filter((p) => p.length >= 3)
      .map((vertices, i) => {
        const { centerline, radius } = extractCenterline(vertices);
        return { id: `part_${i}`, centerline, radius };
      });
  }

  if (rebars.length <= 1) {
    throw new Error("설계모델에서 철근을 분리할 수 없습니다 (서브오브젝트/연결요소 없음)");
  }
  return { object, rebars };
}
```

- [ ] **Step 2: worker.ts 작성**

```ts
// office-dashboard/src/lib/analysis/worker.ts
// 분석 Web Worker — UI 프리즈 방지 (spec §3). 메시지 프로토콜은 useAnalysis.ts와 계약.
import { classifyRebars, estimateWallNormal } from "./classify";
import { applyMat4 } from "./geom";
import { judge } from "./judge";
import { matchRebars } from "./match";
import type { AnalysisInput, AnalysisOutput } from "./pipeline";
import { registerScan } from "./registration";
import type { Rebar } from "./types";

// runAnalysis를 단계별 progress 보고와 함께 인라인 전개
self.onmessage = (e: MessageEvent<AnalysisInput>) => {
  try {
    const input = e.data;
    self.postMessage({ type: "progress", stage: "register" });
    const registration = registerScan(input.scan, input.design, input.manualInit);
    const transformed: Rebar[] = input.scan.map((r) => ({
      ...r,
      centerline: r.centerline.map((p) => applyMat4(registration.matrix, p)),
    }));
    self.postMessage({ type: "progress", stage: "classify" });
    const wallNormal = estimateWallNormal(input.design);
    const designClassified = classifyRebars(input.design, input.up, wallNormal);
    const scanTransformed = classifyRebars(transformed, input.up, wallNormal);
    self.postMessage({ type: "progress", stage: "match" });
    const match = matchRebars(designClassified, scanTransformed);
    self.postMessage({ type: "progress", stage: "judge" });
    const { rebars, summary } = judge(designClassified, scanTransformed, match, input.toleranceMm);
    const output: AnalysisOutput = { registration, rebars, summary, designClassified, scanTransformed };
    self.postMessage({ type: "done", output });
  } catch (err) {
    self.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
```

- [ ] **Step 3: useAnalysis.ts 작성**

```ts
// office-dashboard/src/components/analysis/useAnalysis.ts
"use client";

// Worker 기반 분석 실행 훅. Worker 불가 환경은 메인스레드 폴백.
import { useCallback, useRef, useState } from "react";
import type { AnalysisInput, AnalysisOutput } from "../../lib/analysis/pipeline";

export function useAnalysis() {
  const [stage, setStage] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const run = useCallback(async (input: AnalysisInput): Promise<AnalysisOutput> => {
    setStage("register");
    try {
      const worker =
        workerRef.current ??
        new Worker(new URL("../../lib/analysis/worker.ts", import.meta.url));
      workerRef.current = worker;
      return await new Promise<AnalysisOutput>((resolve, reject) => {
        worker.onmessage = (e) => {
          if (e.data.type === "progress") setStage(e.data.stage);
          else if (e.data.type === "done") {
            setStage(null);
            resolve(e.data.output);
          } else if (e.data.type === "error") {
            setStage(null);
            reject(new Error(e.data.message));
          }
        };
        worker.onerror = (e) => {
          setStage(null);
          reject(new Error(e.message || "worker error"));
        };
        worker.postMessage(input);
      });
    } catch {
      // Worker 생성/번들 실패 폴백: 메인스레드 실행
      const { runAnalysis } = await import("../../lib/analysis/pipeline");
      const out = runAnalysis(input);
      setStage(null);
      return out;
    }
  }, []);

  return { run, stage };
}
```

- [ ] **Step 4: 빌드 확인 + 커밋**

Run: `npm run build`
Expected: 성공 (worker가 `new URL(…, import.meta.url)` 패턴으로 번들링됨. 실패 시 `node_modules/next/dist/docs/`에서 turbopack worker 지원 확인 — 폴백 경로가 있으므로 최악에도 기능은 동작)

```bash
cd /d/Projects/LH/AR && git add office-dashboard/src/components/analysis/loadDesign.ts office-dashboard/src/components/analysis/useAnalysis.ts office-dashboard/src/lib/analysis/worker.ts
git commit -m "feat: design USDZ loader and analysis web worker with fallback"
```

---

### Task 16: 3D 오버레이 뷰어 (AnalysisViewer.tsx)

**Files:**
- Create: `office-dashboard/src/components/analysis/AnalysisViewer.tsx`

**Interfaces:**
- Consumes: three (ModelViewer.tsx 패턴), `RebarRecord`, `ClassifiedRebar`, `Verdict` (Task 1)
- Produces:

```tsx
export interface ViewerProps {
  designObject: THREE.Object3D | null;   // loadDesign 결과 (고스트 처리)
  records: RebarRecord[];
  design: ClassifiedRebar[];             // designId → 중심선 조회용
  scan: ClassifiedRebar[];               // scanId → 중심선 조회용 (설계 좌표 변환 완료본)
  showVerdicts: Verdict[];               // 표시할 판정 (필터)
  showMesh: boolean;                     // 스캔 메시(GLB) 참조 레이어 토글 — 켜면 GLTFLoader로 로드
  meshUrl: string | null;
  focusKey: string | null;               // 포커스할 record key = designId ?? scanId
}
export default function AnalysisViewer(props: ViewerProps)
```
  - 색: pass `#2f9e44`, out_of_tolerance `#f08c00`, extra `#1971c2`, missing `#e03131` (spec §6)
  - record key 규칙: `record.designId ?? record.scanId ?? ""` — AnalysisView 테이블과 공유

- [ ] **Step 1: AnalysisViewer.tsx 작성**

```tsx
// office-dashboard/src/components/analysis/AnalysisViewer.tsx
"use client";

// 설계 고스트 + 판정색 철근 원통 오버레이 — spec §6. ModelViewer의 씬 관리 패턴 답습.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { ClassifiedRebar, RebarRecord, Verdict } from "../../lib/analysis/types";

const VERDICT_COLOR: Record<Verdict, number> = {
  pass: 0x2f9e44,
  out_of_tolerance: 0xf08c00,
  extra: 0x1971c2,
  missing: 0xe03131,
};

export interface ViewerProps {
  designObject: THREE.Object3D | null;
  records: RebarRecord[];
  design: ClassifiedRebar[];
  scan: ClassifiedRebar[];
  showVerdicts: Verdict[];
  showMesh: boolean;
  meshUrl: string | null;
  focusKey: string | null;
}

function cylinderBetween(a: [number, number, number], b: [number, number, number], radius: number, mat: THREE.Material): THREE.Mesh {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const dir = vb.clone().sub(va);
  const len = dir.length() || 0.001;
  const geo = new THREE.CylinderGeometry(radius, radius, len, 12);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(va.clone().add(vb).multiplyScalar(0.5));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

/** 철근 1개 = 중심선 각 선분의 원통 묶음 */
function rebarGroup(r: ClassifiedRebar, color: number, opacity: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color, transparent: opacity < 1, opacity, roughness: 0.6,
  });
  const radius = Math.max(r.radius, 0.006); // 시인성 하한
  for (let i = 0; i + 1 < r.centerline.length; i++) {
    g.add(cylinderBetween(r.centerline[i], r.centerline[i + 1], radius, mat));
  }
  return g;
}

export default function AnalysisViewer({
  designObject, records, design, scan, showVerdicts, showMesh, meshUrl, focusKey,
}: ViewerProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    overlay: THREE.Group;
    meshLayer: THREE.Group;
    keyed: Map<string, THREE.Group>;
  } | null>(null);

  // ---- 씬 부트스트랩 (1회) ----
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#f1f4fa");
    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
    camera.position.set(2, 1.5, 2);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0xc8d3e8, 1.1));
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(3, 6, 4);
    scene.add(dir);
    scene.add(new THREE.GridHelper(10, 20, 0x9db2d4, 0xdde5f2));
    const overlay = new THREE.Group();
    const meshLayer = new THREE.Group();
    scene.add(overlay, meshLayer);
    sceneRef.current = { scene, camera, controls, overlay, meshLayer, keyed: new Map() };

    const resize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, []);

  // ---- 설계 고스트 ----
  useEffect(() => {
    const s = sceneRef.current;
    if (!s || !designObject) return;
    designObject.traverse((n) => {
      const mesh = n as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.material = new THREE.MeshStandardMaterial({
          color: 0x8a94a6, transparent: true, opacity: 0.25, depthWrite: false,
        });
      }
    });
    s.scene.add(designObject);
    // 카메라 프레이밍 (ModelViewer와 동일 방식)
    const box = new THREE.Box3().setFromObject(designObject);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    s.camera.position.set(center.x + maxDim * 1.5, center.y + maxDim, center.z + maxDim * 1.5);
    s.controls.target.copy(center);
    s.controls.update();
    return () => {
      s.scene.remove(designObject);
    };
  }, [designObject]);

  // ---- 판정 오버레이 (records 변경 시 재구성) ----
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    s.overlay.clear();
    s.keyed.clear();
    const designById = new Map(design.map((r) => [r.id, r]));
    const scanById = new Map(scan.map((r) => [r.id, r]));
    for (const rec of records) {
      if (!showVerdicts.includes(rec.verdict)) continue;
      const key = rec.designId ?? rec.scanId ?? "";
      const color = VERDICT_COLOR[rec.verdict];
      let group: THREE.Group | null = null;
      if (rec.verdict === "missing" && rec.designId) {
        const d = designById.get(rec.designId);
        if (d) group = rebarGroup(d, color, 0.45); // 설계 위치 고스트
      } else if (rec.scanId) {
        const sc = scanById.get(rec.scanId);
        if (sc) group = rebarGroup(sc, color, 1);
      }
      if (group) {
        s.overlay.add(group);
        s.keyed.set(key, group);
      }
    }
  }, [records, design, scan, showVerdicts]);

  // ---- 스캔 메시 토글 ----
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    s.meshLayer.clear();
    if (!showMesh || !meshUrl) return;
    let cancelled = false;
    new GLTFLoader().load(meshUrl, (gltf) => {
      if (cancelled || !sceneRef.current) return;
      gltf.scene.traverse((n) => {
        const mesh = n as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.material = new THREE.MeshStandardMaterial({
            color: 0x5c7cfa, transparent: true, opacity: 0.3, depthWrite: false,
          });
        }
      });
      sceneRef.current.meshLayer.add(gltf.scene);
    });
    return () => {
      cancelled = true;
    };
  }, [showMesh, meshUrl]);

  // ---- 포커스 ----
  useEffect(() => {
    const s = sceneRef.current;
    if (!s || !focusKey) return;
    const g = s.keyed.get(focusKey);
    if (!g) return;
    const box = new THREE.Box3().setFromObject(g);
    const center = box.getCenter(new THREE.Vector3());
    s.controls.target.copy(center);
    s.controls.update();
    // 하이라이트: 잠깐 에미시브
    g.traverse((n) => {
      const mesh = n as THREE.Mesh;
      if (mesh.isMesh) {
        const m = mesh.material as THREE.MeshStandardMaterial;
        m.emissive = new THREE.Color(0xffff00);
        m.emissiveIntensity = 0.6;
      }
    });
    const t = setTimeout(() => {
      g.traverse((n) => {
        const mesh = n as THREE.Mesh;
        if (mesh.isMesh) (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
      });
    }, 1500);
    return () => clearTimeout(t);
  }, [focusKey]);

  return <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />;
}
```

- [ ] **Step 2: 빌드 확인 + 커밋**

Run: `npm run build`
Expected: 성공

```bash
cd /d/Projects/LH/AR && git add office-dashboard/src/components/analysis/AnalysisViewer.tsx
git commit -m "feat: 3D overlay viewer with verdict-colored rebar cylinders"
```

---

### Task 17: 분석 화면 (AnalysisView.tsx) — 실행·요약·테이블·슬라이더·수동폴백

**Files:**
- Create: `office-dashboard/src/components/analysis/AnalysisView.tsx`
- Modify: `office-dashboard/src/components/analysis/AnalysisTab.tsx` (Task 14의 자리표시 Alert → AnalysisView)

**Interfaces:**
- Consumes: `loadDesign`(T15), `useAnalysis`(T15), `AnalysisViewer`(T16), `rejudgeRecords`(T8), `parseRebarsJson`(T11), `GET /api/scan`, `PUT·GET /api/analysis-result`(T12), `ScanMeta`(T14), `rigidMat4`는 사용 금지(테스트 전용) — 수동 폴백 행렬은 아래 `nudgeMat4`로 구성
- Produces:
  - `AnalysisView({ scan, arId }: { scan: ScanMeta; arId: string })` (default export)
  - record key = `designId ?? scanId ?? ""` (T16과 동일 규칙)
  - 저장 결과 = spec §5.6 `AnalysisResult` (registration.failed 제외한 형태로 저장; 로드 시 `rejudgeRecords`로 슬라이더만 재적용)

- [ ] **Step 1: AnalysisView.tsx 작성**

```tsx
// office-dashboard/src/components/analysis/AnalysisView.tsx
"use client";

// 분석 실행 + 결과 시각화 화면 — spec §6·§7.
// 흐름: 설계 USDZ + rebars.json 로드 → worker 분석 → 뷰어/카드/테이블 표시.
// 기존 결과가 저장돼 있으면 자동 로드하고, 재분석 버튼으로 다시 돌릴 수 있다.
import {
  Alert, Badge, Box, Button, Card, Center, Chip, Group, Loader, NumberInput,
  Paper, ScrollArea, SimpleGrid, Slider, Stack, Table, Text,
} from "@mantine/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import type * as THREE from "three";
import { rejudgeRecords } from "../../lib/analysis/judge";
import type { AnalysisOutput } from "../../lib/analysis/pipeline";
import { parseRebarsJson } from "../../lib/analysis/rebarsSchema";
import type {
  AnalysisResult, ClassifiedRebar, Mat4, Rebar, RebarRecord, Verdict,
} from "../../lib/analysis/types";
import AnalysisViewer from "./AnalysisViewer";
import { loadDesign } from "./loadDesign";
import type { ScanMeta } from "./ScanList";
import { useAnalysis } from "./useAnalysis";

const ALL_VERDICTS: Verdict[] = ["pass", "out_of_tolerance", "missing", "extra"];
const VERDICT_LABEL: Record<Verdict, string> = {
  pass: "정상", out_of_tolerance: "허용초과", missing: "미시공", extra: "도면 외",
};
const VERDICT_BADGE: Record<Verdict, string> = {
  pass: "green", out_of_tolerance: "orange", missing: "red", extra: "blue",
};
const STAGE_LABEL: Record<string, string> = {
  register: "정합 중…", classify: "분류 중…", match: "매칭 중…", judge: "판정 중…",
};

/** 수동 폴백: XYZ 이동(m) + 요(°)로 초기정합 행렬 구성 (column-major) */
function nudgeMat4(tx: number, ty: number, tz: number, yawDeg: number): Mat4 {
  const a = (yawDeg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, tx, ty, tz, 1];
}

export default function AnalysisView({ scan, arId }: { scan: ScanMeta; arId: string }) {
  const { run, stage } = useAnalysis();
  const [designObject, setDesignObject] = useState<THREE.Object3D | null>(null);
  const [designRebars, setDesignRebars] = useState<Rebar[] | null>(null);
  const [scanRebars, setScanRebars] = useState<Rebar[] | null>(null);
  const [meshUrl, setMeshUrl] = useState<string | null>(null);
  const [output, setOutput] = useState<AnalysisOutput | null>(null);
  const [savedRecords, setSavedRecords] = useState<RebarRecord[] | null>(null);
  const [tolerance, setTolerance] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showVerdicts, setShowVerdicts] = useState<Verdict[]>(ALL_VERDICTS);
  const [showMesh, setShowMesh] = useState(false);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  // 수동 폴백 입력 (정합 실패 시에만 노출)
  const [nudge, setNudge] = useState({ tx: 0, ty: 0, tz: 0, yaw: 0 });

  // ---- 입력 데이터 로드: 설계 + 스캔 + 기존 결과 ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [design, scanRes, prevRes] = await Promise.all([
          loadDesign(arId),
          fetch(`/api/scan?site_id=${scan.site_id}&scan_id=${scan.scan_id}`).then((r) => r.json()),
          fetch(`/api/analysis-result?site_id=${scan.site_id}&scan_id=${scan.scan_id}`),
        ]);
        if (cancelled) return;
        if (scanRes.status !== "success") throw new Error(scanRes.message || "스캔 조회 실패");
        const rebarsText = await (await fetch(scanRes.rebars_url)).text();
        const parsed = parseRebarsJson(rebarsText);
        if (!parsed.ok) throw new Error(`rebars.json 오류: ${parsed.errors.join(", ")}`);
        if (cancelled) return;
        setDesignObject(design.object);
        setDesignRebars(design.rebars);
        setScanRebars(parsed.data.rebars);
        setMeshUrl(scanRes.mesh_url ?? null);
        if (prevRes.ok) {
          const prev: AnalysisResult = await prevRes.json();
          if (!cancelled && prev.version === 1) {
            setSavedRecords(prev.rebars);
            setTolerance(prev.toleranceMm);
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [arId, scan.site_id, scan.scan_id]);

  // ---- 분석 실행 ----
  const analyze = useCallback(
    async (manualInit?: Mat4) => {
      if (!designRebars || !scanRebars) return;
      setError(null);
      try {
        const out = await run({
          design: designRebars, scan: scanRebars,
          toleranceMm: tolerance, up: [0, 1, 0], manualInit,
        });
        setOutput(out);
        setSavedRecords(null);
        if (!out.registration.failed) {
          const result: AnalysisResult = {
            version: 1, scanId: scan.scan_id, arId,
            registration: {
              matrix: out.registration.matrix,
              rmsMm: out.registration.rmsMm,
              method: out.registration.method,
            },
            toleranceMm: tolerance,
            rebars: out.rebars,
            summary: out.summary,
          };
          await fetch(`/api/analysis-result?site_id=${scan.site_id}&scan_id=${scan.scan_id}`, {
            method: "PUT", body: JSON.stringify(result),
          });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [designRebars, scanRebars, tolerance, run, scan.site_id, scan.scan_id, arId],
  );

  // ---- 표시 데이터: 라이브 출력 우선, 없으면 저장본. 슬라이더는 재판정만 ----
  const view = useMemo(() => {
    const base = output?.rebars ?? savedRecords;
    if (!base) return null;
    return rejudgeRecords(base, tolerance);
  }, [output, savedRecords, tolerance]);

  if (loading)
    return (
      <Center py="xl">
        <Loader size="sm" />
      </Center>
    );

  return (
    <Group align="stretch" gap="md" wrap="nowrap" style={{ flex: 1, minHeight: 0 }}>
      {/* ---- 좌: 3D 뷰어 ---- */}
      <Paper withBorder radius="md" style={{ flex: 1, position: "relative", minWidth: 0 }}>
        <AnalysisViewer
          designObject={designObject}
          records={view?.rebars ?? []}
          design={output?.designClassified ?? []}
          scan={output?.scanTransformed ?? []}
          showVerdicts={showVerdicts}
          showMesh={showMesh}
          meshUrl={meshUrl}
          focusKey={focusKey}
        />
        <Group gap={6} style={{ position: "absolute", top: 8, left: 8 }}>
          {ALL_VERDICTS.map((v) => (
            <Chip
              key={v} size="xs" checked={showVerdicts.includes(v)}
              onChange={(on) =>
                setShowVerdicts((prev) => (on ? [...prev, v] : prev.filter((x) => x !== v)))
              }
            >
              {VERDICT_LABEL[v]}
            </Chip>
          ))}
          {meshUrl && (
            <Chip size="xs" checked={showMesh} onChange={setShowMesh}>
              스캔 메시
            </Chip>
          )}
        </Group>
        {savedRecords && !output && (
          <Badge style={{ position: "absolute", bottom: 8, left: 8 }} variant="light">
            저장된 결과 (3D는 재분석 후 표시)
          </Badge>
        )}
      </Paper>

      {/* ---- 우: 패널 ---- */}
      <Stack gap="sm" w={380} style={{ overflow: "hidden" }}>
        <Group gap="xs">
          <Button size="xs" onClick={() => void analyze()} loading={stage != null}>
            {stage ? STAGE_LABEL[stage] ?? stage : output || savedRecords ? "재분석" : "분석 실행"}
          </Button>
          {output && (
            <Badge variant="light" color={output.registration.failed ? "red" : "teal"}>
              정합 RMS {output.registration.rmsMm.toFixed(1)}mm ·{" "}
              {output.registration.method === "auto" ? "자동" : "수동"}
            </Badge>
          )}
        </Group>

        {error && <Alert color="red">{error}</Alert>}

        {output?.registration.failed && (
          <Alert color="orange" title="자동 정합 실패 — 수동 초기정합">
            <Stack gap={6}>
              <Group gap={6} grow>
                <NumberInput size="xs" label="X (m)" value={nudge.tx} step={0.1}
                  onChange={(v) => setNudge({ ...nudge, tx: Number(v) || 0 })} />
                <NumberInput size="xs" label="Y (m)" value={nudge.ty} step={0.1}
                  onChange={(v) => setNudge({ ...nudge, ty: Number(v) || 0 })} />
              </Group>
              <Group gap={6} grow>
                <NumberInput size="xs" label="Z (m)" value={nudge.tz} step={0.1}
                  onChange={(v) => setNudge({ ...nudge, tz: Number(v) || 0 })} />
                <NumberInput size="xs" label="요 (°)" value={nudge.yaw} step={5}
                  onChange={(v) => setNudge({ ...nudge, yaw: Number(v) || 0 })} />
              </Group>
              <Button size="xs" variant="light"
                onClick={() => void analyze(nudgeMat4(nudge.tx, nudge.ty, nudge.tz, nudge.yaw))}>
                이 초기값으로 재정합
              </Button>
            </Stack>
          </Alert>
        )}

        {view && (
          <>
            <SimpleGrid cols={3} spacing={6}>
              <StatCard label="설계 철근" value={`${view.summary.designCount}`} />
              <StatCard label="시공 철근" value={`${view.summary.scanCount}`} />
              <StatCard label="매칭" value={`${view.summary.matched}`} />
              <StatCard label="미시공" value={`${view.summary.missing}`} tone="red" />
              <StatCard label="허용초과" value={`${view.summary.outOfTolerance}`} tone="orange" />
              <StatCard label="도면 외" value={`${view.summary.extra}`} tone="blue" />
            </SimpleGrid>
            {view.summary.deviationMm && (
              <Text size="xs" c="dimmed">
                편차 평균 {view.summary.deviationMm.mean.toFixed(1)}mm · 최대{" "}
                {view.summary.deviationMm.max.toFixed(1)}mm
              </Text>
            )}

            <Box>
              <Text size="xs" fw={600} mb={2}>
                허용오차 ±{tolerance}mm
              </Text>
              <Slider min={1} max={50} value={tolerance} onChange={setTolerance}
                marks={[{ value: 10 }, { value: 25 }, { value: 50 }]} size="sm" />
            </Box>

            <Paper withBorder radius="md" style={{ flex: 1, minHeight: 0 }}>
              <ScrollArea h="100%">
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
                          <Table.Td ff="monospace">{key}</Table.Td>
                          <Table.Td>
                            {r.direction === "vertical" ? "수직" : "수평"}·
                            {r.layer === "outer" ? "외측" : "내측"}
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
              </ScrollArea>
            </Paper>
          </>
        )}
      </Stack>
    </Group>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <Card withBorder radius="md" padding={8}>
      <Text size="xs" c="dimmed">{label}</Text>
      <Text fw={700} ff="monospace" c={tone}>{value}</Text>
    </Card>
  );
}
```

- [ ] **Step 2: AnalysisTab의 자리표시를 교체**

Task 14에서 넣은 `{/* Task 17에서 <AnalysisView …/>로 교체 */}` Alert 줄을 삭제하고:

```tsx
<Box style={{ flex: 1, minHeight: 0, display: "flex" }}>
  <AnalysisView scan={open.scan} arId={open.arId} />
</Box>
```

상단 import에 추가: `import AnalysisView from "./AnalysisView";` 및 Mantine `Box` (기존 import에 병합). 바깥 `<Stack gap="sm" h="100%">`가 이미 있으므로 그대로 사용.

- [ ] **Step 3: 빌드 + 수동 검증 (풀 E2E)**

```bash
npm run build && npm run dev
```

별도 셸에서:

```bash
SCAN_UPLOAD_TOKEN=<.env.local 값> node scripts/make-demo-scan.mjs --upload http://localhost:3000 --site 5
```

브라우저 확인 체크리스트:
1. 시공 분석 탭 → 현장 5 선택 → 데모 스캔 카드 표시 (철근 26개)
2. 분석 실행 → 단계 표시 → 정합 RMS < 10mm 배지
3. 요약: 설계 27 / 시공 26 / 미시공 1 / 허용초과 1 (`rebar_12` 미시공, `rebar_3` 15mm)
4. 3D: 초록 다수 + 주황 1 + 빨간 고스트 1, 필터 칩 동작
5. 슬라이더 20mm로 → 허용초과 0으로 즉시 변경 (재분석 없이)
6. 테이블 행 클릭 → 카메라 포커스 + 하이라이트
7. 목록으로 → 재진입 → 저장된 결과 자동 로드 확인

주의: 3번의 기대 수치는 **해당 사이트의 설계 USDZ가 번들 OBJ(`source-models/`)와
같은 모델일 때**만 정확히 성립한다 (데모 스캔이 그 OBJ에서 생성되므로). 다른
모델이 걸려 있으면 정합이 실패하거나 대부분 미시공/도면외로 나오는 것이 정상 —
그 경우 설계 USDZ가 번들 OBJ에서 변환된 사이트로 바꿔 검증할 것.

- [ ] **Step 4: 커밋**

```bash
cd /d/Projects/LH/AR && git add office-dashboard/src/components/analysis/AnalysisView.tsx office-dashboard/src/components/analysis/AnalysisTab.tsx
git commit -m "feat: analysis view with live tolerance rejudge, table focus, manual fallback"
```

---

### Task 18: BriconLab 이관 스펙 + 문서 갱신 + 마무리 검증

**Files:**
- Create: `api/SCAN_STORAGE_REQUEST.md` (리포 루트)
- Modify: `CLAUDE.md` (§3 대시보드 현황, §4 라우트 표, §8 오픈 아이템, §6 환경변수)

**Interfaces:**
- Consumes: Task 11–12의 실제 계약 (문서는 구현과 자구까지 일치해야 함)
- Produces: 벤더 전달용 스펙 문서, 차기 세션용 갱신된 CLAUDE.md

- [ ] **Step 1: SCAN_STORAGE_REQUEST.md 작성** (MEASUREMENT_UPLOAD_REQUEST.md와 같은 요청서 형식)

```markdown
# BriconLab 요청: as-built 스캔 저장/조회 API

현재 대시보드는 as-built 스캔(철근 중심선 JSON + 선택적 메시)을 Vercel Blob에
자체 저장하고 있습니다. 아래 3개 엔드포인트가 제공되면 BriconLab DB로 이관합니다.
필드명·경로는 협의 가능하며, 의미가 유지되면 됩니다.

## 1. POST /analysis/scan-upload  (multipart)
| field | type | 설명 |
|---|---|---|
| site_id | text | 기존 site-list의 site_id |
| captured_at | text | ISO8601 촬영 시각 |
| rebars | file | rebars.json (아래 스키마) |
| mesh | file(선택) | mesh.glb 시각화용 |

응답: `{ "status":"success", "scan_id":"<id>" }`

rebars.json:
{ "version":1, "unit":"m",
  "rebars":[ { "id":"r0", "centerline":[[x,y,z],...], "radius":0.008 } ] }
- centerline은 2점 이상, 좌표계는 스캔 앱 임의(정합은 대시보드 수행), 단위 m

## 2. GET /analysis/scan-list?site_id=5
응답: `{ "status":"success", "scan_list":[ { "scan_id", "site_id",
  "captured_at", "upload_at", "rebar_count", "has_mesh" } ] }` (upload_at 내림차순)

## 3. GET /analysis/scan-file?scan_id=<id>&file=rebars|mesh
해당 파일 스트림 응답 (rebars → application/json, mesh → model/gltf-binary)

## 4. (선택) 분석결과 저장
PUT/GET /analysis/scan-analysis?scan_id=<id> — JSON 본문 그대로 저장/반환.
미제공 시 분석결과는 계속 자체 스토리지에 보관합니다.
```

- [ ] **Step 2: CLAUDE.md 갱신** — 아래 4곳:

1. §3 Dashboard 목록에 추가:
```markdown
- **시공 분석**: as-built 스캔(철근 중심선 JSON) 업로드 → 브라우저에서 설계모델과
  정합(PCA+ICP)·철근별 매칭 → 미시공/허용초과/도면외 판정 + 3D 오버레이.
  스토리지는 Vercel Blob (BriconLab 이관 스펙: `api/SCAN_STORAGE_REQUEST.md`).
  데모 업로드: `office-dashboard/scripts/make-demo-scan.mjs --upload <url> --site 5`
```
2. §4 Dashboard routes 표에 4행 추가:
```markdown
| `/api/scan-upload` | POST, Bearer `SCAN_UPLOAD_TOKEN` — 라이다 앱의 as-built 업로드 → Vercel Blob |
| `/api/scans?site_id=` | 사이트별 스캔 목록 (Blob meta.json 취합) |
| `/api/scan?site_id=&scan_id=` | 스캔 파일 URL 해석 (rebars/mesh) |
| `/api/analysis-result?site_id=&scan_id=` | PUT/GET 분석결과 JSON |
```
3. §2 Secrets에 추가:
```markdown
office-dashboard/.env.local                # + BLOB_READ_WRITE_TOKEN, SCAN_UPLOAD_TOKEN (시공 분석)
```
4. §8 Open items에 추가:
```markdown
**Blocked on BriconLab:**
- as-built 스캔 저장 API — 스펙 `api/SCAN_STORAGE_REQUEST.md`. 구현되면
  대시보드 API 라우트 내부만 프록시로 교체 (클라이언트 무변경).
```

- [ ] **Step 3: 전체 테스트 + 빌드 최종 확인**

```bash
cd office-dashboard && npm test && npm run build
```
Expected: 전체 테스트 PASS + 빌드 성공

- [ ] **Step 4: 커밋**

```bash
cd /d/Projects/LH/AR && git add api/SCAN_STORAGE_REQUEST.md CLAUDE.md
git commit -m "docs: BriconLab scan storage spec and handoff doc refresh"
```

- [ ] **Step 5: 배포는 사용자 결정** — `npx vercel deploy --prod --yes`는 실행하지 말 것. Vercel 프로젝트에 Blob store 연결 + `SCAN_UPLOAD_TOKEN` env 설정이 선행돼야 하며, 배포 시점은 사용자가 정한다. 완료 보고에 이 두 가지 선행조건을 명시할 것.

---

## 실행 순서 요약

| 순서 | 태스크 | 산출물 |
|---|---|---|
| 1–2 | 인프라·기하 | vitest, types, geom |
| 3–4 | 픽스처·분류 | testFixtures, classify |
| 5–6 | 정합 | coarse PCA + ICP |
| 7–9 | 비교분석 | match, judge, pipeline (E2E 합성 테스트) |
| 10 | 설계 추출 | designExtract (실제 OBJ 검증) |
| 11–12 | 저장/조회 API | scan-upload + 조회 3종 |
| 13 | 데모 대역 | make-demo-scan.mjs |
| 14–17 | UI | 탭·목록·뷰어·분석화면 (수동 E2E) |
| 18 | 문서 | BriconLab 스펙, CLAUDE.md |

Task 1→10은 순수 로직이라 순서대로 독립 검증 가능. 11→13은 Blob 토큰 필요(없어도 코드는 완성 가능, E2E만 보류). 14→17은 UI라 브라우저 확인 필수.








