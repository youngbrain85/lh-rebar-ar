// 분석 파이프라인 진입점 — spec §5. useAnalysis 훅(메인스레드)이 이 함수만 호출한다.
import { classifyRebars, estimateWallNormal } from "./classify";
import { deriveDirectionFamilies } from "./direction";
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
  // 방향군은 설계모델에서만 뽑는다 — 스캔은 노이즈가 있어 자체 군집이 어긋날 수 있으므로
  // 설계 기준 군에 맞춰 배정한다. Task 5에서 파이프라인 출력에 정식으로 배선한다.
  const families = deriveDirectionFamilies(input.design, input.up);
  const designClassified = classifyRebars(input.design, input.up, wallNormal, families);
  const scanTransformed = classifyRebars(transformed, input.up, wallNormal, families);
  const match = matchRebars(designClassified, scanTransformed);
  const { rebars, summary } = judge(designClassified, scanTransformed, match, input.toleranceMm);
  return { registration, rebars, summary, designClassified, scanTransformed };
}
