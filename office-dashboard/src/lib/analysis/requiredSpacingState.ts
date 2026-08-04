// 요구 간격(requiredSpacing) 상태 머신 — 순수 TS, React/DOM/Next 금지.
//
// 배경: requiredSpacing 값의 그룹 키(`${directionId}/${layer}`)는 프레임(design 대
// scan)에 종속적이다 — directionId는 프레임마다 다시 배정되므로, 같은 키가 물리적으로
// 다른 그룹을 가리킬 수 있다. 그래서 값(map)은 항상 그 값이 나온 프레임(frame)과
// 짝지어 다녀야 하고, "지금 분석을 돌릴 프레임"과 그 짝이 맞을 때만 써야 한다.
//
// 이 파일이 따로 존재하는 이유: 이 상태를 AnalysisView.tsx의 useEffect로 관리했을 때
// 세 라운드 연속으로 버그가 났다. 매번 "체크박스 값이 바뀌면 지운다"는 하나의
// useEffect(키: noDesignMode)로 구현했는데, 그 값은 두 가지 서로 다른 사건 — ①
// 사용자가 체크박스를 직접 눌렀다, ② 로드가 저장된 결과의 method에 맞춰 체크박스를
// 동기화했다 — 에서 똑같이 바뀐다. useEffect는 결과값(noDesignMode)만 보므로 이 둘을
// 구분할 수 없고, ②에서도 지워버려 방금 로드한(프레임이 이미 맞는) 값을 파괴했다.
// 사건을 명시적으로 구분하는 리듀서로 바꾸면 이 클래스의 버그 자체가 불가능해진다 —
// "로드됨"과 "사용자가 껐다 켰다" 이벤트가 서로 다르므로 리듀서가 서로 다르게 반응할
// 수 있다. 컴포넌트 테스트 하네스가 없는 이 저장소에서(vitest는 environment:"node")
// 이 로직을 여기로 빼내면 기존 노드 환경 스위트에서 그대로 단위 테스트할 수 있다.

export type FrameSource = "design" | "scan";

export interface RequiredSpacingState {
  /** map의 키가 어느 프레임에서 나온 것인지 */
  frame: FrameSource;
  /** 그룹별 요구 간격 (mm). key = `${directionId}/${layer}` */
  map: Record<string, number>;
}

/** 저장된 결과가 아직 없을 때(또는 registration이 없는 malformed 저장본)의 method */
export type SavedMethod = "auto" | "manual" | "none" | null;

export type RequiredSpacingEvent =
  /** 사용자가 「설계모델 없이 분석」 체크박스를 직접 눌렀다 — 이전 프레임의 값은
   *  새 프레임에서 의미가 없으므로 비운다. */
  | { type: "userToggledFrame"; frame: FrameSource }
  /** 스캔을 열어(또는 다시 열어) 저장된 결과를 로드했다 — 그 결과 자신의 method로
   *  프레임을 확정하고 map과 함께 짝지어 들인다. "지금 모드"와 비교해 거부하지
   *  않는다: 같은 저장 결과에서 나온 map과 method이므로 항상 짝이 맞는다. */
  | { type: "loadedResult"; method: SavedMethod; map: Record<string, number> }
  /** 사용자가 「요구 간격」 입력칸을 직접 고쳤다. value가 null이면(빈칸·0·음수 등
   *  "지정 안 함") 그 키를 지워 그룹 실측 중앙값 폴백을 살린다. */
  | { type: "userEdited"; key: string; value: number | null }
  /** 분석이 성공적으로 끝나 그룹 실측 중앙값(suggested)을 얻었다 — 지금 이 실행의
   *  프레임(frame)과 현재 state의 프레임이 일치할 때만 기존 값을 유지한 채 위에
   *  덮어쓰고, 아니면 suggested만으로 새로 시작한다. */
  | { type: "analyzed"; frame: FrameSource; suggested: Record<string, number> };

export const INITIAL_REQUIRED_SPACING_STATE: RequiredSpacingState = {
  frame: "design",
  map: {},
};

/**
 * 정합 방식(RegistrationResult.method 또는 그 없음)으로부터 그 결과가 어느 프레임에서
 * 나왔는지 되돌린다. method:"none"만 scan 프레임이고 나머지(auto/manual/null)는 전부
 * design 프레임이다 — 저장된 결과가 없을 때(null)도 "알 수 없다"가 아니라 기본값인
 * design으로 확정한다.
 */
export function frameOfMethod(method: SavedMethod): FrameSource {
  return method === "none" ? "scan" : "design";
}

/** 0 이하·유한하지 않은 값은 "지정 안 함"이므로 걸러낸다 — 저장된 0/음수/NaN이 그대로
 *  들어오면 computeSpacing의 `requiredMm[key] ?? med`가 0을 유효값으로 통과시켜 그
 *  그룹이 최상위 색으로 포화된다. */
function cleanMap(map: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(map).filter(
      ([, v]) => typeof v === "number" && Number.isFinite(v) && v > 0,
    ),
  );
}

export function requiredSpacingReducer(
  s: RequiredSpacingState,
  e: RequiredSpacingEvent,
): RequiredSpacingState {
  switch (e.type) {
    case "userToggledFrame":
      return { frame: e.frame, map: {} };
    case "loadedResult":
      return { frame: frameOfMethod(e.method), map: cleanMap(e.map) };
    case "userEdited": {
      if (e.value == null) {
        if (!(e.key in s.map)) return s; // 이미 없으면 새 객체를 만들 필요 없다
        const next = { ...s.map };
        delete next[e.key];
        return { ...s, map: next };
      }
      return { ...s, map: { ...s.map, [e.key]: e.value } };
    }
    case "analyzed": {
      const usable = usableRequiredSpacing(s, e.frame);
      return { frame: e.frame, map: { ...e.suggested, ...usable } };
    }
  }
}

/**
 * state의 map을 frame(지금 분석을 돌릴/돌린 프레임)에서 써도 되는지 판정한다 —
 * state.frame과 frame이 같을 때만 그대로 돌려주고, 다르면 빈 맵을 돌려준다.
 */
export function usableRequiredSpacing(
  s: RequiredSpacingState,
  frame: FrameSource,
): Record<string, number> {
  return s.frame === frame ? s.map : {};
}
