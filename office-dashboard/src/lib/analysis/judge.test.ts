import { describe, expect, it } from "vitest";
import { classifyRebars, estimateWallNormal } from "./classify";
import { deriveDirectionFamilies } from "./direction";
import { judge, rejudgeRecords } from "./judge";
import { matchRebars } from "./match";
import { makeWallGrid, offsetRebar } from "./testFixtures";

const UP: [number, number, number] = [0, 1, 0];
const fams = deriveDirectionFamilies(makeWallGrid(), UP);
const classify = (r = makeWallGrid()) => classifyRebars(r, UP, estimateWallNormal(r), fams);

describe("judge", () => {
  it("clean scan → all pass, summary counts correct", () => {
    const d = classify();
    const s = classify();
    const { rebars, summary } = judge(d, s, matchRebars(d, s), 10);
    expect(rebars.filter((r) => r.verdict === "pass").length).toBe(24);
    expect(summary).toMatchObject({ designCount: 24, scanCount: 24, matched: 24, missing: 0, extra: 0, outOfTolerance: 0 });
    expect(summary.byGroup.length).toBe(4); // 2방향 × 2레이어
  });
  it("15mm offset bar → out_of_tolerance at 10mm, pass at 20mm", () => {
    const d = classify();
    const s = classify(offsetRebar(makeWallGrid(), "d-v-outer-2", [0.015, 0, 0]));
    const m = matchRebars(d, s);
    const at10 = judge(d, s, m, 10);
    expect(at10.summary.outOfTolerance).toBe(1);
    const bad = at10.rebars.find((r) => r.verdict === "out_of_tolerance")!;
    expect(bad.designId).toBe("d-v-outer-2");
    expect(bad.deviationMm!.mean).toBeGreaterThan(10);
    // 재판정만으로 통과로 바뀜
    const at20 = rejudgeRecords(at10.rebars, 20);
    expect(at20.summary.outOfTolerance).toBe(0);
  });
  it("missing design bar → verdict missing with scanId null", () => {
    const d = classify();
    const s = classify(makeWallGrid().filter((r) => r.id !== "d-h-inner-1"));
    const { rebars, summary } = judge(d, s, matchRebars(d, s), 10);
    expect(summary.missing).toBe(1);
    const miss = rebars.find((r) => r.verdict === "missing")!;
    expect(miss.designId).toBe("d-h-inner-1");
    expect(miss.scanId).toBeNull();
    expect(miss.deviationMm).toBeNull();
  });
  it("summary deviation aggregates over matched only", () => {
    const d = classify();
    const s = classify();
    const { summary } = judge(d, s, matchRebars(d, s), 10);
    expect(summary.deviationMm!.mean).toBeLessThan(1);
    expect(summary.deviationMm!.max).toBeLessThan(1);
  });
});
