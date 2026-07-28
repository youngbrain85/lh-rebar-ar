import { describe, expect, it } from "vitest";
import type { AnalysisResult, Rebar } from "./types";

describe("analysis types", () => {
  it("Rebar shape compiles and holds data", () => {
    const r: Rebar = { id: "r0", centerline: [[0, 0, 0], [0, 1, 0]], radius: 0.008 };
    expect(r.centerline.length).toBe(2);
  });

  it("AnalysisResult version literal is 1", () => {
    const v: AnalysisResult["version"] = 1;
    expect(v).toBe(1);
  });
});
