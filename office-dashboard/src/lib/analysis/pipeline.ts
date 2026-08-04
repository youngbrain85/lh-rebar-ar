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

/** summary가 전부 0/null인 빈 요약 — frameSource:"scan"에서 매칭·판정을 지어내지 않기 위한 값 */
const EMPTY_SUMMARY: AnalysisSummary = {
  designCount: 0, scanCount: 0, matched: 0, missing: 0, extra: 0,
  outOfTolerance: 0, deviationMm: null, byGroup: [],
};

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
    summary: EMPTY_SUMMARY,
    designClassified: [],
    scanTransformed,
    families,
    wallNormal,
    spacing,
    plane,
  };
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
