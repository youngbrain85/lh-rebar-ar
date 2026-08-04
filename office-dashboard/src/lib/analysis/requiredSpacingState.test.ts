import { describe, expect, it } from "vitest";
import { runAnalysis } from "./pipeline";
import { spacingGroupKey, suggestRequiredSpacing } from "./spacing";
import {
  frameOfMethod, INITIAL_REQUIRED_SPACING_STATE, requiredSpacingReducer, usableRequiredSpacing,
  type RequiredSpacingState,
} from "./requiredSpacingState";
import { makeWallGrid } from "./testFixtures";

const UP: [number, number, number] = [0, 1, 0];

describe("frameOfMethod", () => {
  it("method:\"none\"만 scan 프레임, 나머지는 전부 design 프레임", () => {
    expect(frameOfMethod("none")).toBe("scan");
    expect(frameOfMethod("auto")).toBe("design");
    expect(frameOfMethod("manual")).toBe("design");
    // 저장된 결과가 없을 때(null)도 "이 값이 나온 프레임을 알 수 없다"가 아니라
    // design으로 확정한다 — 초기 상태(INITIAL_REQUIRED_SPACING_STATE)와 짝을 맞추기
    // 위한 안전한 기본값이다.
    expect(frameOfMethod(null)).toBe("design");
  });
});

// 3차 리뷰 지적 #1(BLOCKING): "지금 모드"를 마운트 시점 체크박스 잔상과 비교하던
// 이전 가드(2차 수정)를 없애고, 값과 그 값이 나온 프레임을 리듀서 상태 하나로 묶었다.
// 아래 여섯 시나리오가 리뷰가 못박은 목록이다 — 특히 1번은 "발주처 13개 현장 전부
// built-in 설계모델이 없어 method:"none"이 이 브랜치의 주력 저장 상태"라는 사실 때문에
// 가장 흔하게 밟히는, 그리고 지금까지 깨져 있던 경로다.
describe("requiredSpacingReducer", () => {
  it("1) 저장된 결과가 method:\"none\"이면(발주처 전 현장의 주력 케이스) 맵을 유지하고 프레임을 scan으로 잡는다", () => {
    // 이전 스캔에서 어떤 프레임에 있었든(여기서는 design으로 시작) 상관없다 —
    // loadedResult는 "지금 상태"와 비교하지 않고 저장된 결과 자신의 method만 본다.
    const prev: RequiredSpacingState = { frame: "design", map: {} };
    const next = requiredSpacingReducer(prev, {
      type: "loadedResult", method: "none", map: { "v1/inner": 125, "h1/inner": 195 },
    });
    expect(next).toEqual({ frame: "scan", map: { "v1/inner": 125, "h1/inner": 195 } });
  });

  it("2) 저장된 결과가 method:\"auto\"면 직전까지 scan 모드였더라도 맵을 유지하고 프레임을 design으로 잡는다", () => {
    const prev: RequiredSpacingState = { frame: "scan", map: { "v1/inner": 999 } };
    const next = requiredSpacingReducer(prev, {
      type: "loadedResult", method: "auto", map: { "h1/inner": 125, "h2/inner": 195 },
    });
    expect(next).toEqual({ frame: "design", map: { "h1/inner": 125, "h2/inner": 195 } });
  });

  it("3) 사용자가 체크박스를 켜면(scan으로) 이전 프레임의 맵을 비운다", () => {
    const prev: RequiredSpacingState = { frame: "design", map: { "h1/inner": 300 } };
    const next = requiredSpacingReducer(prev, { type: "userToggledFrame", frame: "scan" });
    expect(next).toEqual({ frame: "scan", map: {} });
  });

  it("4) 사용자가 체크박스를 끄면(design으로) 이전 프레임의 맵을 비운다", () => {
    const prev: RequiredSpacingState = { frame: "scan", map: { "v1/inner": 300 } };
    const next = requiredSpacingReducer(prev, { type: "userToggledFrame", frame: "design" });
    expect(next).toEqual({ frame: "design", map: {} });
  });

  it("5) analyzed는 사용자 지정값을 실측 중앙값 위에 덮어쓰되, 프레임이 일치할 때만 그렇다", () => {
    const matching: RequiredSpacingState = { frame: "design", map: { "h1/inner": 999 } };
    const mergedSame = requiredSpacingReducer(matching, {
      type: "analyzed", frame: "design", suggested: { "h1/inner": 125, "h2/inner": 195 },
    });
    // h1/inner는 사용자 값(999)이 살아남고, h2/inner는 맵에 없던 값이라 suggested 그대로.
    expect(mergedSame).toEqual({ frame: "design", map: { "h1/inner": 999, "h2/inner": 195 } });

    const mismatched: RequiredSpacingState = { frame: "scan", map: { "v1/inner": 999 } };
    const mergedDiff = requiredSpacingReducer(mismatched, {
      type: "analyzed", frame: "design", suggested: { "h1/inner": 125, "h2/inner": 195 },
    });
    // 프레임이 달라 999는 버려지고 suggested만 남는다.
    expect(mergedDiff).toEqual({ frame: "design", map: { "h1/inner": 125, "h2/inner": 195 } });
  });

  it("6) usableRequiredSpacing은 프레임이 일치하면 맵을, 어긋나면 빈 값을 돌려준다", () => {
    const s: RequiredSpacingState = { frame: "design", map: { "h1/inner": 300 } };
    expect(usableRequiredSpacing(s, "design")).toEqual({ "h1/inner": 300 });
    expect(usableRequiredSpacing(s, "scan")).toEqual({});
  });

  it("userEdited는 값이 있으면 반영하고 null이면(빈칸·0·음수) 지운다 — 프레임이 일치할 때만", () => {
    const s: RequiredSpacingState = { frame: "design", map: { "h1/inner": 100 } };
    const edited = requiredSpacingReducer(s, {
      type: "userEdited", key: "h1/inner", value: 250, frame: "design",
    });
    expect(edited).toEqual({ frame: "design", map: { "h1/inner": 250 } });
    const cleared = requiredSpacingReducer(edited, {
      type: "userEdited", key: "h1/inner", value: null, frame: "design",
    });
    expect(cleared).toEqual({ frame: "design", map: {} });
  });

  // 4차 리뷰 지적 #1: "토글 후 편집" — 체크박스를 토글하면 state.frame은 즉시
  // 바뀌지만(userToggledFrame이 map을 비운다), 화면의 표(spacingGroups)는 다음
  // 재분석 전까지 이전 프레임 그대로 남는다. 그 표에 입력한 값이 그대로 들어가면
  // 같은 키가 물리적으로 다른 그룹을 가리키는 조작된 편차가 나온다(리뷰가 site-1
  // 형태 픽스처로 실측: 슬래브 프레임 h1/inner=300이 스캔 프레임 h1/inner=400인
  // 자리에 required:437로 들어가 dev=-37을 지어냈다). userEdited가 그 표를 만든
  // 결과의 프레임(frame)을 함께 실어 보내면, 리듀서가 지금 state.frame과 어긋나는
  // 편집을 버릴 수 있다.
  it("편집이 나온 표의 프레임이 지금 state의 프레임과 다르면 반영하지 않는다", () => {
    // 체크박스를 막 토글해 프레임은 scan인데(map은 비어 있다), 아직 재분석 전이라
    // 화면의 입력칸은 여전히 design 프레임의 표를 보여주고 있는 상황을 재현한다.
    const s: RequiredSpacingState = { frame: "scan", map: {} };
    const rejected = requiredSpacingReducer(s, {
      type: "userEdited", key: "h1/inner", value: 437, frame: "design",
    });
    // 437이 map에 들어가지 않는다 — 버그가 있었다면 { frame: "scan", map: { "h1/inner": 437 } }가 나온다.
    expect(rejected).toEqual({ frame: "scan", map: {} });
  });

  it("프레임이 일치하면 그제서야 반영된다 — 재분석 후 표와 state가 같은 프레임이 된 경우", () => {
    const s: RequiredSpacingState = { frame: "scan", map: {} };
    const applied = requiredSpacingReducer(s, {
      type: "userEdited", key: "h1/inner", value: 437, frame: "scan",
    });
    expect(applied).toEqual({ frame: "scan", map: { "h1/inner": 437 } });
  });

  // 리뷰 지적 #3: cleanMap의 필터(유한·양수만 통과)는 지금까지 테스트되지 않았다 —
  // 그 검사를 () => true로 바꿔도 기존 스위트가 전부 green이었다.
  it("loadedResult는 저장된 맵의 0·음수·NaN을 걸러낸다", () => {
    const dirty = {
      "v1/inner": 125,       // 정상
      "h1/inner": 0,         // 0 — computeSpacing의 `?? med`가 유효값으로 통과시켜 버린다
      "v1/outer": -10,       // 음수
      "h1/outer": Number.NaN, // NaN
    };
    const next = requiredSpacingReducer(INITIAL_REQUIRED_SPACING_STATE, {
      type: "loadedResult", method: "auto", map: dirty,
    });
    expect(next).toEqual({ frame: "design", map: { "v1/inner": 125 } });
  });

  it("초기 상태는 design 프레임의 빈 맵이다", () => {
    expect(INITIAL_REQUIRED_SPACING_STATE).toEqual({ frame: "design", map: {} });
  });
});

// 리뷰가 요구한 통합 시나리오: pipeline.runAnalysis + 리듀서를 AnalysisView.analyze()가
// 실제로 하는 순서 그대로 재현한다 — usableRequiredSpacing으로 run()에 넘길 값을
// 뽑고, 성공 후 analyzed로 병합한다.
describe("요구 간격은 같은 프레임에서 재분석해도 유지된다 (통합)", () => {
  it("같은 프레임(design)이면 사용자가 지정한 값이 실측 중앙값으로 덮이지 않는다", () => {
    const design = makeWallGrid();
    const scan = makeWallGrid().map((r, i) => ({ ...r, id: `s${i}` }));
    const first = runAnalysis({ design, scan, toleranceMm: 10, up: UP });
    const groupKey = spacingGroupKey(first.spacing.groups[0].direction, first.spacing.groups[0].layer);
    const median = first.spacing.groups[0].medianMm;
    const customValue = Math.round(median) + 37; // 실측 중앙값과 뚜렷이 다른 값

    const state: RequiredSpacingState = { frame: "design", map: { [groupKey]: customValue } };
    const currentFrame = "design" as const;
    const usable = usableRequiredSpacing(state, currentFrame);
    const second = runAnalysis({ design, scan, toleranceMm: 10, up: UP, requiredSpacingMm: usable });
    const nextState = requiredSpacingReducer(state, {
      type: "analyzed", frame: currentFrame, suggested: suggestRequiredSpacing(second.spacing.groups),
    });

    expect(nextState.map[groupKey]).toBe(customValue);
    const g = second.spacing.gaps.find((x) => spacingGroupKey(x.direction, x.layer) === groupKey)!;
    expect(g.requiredMm).toBe(customValue);
  });

  it("프레임이 다르면(design 저장 → scan 모드) 저장된 값은 쓰이지 않고 실측 중앙값으로 되돌아간다", () => {
    const design = makeWallGrid();
    const scan = makeWallGrid().map((r, i) => ({ ...r, id: `s${i}` }));
    const first = runAnalysis({ design, scan, toleranceMm: 10, up: UP });
    const groupKey = spacingGroupKey(first.spacing.groups[0].direction, first.spacing.groups[0].layer);
    const median = first.spacing.groups[0].medianMm;
    const customValue = Math.round(median) + 37;

    const state: RequiredSpacingState = { frame: "design", map: { [groupKey]: customValue } };
    const currentFrame = "scan" as const;
    const usable = usableRequiredSpacing(state, currentFrame);
    expect(usable).toEqual({});
    const second = runAnalysis({
      design, scan, toleranceMm: 10, up: UP, frameSource: "scan", requiredSpacingMm: usable,
    });
    // usable이 비었으므로 모든 그룹이 자기 실측 중앙값을 요구값으로 쓴다 — 노이즈 없는
    // 균일 격자라 편차가 정확히 0이어야 한다. customValue가 스며들었다면 이 단언이 깨진다.
    for (const g of second.spacing.gaps) expect(g.deviationMm).toBeCloseTo(0, 6);
  });

  it("핵심 버그 시나리오: method:\"none\" 결과를 로드한 직후 체크박스 동기화가 일어나도(loadedResult 다음에 아무 것도 오지 않는다) 맵이 살아있다", () => {
    // 3차 리뷰가 잡아낸 버그: SiteAnalysis.onOpen이 noDesignMode를 매번 false로 리셋해
    // AnalysisView는 항상 false로 마운트되고, 로드가 끝나면(method:"none") 체크박스가
    // false→true로 "동기화"된다. 예전 구현(useEffect가 noDesignMode를 보고 지움)에서는
    // 이 동기화 자체가 "사용자가 체크박스를 눌렀다"와 구별되지 않아 방금 로드한 맵을
    // 지워버렸다. 리듀서 구조에서는 그 동기화가 noDesignMode라는 별개의 state를 바꿀
    // 뿐 리듀서에 어떤 이벤트도 보내지 않으므로, loadedResult 이후 아무 일도 일어나지
    // 않아야 한다 — 이 테스트는 정확히 그 "아무 일도 일어나지 않음"을 확인한다.
    const loaded = requiredSpacingReducer(INITIAL_REQUIRED_SPACING_STATE, {
      type: "loadedResult", method: "none", map: { "v1/inner": 125, "h1/inner": 195 },
    });
    // (모방) noDesignMode가 false→true로 바뀐다 — 리듀서 관점에서는 아무 이벤트도 없다.
    // 즉 "체크박스가 바뀌었다"는 사실만으로 리듀서에 아무것도 전달되지 않는다는 것이
    // 바로 이 버그 클래스가 구조적으로 불가능해진 이유다.
    expect(loaded).toEqual({ frame: "scan", map: { "v1/inner": 125, "h1/inner": 195 } });
    // 바로 이어서 재분석해도(같은 프레임) 값이 살아있다.
    expect(usableRequiredSpacing(loaded, "scan")).toEqual({ "v1/inner": 125, "h1/inner": 195 });
  });
});
