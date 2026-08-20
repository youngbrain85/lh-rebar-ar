// LHRebarARTests/RebarFilterTests.swift
import XCTest

/// 2026-08-18 회귀 재현. 이 테스트들이 없던 동안 필터는 **아무것도 숨기지 못했다**:
/// buildTree 가 조상마다 자손 경로를 쌓고 visiblePaths 가 그걸 전부 합집합했기 때문.
final class RebarFilterTests: XCTestCase {

    private func tree() throws -> [RebarTaxonomy.TreeNode] {
        let t = try XCTUnwrap(RebarTaxonomy.fromPrimNames(entityPaths: DesignModelFixture.paths))
        return RebarTaxonomy.buildTree(t)
    }

    func testAllLeavesCheckedShowsEverything() throws {
        let tree = try tree()
        let checked = RebarTaxonomy.leafValues(tree)
        XCTAssertEqual(checked.count, 45)
        XCTAssertEqual(RebarTaxonomy.visiblePaths(tree, checked: checked).count, 45)
    }

    func testUncheckingOneLeafHidesExactlyOne() throws {
        let tree = try tree()
        var checked = RebarTaxonomy.leafValues(tree)
        checked.remove("/RebarModel/Wall_Front_Vert_01")
        XCTAssertEqual(RebarTaxonomy.visiblePaths(tree, checked: checked).count, 44)
    }

    /// 가지 하나(전면 수직철근 9가닥)를 끄면 정확히 9개가 사라져야 한다.
    /// 조상 '벽체' 가 45개를 되살리던 것이 원래 버그다.
    func testUncheckingBranchHidesItsLeavesOnly() throws {
        let tree = try tree()
        var checked = RebarTaxonomy.leafValues(tree)
        for i in 1...9 {
            checked.remove("/RebarModel/Wall_Front_Vert_\(String(format: "%02d", i))")
        }
        let visible = RebarTaxonomy.visiblePaths(tree, checked: checked)
        XCTAssertEqual(visible.count, 36)
        XCTAssertFalse(visible.contains("/RebarModel/Wall_Front_Vert_05"))
        XCTAssertTrue(visible.contains("/RebarModel/Wall_Rear_Vert_05"))
    }

    func testUncheckingEverythingHidesEverything() throws {
        XCTAssertTrue(try RebarTaxonomy.visiblePaths(tree(), checked: []).isEmpty)
    }

    /// 조상 value 가 체크 집합에 섞여 들어와도 가시성에 영향을 주면 안 된다.
    /// (잎만 센다는 규칙을 못박는다)
    func testAncestorValuesInCheckedSetAreIgnored() throws {
        let tree = try tree()
        var checked = RebarTaxonomy.leafValues(tree)
        for i in 1...9 {
            checked.remove("/RebarModel/Wall_Front_Vert_\(String(format: "%02d", i))")
        }
        checked.insert("벽체")
        checked.insert("벽체/전면")
        checked.insert("벽체/전면/수직철근")
        XCTAssertEqual(RebarTaxonomy.visiblePaths(tree, checked: checked).count, 36)
    }

    func testCheckStateIsThreeWay() throws {
        let tree = try tree()
        let front = try XCTUnwrap(tree.first?.children.first { $0.label == "전면" })
        let vert = try XCTUnwrap(front.children.first { $0.label == "수직철근" })

        let all = RebarTaxonomy.leafValues(tree)
        XCTAssertEqual(RebarTaxonomy.checkState(vert, checked: all), .on)
        XCTAssertEqual(RebarTaxonomy.checkState(vert, checked: []), .off)

        var partial = RebarTaxonomy.leafValues(tree)
        partial.remove("/RebarModel/Wall_Front_Vert_01")
        XCTAssertEqual(RebarTaxonomy.checkState(vert, checked: partial), .mixed)
        XCTAssertEqual(RebarTaxonomy.checkState(front, checked: partial), .mixed)
    }
}
