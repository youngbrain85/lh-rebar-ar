import { describe, expect, it } from "vitest";
import { classifyRebars, estimateWallNormal } from "./classify";
import { judge } from "./judge";
import { assignLabels } from "./label";
import { matchRebars } from "./match";
import { makeWallGrid } from "./testFixtures";
import type { ClassifiedRebar } from "./types";

const UP: [number, number, number] = [0, 1, 0];
const classify = (r = makeWallGrid()) => classifyRebars(r, UP, estimateWallNormal(r));

describe("assignLabels", () => {
  const d = classify();
  const s = classify(makeWallGrid().filter((r) => r.id !== "d-v-outer-3"));
  const { rebars } = judge(d, s, matchRebars(d, s), 10);
  const labeled = assignLabels(rebars, d, s);

  it("labels every record uniquely in 방향-레이어-번호 form", () => {
    const labels = labeled.map((r) => r.label);
    expect(labels.every((l) => /^수(직|평)-(내|외)측-\d+$/.test(l ?? ""))).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("numbers vertical bars by X position ascending", () => {
    const vOuter = labeled.filter((r) => r.direction === "vertical" && r.layer === "outer");
    // 수직-외측 그룹: 픽스처의 x = 0..1.8 순서와 라벨 번호가 일치해야 한다
    const first = vOuter.find((r) => r.label === "수직-외측-1")!;
    expect(first.designId).toBe("d-v-outer-0");
    const fourth = vOuter.find((r) => r.label === "수직-외측-4")!;
    expect(fourth.designId).toBe("d-v-outer-3"); // 미시공 철근도 위치순 번호를 받는다
    expect(fourth.verdict).toBe("missing");
  });

  it("returns records sorted by group then number", () => {
    const keys = labeled.map((r) => `${r.direction}/${r.layer}`);
    const firstHorizontal = keys.indexOf("horizontal/outer");
    expect(keys.slice(0, firstHorizontal).every((k) => k.startsWith("vertical"))).toBe(true);
  });

  it("rejudge-style spread preserves labels", () => {
    const copy = labeled.map((r) => ({ ...r }));
    expect(copy.every((r, i) => r.label === labeled[i].label)).toBe(true);
  });
});
