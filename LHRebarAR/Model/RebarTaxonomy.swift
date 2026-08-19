// LHRebarAR/Model/RebarTaxonomy.swift
import Foundation

/// 철근 계층 분류 — 대시보드 `office-dashboard/src/lib/analysis/taxonomy.ts`의 Swift 포트.
///
/// ★ 두 구현이 갈라지면 두 앱이 같은 철근에 다른 이름표를 붙인다. 케이스 표는
///   `RebarTaxonomyTests`가 TS 테스트와 동일한 입력·기대값으로 잡아 둔다.
enum RebarTaxonomy {

    // MARK: - 경로 정규화

    /// 정규화 과정에서 제거하는 세그먼트.
    /// - `modelEntity` / `placementRoot`: 배치할 때 씌우는 wrapper (ModelAnchorController)
    /// - `Meshes`: USD Scope 컨테이너. 같은 모델이 2단으로도 3단으로도 나오게 만든다
    static let wrapperSegments: Set<String> = ["modelEntity", "placementRoot", "Meshes"]

    /// prim 경로를 조인 키로 정규화한다. 대소문자·공백은 **바꾸지 않는다**(USD는 구분).
    ///
    /// 같은 철근이 사이드카(`/RebarModel/X`), 대시보드(모델에 따라 2단 또는 3단),
    /// 앱(배치 wrapper가 낀 경로) 세 곳에서 서로 다른 문자열로 나타나기 때문에 필요하다.
    /// 어긋나면 조인율이 0%가 되는데 증상은 "트리가 비었다" 하나뿐이라 원인을 못 찾는다.
    static func normalizePrimPath(_ s: String) -> String {
        let segs = s.split(separator: "/", omittingEmptySubsequences: true)
            .map(String.init)
            .filter { !wrapperSegments.contains($0) }
        return "/" + segs.joined(separator: "/")
    }

    /// `경로#3` → `경로`. 한 prim이 여러 가닥으로 쪼개진 경우의 꼬리를 뗀다.
    static func stripComponentIndex(_ id: String) -> String {
        guard let hash = id.lastIndex(of: "#") else { return id }
        return String(id[id.startIndex..<hash])
    }

    // MARK: - 라벨

    /// §4.2 결정론적 조립 규칙. 사이드카 label이 있으면 그쪽이 이긴다.
    static func composeLabel(path: [String], no: Int?) -> String {
        guard let no else { return path.joined(separator: "-") }
        return (path + [String(format: "%02d", no)]).joined(separator: "-")
    }

    // MARK: - 코드북 (사이드카가 없을 때)

    /// 옹벽 철근 분류표 — **발주처 제공 (2026-08-08)**.
    /// 원본 `docs/wall-rebar-classification.png`, TS 원본 `taxonomy.ts`의 WALL_TAXONOMY.
    ///
    /// ★ 괄호 안 역할명이 면마다 다르다(벽체 전면 `수직철근` vs 배면 `수직철근(주철근)`).
    ///   그래서 토큰별 사전으로는 정식 명칭을 복원할 수 없고 조합을 통째로 갖고 있어야 한다.
    /// ★ 헌치는 독립 부재가 아니라 `벽체-저판` 경계의 보강철근이며 면이 없어 2단계다.
    struct WallRow {
        let token: String
        let member: String
        let face: String?
        let fn: String
        let optional: Bool

        /// 트리 경로. 면이 없는 행은 2단계다.
        var path: [String] { face == nil ? [member, fn] : [member, face!, fn] }
    }

    static let wallTaxonomy: [WallRow] = [
        .init(token: "Wall_Front_Vert",       member: "벽체", face: "전면",      fn: "수직철근",             optional: false),
        .init(token: "Wall_Front_Horiz",      member: "벽체", face: "전면",      fn: "수평철근(배력철근)",   optional: false),
        .init(token: "Wall_Rear_Vert",        member: "벽체", face: "배면",      fn: "수직철근(주철근)",     optional: false),
        .init(token: "Wall_Rear_Horiz",       member: "벽체", face: "배면",      fn: "수평철근(배력철근)",   optional: false),
        .init(token: "Wall_FrontRear_Shear",  member: "벽체", face: "전면-배면", fn: "간격재(전단철근)",     optional: true),
        .init(token: "Wall_Top_Reinf",        member: "벽체", face: "상단",      fn: "보강철근",             optional: true),
        .init(token: "Base_Upper_Trans",      member: "저판", face: "상부",      fn: "횡방향철근(주철근)",   optional: false),
        .init(token: "Base_Upper_Long",       member: "저판", face: "상부",      fn: "종방향철근(배력철근)", optional: false),
        .init(token: "Base_Lower_Trans",      member: "저판", face: "하부",      fn: "횡방향철근",           optional: false),
        .init(token: "Base_Lower_Long",       member: "저판", face: "하부",      fn: "종방향철근(배력철근)", optional: false),
        .init(token: "Base_UpperLower_Shear", member: "저판", face: "상부-하부", fn: "간격재(전단철근)",     optional: true),
        .init(token: "WallBase_Haunch",       member: "벽체-저판", face: nil,    fn: "보강철근(헌치철근)",   optional: true),
    ]

    static let rowByToken: [String: WallRow] = {
        var m: [String: WallRow] = [:]
        for r in wallTaxonomy { m[r.token] = r }
        return m
    }()

    /// 토큰 → 분류표 행 인덱스. 트리 형제 순서를 표 순서로 고정하는 데 쓴다.
    static let rowIndexByToken: [String: Int] = {
        var m: [String: Int] = [:]
        for (i, r) in wallTaxonomy.enumerated() { m[r.token] = i }
        return m
    }()

    /// 표에 없는 이름을 만났을 때의 느슨한 폴백 — 괄호 안 역할명은 복원하지 못한다.
    static let looseTokens: [String: String] = [
        "Wall": "벽체", "Base": "저판", "WallBase": "벽체-저판",
        "Front": "전면", "Rear": "배면", "FrontRear": "전면-배면", "Top": "상단",
        "Upper": "상부", "Lower": "하부", "UpperLower": "상부-하부",
        "Vert": "수직철근", "Horiz": "수평철근",
        "Trans": "횡방향철근", "Long": "종방향철근",
        "Shear": "간격재", "Reinf": "보강철근", "Haunch": "헌치철근",
        "V": "수직철근", "H": "수평철근",
    ]

    /// as-built 생성기 전용 레거시 어댑터 (`TopV_01` — 토큰 하나에 두 축).
    ///
    /// ★ 부위 어휘(상부/하부·수직철근)를 쓰지 않고 기하 어휘로 편다. `상부 > 수직철근`은
    ///   저판의 면 어휘와 전벽의 방향 어휘를 섞는 것이라, 부위 정보가 전혀 없는 이
    ///   모델에 붙이면 도면 기반 분류인 척하게 된다.
    private static let legacyWords: [String: String] = [
        "Top": "상단", "Bot": "하단", "V": "세로", "H": "가로",
    ]

    /// 코드북 해석률이 이 비율 미만이면 이름 기반 분류를 채택하지 않는다.
    static let primNameMinRatio = 0.6

    struct Parsed: Equatable {
        var path: [String]
        var no: Int?
        /// 분류표 행에 정확히 맞은 경우 그 토큰. 느슨한 폴백으로 만든 경로면 nil.
        var token: String?
    }

    /// 이름 하나를 경로로 해석. 해석 불가면 nil.
    static func parsePrimName(_ leaf: String) -> Parsed? {
        var tokens = leaf.split(separator: "_", omittingEmptySubsequences: true).map(String.init)
        guard !tokens.isEmpty else { return nil }

        var no: Int?
        if let last = tokens.last, last.allSatisfy(\.isNumber), let n = Int(last) {
            no = n
            tokens.removeLast()
        }
        guard !tokens.isEmpty else { return nil }

        // ★ 분류표 조회가 우선. 괄호 안 역할명은 조합을 봐야 나온다.
        let joined = tokens.joined(separator: "_")
        if let row = rowByToken[joined] {
            return Parsed(path: row.path, no: no, token: joined)
        }

        var path: [String] = []
        for t in tokens {
            if t.count == 4,
               let head = legacyWords[String(t.prefix(3))],
               let tail = legacyWords[String(t.suffix(1))],
               ["Top", "Bot"].contains(String(t.prefix(3))),
               ["V", "H"].contains(String(t.suffix(1))) {
                path.append(head)
                path.append(tail)
                continue
            }
            guard let mapped = looseTokens[t] else { return nil }
            path.append(mapped)
        }
        return Parsed(path: path, no: no, token: nil)
    }

    // MARK: - 노드 · 트리

    struct Node: Equatable {
        var path: [String]
        var label: String
        var no: Int?
        /// 발주처 분류표에서의 행 인덱스. 표 밖 노드는 `Int.max`.
        /// **정렬 전용이다** — Dictionary 순회 순서가 실행마다 달라지는 것을 막는다.
        var order: Int
        /// 이 잎에 매달린 엔티티 경로 목록. 1 prim = 1 가닥 규약을 어기면 2개 이상.
        var paths: [String]
    }

    enum Source: String {
        case sidecar, primName, geometry

        /// 배지 문구 — 대시보드와 **같은 문자열**을 써야 한다.
        var notice: String? {
            switch self {
            case .sidecar: return nil
            case .primName: return "모델 이름 규칙으로 추정 — 도면 확인 필요"
            case .geometry: return "형상 자동 분류 — 부위 구분 아님"
            }
        }
    }

    struct Taxonomy {
        var root: String
        /// 정규화된 엔티티 경로 → 노드
        var byPath: [String: Node]
        /// 조인 안 된 엔티티 경로
        var unmatched: [String]
        var source: Source
    }

    /// 사이드카 계층 정보로 분류한다.
    static func fromSidecar(_ meta: RebarMetaFile, entityPaths: [String]) -> Taxonomy {
        var byPrim: [String: RebarMetaFile.Entry] = [:]
        for r in meta.rebars { byPrim[normalizePrimPath(r.prim)] = r }

        var byPath: [String: Node] = [:]
        var unmatched: [String] = []
        var nodeByPrim: [String: Node] = [:]

        for p in entityPaths {
            let key = normalizePrimPath(stripComponentIndex(p))
            guard let hit = byPrim[key] else {
                unmatched.append(p)
                continue
            }
            var node = nodeByPrim[key] ?? Node(
                path: hit.path,
                label: hit.label ?? composeLabel(path: hit.path, no: hit.no),
                no: hit.no,
                order: wallTaxonomy.firstIndex { $0.path == hit.path } ?? Int.max,
                paths: []
            )
            node.paths.append(p)
            nodeByPrim[key] = node
        }
        // 같은 prim을 공유하는 경로들이 같은 노드(=같은 paths 배열)를 보게 맞춘다
        for (_, node) in nodeByPrim {
            for p in node.paths { byPath[p] = node }
        }
        return Taxonomy(root: meta.structure, byPath: byPath, unmatched: unmatched, source: .sidecar)
    }

    /// prim 이름에서 계층을 유도한다. 해석률이 임계 미만이면 nil.
    static func fromPrimNames(entityPaths: [String]) -> Taxonomy? {
        guard !entityPaths.isEmpty else { return nil }

        var byPath: [String: Node] = [:]
        var unmatched: [String] = []
        var nodeByPrim: [String: Node] = [:]

        for p in entityPaths {
            let key = normalizePrimPath(stripComponentIndex(p))
            let leaf = String(key.split(separator: "/").last ?? "")
            guard let parsed = parsePrimName(leaf) else {
                unmatched.append(p)
                continue
            }
            var node = nodeByPrim[key] ?? Node(
                path: parsed.path,
                label: composeLabel(path: parsed.path, no: parsed.no),
                no: parsed.no,
                order: parsed.token.flatMap { rowIndexByToken[$0] } ?? Int.max,
                paths: []
            )
            node.paths.append(p)
            nodeByPrim[key] = node
        }
        for (_, node) in nodeByPrim {
            for p in node.paths { byPath[p] = node }
        }

        let ratio = Double(byPath.count) / Double(entityPaths.count)
        guard ratio >= primNameMinRatio else { return nil }
        return Taxonomy(root: "구조물", byPath: byPath, unmatched: unmatched, source: .primName)
    }

    // MARK: - 트리 조립

    final class TreeNode {
        let value: String
        let label: String
        /// 이 서브트리에 매달린 엔티티 경로 전체
        private(set) var paths: [String] = []
        private(set) var children: [TreeNode] = []
        private var childIndex: [String: TreeNode] = [:]

        init(value: String, label: String) {
            self.value = value
            self.label = label
        }

        var count: Int { paths.count }

        func child(value: String, label: String) -> TreeNode {
            if let existing = childIndex[value] { return existing }
            let node = TreeNode(value: value, label: label)
            childIndex[value] = node
            children.append(node)
            return node
        }

        func add(paths newPaths: [String]) { paths.append(contentsOf: newPaths) }
    }

    /// 조인 안 된 철근이 모이는 고정 노드의 value.
    static let unclassifiedValue = "__unclassified__"

    /// Taxonomy → 중첩 트리. `unmatched`가 있으면 「분류 없음」을 마지막에 붙인다.
    static func buildTree(_ t: Taxonomy) -> [TreeNode] {
        let root = TreeNode(value: "", label: t.root)
        var seen = Set<String>()

        // 노드 객체는 값 타입이라 참조 비교가 안 된다 — prim 키로 중복을 거른다
        // ★ Dictionary 순회 순서는 명세돼 있지 않다 — 정렬하지 않으면 앱을 다시 켤
        //   때마다 트리의 면·기능 순서가 바뀐다. (order, no, 잎경로) 로 못박는다.
        let ordered = t.byPath.values.sorted { a, b in
            if a.order != b.order { return a.order < b.order }
            if (a.no ?? 0) != (b.no ?? 0) { return (a.no ?? 0) < (b.no ?? 0) }
            return (a.paths.first ?? "") < (b.paths.first ?? "")
        }
        for node in ordered {
            let key = node.paths.sorted().joined(separator: "|")
            if seen.contains(key) { continue }
            seen.insert(key)

            var level = root
            var segs: [String] = []
            for seg in node.path {
                segs.append(seg)
                let child = level.child(value: segs.joined(separator: "/"), label: seg)
                child.add(paths: node.paths)
                level = child
            }
            let leafValue = normalizePrimPath(stripComponentIndex(node.paths.first ?? ""))
            let leaf = level.child(value: leafValue, label: node.label)
            if leaf.paths.isEmpty { leaf.add(paths: node.paths) }
        }

        var out = root.children
        if !t.unmatched.isEmpty {
            let node = TreeNode(value: unclassifiedValue, label: "분류 없음 (\(t.unmatched.count))")
            node.add(paths: t.unmatched)
            out.append(node)
        }
        return out
    }

    /// 트리의 **잎** value 만 — 체크 상태의 신원 집합.
    ///
    /// ★ 조상 value 는 절대 포함하지 않는다. 조상은 자손 경로를 중복 보유하므로
    ///   체크 집합에 들어가는 순간 자손을 꺼도 되살아난다(2026-08-18 회귀).
    ///   조상 체크박스는 상태를 저장하지 않고 `checkState` 로 파생한다.
    static func leafValues(_ nodes: [TreeNode]) -> Set<String> {
        var out: Set<String> = []
        func walk(_ ns: [TreeNode]) {
            for n in ns {
                if n.children.isEmpty { out.insert(n.value) } else { walk(n.children) }
            }
        }
        walk(nodes)
        return out
    }

    /// 한 노드 서브트리의 잎 value.
    static func leafValues(_ node: TreeNode) -> Set<String> {
        node.children.isEmpty ? [node.value] : leafValues(node.children)
    }

    enum CheckState: Equatable { case on, off, mixed }

    /// 노드의 체크 상태 — 자손 잎에서 파생한다.
    static func checkState(_ node: TreeNode, checked: Set<String>) -> CheckState {
        let leaves = leafValues(node)
        guard !leaves.isEmpty else { return .off }
        let on = leaves.intersection(checked).count
        if on == 0 { return .off }
        return on == leaves.count ? .on : .mixed
    }

    /// 체크된 **잎** → 보여야 할 엔티티 경로 집합.
    ///
    /// ★ 잎의 `value` 가 아니라 `paths` 를 합친다. value 는 `stripComponentIndex` 를
    ///   거친 값인데 `applyVisibility` 가 비교하는 id 는 `경로` / `경로#1` 형태다.
    ///   한 prim 이 연결요소 여럿으로 쪼개진 경우까지 맞으려면 paths 여야 한다.
    /// ★ 조상 노드는 절대 세지 않는다 — 자손 경로를 중복 보유하기 때문이다.
    static func visiblePaths(_ nodes: [TreeNode], checked: Set<String>) -> Set<String> {
        var out: Set<String> = []
        func walk(_ ns: [TreeNode]) {
            for n in ns {
                if n.children.isEmpty {
                    if checked.contains(n.value) { out.formUnion(n.paths) }
                } else {
                    walk(n.children)
                }
            }
        }
        walk(nodes)
        return out
    }
}
