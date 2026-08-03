import { describe, expect, it } from "vitest";
import { classifyRebars, estimateWallNormal } from "./classify";
import { deriveDirectionFamilies } from "./direction";
import { judge } from "./judge";
import { assignLabels } from "./label";
import { matchRebars } from "./match";
import { makeWallGrid } from "./testFixtures";
import type { ClassifiedRebar } from "./types";

const UP: [number, number, number] = [0, 1, 0];
const grid = makeWallGrid();
const fams = deriveDirectionFamilies(grid, UP);
const classify = (r = grid) => classifyRebars(r, UP, estimateWallNormal(r), fams);

describe("assignLabels", () => {
  const d = classify();
  const s = classify(makeWallGrid().filter((r) => r.id !== "d-v-outer-3"));
  const { rebars } = judge(d, s, matchRebars(d, s), 10);
  const labeled = assignLabels(rebars, d, s, fams);

  it("labels every record uniquely in 방향-레이어-번호 form", () => {
    const labels = labeled.map((r) => r.label);
    expect(labels.every((l) => /^(세로|가로)-(내|외)측-\d+$/.test(l ?? ""))).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("numbers vertical bars by X position ascending", () => {
    const vOuter = labeled.filter((r) => r.directionLabel === "세로" && r.layer === "outer");
    // 세로-외측 그룹: 픽스처의 x = 0..1.8 순서와 라벨 번호가 일치해야 한다
    const first = vOuter.find((r) => r.label === "세로-외측-1")!;
    expect(first.designId).toBe("d-v-outer-0");
    const fourth = vOuter.find((r) => r.label === "세로-외측-4")!;
    expect(fourth.designId).toBe("d-v-outer-3"); // 미시공 철근도 위치순 번호를 받는다
    expect(fourth.verdict).toBe("missing");
  });

  it("returns records sorted by group then number (groups stay contiguous)", () => {
    // 정렬 키가 방향군 id 사전순으로 바뀌어 "세로가 항상 먼저"는 더 이상 보장되지 않는다
    // (방향군 개수가 2개로 고정되지 않으므로) — 대신 같은 그룹의 레코드가 끊기지 않고
    // 뭉쳐 있어야 한다는 불변식만 확인한다.
    const keys = labeled.map((r) => `${r.direction}/${r.layer}`);
    const seenGroups = new Set<string>();
    let prevKey: string | null = null;
    for (const k of keys) {
      if (k !== prevKey) {
        expect(seenGroups.has(k)).toBe(false); // 이전에 끝난 그룹이 다시 나타나면 뭉쳐 있지 않은 것
        seenGroups.add(k);
        prevKey = k;
      }
    }
  });

  it("rejudge-style spread preserves labels", () => {
    const copy = labeled.map((r) => ({ ...r }));
    expect(copy.every((r, i) => r.label === labeled[i].label)).toBe(true);
  });
});
