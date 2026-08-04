// 분석 파이프라인 진입점 — spec §5. useAnalysis 훅(메인스레드)이 이 함수만 호출한다.
import { classifyRebars, estimateWallNormal } from "./classify";
import { fitWallPlane, type WallPlane } from "./contour";
import { deriveDirectionFamilies } from "./direction";
import { applyMat4, mat4Identity } from "./geom";
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
  /**
   * 분석 프레임(벽면 법선·방향군)을 어디서 뽑을지. 기본 "design".
   * "scan"이면 설계모델을 아예 읽지 않는다 — 발주처 현장의 설계모델이 built-in이 아니거나
   * (전 현장이 그렇다), 아예 다른 구조물(바닥판 등)이라 프레임을 오염시킬 때 쓴다.
   */
  frameSource?: "design" | "scan";
}

export interface AnalysisOutput {
  registration: { matrix: Mat4; rmsMm: number; method: "auto" | "manual" | "none"; failed: boolean };
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

/**
 * summary가 전부 0/null인 빈 요약 — frameSource:"scan"에서 매칭·판정을 지어내지 않기 위한 값.
 * ★ 반드시 호출마다 새로 만들 것. 모듈 상수 하나를 공유해서 반환하면 그 안의 `byGroup`
 * 배열까지 여러 결과가 같은 참조를 공유하게 되어, 한쪽 결과를 다루는 코드가(예: 향후
 * byGroup에 항목을 얹는 식으로) 제자리에서 건드리면 무관한 다른 분석 결과까지 조용히
 * 오염된다 — AnalysisView.tsx가 이미 반환된 output 객체를 그대로 변경하는 관례
 * (`out.rebars = …`)가 있는 코드베이스라 이 위험이 이론적인 얘기가 아니다.
 */
function emptySummary(): AnalysisSummary {
  return {
    designCount: 0, scanCount: 0, matched: 0, missing: 0, extra: 0,
    outOfTolerance: 0, deviationMm: null, byGroup: [],
  };
}

/**
 * frameSource:"scan" — 스캔 자신의 형상에서 벽면 법선·방향군을 뽑고, 설계모델은 절대
 * 읽지 않는다. 정합도 하지 않는다: design이 원래 없거나(발주처 현장 전부) 다른 구조물이면
 * (site 1의 바닥판) design 기준 정합·분류·매칭이 전부 무의미해지기 때문이다.
 * 간격 측정 자체는 강체변환에 불변이므로, "정합을 생략"하는 것만으로는 안 되고
 * 프레임(법선·방향군)의 원천을 design → scan으로 바꿔야 실제로 문제가 고쳐진다.
 */
function runScanFrameAnalysis(input: AnalysisInput): AnalysisOutput {
  const registration = { matrix: mat4Identity(), rmsMm: 0, method: "none" as const, failed: false };
  const wallNormal = estimateWallNormal(input.scan);
  const families = deriveDirectionFamilies(input.scan, input.up);
  const scanTransformed = classifyRebars(input.scan, input.up, wallNormal, families);
  const spacing = computeSpacing(scanTransformed, families, wallNormal, input.requiredSpacingMm ?? {});
  const plane = fitWallPlane(scanTransformed, wallNormal, input.up);
  return {
    registration,
    rebars: [],
    summary: emptySummary(),
    designClassified: [],
    scanTransformed,
    families,
    wallNormal,
    spacing,
    plane,
  };
}

/**
 * 정합 방식(RegistrationResult.method)으로부터 그 결과가 어느 프레임에서 나왔는지
 * 되돌린다. `spacingGroupKey`(`${directionId}/${layer}`)의 directionId(`v1`/`h1`/…)는
 * `deriveDirectionFamilies`가 프레임(design 대 scan)마다 다시 배정하는 값이라(아래
 * "그룹 키는 프레임에 종속적이다" 테스트가 실측으로 고정해 둔 사실), 저장된
 * `requiredSpacingMm`을 다시 쓰려면 반드시 그 값이 나온 프레임을 알아야 한다.
 *
 * ★ "지금 모드"를 별도로 추정해서(예: 컴포넌트 마운트 시점의 체크박스 잔상) 저장된
 * 값과 비교하는 방식은 쓰지 않는다 — 그 잔상은 이전 스캔에서 넘어온 값일 수 있고,
 * 동기화가 반영되는 타이밍에 따라 결론이 달라진다(리뷰 지적: 이 비교 방식 자체가
 * "정상적으로 동기화될 예정인 경우에만" 거부하는 역설을 낳았다). 저장된 결과 자신이
 * 선언하는 method만이 유일하게 신뢰할 수 있는 근거이므로, 호출부(AnalysisView.tsx)는
 * 로드한 requiredSpacingMm을 항상 이 함수가 돌려주는 프레임과 "짝지어" state에 들고
 * 있다가, 실제로 분석을 돌리는 시점의 프레임과 그 짝이 맞을 때만 사용한다.
 */
export function frameOfMethod(
  method: "auto" | "manual" | "none" | null,
): "design" | "scan" {
  return method === "none" ? "scan" : "design";
}

/**
 * requiredSpacingMm 맵을 지금 프레임에서 써도 되는지 판정한다 — 맵이 만들어진 프레임
 * (mapFrame, `frameOfMethod`로 구한다)과 지금 분석을 돌릴 프레임(currentFrame)이 같을
 * 때만 그대로 돌려주고, 다르면 빈 맵으로 시작한다. `AnalysisView.tsx`의 `analyze()`가
 * `run()`에 넘길 값과, 분석 성공 후 `suggestRequiredSpacing`과 합칠 기준값 양쪽에
 * 이 함수를 쓴다 — 두 곳이 서로 다른 판정을 하면(예: 하나는 마운트 시점 잔상과 비교)
 * "값은 버려졌는데 저장은 그 값 기준으로 됐다" 같은 불일치가 생긴다.
 */
export function usableRequiredSpacing(
  map: Record<string, number>,
  mapFrame: "design" | "scan",
  currentFrame: "design" | "scan",
): Record<string, number> {
  return mapFrame === currentFrame ? map : {};
}

export function runAnalysis(input: AnalysisInput): AnalysisOutput {
  if (input.frameSource === "scan") return runScanFrameAnalysis(input);

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
