# 철근 계층 분류 + 트리 필터 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 철근을 부위/면/방향 계층으로 나누고, 대시보드와 LH 전용 앱 양쪽에서 트리로 선택해 표시/숨김한다.

**Architecture:** 계층·한글 표시명은 BriconLab 사이드카 JSON으로 받고, USDZ prim 경로를 조인 키로 쓴다. 사이드카가 없으면 prim 이름 코드북 → 기하 분류 순으로 폴백한다. 필터는 표시 전용 — 편차·간격 수치는 재계산하지 않는다.

**Tech Stack:** Next.js 16 / React 19 / Mantine 9.4.1 (`Tree`+`useTree`) / three.js 0.185 / zod / vitest · Swift 5.9 + SwiftUI + RealityKit / xcodegen

**Spec:** `docs/superpowers/specs/2026-08-05-rebar-hierarchy-design.md`

## Global Constraints

- `src/lib/analysis/**` 는 **순수 TS** — three.js / DOM / Next / `@mantine` import 금지.
- `AnalysisResult.version` 은 **2 유지**. optional 필드만 추가한다. 서버 PUT 가드(`api/analysis-result/route.ts:34`)·클라 로드 가드(`AnalysisView.tsx:139-142`)를 건드리지 않는다.
- 조인 키는 **§5.2 `normalizePrimPath`** 를 거친 문자열끼리만 비교한다. TS와 Swift 두 구현은 **동일한 케이스 표**로 테스트한다.
- 트리는 **색을 쓰지 않는다** — 체크박스 + 텍스트만. 판정 6색·컨투어 5색 재사용 금지(`docs/design-system.md:213`). 클릭 대상 최소 32×32px(:202).
- `source !== "sidecar"` 이면 **배지 필수**: `primName` → `모델 이름 규칙으로 추정 — 도면 확인 필요`, `geometry` → `형상 자동 분류 — 부위 구분 아님`.
- 필터는 **표시 전용**. 철근별 `deviationMm`·`spacingGroups` 는 재계산하지 않는다. 판정 카운트와 `summary.deviationMm` 만 같은 모집단으로 다시 계산한다.
- iOS: 새 Swift 파일 추가 시 **`xcodegen generate` 필수**. 앱별 기능 차이는 **`AppFeatures.swift` 한 곳에만** 둔다 — `#if LH_ONLY` 를 화면 코드에 뿌리지 않는다.
- 기존 테스트 **17파일 154개**가 회귀 없이 통과해야 한다. 실행: `cd office-dashboard && npx vitest run`

---

## File Structure

| 파일 | 책임 | 태스크 |
|---|---|---|
| `src/lib/analysis/designExtract.ts` | 메시 → Rebar. **경로 키 · 필터 선적용 · 중복 감지** | T1 |
| `src/components/analysis/loadDesign.ts` | USDZ → (Object3D, Rebar[]). **prim 경로 조립** | T1 |
| `src/lib/analysis/taxonomy.ts` | 신설 — 경로 정규화, 3경로 택소노미, 트리 빌드 | T2 |
| `src/lib/analysis/rebarMetaSchema.ts` | 신설 — 사이드카 zod 스키마 | T3 |
| `src/app/api/rebar-meta/route.ts` | 신설 — BriconLab 프록시 | T3 |
| `src/components/analysis/RebarTree.tsx` | 신설 — 트리 UI (순수, `AnalysisView` 비종속) | T4 |
| `src/components/analysis/AnalysisView.tsx` | 분할 + 트리 탭 + 필터 상태 | T4·T5 |
| `src/components/analysis/AnalysisViewer.tsx` | 구성/가시성 이펙트 분리 | T5 |
| `LHRebarAR/AR/ModelAnchorController.swift` | 노드 경로 열거 · `isEnabled` 숨김 · DEBUG 덤프 | T6 |
| `LHRebarAR/Model/RebarTaxonomy.swift` | 신설 — §5.2 정규화 + §8 코드북 Swift 포트 | T7 |
| `LHRebarAR/UI/Components/RebarTreePad.swift` | 신설 — 트리 UI | T8 |

---

## Task 1: 경로 기반 id (§6.1)

**Files:**
- Modify: `office-dashboard/src/lib/analysis/designExtract.ts`
- Modify: `office-dashboard/src/components/analysis/loadDesign.ts`
- Test: `office-dashboard/src/lib/analysis/designExtract.test.ts`

**Interfaces:**
- Produces: `MeshData { name: string; path: string; positions: number[]; index: number[] | null }` (`path` **필수**), `rebarsFromMeshes(meshes, filter?): { rebars: Rebar[]; duplicatePaths: string[] }`

- [ ] **Step 1: `MeshData.path` 를 필수로 추가하고 테스트 리터럴 6곳 갱신**

`designExtract.test.ts` 의 `MeshData` 리터럴 `:71-75`, `:87`, `:94-101`, `:102`, `:103`, `:111` 에 `path` 를 넣는다. vitest 는 타입체크를 하지 않으므로 빠뜨리면 컴파일 에러가 아니라 **전 메시가 `undefined` 키로 한 그룹에 뭉치는 런타임 오작동**이 된다.

- [ ] **Step 2: 실패하는 테스트 3개 작성**

```ts
it("부모가 다르면 같은 리프 이름도 뭉치지 않는다", () => {
  const { rebars } = rebarsFromMeshes([
    { name: "bar", path: "/Root/A/bar", positions: barAt(0), index: null },
    { name: "bar", path: "/Root/B/bar", positions: barAt(1), index: null },
  ]);
  expect(rebars.map((r) => r.id).sort()).toEqual(["/Root/A/bar", "/Root/B/bar"]);
});

it("같은 경로가 두 번 오면 duplicatePaths 에 보고한다", () => {
  const { duplicatePaths } = rebarsFromMeshes([
    { name: "bar", path: "/Root/bar", positions: barAt(0), index: null },
    { name: "bar", path: "/Root/bar", positions: barAt(1), index: null },
  ]);
  expect(duplicatePaths).toEqual(["/Root/bar"]);
});

it("필터로 걸러지는 파편이 생겨도 나머지 id 가 변하지 않는다", () => {
  const clean = rebarsFromMeshes([{ name: "s", path: "/R/s", positions: twoBars(), index: twoBarIdx() }]);
  const withFragment = rebarsFromMeshes([
    { name: "s", path: "/R/s", positions: twoBarsPlusFragment(), index: twoBarsPlusFragmentIdx() },
  ]);
  expect(withFragment.rebars.map((r) => r.id)).toEqual(clean.rebars.map((r) => r.id));
});
```

- [ ] **Step 3: 실패 확인** — `npx vitest run designExtract` → FAIL

- [ ] **Step 4: `rebarsFromMeshes` 재작성**

순서가 중요하다: **필터 → 정렬 → k 부여**.

```ts
export function rebarsFromMeshes(meshes: MeshData[], filter: RebarFilter = {}) {
  const maxRadius = filter.maxRadius ?? 0.05;
  const minLength = filter.minLength ?? 0.1;

  const byPath = new Map<string, Vec3[][]>();
  const duplicatePaths: string[] = [];
  for (const m of meshes) {
    const comps = m.index ? splitByConnectivity(m.positions, m.index) : [flatToVec3(m.positions)];
    if (byPath.has(m.path)) duplicatePaths.push(m.path);
    const arr = byPath.get(m.path) ?? [];
    arr.push(...comps.filter((c) => c.length >= 3));
    byPath.set(m.path, arr);
  }

  const out: Rebar[] = [];
  for (const [path, comps] of byPath) {
    // 1) 필터 먼저 — k 가 파편 유무에 흔들리지 않게
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
  if (duplicatePaths.length) {
    console.warn(`[designExtract] 중복 prim 경로 ${duplicatePaths.length}건 — 철근 id 가 뒤섞일 수 있습니다`, duplicatePaths);
  }
  return { rebars: out, duplicatePaths };
}
```

- [ ] **Step 5: `loadDesign.ts` 에서 경로 조립**

죽은 부모 폴백(`:28-31`)을 제거하고 부모 체인으로 경로를 만든다.

```ts
function primPath(o: THREE.Object3D, fallbackIdx: number): string {
  const segs: string[] = [];
  let n: THREE.Object3D | null = o;
  while (n && n.parent) { segs.unshift(n.name || `_${fallbackIdx}`); n = n.parent; }
  return "/" + segs.join("/");
}
```

`meshData` 생성부에서 `path: primPath(mesh, mi)` 로 넣고, `const { rebars, duplicatePaths } = rebarsFromMeshes(meshData);` 로 받는다. `rebars.length <= 1` throw 는 유지.

- [ ] **Step 6: 통과 확인 + 전체 회귀**

Run: `cd office-dashboard && npx vitest run`
Expected: 신규 3개 포함 전부 통과, 기존 154개 회귀 없음.

- [ ] **Step 7: `idScheme` 필드 추가**

`types.ts` 의 `AnalysisResult` 에 `idScheme?: "name" | "path"` 추가(version 은 2 유지). `pipeline.ts` 가 결과를 만들 때 `idScheme: "path"` 를 넣는다. 로드 시 `res.idScheme !== "path"` 면 UI 가 배지를 띄운다(T4).

- [ ] **Step 8: 커밋**

```bash
git add office-dashboard/src/lib/analysis office-dashboard/src/components/analysis/loadDesign.ts
git commit -m "fix: 철근 id 를 prim 경로 기반으로 — 메시 데이터 이름 중복 시 id 뒤집힘 해소"
```

---

## Task 2: `taxonomy.ts` (§5.2 · §6.2 · §8)

**Files:**
- Create: `office-dashboard/src/lib/analysis/taxonomy.ts`
- Test: `office-dashboard/src/lib/analysis/taxonomy.test.ts`

**Interfaces:**
- Consumes: `Rebar.id`(T1 경로 형식), `RebarRecord`
- Produces: `normalizePrimPath`, `RebarNode`, `Taxonomy`, `TaxonomyTreeNode`, `taxonomyFromSidecar`, `taxonomyFromPrimNames`, `taxonomyFromGeometry`, `buildTree`

- [ ] **Step 1: 타입과 테스트 작성** (스펙 §6.2 의 시그니처 그대로)

핵심 케이스:
```ts
it("절대/상대/wrapper 3형태가 같은 키로 정규화된다", () => {
  const want = "/RebarModel/Stem_Front_Vert_01";
  expect(normalizePrimPath("/RebarModel/Stem_Front_Vert_01")).toBe(want);
  expect(normalizePrimPath("RebarModel//Stem_Front_Vert_01")).toBe(want);
  expect(normalizePrimPath("/modelEntity/RebarModel/Meshes/Stem_Front_Vert_01")).toBe(want);
});

it("깊이가 부위마다 달라도 트리가 만들어진다", () => { /* 전벽 3단 + 헌치 1단 */ });
it("조인 안 된 id 는 unmatched 로 간다", () => { /* designId=null 인 extra */ });
it("사이드카에만 있는 prim 은 unmatchedPrims 로 간다", () => {});
it("한 prim 에 가닥이 여럿이면 잎 1개에 ids 2개", () => {});
it("코드북 해석률 60% 미만이면 primName 을 채택하지 않는다", () => {});
it("TopV_01 은 레거시 어댑터로 '상단 > 세로' 가 된다 (부위 어휘 금지)", () => {});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run taxonomy` → FAIL

- [ ] **Step 3: 구현**

`normalizePrimPath`: 빈 세그먼트 제거 → `WRAPPER_SEGMENTS = new Set(["modelEntity", "placementRoot", "Meshes"])` 제거 → 선행 슬래시 부착. 대소문자·공백 미변경.

`taxonomyFromSidecar`: `meta.rebars` 를 `normalizePrimPath(prim)` 키 맵으로 만들고, `ids` 각각을 `#k` 제거 후 조회. 매칭되면 `byId`, 아니면 `unmatched`. 역방향 미사용 prim 은 `unmatchedPrims`. `label` 없으면 `[...path, zeroPad2(no)].join("-")`.

`taxonomyFromPrimNames`: `#k` 제거 → 마지막 `/` 뒤 세그먼트 → `_` 분해 → 꼬리 숫자 토큰을 `no` 로 → 코드북 매핑. **레거시 어댑터** `^(Top|Bot)(V|H)$` 는 부위 어휘가 아닌 `상단/하단`·`세로/가로` 로 편다. 해석률 < 0.6 이면 `null` 반환(호출부가 기하로 폴백).

`taxonomyFromGeometry`: `RebarRecord.directionLabel` × `layer`(외측/내측) 2단. `root = "자동 분류"`.

`buildTree`: `path` 로 중첩 노드를 만들고 `count = ids.length` 합계. `unmatched` 가 있으면 루트 아래 `분류 없음 (N)` 노드를 **마지막에** 붙인다.

- [ ] **Step 4: 통과 확인** — `npx vitest run`

- [ ] **Step 5: 커밋**

```bash
git add office-dashboard/src/lib/analysis/taxonomy.ts office-dashboard/src/lib/analysis/taxonomy.test.ts
git commit -m "feat: 철근 계층 해석기 (사이드카/prim이름/기하 3경로 + 경로 정규화)"
```

---

## Task 3: 사이드카 스키마 + 프록시 (§5.1 · §5.3)

**Files:**
- Create: `office-dashboard/src/lib/analysis/rebarMetaSchema.ts`
- Create: `office-dashboard/src/lib/analysis/rebarMetaSchema.test.ts`
- Create: `office-dashboard/src/app/api/rebar-meta/route.ts`

**Interfaces:**
- Produces: `RebarMetaFile` 타입, `parseRebarMeta(json: unknown): { ok: true; data: RebarMetaFile } | { ok: false; errors: string[] }`

- [ ] **Step 1: zod 스키마 + 테스트** — `rebarsSchema.ts` 의 형태를 그대로 따른다(`safeParse` → 한국어 필드 메시지).

```ts
const schema = z.object({
  version: z.literal(1),
  ar_id: z.string().min(1),
  model_upload_at: z.string().optional(),
  prim_count: z.number().int().nonnegative().optional(),
  structure: z.string().min(1),
  rebars: z.array(z.object({
    prim: z.string().min(1),
    label: z.string().optional(),
    path: z.array(z.string().min(1)).min(1, "path 는 1단계 이상"),
    no: z.number().int().positive().optional(),
  })).min(1, "rebars 가 비어 있음"),
});
```

테스트: `version: 2` 거부, `path` 빈 배열 거부, `label` 없이도 통과.

- [ ] **Step 2: 프록시 라우트** — `api/model/route.ts` 의 패턴을 따르되 **`Cache-Control: no-store`**. 백엔드가 404 면 그대로 404 를 전달한다.

- [ ] **Step 3: 통과 확인 + 커밋**

```bash
npx vitest run rebarMeta && npm run build
git commit -am "feat: 철근 계층 사이드카 스키마 + /api/rebar-meta 프록시"
```

---

## Task 4: 트리 UI + `AnalysisView` 분할 (§6.3)

**Files:**
- Create: `office-dashboard/src/components/analysis/RebarTree.tsx`
- Modify: `office-dashboard/src/components/analysis/AnalysisView.tsx`

**Interfaces:**
- Consumes: `TaxonomyTreeNode[]`, `Taxonomy.source`
- Produces: `<RebarTree nodes selected onChange source />`, `AnalysisView` 의 `selectedIds: Set<string>` 상태

- [ ] **Step 1: `AnalysisView.tsx`(779줄) 를 먼저 쪼갠다** — `<MetricControls>`, `<SpacingTable>`, `<RebarTable>`. 순수 이동만, 동작 변경 없음. `npm run build` 로 확인.

- [ ] **Step 2: `<RebarTree>` 작성**

`Tree` + `useTree({ initialCheckedState, checkStrictly: false })`. 체크박스는 `renderNode` 에서 직접 그린다 — `Tree` 가 주는 체크박스 prop 은 `checkOnSpace` 하나뿐이다.

```tsx
<Tree
  data={nodes} tree={tree} levelOffset={20}
  renderNode={({ node, expanded, hasChildren, elementProps, tree }) => (
    <Group gap="xs" {...elementProps} style={{ minHeight: 32 }}>
      {hasChildren && <IconChevronDown size={14} style={{ transform: expanded ? "none" : "rotate(-90deg)" }} />}
      <Checkbox
        size="xs"
        checked={tree.isNodeChecked(node.value)}
        indeterminate={tree.isNodeIndeterminate(node.value)}
        onChange={() => (tree.isNodeChecked(node.value) ? tree.uncheckNode(node.value) : tree.checkNode(node.value))}
        onClick={(e) => e.stopPropagation()}
      />
      <Text size="sm">{node.label}</Text>
      <Badge size="xs" variant="light">{(node as TaxonomyTreeNode).count}</Badge>
    </Group>
  )}
/>
```

`source !== "sidecar"` 이면 트리 위에 `<Alert>` 로 Global Constraints 의 고정 문구를 띄운다. **색은 쓰지 않는다.**

- [ ] **Step 3: 우측 패널을 `Tabs` 로 나눈다** — 「분석」(기존 내용) / 「철근」(트리). 뷰어 폭·칩 스택·범례 절대배치는 건드리지 않는다.

- [ ] **Step 4: 택소노미 배선**

`useEffect` 로 `/api/rebar-meta?ar_id=` 를 받아 `parseRebarMeta` → 실패·404 면 `taxonomyFromPrimNames(ids)` → 그것도 `null` 이면 `taxonomyFromGeometry(records)`. **빌드 대조**: `model_upload_at`/`prim_count` 가 모델과 어긋나면 사이드카를 버리고 폴백 + "계층 정보가 모델과 맞지 않습니다" 배지.

`idScheme !== "path"` 인 저장 결과면 "이전 식별 방식으로 저장돼 계층 정보를 붙일 수 없습니다 — 재분석하세요" 배지.

- [ ] **Step 5: 빌드 확인 + 커밋**

```bash
npm run build
git commit -am "feat: 철근 계층 트리 UI + AnalysisView 분할"
```

---

## Task 5: 필터 배선 (§6.4)

**Files:**
- Modify: `office-dashboard/src/components/analysis/AnalysisViewer.tsx`
- Modify: `office-dashboard/src/components/analysis/AnalysisView.tsx`

**Interfaces:**
- Consumes: `selectedIds: Set<string>` (T4)
- Produces: `AnalysisViewer` 의 `visibleKeys: Set<string> | null` prop (null = 전체 표시)

- [ ] **Step 1: 구성/가시성 이펙트 분리** (§6.4.4)

구성 이펙트는 `records`/`design`/`scan` 만 보고 **모든** 레코드의 Group 을 만들어 `keyed` 에 채운다 — `showVerdicts`·`showScanBars` 조건을 여기서 제거한다. 새 가시성 이펙트가 셋을 논리곱으로 처리한다:

```ts
useEffect(() => {
  const s = sceneRef.current; if (!s) return;
  for (const [key, group] of s.keyed) {
    const rec = recByKey.get(key);
    group.visible =
      showScanBars &&
      (noDesign || !rec || showVerdicts.includes(rec.verdict)) &&
      (visibleKeys === null || visibleKeys.has(key));
  }
}, [showVerdicts, showScanBars, noDesign, visibleKeys, records]);
```

재프레이밍 로직은 **구성 이펙트에 남긴다** — `dataWasEmptyRef` 불변식이 데이터 유무에 걸려 있으므로 가시성 토글에 반응하면 안 된다.

- [ ] **Step 2: id 공간 변환** (§6.4.1)

`AnalysisView` 에서:
```ts
const vScan = useMemo(() => {
  if (!selectedIds) return null;
  const s = new Set<string>();
  for (const rec of view.rebars) {
    if (rec.scanId && (rec.designId == null || selectedIds.has(rec.designId))) s.add(rec.scanId);
  }
  return s;
}, [selectedIds, view.rebars]);
```
`designId == null`(도면 외)은 항상 포함 — 「분류 없음」 노드가 꺼지면 그때만 제외한다.

컨투어 표본:
```ts
const samples = effectiveMetric === "spacing"
  ? (spacing?.gaps ?? []).filter((g) => !vScan || (vScan.has(g.aId) && vScan.has(g.bId)))
  : positionSamples.filter((p) => !vScan || vScan.has(p.scanId));
```
`samples.length === 0` 일 때 null 대신 "선택한 철근에는 간격 구간이 없습니다" 상태를 렌더한다.

> `ContourSample` 에 `scanId` 가 없으면 위치 편차 표본 생성부(`AnalysisView.tsx:333` 근처)에서 함께 실어 보낸다.

- [ ] **Step 3: 컨투어 투영 가드** (§6.4.3)

선택된 철근들의 대표 축과 벽 법선이 이루는 각이 60° 임계 밖이면 컨투어를 그리지 않고 "이 부위는 벽면 지도에 투영할 수 없습니다 (깊이 방향 정보 손실)" 를 표시한다.

- [ ] **Step 4: 통계 재계산** (§6.4.2)

판정 카운트와 `summary.deviationMm`(평균·최대)를 **같은 모집단**(체크된 잎 ∪ 분류 없음)으로 다시 계산한다. 철근별 `deviationMm`·`spacingGroups` 는 **건드리지 않는다**. 필터 중이면 카드 묶음에 「선택한 철근 기준」 캡션, 간격 구간 표 헤더에 「필터 중 — 간격은 전체 기준」 배지를 띄우고 숨긴 철근이 낀 행을 흐리게 한다.

- [ ] **Step 5: 재보간 디바운스 150ms** — `contour.ts:131-148` 3중 루프가 메인스레드에서 돈다.

- [ ] **Step 6: 실데이터 검증 (V3·V4)**

```bash
npm run dev
```
브라우저에서 site 1 「시공 분석」 → 데모 스캔 업로드 → 분석 실행.
확인: 60개 철근이 4갈래 2단계 트리(`상단/하단 × 세로/가로`)로 뜨고, `모델 이름 규칙으로 추정` 배지가 보이고, 체크 해제 시 3D 에서 사라지고, 컨투어가 남은 영역만 칠한다. **스크린샷으로 대조한다.**

- [ ] **Step 7: 커밋 + 배포**

```bash
npm run build && npx vercel deploy --prod --yes
git commit -am "feat: 철근 트리 필터 배선 (표시 전용 · id 공간 변환 · 컨투어 가드)"
```

---

## Task 6: iOS 노드 경로·숨김·DEBUG 덤프 (§7.0 · §7.1)

**Files:**
- Modify: `LHRebarAR/AR/ModelAnchorController.swift`
- Modify: `LHRebarAR/Placement/PlacementViewModel.swift`

**Interfaces:**
- Produces: `ModelAnchorController.meshNodePaths(of:) -> [String]`, `setHidden(_:paths:) -> Int`, `PlacementViewModel.hiddenPaths: Set<String>`

- [ ] **Step 1: 노드 경로 열거** — `installCollision` 과 같은 스택 DFS. 경로는 `modelEntity` 기준, `RebarTaxonomy.normalizePrimPath`(T7) 로 정규화. 형제 동명이면 `#k` 접미사 + DEBUG 로그.

- [ ] **Step 2: `setHidden`**

```swift
@discardableResult
func setHidden(_ hidden: Bool, paths: Set<String>) -> Int {
    guard let modelEntity else { return 0 }
    var matched = 0
    var stack: [(Entity, String)] = [(modelEntity, "")]
    while let (entity, prefix) = stack.popLast() {
        let path = prefix.isEmpty ? "" : prefix
        for child in entity.children { stack.append((child, path + "/" + child.name)) }
        guard entity.components[ModelComponent.self] != nil else { continue }
        if paths.contains(RebarTaxonomy.normalizePrimPath(path)) {
            entity.isEnabled = !hidden
            matched += 1
        }
    }
    return matched
}
```

- [ ] **Step 3: `#if DEBUG` 엔티티 트리 덤프** — 각 노드의 `name`·깊이·`ModelComponent` 유무를 출력하고 `lastCollisionNodeCount` 를 DEBUG HUD 에 노출.

- [ ] **Step 4: 필터 상태 수명** — `PlacementViewModel` 이 `hiddenPaths: Set<String>` 을 보유. `place()` 직후 재적용하고, `setHidden` 반환값이 0 이면 `hiddenPaths` 를 **비운다**(다른 모델 배치).

- [ ] **Step 5: `xcodegen generate` + CI 컴파일**

```bash
gh workflow run ios-testflight.yml -f app=both -f upload=false
```

- [ ] **Step 6: 커밋**

---

## Task 7: Swift 택소노미 포트 + 사이드카 수신 (§7.3 · §7.4)

**Files:**
- Create: `LHRebarAR/Model/RebarTaxonomy.swift`
- Create: `LHRebarARTests/RebarTaxonomyTests.swift`
- Modify: `LHRebarAR/Backend/BackendClient.swift`

**Interfaces:**
- Produces: `RebarTaxonomy.normalizePrimPath(_:) -> String`, `RebarTaxonomy.fromSidecar(_:paths:)`, `RebarTaxonomy.fromPrimNames(_:)`, `BackendClient.fetchRebarMeta(arId:)`

- [ ] **Step 1: T2 의 케이스 표를 그대로 XCTest 로 옮긴다** — 두 구현이 갈라지면 두 앱의 트리가 달라진다.
- [ ] **Step 2: `normalizePrimPath` + 코드북 포트** (§8.1 표 그대로, 레거시 어댑터 포함)
- [ ] **Step 3: `fetchRebarMeta`** — 캐시 키는 `ModelFileStore` 와 같은 `arID_uploadAt`. 404·파싱 실패는 nil 반환(폴백).
- [ ] **Step 4: `xcodegen generate` + 테스트 실행 + 커밋**

---

## Task 8: LH 앱 트리 UI (§7.3)

**Files:**
- Create: `LHRebarAR/UI/Components/RebarTreePad.swift`
- Modify: `LHRebarAR/UI/Screens/ARPlacementView.swift`
- Modify: `LHRebarAR/App/AppFeatures.swift` (주석만)

- [ ] **Step 1: `DisclosureGroup` 기반 트리 패드** — `FineAdjustPad` 오버레이 패턴을 따른다. 라벨은 사이드카 `label`, `source` 배지는 대시보드와 **동일 문구**.
- [ ] **Step 2: `AppFeatures.rebarFilter` 게이트** — 이 플래그를 읽는 최초이자 유일한 지점. `#if LH_ONLY` 를 화면에 뿌리지 않는다. `AppFeatures.swift:18` 주석을 "철근 계층(부위/면/방향)별 필터" 로 정정.
- [ ] **Step 3: `xcodegen generate` + CI 컴파일 + 커밋**

---

## Task 9: 문서 갱신 (§12)

**Files:**
- Modify: `CLAUDE.md`, `docs/design-system.md`, `docs/ar-app-split-device-check.md`, `docs/superpowers/specs/2026-08-04-ar-app-split-design.md`, `api/USDZ_REQUEST.md`

- [ ] **Step 1: `CLAUDE.md`** — §8 에 사이드카 엔드포인트 대기 추가. 고차 목록에 "§3.7 메시 데이터블록 이름" 추가. §1 의 "철근 종류별 필터링" → "철근 계층(부위/면/방향)별 필터".
- [ ] **Step 2: `docs/design-system.md`** — §7.6 트리 UI 절 신설(색 미사용, 행 높이 32px 하한, `source` 배지 3문구), §10 버전표 v1.2.
- [ ] **Step 3: 앱분할 스펙** — 열린 항목을 **부분 해소**로 표시(선행 확인은 해결, '철근 종류' 축은 미구현).
- [ ] **Step 4: `api/USDZ_REQUEST.md:37-41`** — 예시 커맨드에 `allow_unicode=True, author_blender_name=True` 추가. **축·단위 요구는 건드리지 않는다**(고차 #4).
- [ ] **Step 5: `docs/ar-app-split-device-check.md`** — V6~V10 추가.
- [ ] **Step 6: 커밋 + PR**

---

## 실행 순서 메모

T1~T5(대시보드)는 **기기 없이 전부 검증 가능**하고 오늘 있는 모델로 실데이터 확인까지 된다. T6~T8(iOS)은 §7.0 기기 검증이 통과해야 의미가 있다 — CI 컴파일까지는 되지만 **동작 확인은 기기가 필요하다.**
