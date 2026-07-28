// office-dashboard/src/components/analysis/useAnalysis.ts
"use client";

// 분석 실행 훅 — 메인스레드에서 실행한다.
// 실측 분석 시간이 실데이터 규모에서 100ms 미만이라 Web Worker를 쓰지 않는다
// (Next 16.2.7 Turbopack이 worker 번들을 지원하지 않는 것도 확인됨 — task-15-report 참조).
import { useCallback, useState } from "react";
import type { AnalysisInput, AnalysisOutput } from "../../lib/analysis/pipeline";

export function useAnalysis() {
  const [stage, setStage] = useState<string | null>(null);

  const run = useCallback(async (input: AnalysisInput): Promise<AnalysisOutput> => {
    setStage("register");
    // 스피너가 그려질 수 있게 한 프레임 양보
    await new Promise((r) => setTimeout(r, 0));
    try {
      const { runAnalysis } = await import("../../lib/analysis/pipeline");
      return runAnalysis(input);
    } finally {
      setStage(null);
    }
  }, []);

  return { run, stage };
}
