// office-dashboard/src/components/analysis/useAnalysis.ts
"use client";

// Worker 기반 분석 실행 훅. Worker 불가 환경은 메인스레드 폴백.
import { useCallback, useRef, useState } from "react";
import type { AnalysisInput, AnalysisOutput } from "../../lib/analysis/pipeline";

export function useAnalysis() {
  const [stage, setStage] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const run = useCallback(async (input: AnalysisInput): Promise<AnalysisOutput> => {
    setStage("register");
    try {
      const worker =
        workerRef.current ??
        new Worker(new URL("../../lib/analysis/worker.ts", import.meta.url));
      workerRef.current = worker;
      return await new Promise<AnalysisOutput>((resolve, reject) => {
        worker.onmessage = (e) => {
          if (e.data.type === "progress") setStage(e.data.stage);
          else if (e.data.type === "done") {
            setStage(null);
            resolve(e.data.output);
          } else if (e.data.type === "error") {
            setStage(null);
            reject(new Error(e.data.message));
          }
        };
        worker.onerror = (e) => {
          setStage(null);
          reject(new Error(e.message || "worker error"));
        };
        worker.postMessage(input);
      });
    } catch {
      // Worker 생성/번들 실패 폴백: 메인스레드 실행
      const { runAnalysis } = await import("../../lib/analysis/pipeline");
      const out = runAnalysis(input);
      setStage(null);
      return out;
    }
  }, []);

  return { run, stage };
}
