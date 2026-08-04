import { describe, expect, it } from "vitest";
import { classifyRebars, estimateWallNormal } from "./classify";
import { deriveDirectionFamilies } from "./direction";
import { makeWallGrid } from "./testFixtures";

const UP: [number, number, number] = [0, 1, 0];
const fams = (r = makeWallGrid()) => deriveDirectionFamilies(r, UP);

describe("estimateWallNormal", () => {
  it("finds Z for an XY-plane wall grid", () => {
    const n = estimateWallNormal(makeWallGrid());
    expect(Math.abs(n[2])).toBeGreaterThan(0.99);
  });
});

describe("classifyRebars", () => {
  it("classifies direction and layer for the full grid", () => {
    const g = makeWallGrid();
    const f = deriveDirectionFamilies(g, UP);
    const c = classifyRebars(g, UP, estimateWallNormal(g), f);
    const byId = new Map(f.map((x) => [x.id, x.label]));
    const v = c.find((r) => r.id === "d-v-outer-0")!;
    expect(byId.get(v.direction)).toBe("세로");
    expect(v.layer).toBe("outer");
    const hInner = c.find((r) => r.id === "d-h-inner-2")!;
    expect(byId.get(hInner.direction)).toBe("가로");
    expect(hInner.layer).toBe("inner");
  });
  it("single-layer grid → everything outer", () => {
    const g = makeWallGrid().filter((r) => r.id.includes("-outer-"));
    const c = classifyRebars(g, UP, estimateWallNormal(makeWallGrid()), fams());
    expect(c.every((r) => r.layer === "outer")).toBe(true);
  });
});
