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
    func testUnknownNamesGoToUnclassifiedOnKindAxis() throws {
        let paths = DesignModelFixture.paths + ["/RebarModel/TopV_01", "/RebarModel/TopV_02"]
        let t = try XCTUnwrap(RebarTaxonomy.fromPrimNames(entityPaths: paths))
        let kind = RebarTaxonomy.buildTree(t, axis: .kind)
        XCTAssertEqual(kind.last?.label, "분류 없음")
        XCTAssertEqual(kind.last?.count, 2)
        // 부위순에서는 레거시 어댑터가 편 경로대로 계속 보인다
        let member = RebarTaxonomy.buildTree(t, axis: .member)
        XCTAssertTrue(member.contains { $0.label == "상단" })
    }
}
