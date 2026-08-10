import { describe, expect, it } from "vitest";
import {
  allValues, buildTree, composeLabel, leafCount, normalizePrimPath, PRIM_NAME_MIN_RATIO,
  rowPath, SOURCE_NOTICE, taxonomyFromClassified, taxonomyFromGeometry, taxonomyFromPrimNames,
  taxonomyFromSidecar, UNCLASSIFIED_VALUE, visibleIdsFromChecked, WALL_TAXONOMY,
  type SidecarLike, type TaxonomyTreeNode,
} from "./taxonomy";
import type { ClassifiedRebar, RebarRecord } from "./types";

/** 트리에서 value로 노드를 찾는다 */
function find(nodes: TaxonomyTreeNode[], value: string): TaxonomyTreeNode | null {
  for (const n of nodes) {
    if (n.value === value) return n;
    const hit = n.children ? find(n.children, value) : null;
    if (hit) return hit;
  }
  return null;
}

describe("normalizePrimPath", () => {
  it("절대/중복슬래시/wrapper 3형태가 같은 키로 정규화된다", () => {
    const want = "/RebarModel/Wall_Front_Vert_01";
    expect(normalizePrimPath("/RebarModel/Wall_Front_Vert_01")).toBe(want);
    expect(normalizePrimPath("RebarModel//Wall_Front_Vert_01")).toBe(want);
    expect(normalizePrimPath("/modelEntity/RebarModel/Wall_Front_Vert_01")).toBe(want);
    expect(normalizePrimPath("/RebarModel/Meshes/Wall_Front_Vert_01")).toBe(want);
    expect(normalizePrimPath("/placementRoot/modelEntity/RebarModel/Meshes/Wall_Front_Vert_01"))
      .toBe(want);
  });

  it("대소문자와 공백은 바꾸지 않는다 — USD는 대소문자를 구분한다", () => {
    expect(normalizePrimPath("/Root/Bar A")).toBe("/Root/Bar A");
    expect(normalizePrimPath("/root/bar")).not.toBe("/Root/Bar");
  });
});

describe("composeLabel", () => {
  it("§4.2 규칙 — 경로 + 2자리 0패딩 번호", () => {
    expect(composeLabel(["벽체", "전면", "수직철근"], 1)).toBe("벽체-전면-수직철근-01");
    expect(composeLabel(["벽체-저판", "보강철근(헌치철근)"], 7))
      .toBe("벽체-저판-보강철근(헌치철근)-07");
    expect(composeLabel(["벽체-저판", "보강철근(헌치철근)"], null))
      .toBe("벽체-저판-보강철근(헌치철근)");
  });
});

describe("taxonomyFromSidecar", () => {
  // 사이드카의 path 는 **데이터**다 — 엔진은 어휘를 해석하지 않고 그대로 쓴다.
  // 픽스처는 발주처 분류표(§4.1)의 실제 어휘로 둔다.
  const meta: SidecarLike = {
    structure: "옹벽",
    rebars: [
      { prim: "/RebarModel/Wall_Front_Vert_01", label: "벽체-전면-수직철근-01",
        path: ["벽체", "전면", "수직철근"], no: 1 },
      { prim: "/RebarModel/Wall_Front_Vert_02", label: "벽체-전면-수직철근-02",
        path: ["벽체", "전면", "수직철근"], no: 2 },
      { prim: "/RebarModel/WallBase_Haunch_01", label: "벽체-저판-보강철근(헌치철근)-01",
        path: ["벽체-저판", "보강철근(헌치철근)"], no: 1 },
      // label 생략 — §4.2 규칙으로 조립돼야 한다
      { prim: "/RebarModel/Base_Upper_Trans_01",
        path: ["저판", "상부", "횡방향철근(주철근)"], no: 1 },
    ],
  };

  it("깊이가 부위마다 달라도 트리가 만들어진다", () => {
    const t = taxonomyFromSidecar(meta, [
      "/RebarModel/Wall_Front_Vert_01",
      "/RebarModel/WallBase_Haunch_01",
      "/RebarModel/Base_Upper_Trans_01",
    ]);
    expect(t.source).toBe("sidecar");
    expect(t.root).toBe("옹벽");
    const tree = buildTree(t);
    // 벽체·저판은 3단, 벽체-저판은 면이 없어 2단
    expect(find(tree, "벽체/전면/수직철근")).not.toBeNull();
    expect(find(tree, "벽체-저판")).not.toBeNull();
    expect(find(tree, "벽체-저판/보강철근(헌치철근)")).not.toBeNull();
    expect(find(tree, "저판/상부/횡방향철근(주철근)")).not.toBeNull();
  });

  it("label 이 없으면 §4.2 규칙으로 조립한다", () => {
    const t = taxonomyFromSidecar(meta, ["/RebarModel/Base_Upper_Trans_01"]);
    expect(t.byId.get("/RebarModel/Base_Upper_Trans_01")!.label)
      .toBe("저판-상부-횡방향철근(주철근)-01");
  });

  it("wrapper 가 낀 id 도 조인된다", () => {
    const t = taxonomyFromSidecar(meta, ["/modelEntity/RebarModel/Meshes/WallBase_Haunch_01"]);
    expect(t.unmatched).toEqual([]);
    expect(t.byId.get("/modelEntity/RebarModel/Meshes/WallBase_Haunch_01")!.label)
      .toBe("벽체-저판-보강철근(헌치철근)-01");
  });

  it("조인 안 된 id 는 unmatched 로 간다", () => {
    const t = taxonomyFromSidecar(meta, ["/RebarModel/WallBase_Haunch_01", "/RebarModel/Unknown_09"]);
    expect(t.unmatched).toEqual(["/RebarModel/Unknown_09"]);
    expect(t.byId.has("/RebarModel/Unknown_09")).toBe(false);
  });

  it("사이드카에만 있는 prim 은 unmatchedPrims 로 간다", () => {
    const t = taxonomyFromSidecar(meta, ["/RebarModel/WallBase_Haunch_01"]);
    expect(t.unmatchedPrims.sort()).toEqual([
      "/RebarModel/Base_Upper_Trans_01",
      "/RebarModel/Wall_Front_Vert_01",
      "/RebarModel/Wall_Front_Vert_02",
    ]);
  });

  it("한 prim 에 가닥이 여럿이면 잎 1개에 ids 2개 (R6 위반 시 동작)", () => {
    const t = taxonomyFromSidecar(meta, [
      "/RebarModel/WallBase_Haunch_01#0",
      "/RebarModel/WallBase_Haunch_01#1",
    ]);
    const node = t.byId.get("/RebarModel/WallBase_Haunch_01#0")!;
    expect(node.ids).toEqual([
      "/RebarModel/WallBase_Haunch_01#0", "/RebarModel/WallBase_Haunch_01#1",
    ]);
    expect(t.byId.get("/RebarModel/WallBase_Haunch_01#1")).toBe(node); // 같은 객체를 공유
    const tree = buildTree(t);
    expect(find(tree, "벽체-저판")!.count).toBe(2);
    expect(find(tree, "벽체-저판")!.children).toHaveLength(1); // 잎은 하나
  });

  it("unmatched 가 있으면 「분류 없음」 노드가 마지막에 붙는다", () => {
    const t = taxonomyFromSidecar(meta, ["/RebarModel/WallBase_Haunch_01", "/scan/extra-1"]);
    const tree = buildTree(t);
    const last = tree[tree.length - 1];
    expect(last.value).toBe(UNCLASSIFIED_VALUE);
    expect(last.label).toBe("분류 없음 (1)");
    expect(last.ids).toEqual(["/scan/extra-1"]);
  });

  it("unmatched 가 없으면 「분류 없음」 노드도 없다", () => {
    const t = taxonomyFromSidecar(meta, ["/RebarModel/WallBase_Haunch_01"]);
    expect(find(buildTree(t), UNCLASSIFIED_VALUE)).toBeNull();
  });

  it("상위 노드의 count 는 자손 ids 합계다", () => {
    const t = taxonomyFromSidecar(meta, [
      "/RebarModel/Wall_Front_Vert_01",
      "/RebarModel/Wall_Front_Vert_02",
    ]);
    const tree = buildTree(t);
    expect(find(tree, "벽체")!.count).toBe(2);
    expect(find(tree, "벽체/전면/수직철근")!.count).toBe(2);
  });
});

describe("taxonomyFromPrimNames", () => {
  it("분류표 토큰을 표의 정식 명칭으로 편다", () => {
    const t = taxonomyFromPrimNames([
      "/RebarModel/Wall_Front_Vert_01",
      "/RebarModel/Wall_Rear_Vert_01",
      "/RebarModel/Base_Upper_Trans_01",
      "/RebarModel/WallBase_Haunch_01",
    ])!;
    expect(t.source).toBe("primName");
    expect(t.root).toBe("구조물");
    expect(t.byId.get("/RebarModel/Wall_Front_Vert_01")!.path)
      .toEqual(["벽체", "전면", "수직철근"]);
    // ★ 같은 "수직철근"이라도 배면은 (주철근)이 붙는다 — 토큰별 사전으로는 못 낸다
    expect(t.byId.get("/RebarModel/Wall_Rear_Vert_01")!.path)
      .toEqual(["벽체", "배면", "수직철근(주철근)"]);
    expect(t.byId.get("/RebarModel/Base_Upper_Trans_01")!.path)
      .toEqual(["저판", "상부", "횡방향철근(주철근)"]);
    // 헌치는 독립 부재가 아니라 벽체-저판 경계의 보강철근이고, 면이 없어 2단계다
    expect(t.byId.get("/RebarModel/WallBase_Haunch_01")!.path)
      .toEqual(["벽체-저판", "보강철근(헌치철근)"]);
    expect(t.byId.get("/RebarModel/WallBase_Haunch_01")!.label)
      .toBe("벽체-저판-보강철근(헌치철근)-01");
  });

  it("분류표 12행이 전부 해석된다", () => {
    const ids = WALL_TAXONOMY.map((r, i) => `/RebarModel/${r.token}_${String(i + 1).padStart(2, "0")}`);
    const t = taxonomyFromPrimNames(ids)!;
    expect(t).not.toBeNull();
    expect(t.byId.size).toBe(WALL_TAXONOMY.length);
    expect(t.unmatched).toEqual([]);
    for (const [i, r] of WALL_TAXONOMY.entries()) {
      expect(t.byId.get(ids[i])!.path).toEqual(rowPath(r));
    }
  });

  it("분류표 토큰은 전부 USD 식별자 규칙을 만족한다", () => {
    // 하이픈·한글이 섞이면 Blender 익스포터가 조용히 _ 로 치환해 이름이 뭉개진다
    for (const r of WALL_TAXONOMY) {
      expect(r.token).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
    }
    expect(new Set(WALL_TAXONOMY.map((r) => r.token)).size).toBe(WALL_TAXONOMY.length);
  });

  it("면이 없는 행은 2단계, 있는 행은 3단계", () => {
    for (const r of WALL_TAXONOMY) {
      expect(rowPath(r).length).toBe(r.face == null ? 2 : 3);
    }
  });

  it("TopV_01 은 레거시 어댑터로 '상단 > 세로' 가 된다 — 부위 어휘를 쓰지 않는다", () => {
    const ids = [
      ...Array.from({ length: 20 }, (_, i) => `/RebarModel/TopV_${String(i + 1).padStart(2, "0")}`),
      ...Array.from({ length: 10 }, (_, i) => `/RebarModel/TopH_${String(i + 1).padStart(2, "0")}`),
      ...Array.from({ length: 20 }, (_, i) => `/RebarModel/BotV_${String(i + 1).padStart(2, "0")}`),
      ...Array.from({ length: 10 }, (_, i) => `/RebarModel/BotH_${String(i + 1).padStart(2, "0")}`),
    ];
    const t = taxonomyFromPrimNames(ids)!;
    expect(t.byId.size).toBe(60);
    expect(t.byId.get("/RebarModel/TopV_01")!.path).toEqual(["상단", "세로"]);
    expect(t.byId.get("/RebarModel/TopV_01")!.label).toBe("상단-세로-01");
    // 부위 어휘가 새어나오지 않는다
    const allSegs = [...t.byId.values()].flatMap((n) => n.path);
    // 분류표(§4.1)의 어휘가 새어나오면 안 된다 — as-built 모델에는 부위 정보가 없다
    for (const forbidden of ["벽체", "저판", "벽체-저판", "전면", "배면", "상부", "하부", "수직철근"]) {
      expect(allSegs).not.toContain(forbidden);
    }
    const tree = buildTree(t);
    expect(tree.map((n) => n.value).sort()).toEqual(["상단", "하단"]);
    expect(find(tree, "상단")!.count).toBe(30);
  });

  it("코드북 해석률이 임계 미만이면 null 을 돌려준다", () => {
    // 5개 중 2개만 해석 가능 → 0.4 < 0.6
    const t = taxonomyFromPrimNames([
      "/R/Haunch_01", "/R/Haunch_02",
      "/R/Wall_A", "/R/Wall_B", "/R/Wall_C",
    ]);
    expect(t).toBeNull();
  });

  it("임계 이상이면 채택하고 해석 실패분은 unmatched 로 간다", () => {
    // 5개 중 4개 해석 가능 → 0.8 ≥ 0.6
    const t = taxonomyFromPrimNames([
      "/R/Haunch_01", "/R/Haunch_02", "/R/Haunch_03", "/R/Haunch_04", "/R/Wall_A",
    ])!;
    expect(t).not.toBeNull();
    expect(t.unmatched).toEqual(["/R/Wall_A"]);
    expect(find(buildTree(t), UNCLASSIFIED_VALUE)!.count).toBe(1);
  });

  it("빈 목록은 null", () => {
    expect(taxonomyFromPrimNames([])).toBeNull();
  });

  it("임계값은 0.6 이다", () => {
    expect(PRIM_NAME_MIN_RATIO).toBe(0.6);
  });
});

describe("taxonomyFromGeometry", () => {
  const rec = (o: Partial<RebarRecord>): RebarRecord => ({
    designId: "d1", scanId: "s1", direction: "v1", directionLabel: "세로",
    layer: "outer", deviationMm: { mean: 3, max: 5 }, verdict: "pass", ...o,
  });

  it("방향군 × 레이어 2단 — 부위 어휘를 쓰지 않는다", () => {
    const t = taxonomyFromGeometry([
      rec({ designId: "/d/1" }),
      rec({ designId: "/d/2", layer: "inner" }),
      rec({ designId: "/d/3", direction: "h1", directionLabel: "가로" }),
    ]);
    expect(t.source).toBe("geometry");
    expect(t.root).toBe("자동 분류");
    expect(t.byId.get("/d/1")!.path).toEqual(["세로", "외측"]);
    expect(t.byId.get("/d/2")!.path).toEqual(["세로", "내측"]);
    expect(t.byId.get("/d/3")!.path).toEqual(["가로", "외측"]);
  });

  it("도면 외(designId=null)는 unmatched 로 간다", () => {
    const t = taxonomyFromGeometry([
      rec({ designId: "/d/1" }),
      rec({ designId: null, scanId: "/s/9", verdict: "extra" }),
    ]);
    expect(t.unmatched).toEqual(["/s/9"]);
    expect(find(buildTree(t), UNCLASSIFIED_VALUE)!.ids).toEqual(["/s/9"]);
  });
});

describe("taxonomyFromClassified (frameSource:\"scan\")", () => {
  const bar = (id: string, dir: string, layer: "outer" | "inner"): ClassifiedRebar => ({
    id, centerline: [[0, 0, 0], [0, 1, 0]], radius: 0.01,
    direction: dir === "세로" ? "v1" : "h1", directionLabel: dir, layer,
  });

  it("스캔 철근 자신의 id 로 2단 트리를 만든다", () => {
    const t = taxonomyFromClassified([
      bar("s1", "세로", "outer"), bar("s2", "세로", "outer"), bar("s3", "가로", "inner"),
    ]);
    expect(t.source).toBe("geometry");
    expect(t.root).toBe("자동 분류");
    expect(t.byId.get("s1")!.path).toEqual(["세로", "외측"]);
    expect(t.byId.get("s1")!.label).toBe("세로-외측-01");
    expect(t.byId.get("s2")!.label).toBe("세로-외측-02");
    expect(t.byId.get("s3")!.path).toEqual(["가로", "내측"]);
    const tree = buildTree(t);
    expect(find(tree, "세로")!.count).toBe(2);
    expect(find(tree, "가로/내측")!.count).toBe(1);
  });

  it("트리 잎의 id 가 스캔 id 그대로다 — 뷰어 키와 맞아야 한다", () => {
    const t = taxonomyFromClassified([bar("scan-42", "세로", "outer")]);
    const visible = visibleIdsFromChecked(buildTree(t), new Set(allValues(buildTree(t))));
    expect([...visible]).toEqual(["scan-42"]);
  });
});

describe("visibleIdsFromChecked · allValues · leafCount", () => {
  const meta: SidecarLike = {
    structure: "옹벽",
    rebars: [
      { prim: "/R/Wall_Front_Vert_01", path: ["벽체", "전면", "수직철근"], no: 1 },
      { prim: "/R/Wall_Front_Vert_02", path: ["벽체", "전면", "수직철근"], no: 2 },
      { prim: "/R/WallBase_Haunch_01", path: ["벽체-저판", "보강철근(헌치철근)"], no: 1 },
    ],
  };
  const ids = ["/R/Wall_Front_Vert_01", "/R/Wall_Front_Vert_02", "/R/WallBase_Haunch_01"];
  const tree = buildTree(taxonomyFromSidecar(meta, ids));

  it("전부 체크하면 전부 보인다", () => {
    const visible = visibleIdsFromChecked(tree, new Set(allValues(tree)));
    expect([...visible].sort()).toEqual([...ids].sort());
  });

  it("상위 노드만 체크해도 자손 id 가 전부 나온다", () => {
    const visible = visibleIdsFromChecked(tree, new Set(["벽체"]));
    expect([...visible].sort()).toEqual([
      "/R/Wall_Front_Vert_01", "/R/Wall_Front_Vert_02",
    ]);
  });

  it("잎만 체크해도 그 id 가 나온다", () => {
    const visible = visibleIdsFromChecked(tree, new Set(["/R/WallBase_Haunch_01"]));
    expect([...visible]).toEqual(["/R/WallBase_Haunch_01"]);
  });

  it("아무것도 체크하지 않으면 빈 집합", () => {
    expect(visibleIdsFromChecked(tree, new Set()).size).toBe(0);
  });

  it("leafCount 는 잎 개수를 센다", () => {
    expect(leafCount(tree)).toBe(3);
  });
});

describe("SOURCE_NOTICE", () => {
  it("sidecar 만 배지가 없다", () => {
    expect(SOURCE_NOTICE.sidecar).toBeNull();
    expect(SOURCE_NOTICE.primName).toBe("모델 이름 규칙으로 추정 — 도면 확인 필요");
    expect(SOURCE_NOTICE.geometry).toBe("형상 자동 분류 — 부위 구분 아님");
  });
});
