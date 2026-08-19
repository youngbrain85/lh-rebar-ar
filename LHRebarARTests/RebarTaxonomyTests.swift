// LHRebarARTests/RebarTaxonomyTests.swift
import XCTest

final class RebarTaxonomyTests: XCTestCase {

    func testClassifiesAll45Bars() throws {
        let t = try XCTUnwrap(RebarTaxonomy.fromPrimNames(entityPaths: DesignModelFixture.paths))
        XCTAssertEqual(t.source, .primName)
        XCTAssertEqual(t.unmatched, [])
        XCTAssertEqual(t.byPath.count, 45)

        var counts: [String: Int] = [:]
        for (_, node) in t.byPath {
            counts[node.path.joined(separator: ">"), default: 0] += 1
        }
        XCTAssertEqual(counts, DesignModelFixture.expectedCounts)
    }

    /// `Wall_Front` 은 `Wall_FrontRear_Shear` 의 접두어다. 접두어 비교로 매칭하면
    /// 간격재 13개가 전면 철근으로 샌다. 완전일치 조회라 안 새는 것을 못박는다.
    func testShearIsNotMisreadAsFrontFace() {
        let shear = RebarTaxonomy.parsePrimName("Wall_FrontRear_Shear_01")
        XCTAssertEqual(shear?.path, ["벽체", "전면-배면", "간격재(전단철근)"])
        XCTAssertEqual(shear?.no, 1)

        let front = RebarTaxonomy.parsePrimName("Wall_Front_Vert_01")
        XCTAssertEqual(front?.path, ["벽체", "전면", "수직철근"])
    }

    /// 두 자리 zero-pad 번호가 정수로 읽히고 라벨에서 다시 두 자리로 돌아온다.
    func testZeroPaddedNumbers() throws {
        let p = try XCTUnwrap(RebarTaxonomy.parsePrimName("Wall_Rear_Vert_05"))
        XCTAssertEqual(p.no, 5)
        XCTAssertEqual(RebarTaxonomy.composeLabel(path: p.path, no: p.no),
                       "벽체-배면-수직철근(주철근)-05")
    }

    /// 정규화가 이 모델의 경로를 건드리지 않는다(wrapper 세그먼트와 충돌 없음).
    func testNormalizeLeavesRealPathsIntact() {
        XCTAssertEqual(RebarTaxonomy.normalizePrimPath("/RebarModel/Wall_Front_Vert_01"),
                       "/RebarModel/Wall_Front_Vert_01")
        XCTAssertEqual(RebarTaxonomy.normalizePrimPath("/modelEntity/RebarModel/Wall_Front_Vert_01"),
                       "/RebarModel/Wall_Front_Vert_01")
    }

    /// Swift Dictionary 순회 순서는 명세되지 않고 새로 만들 때마다 달라진다.
    /// 매번 새 Taxonomy 를 만들어 트리 모양이 같은지 본다.
    func testTreeOrderIsDeterministic() throws {
        func shape(_ ns: [RebarTaxonomy.TreeNode]) -> [String] {
            ns.flatMap { [$0.label] + shape($0.children) }
        }
        let base = try XCTUnwrap(RebarTaxonomy.fromPrimNames(entityPaths: DesignModelFixture.paths))
        let expected = shape(RebarTaxonomy.buildTree(base))
        for i in 0..<50 {
            let again = try XCTUnwrap(
                RebarTaxonomy.fromPrimNames(entityPaths: DesignModelFixture.paths))
            XCTAssertEqual(shape(RebarTaxonomy.buildTree(again)), expected, "반복 \(i)")
        }
    }

    /// 형제 순서는 발주처 분류표 행 순서를 따른다 — 전면 → 배면 → 전면-배면.
    func testTreeOrderFollowsOfficialTable() throws {
        let t = try XCTUnwrap(RebarTaxonomy.fromPrimNames(entityPaths: DesignModelFixture.paths))
        let tree = RebarTaxonomy.buildTree(t)
        XCTAssertEqual(tree.map(\.label), ["벽체"])
        XCTAssertEqual(tree[0].children.map(\.label), ["전면", "배면", "전면-배면"])
        XCTAssertEqual(tree[0].children[0].children.map(\.label),
                       ["수직철근", "수평철근(배력철근)"])
        XCTAssertEqual(tree[0].children[1].children.map(\.label),
                       ["수직철근(주철근)", "수평철근(배력철근)"])
        // 잎은 번호순
        XCTAssertEqual(tree[0].children[1].children[0].children.map(\.label),
                       (1...5).map { "벽체-배면-수직철근(주철근)-0\($0)" })
    }
}
