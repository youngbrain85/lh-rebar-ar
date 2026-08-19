import ARKit
import Combine
import Foundation
import RealityKit

@MainActor
final class PlacementViewModel: ObservableObject {
    @Published private(set) var state: PlacementState = .loading
    @Published private(set) var lastHitSource: PlacementHit.Source?
    @Published private(set) var gesturesEnabled: Bool = true
    @Published private(set) var lastPlacementMs: Double?
    @Published private(set) var placementHistory: [PlacementMeasurement] = []
    private let placementHistoryCap = 200
    @Published var modelOpacity: Float = 0.7 {
        didSet {
            if oldValue != modelOpacity {
                anchorController?.setOpacity(modelOpacity)
            }
        }
    }
    let currentModel: RebarModel
    let fine = FineAdjustmentViewModel()
    let visualLock = VisualLockService()

    // MARK: - 철근 계층 필터 (spec §7.2)

    /// 트리 노드 체크 상태. 비어 있지 않으면 필터가 걸린 상태다.
    @Published private(set) var rebarTree: [RebarTaxonomy.TreeNode] = []
    @Published private(set) var rebarSource: RebarTaxonomy.Source = .geometry
    @Published var checkedRebarNodes: Set<String> = [] {
        didSet { if oldValue != checkedRebarNodes { applyRebarFilter() } }
    }
    /// 배치된 모델에서 찾은 메시 노드 수. 0이면 RealityKit 이 이름 있는 노드를
    /// 주지 않았다는 뜻이다(스펙 §3.7 — 기기 검증 항목).
    @Published private(set) var rebarNodeCount: Int = 0

    private var loadedTemplate: Entity?
    private var anchorController: ModelAnchorController?
    private var gestureCoordinator: GestureCoordinator?
    private var adjustingCount: Int = 0

    init(model: RebarModel) {
        self.currentModel = model
    }

    func bind(arView: ARView) {
        let controller = ModelAnchorController(arView: arView)
        anchorController = controller
        fine.bind(to: controller)
        visualLock.bind(arView: arView)
        gestureCoordinator = GestureCoordinator(
            arView: arView,
            anchorController: controller,
            viewModel: self
        )
        gestureCoordinator?.setEnabled(false)  // enabled only after placement
    }

    func loadModel() async {
        state = .loading
        do {
            let entity = try await ModelLoader.load(currentModel)
            loadedTemplate = entity
            state = .ready
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    func handleTap(in arView: ARView, at screenPoint: CGPoint) {
        guard state.canPlace, let template = loadedTemplate else { return }
        let tapStart = Date()
        guard let hit = AnchorStrategy.placementRaycast(from: arView, at: screenPoint) else {
            return
        }
        let instance = template.clone(recursive: true)
        anchorController?.place(model: instance, at: hit.worldTransform)
        anchorController?.setOpacity(modelOpacity)
        // 배치되는 것은 템플릿의 clone이라 엔티티 참조가 매번 바뀐다 — 필터 상태를
        // 경로 문자열로 들고 배치할 때마다 다시 적용한다 (spec §7.2)
        rebuildRebarTree()
        applyRebarFilter()
        gestureCoordinator?.resetAfterPlacement()
        gestureCoordinator?.setEnabled(gesturesEnabled)
        fine.captureBase()
        if let root = anchorController?.placementRoot {
            visualLock.captureReference(around: root)
        }
        lastHitSource = hit.source
        state = .placed

        let elapsedMs = Date().timeIntervalSince(tapStart) * 1000
        lastPlacementMs = elapsedMs
        let measurement = PlacementMeasurement(
            timestamp: Date(),
            durationMs: elapsedMs,
            hitSource: hit.source
        )
        placementHistory.append(measurement)
        if placementHistory.count > placementHistoryCap {
            placementHistory.removeFirst(placementHistory.count - placementHistoryCap)
        }
        AppLogger.shared.logPlacementLatency(elapsedMs, hitSource: measurement.sourceLabel)
    }

    // MARK: - 철근 계층 필터

    /// 배치된 모델의 엔티티 경로로 트리를 다시 만든다.
    /// 사이드카가 있으면 그것으로, 없으면 prim 이름 코드북으로. 둘 다 안 되면 트리를 비운다
    /// (형상 자동 분류 3단계는 대시보드 분석 산출물이 있어야 돌아 앱에서는 성립하지 않는다).
    func rebuildRebarTree() {
        guard AppFeatures.rebarFilter, let controller = anchorController,
              let model = controller.modelEntity else {
            rebarTree = []
            rebarNodeCount = 0
            return
        }
        let paths = ModelAnchorController.meshNodePaths(of: model)
        rebarNodeCount = paths.count

        if let meta = rebarMeta, meta.isUsable {
            let t = RebarTaxonomy.fromSidecar(meta, entityPaths: paths)
            if !t.byPath.isEmpty {
                rebarTree = RebarTaxonomy.buildTree(t)
                rebarSource = t.source
                checkedRebarNodes = RebarTaxonomy.leafValues(rebarTree)
                return
            }
        }
        if let t = RebarTaxonomy.fromPrimNames(entityPaths: paths) {
            rebarTree = RebarTaxonomy.buildTree(t)
            rebarSource = t.source
            checkedRebarNodes = RebarTaxonomy.leafValues(rebarTree)
            return
        }
        // 이름이 규약을 안 따르면 계층 없이 평평하게 나열한다 — 개별 토글은 유지된다
        // (spec §7.5). 아무것도 못 하는 것보다 낫다.
        let flat = RebarTaxonomy.Taxonomy(
            root: "전체", byPath: [:], unmatched: paths, source: .geometry
        )
        rebarTree = RebarTaxonomy.buildTree(flat)
        rebarSource = .geometry
        checkedRebarNodes = RebarTaxonomy.leafValues(rebarTree)
    }

    /// 사이드카 계층 정보. 모델과 함께 받아 둔다(없으면 nil → 이름 기반 폴백).
    var rebarMeta: RebarMetaFile?

    private func applyRebarFilter() {
        guard AppFeatures.rebarFilter, !rebarTree.isEmpty else { return }
        let all = RebarTaxonomy.leafValues(rebarTree)
        // 전부 체크된 상태는 "필터 없음"이다 — 굳이 집합을 만들지 않는다
        let visible: Set<String>? = checkedRebarNodes == all
            ? nil
            : RebarTaxonomy.visiblePaths(rebarTree, checked: checkedRebarNodes)
        anchorController?.applyVisibility(visible)
        // ★ 여기서 matched==0 을 조인 실패로 읽지 않는다. "사용자가 전부 숨겼다" 와
        //   구분되지 않아 전체 해제가 즉시 원복되던 것이 2026-08-18 회귀였다.
        //   조인 성패는 rebuildRebarTree 에서 rebarNodeCount 로 한 번만 판정한다.
    }

    func clearPlacementHistory() {
        placementHistory.removeAll()
        lastPlacementMs = nil
        AppLogger.shared.clearPlacementLog()
    }

    func resetPlacement() {
        anchorController?.removeCurrent()
        gestureCoordinator?.setEnabled(false)
        gestureCoordinator?.resetAfterPlacement()
        fine.clear()
        visualLock.clear()
        adjustingCount = 0
        lastHitSource = nil
        state = loadedTemplate == nil ? .loading : .ready
    }

    // MARK: - Gesture bridging

    func beginAdjusting() {
        adjustingCount += 1
        if adjustingCount > 0, case .placed = state {
            state = .adjusting
        }
    }

    func endAdjusting() {
        adjustingCount = max(0, adjustingCount - 1)
        if adjustingCount == 0, case .adjusting = state {
            commitAdjustments()
            state = .placed
        }
    }

    /// Called when an adjustment session settles (coarse gesture ends or the
    /// fine-adjust pad closes): re-anchor the model at its adjusted pose so
    /// ARKit tracks it from a fresh nearby anchor (reduces lever-arm drift),
    /// re-baseline fine deltas, and snapshot the surrounding real-world mesh as
    /// the visual-lock datum for later re-locking.
    func commitAdjustments() {
        anchorController?.reanchor()
        fine.captureBase()
        if let root = anchorController?.placementRoot {
            visualLock.captureReference(around: root)
        }
    }

    /// Visual re-lock: aligns the current LiDAR scan of the structure to the
    /// datum captured at the last commit and snaps the model back onto the real
    /// structure. Returns (success, user-facing message).
    func relockNow() async -> (Bool, String) {
        guard let controller = anchorController, let root = controller.placementRoot else {
            return (false, "배치된 모델이 없습니다")
        }
        let outcome = await visualLock.relock()
        guard let newTransform = outcome.newModelTransform else {
            return (false, outcome.message)
        }
        root.setTransformMatrix(newTransform, relativeTo: nil)
        controller.reanchor()
        fine.captureBase()
        return (true, outcome.message)
    }

    /// Called by the view when AR tracking state gates user input.
    func setAdjustmentEnabled(_ enabled: Bool) {
        gesturesEnabled = enabled
        // Only allow gestures if we actually have something to adjust.
        let hasModel = anchorController?.placementRoot != nil
        gestureCoordinator?.setEnabled(enabled && hasModel)
        if !enabled, case .adjusting = state {
            adjustingCount = 0
            state = .placed
        }
    }
}
