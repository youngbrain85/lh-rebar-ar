import { describe, expect, it } from "vitest";
import { classifyRebars, estimateWallNormal } from "./classify";
import { makeWallGrid } from "./testFixtures";

const UP: [number, number, number] = [0, 1, 0];

describe("estimateWallNormal", () => {
  it("finds Z for an XY-plane wall grid", () => {
    const n = estimateWallNormal(makeWallGrid());
    expect(Math.abs(n[2])).toBeGreaterThan(0.99);
  });
});

describe("classifyRebars", () => {
  it("classifies direction and layer for the full grid", () => {
    const g = makeWallGrid();
    const c = classifyRebars(g, UP, estimateWallNormal(g));
    const v = c.find((r) => r.id === "d-v-outer-0")!;
    expect(v.direction).toBe("vertical");
    expect(v.layer).toBe("outer");
    const hInner = c.find((r) => r.id === "d-h-inner-2")!;
    expect(hInner.direction).toBe("horizontal");
    expect(hInner.layer).toBe("inner");
  });
  it("single-layer grid → everything outer", () => {
    const g = makeWallGrid().filter((r) => r.id.includes("-outer-"));
    const c = classifyRebars(g, UP, estimateWallNormal(makeWallGrid()));
    expect(c.every((r) => r.layer === "outer")).toBe(true);
  });
});
