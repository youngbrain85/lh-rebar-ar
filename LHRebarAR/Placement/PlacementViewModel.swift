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
