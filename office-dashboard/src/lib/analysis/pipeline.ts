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
 * 저장된 `requiredSpacingMm`을 지금 모드에 그대로 들여도 되는지 판단한다.
 *
 * `spacingGroupKey`(`${directionId}/${layer}`)의 directionId(`v1`/`h1`/…)는
 * `deriveDirectionFamilies`가 프레임(design 대 scan, 또는 설계가 벽이냐 슬래브냐)마다
 * 다시 배정하는 값이다 — 물리적으로 같은 그룹도 프레임이 다르면 다른 키를 받는다(아래
 * "그룹 키는 프레임에 종속적이다" 테스트가 실측으로 고정해 둔 사실). 그래서 저장 당시의
 * 방식(savedMethod)과 지금 모드가 다르면, 저장된 requiredSpacingMm의 키가 지금 화면의
 * 다른 그룹을 가리킬 수 있다 — 들이면 그룹이 뒤바뀐 채로 편차가 계산돼 조작된 값
 * (실측: +100mm급)이 나온다. `AnalysisView.tsx`가 저장된 결과를 로드할 때 이 함수로
 * 걸러낸다.
 */
export function requiredSpacingMatchesMode(
  savedMethod: "auto" | "manual" | "none" | null,
  isNoDesignMode: boolean,
): boolean {
  return (savedMethod === "none") === isNoDesignMode;
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
