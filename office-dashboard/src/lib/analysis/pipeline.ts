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
