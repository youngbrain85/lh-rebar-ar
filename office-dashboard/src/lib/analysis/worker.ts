// office-dashboard/src/lib/analysis/worker.ts
// 분석 Web Worker — UI 프리즈 방지 (spec §3). 메시지 프로토콜은 useAnalysis.ts와 계약.
import { classifyRebars, estimateWallNormal } from "./classify";
import { applyMat4 } from "./geom";
import { judge } from "./judge";
import { matchRebars } from "./match";
import type { AnalysisInput, AnalysisOutput } from "./pipeline";
import { registerScan } from "./registration";
import type { Rebar } from "./types";

// runAnalysis를 단계별 progress 보고와 함께 인라인 전개
self.onmessage = (e: MessageEvent<AnalysisInput>) => {
  try {
    const input = e.data;
    self.postMessage({ type: "progress", stage: "register" });
    const registration = registerScan(input.scan, input.design, input.manualInit);
    const transformed: Rebar[] = input.scan.map((r) => ({
      ...r,
      centerline: r.centerline.map((p) => applyMat4(registration.matrix, p)),
    }));
    self.postMessage({ type: "progress", stage: "classify" });
    const wallNormal = estimateWallNormal(input.design);
    const designClassified = classifyRebars(input.design, input.up, wallNormal);
    const scanTransformed = classifyRebars(transformed, input.up, wallNormal);
    self.postMessage({ type: "progress", stage: "match" });
    const match = matchRebars(designClassified, scanTransformed);
    self.postMessage({ type: "progress", stage: "judge" });
    const { rebars, summary } = judge(designClassified, scanTransformed, match, input.toleranceMm);
    const output: AnalysisOutput = { registration, rebars, summary, designClassified, scanTransformed };
    self.postMessage({ type: "done", output });
  } catch (err) {
    self.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
