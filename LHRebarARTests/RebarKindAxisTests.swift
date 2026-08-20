// LHRebarARTests/RebarKindAxisTests.swift
import XCTest

final class RebarKindAxisTests: XCTestCase {

    private func taxonomy() throws -> RebarTaxonomy.Taxonomy {
        try XCTUnwrap(RebarTaxonomy.fromPrimNames(entityPaths: DesignModelFixture.paths))
    }

    /// 종류순은 2단이다: 종류 → 위치.
    /// 역할명(괄호 안)은 **한 종류 안에서 역할이 하나뿐이면 종류 노드에**,
    /// 갈리면 자식에 붙는다.
    func testKindAxisShape() throws {
        let tree = RebarTaxonomy.buildTree(try taxonomy(), axis: .kind)
        XCTAssertEqual(tree.map(\.label),
                       ["수직철근", "수평철근(배력철근)", "간격재(전단철근)"])
        XCTAssertEqual(tree.map(\.count), [14, 18, 13])

        // 수직철근: 전면은 역할 없음, 배면은 주철근 → 갈리므로 자식에 붙는다
        XCTAssertEqual(tree[0].children.map(\.label), ["전면", "배면(주철근)"])
        XCTAssertEqual(tree[0].children.map(\.count), [9, 5])

        // 수평철근: 양면 모두 배력철근 → 종류 노드에 붙고 자식은 면만
        XCTAssertEqual(tree[1].children.map(\.label), ["전면", "배면"])
        XCTAssertEqual(tree[2].children.map(\.label), ["전면-배면"])
    }

    /// 잎은 두 축에서 같은 value 를 갖는다 — 그래서 축을 바꿔도 체크가 유지된다.
    func testLeafValuesAreIdenticalAcrossAxes() throws {
        let t = try taxonomy()
        XCTAssertEqual(RebarTaxonomy.leafValues(RebarTaxonomy.buildTree(t, axis: .member)),
                       RebarTaxonomy.leafValues(RebarTaxonomy.buildTree(t, axis: .kind)))
    }

    /// 부위순에서 9가닥을 끈 체크 집합을 종류순 트리에 그대로 먹여도 36개가 보인다.
    func testCheckedSetSurvivesAxisSwitch() throws {
        let t = try taxonomy()
        let member = RebarTaxonomy.buildTree(t, axis: .member)
        var checked = RebarTaxonomy.leafValues(member)
        for i in 1...9 {
            checked.remove("/RebarModel/Wall_Front_Vert_\(String(format: "%02d", i))")
        }
        XCTAssertEqual(RebarTaxonomy.visiblePaths(member, checked: checked).count, 36)

        let kind = RebarTaxonomy.buildTree(t, axis: .kind)
        XCTAssertEqual(RebarTaxonomy.visiblePaths(kind, checked: checked).count, 36)
    }

    /// 기본 인자는 부위순이다 — 기존 호출부가 안 깨진다.
    func testDefaultAxisIsMember() throws {
        let t = try taxonomy()
        XCTAssertEqual(RebarTaxonomy.buildTree(t).map(\.label),
                       RebarTaxonomy.buildTree(t, axis: .member).map(\.label))
    }

    /// 분류표 밖 이름은 종류축 재료가 없다 → 종류순에서 「분류 없음」으로 간다.
    /// 「분류 없음」은 잎이 아니라 **가지**다 — 미분류 철근도 개별로 켜고 끌 수 있어야
    /// 부위순에서의 개별 잎과 신원이 맞는다(2026-08-18 리뷰 회귀 수정).
    func testUnknownNamesGoToUnclassifiedOnKindAxis() throws {
        let paths = DesignModelFixture.paths + ["/RebarModel/TopV_01", "/RebarModel/TopV_02"]
        let t = try XCTUnwrap(RebarTaxonomy.fromPrimNames(entityPaths: paths))
        let kind = RebarTaxonomy.buildTree(t, axis: .kind)
        XCTAssertEqual(kind.last?.label, "분류 없음")
        XCTAssertEqual(kind.last?.count, 2)
        XCTAssertEqual(kind.last?.children.count, 2, "잎 하나로 뭉치지 않고 개별 가지여야 한다")
        // 부위순에서는 레거시 어댑터가 편 경로대로 계속 보인다
        let member = RebarTaxonomy.buildTree(t, axis: .member)
        XCTAssertTrue(member.contains { $0.label == "상단" })
    }

    /// Important-1 리뷰 회귀: 미분류 철근이 섞이면 종류축의 「분류 없음」이
    /// 예전엔 잎 하나(`__unclassified__`)로 뭉쳐서 부위축의 개별 잎과 신원이
    /// 어긋났다 — leafValues 집합이 달라지고, 부위순에서 켠 체크가 종류순으로
    /// 안 건너갔다. 이제 개별 가지이므로 두 축의 잎 집합·가시성이 다시 같아야 한다.
    func testLeafValuesIdenticalAcrossAxesWithUnclassified() throws {
        let paths = DesignModelFixture.paths + ["/RebarModel/TopV_01", "/RebarModel/TopV_02"]
        let t = try XCTUnwrap(RebarTaxonomy.fromPrimNames(entityPaths: paths))
        let member = RebarTaxonomy.buildTree(t, axis: .member)
        let kind = RebarTaxonomy.buildTree(t, axis: .kind)
        XCTAssertEqual(RebarTaxonomy.leafValues(member), RebarTaxonomy.leafValues(kind))
        XCTAssertEqual(RebarTaxonomy.leafValues(member).count, 47)

        // 전부 체크면 두 축 모두 47개가 보인다 — 미분류 2가닥이 증발하지 않는다.
        let all = RebarTaxonomy.leafValues(member)
        XCTAssertEqual(RebarTaxonomy.visiblePaths(member, checked: all).count, 47)
        XCTAssertEqual(RebarTaxonomy.visiblePaths(kind, checked: all).count, 47)
    }

    /// 분류표 12행 전부를 한 번에 태워 kind/role 과 종류순 라벨을 못박는다.
    /// Task 7 이 이 값을 TypeScript 에 복제하므로 오타가 여기서 걸려야 한다.
    ///
    /// 기대값은 알고리즘을 손으로 따라간 결과다 (RebarTaxonomy.buildTree 축 .kind 참고):
    /// rolesByKind 를 12행 전체로 모으면 수평철근={배력철근}·간격재={전단철근}·
    /// 종방향철근={배력철근} 은 역할이 하나뿐이라 종류 노드에 괄호가 붙고,
    /// 수직철근={nil,주철근}·보강철근={nil,헌치철근}·횡방향철근={주철근,nil} 은
    /// 갈리므로 역할 있는 자식에만 괄호가 붙는다. 행 순서(order 0..11)대로
    /// 처리되므로 종류 노드 등장 순서는 수직철근→수평철근(배력철근)→간격재(전단철근)→
    /// 보강철근→횡방향철근→종방향철근(배력철근).
    func testAllTwelveRowsOnKindAxis() throws {
        let ids = RebarTaxonomy.wallTaxonomy.enumerated().map { i, r in
            "/RebarModel/\(r.token)_\(String(format: "%02d", i + 1))"
        }
        let t = try XCTUnwrap(RebarTaxonomy.fromPrimNames(entityPaths: ids))
        let kind = RebarTaxonomy.buildTree(t, axis: .kind)
        let shape = kind.map { n in "\(n.label): \(n.children.map(\.label).joined(separator: ", "))" }
        XCTAssertEqual(shape, [
            "수직철근: 전면, 배면(주철근)",
            "수평철근(배력철근): 전면, 배면",
            "간격재(전단철근): 전면-배면, 상부-하부",
            "보강철근: 상단, 벽체-저판(헌치철근)",
            "횡방향철근: 상부(주철근), 하부",
            "종방향철근(배력철근): 상부, 하부",
        ])
        // 행마다 prim 하나씩 12개를 태웠으니 종류 6개는 각각 정확히 2가닥이다.
        XCTAssertEqual(kind.map(\.count), [2, 2, 2, 2, 2, 2])
    }
}
