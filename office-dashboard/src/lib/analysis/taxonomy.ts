// 철근 계층 해석 — spec §5.2 · §6.2 · §8.
// 순수 TS. three.js / DOM / Next / @mantine import 금지.
//
// 계층의 출처는 세 가지이고 신뢰도 순으로 내려간다:
//   1. sidecar   BriconLab이 준 계층 JSON (도면 기반)
//   2. primName  prim 이름을 코드북으로 해석 (추정)
//   3. geometry  방향군 × 레이어 (부위 구분 아님)
// 어느 단계인지는 Taxonomy.source가 들고 있고, UI는 sidecar가 아닐 때
// 반드시 배지를 띄워야 한다 — 안 그러면 기하 분류가 도면 분류인 척한다.

import type { RebarRecord } from "./types";

export interface RebarNode {
  /** 트리 경로 (잎 제외). 깊이는 부위마다 다르다 — 전벽 3단, 헌치 1단 */
  path: string[];
  /** 표시명 — 사이드카 label 또는 §4.2 조립 규칙 */
  label: string;
  no: number | null;
  /** 이 잎에 매달린 Rebar.id 목록. R6(1 prim = 1 가닥) 위반 시 2개 이상 */
  ids: string[];
}

export interface Taxonomy {
  /** 트리 루트 표시명 */
  root: string;
  /** Rebar.id → 노드 */
  byId: Map<string, RebarNode>;
  /** 조인 안 된 Rebar.id — 도면 외(designId=null) + 조인 실패 */
  unmatched: string[];
  /** 사이드카에는 있는데 대응 Rebar가 없는 prim — 경고용 */
  unmatchedPrims: string[];
  source: "sidecar" | "primName" | "geometry";
}

/** UI 비의존 트리 노드. Mantine 변환은 컴포넌트에서 한다 */
export interface TaxonomyTreeNode {
  /** 내부 노드 = path.join("/"), 잎 = 정규화된 prim 경로. 체크 상태의 신원 */
  value: string;
  label: string;
  /** 이 서브트리에 매달린 Rebar.id 총수 */
  count: number;
  /** 이 서브트리에 매달린 Rebar.id 전체 — 체크 → 표시집합 변환에 쓴다 */
  ids: string[];
  children?: TaxonomyTreeNode[];
}

/** 사이드카의 최소 형태 — 전체 스키마는 rebarMetaSchema.ts */
export interface SidecarLike {
  structure: string;
  rebars: { prim: string; label?: string; path: string[]; no?: number }[];
}

/** 조인 안 된 철근이 모이는 고정 노드의 value — UI가 이 값으로 알아본다 */
export const UNCLASSIFIED_VALUE = "__unclassified__";

/**
 * 정규화 과정에서 제거하는 세그먼트.
 * - `modelEntity` / `placementRoot`: iOS가 배치할 때 씌우는 wrapper (ModelAnchorController)
 * - `Meshes`: USD Scope 컨테이너. 같은 모델이 2단으로도 3단으로도 나오게 만든다
 */
const WRAPPER_SEGMENTS = new Set(["modelEntity", "placementRoot", "Meshes"]);

/**
 * prim 경로를 조인 키로 정규화한다. 대소문자·공백은 **바꾸지 않는다**(USD는 구분).
 *
 * 같은 철근이 사이드카·대시보드·iOS 세 곳에서 서로 다른 문자열로 나타나기 때문에
 * 필요하다. 어긋나면 조인율이 0%가 되는데 증상은 "트리가 비었다" 하나뿐이다.
 */
export function normalizePrimPath(s: string): string {
  const segs = s
    .split("/")
    .filter((seg) => seg !== "" && !WRAPPER_SEGMENTS.has(seg));
  return "/" + segs.join("/");
}

/** `경로#3` → `경로`. 한 prim이 여러 가닥으로 쪼개진 경우의 꼬리를 뗀다 */
function stripComponentIndex(id: string): string {
  const hash = id.lastIndexOf("#");
  return hash < 0 ? id : id.slice(0, hash);
}

const zeroPad2 = (n: number) => String(n).padStart(2, "0");

/** §4.2 결정론적 조립 규칙. 사이드카 label이 있으면 그쪽이 이긴다 */
export function composeLabel(path: string[], no: number | null): string {
  return no == null ? path.join("-") : [...path, zeroPad2(no)].join("-");
}

// ---------------------------------------------------------------- 1. sidecar

export function taxonomyFromSidecar(meta: SidecarLike, ids: string[]): Taxonomy {
  const byPrim = new Map<string, { label?: string; path: string[]; no?: number }>();
  for (const r of meta.rebars) byPrim.set(normalizePrimPath(r.prim), r);

  const byId = new Map<string, RebarNode>();
  const unmatched: string[] = [];
  const usedPrims = new Set<string>();
  // 같은 prim에서 갈라진 가닥들은 잎 하나를 공유한다 (R6 위반 시의 정의된 동작)
  const nodeByPrim = new Map<string, RebarNode>();

  for (const id of ids) {
    const key = normalizePrimPath(stripComponentIndex(id));
    const hit = byPrim.get(key);
    if (!hit) {
      unmatched.push(id);
      continue;
    }
    usedPrims.add(key);
    let node = nodeByPrim.get(key);
    if (!node) {
      const no = hit.no ?? null;
      node = { path: hit.path, label: hit.label ?? composeLabel(hit.path, no), no, ids: [] };
      nodeByPrim.set(key, node);
    }
    node.ids.push(id);
    byId.set(id, node);
  }

  const unmatchedPrims = [...byPrim.keys()].filter((p) => !usedPrims.has(p));
  return { root: meta.structure, byId, unmatched, unmatchedPrims, source: "sidecar" };
}

// -------------------------------------------------------------- 2. primName

/** §8.1 코드북. 신규 규약 토큰 + 약어 확장 */
const CODEBOOK: Record<string, string> = {
  Stem: "전벽철근", Base: "저판철근", Haunch: "헌치철근",
  Front: "전면", Rear: "배면",
  Top: "상부", Bot: "하부",
  Vert: "수직철근", Horiz: "수평철근",
  Trans: "횡방향", Long: "종방향",
  V: "수직철근", H: "수평철근",
};

/**
 * as-built 생성기 전용 레거시 어댑터.
 * 현재 BriconLab의 as-built 모델은 `TopV_01` — 토큰 하나에 두 축이 붙어 있다.
 *
 * ★ 부위 어휘(상부/하부·수직철근)를 쓰지 않고 기하 어휘(상단/하단·세로/가로)로
 * 편다. `상부 > 수직철근`은 저판의 면 어휘와 전벽의 방향 어휘를 섞는 것이라,
 * 부위 정보가 전혀 없는 이 모델에 붙이면 도면 기반 분류인 척하게 된다.
 */
const LEGACY_TOPBOT = /^(Top|Bot)(V|H)$/;
const LEGACY_WORDS: Record<string, string> = {
  Top: "상단", Bot: "하단", V: "세로", H: "가로",
};

/** 이름 하나를 경로로 해석. 해석 불가면 null */
function parsePrimName(leaf: string): { path: string[]; no: number | null } | null {
  const tokens = leaf.split("_").filter((t) => t !== "");
  if (tokens.length === 0) return null;

  let no: number | null = null;
  if (/^\d+$/.test(tokens[tokens.length - 1])) {
    no = Number(tokens.pop());
  }
  if (tokens.length === 0) return null;

  const path: string[] = [];
  for (const t of tokens) {
    const legacy = LEGACY_TOPBOT.exec(t);
    if (legacy) {
      path.push(LEGACY_WORDS[legacy[1]], LEGACY_WORDS[legacy[2]]);
      continue;
    }
    const mapped = CODEBOOK[t];
    if (!mapped) return null;
    path.push(mapped);
  }
  return { path, no };
}

/** 코드북 해석률이 이 비율 미만이면 2단계를 채택하지 않는다 */
export const PRIM_NAME_MIN_RATIO = 0.6;

/**
 * prim 이름에서 계층을 유도한다. 해석률이 임계 미만이면 null —
 * 호출부가 기하 분류로 폴백한다.
 */
export function taxonomyFromPrimNames(ids: string[]): Taxonomy | null {
  if (ids.length === 0) return null;

  const byId = new Map<string, RebarNode>();
  const unmatched: string[] = [];
  const nodeByPrim = new Map<string, RebarNode>();

  for (const id of ids) {
    const key = normalizePrimPath(stripComponentIndex(id));
    const leaf = key.slice(key.lastIndexOf("/") + 1);
    const parsed = parsePrimName(leaf);
    if (!parsed) {
      unmatched.push(id);
      continue;
    }
    const shared = nodeByPrim.get(key);
    if (shared) {
      shared.ids.push(id);
      byId.set(id, shared);
      continue;
    }
    const node: RebarNode = {
      path: parsed.path,
      label: composeLabel(parsed.path, parsed.no),
      no: parsed.no,
      ids: [id],
    };
    nodeByPrim.set(key, node);
    byId.set(id, node);
  }

  if (byId.size / ids.length < PRIM_NAME_MIN_RATIO) return null;
  return { root: "구조물", byId, unmatched, unmatchedPrims: [], source: "primName" };
}

// ------------------------------------------------------------- 3. geometry

const LAYER_KO = { inner: "내측", outer: "외측" } as const;

/**
 * 방향군 × 레이어 2단 트리. **부위 어휘를 일절 쓰지 않는다** —
 * 이건 도면이 아니라 형상에서 나온 분류다.
 */
export function taxonomyFromGeometry(records: RebarRecord[]): Taxonomy {
  const byId = new Map<string, RebarNode>();
  const unmatched: string[] = [];
  const counters = new Map<string, number>();

  for (const rec of records) {
    const id = rec.designId;
    if (id == null) {
      if (rec.scanId != null) unmatched.push(rec.scanId);
      continue;
    }
    const dir = rec.directionLabel ?? rec.direction;
    const path = [dir, LAYER_KO[rec.layer]];
    const key = path.join("/");
    const no = (counters.get(key) ?? 0) + 1;
    counters.set(key, no);
    byId.set(id, { path, label: rec.label ?? composeLabel(path, no), no, ids: [id] });
  }

  return { root: "자동 분류", byId, unmatched, unmatchedPrims: [], source: "geometry" };
}

// ----------------------------------------------------------------- 트리 조립

/**
 * Taxonomy → 중첩 트리. 잎은 prim당 하나이고 `ids`에 갈라진 가닥을 전부 담는다.
 * `unmatched`가 있으면 루트 아래 「분류 없음 (N)」을 **마지막에** 붙인다 —
 * 도면 외(designId=null)는 계층 노드를 가질 수 없어서, 이 노드가 없으면
 * 어떤 필터를 켜든 「도면 외」가 0건이 되고 화면이 조용히 거짓말을 한다.
 */
export function buildTree(t: Taxonomy): TaxonomyTreeNode[] {
  interface Draft {
    value: string;
    label: string;
    ids: string[];
    children: Map<string, Draft>;
  }
  const rootChildren = new Map<string, Draft>();

  const seenNodes = new Set<RebarNode>();
  for (const node of t.byId.values()) {
    if (seenNodes.has(node)) continue;
    seenNodes.add(node);

    let level = rootChildren;
    const segs: string[] = [];
    for (const seg of node.path) {
      segs.push(seg);
      const value = segs.join("/");
      let draft = level.get(value);
      if (!draft) {
        draft = { value, label: seg, ids: [], children: new Map() };
        level.set(value, draft);
      }
      draft.ids.push(...node.ids);
      level = draft.children;
    }
    // 잎 — value는 정규화된 prim 경로(가닥 인덱스 제외)라 트리 안에서 유일하다
    const leafValue = normalizePrimPath(stripComponentIndex(node.ids[0]));
    if (!level.has(leafValue)) {
      level.set(leafValue, { value: leafValue, label: node.label, ids: [...node.ids], children: new Map() });
    }
  }

  const toNode = (d: Draft): TaxonomyTreeNode => {
    const children = [...d.children.values()].map(toNode);
    return {
      value: d.value,
      label: d.label,
      ids: d.ids,
      count: d.ids.length,
      ...(children.length > 0 ? { children } : {}),
    };
  };

  const out = [...rootChildren.values()].map(toNode);

  if (t.unmatched.length > 0) {
    out.push({
      value: UNCLASSIFIED_VALUE,
      label: `분류 없음 (${t.unmatched.length})`,
      ids: [...t.unmatched],
      count: t.unmatched.length,
    });
  }
  return out;
}

/** 트리의 모든 노드 value — 초기 "전부 체크" 상태를 만들 때 쓴다 */
export function allValues(nodes: TaxonomyTreeNode[]): string[] {
  const out: string[] = [];
  const walk = (ns: TaxonomyTreeNode[]) => {
    for (const n of ns) {
      out.push(n.value);
      if (n.children) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/**
 * 체크된 노드 value 집합 → 보여야 할 Rebar.id 집합.
 * 부모가 체크되면 자손도 체크되지만(checkStrictly:false), 어느 쪽이 들어와도
 * 같은 결과가 나오도록 체크된 노드의 ids를 전부 합집합한다.
 */
export function visibleIdsFromChecked(
  nodes: TaxonomyTreeNode[],
  checked: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  const walk = (ns: TaxonomyTreeNode[]) => {
    for (const n of ns) {
      if (checked.has(n.value)) for (const id of n.ids) out.add(id);
      if (n.children) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/** 트리 잎(자식 없는 노드) 수 — 성능 가드용 */
export function leafCount(nodes: TaxonomyTreeNode[]): number {
  let n = 0;
  const walk = (ns: TaxonomyTreeNode[]) => {
    for (const x of ns) {
      if (x.children && x.children.length > 0) walk(x.children);
      else n += 1;
    }
  };
  walk(nodes);
  return n;
}

/** 배지 문구 — 대시보드와 iOS가 같은 문자열을 써야 한다 */
export const SOURCE_NOTICE: Record<Taxonomy["source"], string | null> = {
  sidecar: null,
  primName: "모델 이름 규칙으로 추정 — 도면 확인 필요",
  geometry: "형상 자동 분류 — 부위 구분 아님",
};
