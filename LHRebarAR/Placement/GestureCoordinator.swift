import ARKit
import RealityKit
import UIKit
import simd

@MainActor
final class GestureCoordinator: NSObject {
    private weak var arView: ARView?
    private weak var anchorController: ModelAnchorController?
    private weak var viewModel: PlacementViewModel?

    private var panRecognizer: UIPanGestureRecognizer?
    private var rotateRecognizer: UIRotationGestureRecognizer?

    // Pan state
    private var panStartHitWorld: SIMD3<Float>?
    private var panStartRootPosition: SIMD3<Float>?

    // Rotate state (accumulated Y-axis yaw on placementRoot, in radians)
    private var accumulatedYaw: Float = 0
    private var rotateBaseYaw: Float = 0

    init(
        arView: ARView,
        anchorController: ModelAnchorController,
        viewModel: PlacementViewModel
    ) {
        self.arView = arView
        self.anchorController = anchorController
        self.viewModel = viewModel
        super.init()
        installGestures()
    }

    func setEnabled(_ enabled: Bool) {
        panRecognizer?.isEnabled = enabled
        rotateRecognizer?.isEnabled = enabled
    }

    func resetAfterPlacement() {
        accumulatedYaw = 0
        rotateBaseYaw = 0
        panStartHitWorld = nil
        panStartRootPosition = nil
    }

    private func installGestures() {
        guard let arView else { return }

        let pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
        pan.minimumNumberOfTouches = 1
        pan.maximumNumberOfTouches = 1
        pan.delegate = self
        arView.addGestureRecognizer(pan)
        panRecognizer = pan

        let rotate = UIRotationGestureRecognizer(target: self, action: #selector(handleRotate(_:)))
        rotate.delegate = self
        arView.addGestureRecognizer(rotate)
        rotateRecognizer = rotate
    }

    @objc private func handlePan(_ recognizer: UIPanGestureRecognizer) {
        guard
            let arView,
            let root = anchorController?.placementRoot
        else { return }

        let point = recognizer.location(in: arView)

        switch recognizer.state {
        case .began:
            guard let hit = AnchorStrategy.placementRaycast(from: arView, at: point) else {
                recognizer.state = .cancelled
                return
            }
            panStartHitWorld = hit.worldTransform.translation
            panStartRootPosition = root.position(relativeTo: nil)
            viewModel?.beginAdjusting()

        case .changed:
            guard
                let start = panStartHitWorld,
                let base = panStartRootPosition,
                let hit = AnchorStrategy.placementRaycast(from: arView, at: point)
            else { return }
            let delta = hit.worldTransform.translation - start
            var newPos = base + delta
            newPos.y = base.y  // pan is XZ only; keep ground level fixed
            root.setPosition(newPos, relativeTo: nil)

        case .ended, .cancelled, .failed:
            panStartHitWorld = nil
            panStartRootPosition = nil
            viewModel?.endAdjusting()

        default:
            break
        }
    }

    @objc private func handleRotate(_ recognizer: UIRotationGestureRecognizer) {
        guard let root = anchorController?.placementRoot else { return }

        switch recognizer.state {
        case .began:
            rotateBaseYaw = accumulatedYaw
            viewModel?.beginAdjusting()

        case .changed:
            // UIRotationGestureRecognizer gives clockwise-positive screen rotation.
            // Invert sign so clockwise 2-finger twist rotates the model clockwise
            // when viewed from above (around world +Y).
            let newYaw = rotateBaseYaw - Float(recognizer.rotation)
            accumulatedYaw = newYaw
            root.setOrientation(simd_quatf(angle: newYaw, axis: [0, 1, 0]), relativeTo: nil)

        case .ended, .cancelled, .failed:
            viewModel?.endAdjusting()

        default:
            break
        }
    }
}

extension GestureCoordinator: UIGestureRecognizerDelegate {
    nonisolated func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        true
    }
}

extension simd_float4x4 {
    var translation: SIMD3<Float> {
        SIMD3<Float>(columns.3.x, columns.3.y, columns.3.z)
    }
}
