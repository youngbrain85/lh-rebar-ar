import { describe, expect, it } from "vitest";
import { classifyRebars, estimateWallNormal } from "./classify";
import { groupCutoffM, matchRebars } from "./match";
import { jitterRebars, makeWallGrid, offsetRebar } from "./testFixtures";
import type { ClassifiedRebar } from "./types";

const UP: [number, number, number] = [0, 1, 0];

function classified(rebars = makeWallGrid()): ClassifiedRebar[] {
  return classifyRebars(rebars, UP, estimateWallNormal(rebars));
}

describe("groupCutoffM", () => {
  it("vertical-outer cutoff = spacing/2 = 0.15m", () => {
    const d = classified();
    const idx = d.map((r, i) => (r.direction === "vertical" && r.layer === "outer" ? i : -1)).filter((i) => i >= 0);
    expect(groupCutoffM(d, idx)).toBeCloseTo(0.15, 3);
  });
  it("fewer than 2 design bars → 0.1m fallback", () => {
    const d = classified();
    expect(groupCutoffM(d, [0])).toBe(0.1);
  });
});

describe("matchRebars", () => {
  it("identical sets → all matched, no missing/extra", () => {
    const d = classified();
    const s = classified(jitterRebars(makeWallGrid(), 0.002, 11));
    const m = matchRebars(d, s);
    expect(m.pairs.length).toBe(24);
    expect(m.missingDesign).toEqual([]);
    expect(m.extraScan).toEqual([]);
  });
  it("removed scan bar → exactly that design bar missing", () => {
    const d = classified();
    const scanRebars = makeWallGrid().filter((r) => r.id !== "d-v-outer-3");
    const s = classified(scanRebars);
    const m = matchRebars(d, s);
    expect(m.missingDesign.length).toBe(1);
    expect(d[m.missingDesign[0]].id).toBe("d-v-outer-3");
    expect(m.extraScan).toEqual([]);
  });
  it("extra scan bar → reported as extra", () => {
    const d = classified();
    const extra = makeWallGrid();
    extra.push({ id: "ghost", radius: 0.008, centerline: [[0.95, 0, 0], [0.95, 1, 0], [0.95, 2, 0]] });
    const s = classified(extra);
    const m = matchRebars(d, s);
    expect(m.extraScan.length).toBe(1);
    expect(s[m.extraScan[0]].id).toBe("ghost");
  });
  it("15mm-offset bar still matches (within 150mm cutoff) with meanMm≈15", () => {
    const d = classified();
    const s = classified(offsetRebar(makeWallGrid(), "d-v-outer-2", [0.015, 0, 0]));
    const m = matchRebars(d, s);
    const pair = m.pairs.find((p) => d[p.designIdx].id === "d-v-outer-2")!;
    expect(pair.meanMm).toBeGreaterThan(10);
    expect(pair.meanMm).toBeLessThan(20);
  });
  it("does not match across groups (vertical bar never pairs with horizontal)", () => {
    const d = classified();
    const s = classified();
    for (const p of matchRebars(d, s).pairs) {
      expect(d[p.designIdx].direction).toBe(s[p.scanIdx].direction);
      expect(d[p.designIdx].layer).toBe(s[p.scanIdx].layer);
    }
  });
});
