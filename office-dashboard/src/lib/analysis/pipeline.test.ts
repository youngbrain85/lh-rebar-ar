import { describe, expect, it } from "vitest";
import { mat4FromRotTrans, mat4Identity } from "./geom";
import { requiredSpacingMatchesMode, runAnalysis } from "./pipeline";
import { spacingGroupKey } from "./spacing";
import {
  jitterRebars, makeDiagonalFamilyGrid, makeWallGrid, offsetRebar, rigidMat4, transformRebars,
} from "./testFixtures";
import type { Rebar } from "./types";

const UP: [number, number, number] = [0, 1, 0];

describe("runAnalysis end-to-end", () => {
  it("full scenario: transform+noise+1 missing+1 offset → correct verdicts", () => {
    // 대칭 격자는 정합이 거울 대칭해로 수렴할 수 있어 코너 스텁으로 대칭을 깬다 (Task 5/6과 동일 원칙)
    const STUB = {
      id: "asym-stub",
      radius: 0.008,
      centerline: [[-0.25, 0, 0], [-0.25, 0.4, 0]] as [number, number, number][],
    };
    const design = [...makeWallGrid(), STUB];
    // 시공 시나리오: d-v-outer-3 미시공, d-h-inner-1 15mm 오프셋, 2mm 노이즈, 임의 배치
    let scan = [...makeWallGrid(), STUB].filter((r) => r.id !== "d-v-outer-3");
    scan = offsetRebar(scan, "d-h-inner-1", [0, 0, 0.015]);
    scan = jitterRebars(scan, 0.002, 99);
    scan = transformRebars(scan, rigidMat4(75, [3.1, -0.6, 1.4]));
    // 스캔 id는 라이다 앱 임의 명명 시뮬레이션
    scan = scan.map((r, i) => ({ ...r, id: `s${i}` }));

    const out = runAnalysis({ design, scan, toleranceMm: 10, up: UP });

    expect(out.registration.failed).toBe(false);
    expect(out.registration.rmsMm).toBeLessThan(6);
    expect(out.summary.designCount).toBe(25);
    expect(out.summary.scanCount).toBe(24);
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

describe("runAnalysis: frameSource=\"scan\" — 설계모델 없이 분석", () => {
  // 벽(makeWallGrid, XY평면·법선 Z)을 x축 기준 90° 돌려 "바닥판형" 설계를 만든다.
  // rigidMat4는 up(Y)축 요(yaw) 회전만 지원해 이 회전을 표현할 수 없으므로,
  // mat4FromRotTrans에 직접 행:  [1,0,0 / 0,0,-1 / 0,1,0] (x축 +90°)을 넣어 만든다.
  // 결과: (x,y,z) → (x,-z,y) — 법선이 up(Y)과 나란해져 실제 바닥판(발주처 site 1)과
  // 같은 성질(벽과 다른 배향)을 갖는다.
  const slabRotation = mat4FromRotTrans([1, 0, 0, 0, 0, -1, 0, 1, 0], [0, 0, 0]);
  const makeSlabDesign = () => transformRebars(makeWallGrid(), slabRotation);
  const UP: [number, number, number] = [0, 1, 0];

  it("핵심 회귀: 같은 스캔이면 설계가 벽이든 바닥판이든 간격 결과가 완전히 같다", () => {
    const scan = makeWallGrid().map((r, i) => ({ ...r, id: `s${i}` }));
    const wallDesign = makeWallGrid();
    const slabDesign = makeSlabDesign();

    const withWallDesign = runAnalysis({
      design: wallDesign, scan, toleranceMm: 10, up: UP, frameSource: "scan",
    });
    const withSlabDesign = runAnalysis({
      design: slabDesign, scan, toleranceMm: 10, up: UP, frameSource: "scan",
    });

    // 프레임(법선·방향군)과 그로부터 파생되는 간격이 설계와 완전히 무관해야 한다.
    expect(withSlabDesign.wallNormal).toEqual(withWallDesign.wallNormal);
    expect(withSlabDesign.families).toEqual(withWallDesign.families);
    expect(withSlabDesign.spacing).toEqual(withWallDesign.spacing);
    expect(withSlabDesign.plane).toEqual(withWallDesign.plane);

    // 대조군: "design" 모드(기본값)에서는 같은 두 설계가 서로 다른 프레임을 만들어
    // spacing 결과가 달라진다 — 이 대조가 없으면 위 일치가 "그냥 뭘 해도 같은 값이
    // 나오는" 우연인지, frameSource:"scan"이 실제로 설계 의존성을 끊었기 때문인지
    // 구별할 수 없다. ★ 여기서 "달라진다"는 간격 **중앙값 자체**(300mm×6, 400mm×4,
    // 두 레이어)가 아니다 — 그건 이 픽스처에서 둘 다 동일하다. 달라지는 건 그
    // 값이 매겨지는 **방향군 id와 순서**다(설계가 벽이면 v1/h1, 슬래브면 h1/h2로
    // 재배정되고 그룹 나열 순서도 바뀐다) — 프레임(법선·방향군)이 설계를 따라가고
    // 있다는 증거이자, toEqual이 실제로 잡아내는 차이다.
    const designModeWall = runAnalysis({ design: wallDesign, scan, toleranceMm: 10, up: UP });
    const designModeSlab = runAnalysis({ design: slabDesign, scan, toleranceMm: 10, up: UP });
    expect(designModeSlab.spacing).not.toEqual(designModeWall.spacing);
  });

  it("design: [] 이어도 예외 없이 동작한다", () => {
    const scan = makeWallGrid().map((r, i) => ({ ...r, id: `s${i}` }));
    const out = runAnalysis({ design: [], scan, toleranceMm: 10, up: UP, frameSource: "scan" });
    expect(out.registration.failed).toBe(false);
    expect(out.spacing.gaps.length).toBeGreaterThan(0);
    // ★ 위 두 단언만으로는 이 테스트가 겨냥하는 뮤테이션(설계를 읽으려다 실패)을 못 잡는다.
    //   design:[]이어도 estimateWallNormal([])은 던지지 않고 [0,0,1]을 반환하고,
    //   deriveDirectionFamilies([], up)은 []을 반환해 assignFamily가 전부 "v1"으로
    //   몰아넣으며, computeSpacing의 axisOf 폴백([0,1,0])이 그래도 구간을 만들어내
    //   gaps.length > 0이 우연히 통과한다. 방향군이 스캔에서 실제로 뽑혔는지(빈 배열이
    //   아닌지)를 못박아야 "설계를 읽지 않고도 진짜로 동작한다"는 근거가 된다.
    expect(out.families.length).toBeGreaterThan(0);
  });

  it("정합은 시도조차 하지 않는다 — method: \"none\", failed: false, 항등행렬", () => {
    const scan = makeWallGrid().map((r, i) => ({ ...r, id: `s${i}` }));
    const out = runAnalysis({
      design: makeSlabDesign(), scan, toleranceMm: 10, up: UP, frameSource: "scan",
    });
    expect(out.registration.method).toBe("none");
    expect(out.registration.failed).toBe(false);
    expect(out.registration.matrix).toEqual(mat4Identity());
  });

  it("매칭·판정 결과는 지어내지 않는다 — rebars/designClassified 빈 배열, summary 0", () => {
    const scan = makeWallGrid().map((r, i) => ({ ...r, id: `s${i}` }));
    const out = runAnalysis({
      design: makeWallGrid(), scan, toleranceMm: 10, up: UP, frameSource: "scan",
    });
    expect(out.rebars).toEqual([]);
    expect(out.designClassified).toEqual([]);
    expect(out.summary).toEqual({
      designCount: 0, scanCount: 0, matched: 0, missing: 0, extra: 0,
      outOfTolerance: 0, deviationMm: null, byGroup: [],
    });
  });

  it("방향군은 설계가 아니라 스캔에서 뽑는다 — 설계에 없는 45° 사재도 스캔에 있으면 잡힌다", () => {
    // 설계는 세로/가로 두 군뿐인 평범한 벽, 스캔에만 45° 사재군이 섞여 있다.
    const design = makeWallGrid();
    const scan = makeDiagonalFamilyGrid().map((r, i) => ({ ...r, id: `s${i}` }));
    const out = runAnalysis({ design, scan, toleranceMm: 10, up: UP, frameSource: "scan" });
    expect(out.families.some((f) => f.label.startsWith("사재"))).toBe(true);
  });
});

// 리뷰 지적 #1(CRITICAL): AnalysisView.tsx가 저장된 requiredSpacingMm을 프레임이 바뀐
// 채로 재사용해 조작된 편차(+100mm급)를 만들어낸 버그. 근본 원인은 spacingGroupKey의
// directionId가 프레임에 종속적이라는 사실이고, 그 사실을 여기서 엔진 레벨로 고정해
// 둔다 — UI가 requiredSpacingMatchesMode로 가드해야 하는 이유의 근거다.
describe("그룹 키는 프레임에 종속적이다 — requiredSpacingMm이 프레임을 넘어 살아남으면 안 되는 이유", () => {
  const slabRotation = mat4FromRotTrans([1, 0, 0, 0, 0, -1, 0, 1, 0], [0, 0, 0]);
  const UP: [number, number, number] = [0, 1, 0];

  it("같은 스캔·같은 물리적 간격 분포인데 설계가 벽이냐 슬래브냐에 따라 그룹 키(direction id)가 달라진다", () => {
    const scan = makeWallGrid().map((r, i) => ({ ...r, id: `s${i}` }));
    const wallDesign = makeWallGrid();
    const slabDesign = transformRebars(makeWallGrid(), slabRotation);

    const withWall = runAnalysis({ design: wallDesign, scan, toleranceMm: 10, up: UP });
    const withSlab = runAnalysis({ design: slabDesign, scan, toleranceMm: 10, up: UP });

    const wallKeys = new Set(
      withWall.spacing.groups.map((g) => spacingGroupKey(g.direction, g.layer)),
    );
    const slabKeys = new Set(
      withSlab.spacing.groups.map((g) => spacingGroupKey(g.direction, g.layer)),
    );
    // 우연한 이름 충돌이 아니라 체계적으로 다시 배정된다는 근거: 키 집합 자체가 다르다.
    expect(slabKeys).not.toEqual(wallKeys);
    // 하지만 물리적으로는 같은 간격 분포다(중앙값 다중집합이 동일) — "그룹이 사라진 게
    // 아니라 이름표만 바뀌었다"는 것을 보여준다. 이게 바로 위험한 이유: 저장된
    // requiredSpacingMm의 키를 다른 프레임에서 그대로 조회하면, 존재하지 않는 그룹으로
    // 조용히 실패하는 게 아니라 **다른 물리적 그룹의 값을 우연히 맞혀버릴 수 있다**
    // (리뷰가 실측한 h1/inner 충돌이 정확히 이 경우다).
    const wallMedians = withWall.spacing.groups.map((g) => g.medianMm).sort((a, b) => a - b);
    const slabMedians = withSlab.spacing.groups.map((g) => g.medianMm).sort((a, b) => a - b);
    expect(slabMedians).toEqual(wallMedians);
  });
});

describe("requiredSpacingMatchesMode", () => {
  it("저장 당시 방식과 지금 모드가 일치할 때만 true", () => {
    expect(requiredSpacingMatchesMode("none", true)).toBe(true);
    expect(requiredSpacingMatchesMode("auto", false)).toBe(true);
    expect(requiredSpacingMatchesMode("manual", false)).toBe(true);
  });
  it("저장 당시 방식과 지금 모드가 어긋나면 false", () => {
    expect(requiredSpacingMatchesMode("none", false)).toBe(false);
    expect(requiredSpacingMatchesMode("auto", true)).toBe(false);
    expect(requiredSpacingMatchesMode("manual", true)).toBe(false);
  });
  it("저장된 결과가 없으면(null) 지금이 설계 모드일 때만 true — 지어낼 근거가 없으므로 보수적으로 막는다", () => {
    expect(requiredSpacingMatchesMode(null, false)).toBe(true);
    expect(requiredSpacingMatchesMode(null, true)).toBe(false);
  });
});
