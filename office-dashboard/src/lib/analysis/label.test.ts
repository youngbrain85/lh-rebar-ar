import { describe, expect, it } from "vitest";
import { classifyRebars, estimateWallNormal } from "./classify";
import { deriveDirectionFamilies } from "./direction";
import { judge } from "./judge";
import { assignLabels } from "./label";
import { matchRebars } from "./match";
import { makeDiagonalFamilyGrid, makeWallGrid } from "./testFixtures";
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

// 방향군이 세로/가로 둘로 고정돼 있지 않다는 것 자체를 검증하는 엔진 레벨 통합 테스트.
// classify → match → judge → label을 전부 거쳐야 byGroup·라벨이 실제로 3군을 반영하는지
// 확인할 수 있다 — 개별 모듈 단위 테스트만으로는 "하드코딩된 2군 루프를 그대로 둬도
// 통과하는" 회귀를 못 잡는다.
describe("direction families beyond vertical/horizontal", () => {
  it("byGroup and labels cover every derived family, not just horizontal/vertical", () => {
    const grid = makeDiagonalFamilyGrid();
    const f = deriveDirectionFamilies(grid, UP);
    const d = classifyRebars(grid, UP, estimateWallNormal(grid), f);
    const s = classifyRebars(grid, UP, estimateWallNormal(grid), f);
    const { rebars, summary } = judge(d, s, matchRebars(d, s), 10);

    expect(summary.byGroup.length).toBe(6); // 세로/가로/사재 3방향군 × 외측/내측 2레이어

    const diagFam = f.find((fam) => fam.label.startsWith("사재"))!;
    const vFam = f.find((fam) => fam.label === "세로")!;
    const hFam = f.find((fam) => fam.label === "가로")!;
    expect(diagFam.id).not.toBe(vFam.id);
    expect(diagFam.id).not.toBe(hFam.id);

    const diagGroups = summary.byGroup.filter((g) => g.direction === diagFam.id);
    expect(diagGroups.length).toBe(2); // 외측 + 내측
    expect(diagGroups.every((g) => g.directionLabel.startsWith("사재"))).toBe(true);

    const labeled = assignLabels(rebars, d, s, f);
    const diagLabeled = labeled.filter((r) => r.direction === diagFam.id);
    expect(diagLabeled.length).toBeGreaterThan(0);
    expect(diagLabeled.every((r) => /^사재.*-(내|외)측-\d+$/.test(r.label ?? ""))).toBe(true);
  });

  it("numbers a 45° diagonal group deterministically regardless of input bar order", () => {
    // barAxis가 정확히 45°인 사재군은 옛 구현(세계축 x/y 중 하나를 고정으로 고르는 분기)에서
    // 부동소수 노이즈로 정렬 방향이 뒤집힐 수 있었다 — 입력 순서를 바꿔도 라벨 순서가
    // 그대로인지로 그 회귀를 잡는다.
    const labelSequence = (grid: ReturnType<typeof makeDiagonalFamilyGrid>) => {
      const f = deriveDirectionFamilies(grid, UP);
      const d = classifyRebars(grid, UP, estimateWallNormal(grid), f);
      const s = classifyRebars(grid, UP, estimateWallNormal(grid), f);
      const { rebars } = judge(d, s, matchRebars(d, s), 10);
      const labeled = assignLabels(rebars, d, s, f);
      return labeled.filter((r) => r.directionLabel?.startsWith("사재")).map((r) => r.label);
    };

    const forward = makeDiagonalFamilyGrid();
    const reversed = [...forward].reverse();

    const seqForward = labelSequence(forward);
    const seqReversed = labelSequence(reversed);
    expect(seqForward.length).toBeGreaterThan(0);
    expect(seqReversed).toEqual(seqForward);
  });
});
