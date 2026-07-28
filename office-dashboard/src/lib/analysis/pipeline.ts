// 분석 파이프라인 진입점 — spec §5. useAnalysis 훅(메인스레드)이 이 함수만 호출한다.
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
