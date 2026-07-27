import ARKit
import RealityKit
import SwiftUI

struct ARViewContainer: UIViewRepresentable {
    @ObservedObject var manager: ARSessionManager
    var onViewReady: ((ARView) -> Void)?
    var onTap: ((ARView, CGPoint) -> Void)?

    func makeCoordinator() -> Coordinator {
        Coordinator(manager: manager, onTap: onTap)
    }

    func makeUIView(context: Context) -> ARView {
        let arView = ARView(
            frame: .zero,
            cameraMode: .ar,
            automaticallyConfigureSession: false
        )
        arView.renderOptions = [.disableMotionBlur, .disableHDR]
        // Occlusion ON: the LiDAR mesh of real surfaces hides parts of the
        // design model behind them, for realistic depth. NOTE: the "model
        // vanished in tight spaces" bug was NOT occlusion — it was the
        // placement being bound to an ARAnchor that lost tracking; fixed by
        // world-anchoring in ModelAnchorController (place + reanchor).
        arView.environment.sceneUnderstanding.options = [.occlusion, .collision]
        arView.session.delegate = context.coordinator

        context.coordinator.installCoachingOverlay(on: arView)
        context.coordinator.installTapGesture(on: arView)

        arView.session.run(manager.makeConfiguration())
        applyDebug(showMesh: manager.showMeshDebug, to: arView)

        onViewReady?(arView)
        return arView
    }

    func updateUIView(_ uiView: ARView, context: Context) {
        context.coordinator.onTap = onTap
        applyDebug(showMesh: manager.showMeshDebug, to: uiView)
    }

    static func dismantleUIView(_ uiView: ARView, coordinator: Coordinator) {
        uiView.session.pause()
    }

    private func applyDebug(showMesh: Bool, to arView: ARView) {
        arView.debugOptions = showMesh ? [.showSceneUnderstanding] : []
    }

    final class Coordinator: NSObject, ARSessionDelegate, ARCoachingOverlayViewDelegate {
        private let manager: ARSessionManager
        var onTap: ((ARView, CGPoint) -> Void)?
        private weak var coachingOverlay: ARCoachingOverlayView?
        private weak var boundARView: ARView?

        init(manager: ARSessionManager, onTap: ((ARView, CGPoint) -> Void)?) {
            self.manager = manager
            self.onTap = onTap
        }

        func installCoachingOverlay(on arView: ARView) {
            let overlay = ARCoachingOverlayView()
            overlay.session = arView.session
            overlay.goal = .horizontalPlane
            overlay.activatesAutomatically = true
            overlay.delegate = self
            overlay.translatesAutoresizingMaskIntoConstraints = false
            arView.addSubview(overlay)
            NSLayoutConstraint.activate([
                overlay.leadingAnchor.constraint(equalTo: arView.leadingAnchor),
                overlay.trailingAnchor.constraint(equalTo: arView.trailingAnchor),
                overlay.topAnchor.constraint(equalTo: arView.topAnchor),
                overlay.bottomAnchor.constraint(equalTo: arView.bottomAnchor),
            ])
            coachingOverlay = overlay
        }

        func installTapGesture(on arView: ARView) {
            let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
            tap.cancelsTouchesInView = false
            arView.addGestureRecognizer(tap)
            boundARView = arView
        }

        @objc private func handleTap(_ gesture: UITapGestureRecognizer) {
            guard let arView = boundARView else { return }
            let point = gesture.location(in: arView)
            onTap?(arView, point)
        }

        func session(_ session: ARSession, cameraDidChangeTrackingState camera: ARCamera) {
            let state = camera.trackingState
            Task { @MainActor in
                manager.updateTracking(from: state)
            }
        }

        func session(_ session: ARSession, didUpdate frame: ARFrame) {
            Task { @MainActor in
                manager.diagnostics.observe(frame: frame)
                manager.quality.observe(frame: frame)
            }
        }

        func session(_ session: ARSession, didFailWithError error: Error) {
            Task { @MainActor in
                manager.report(error: error)
            }
        }

        func sessionWasInterrupted(_ session: ARSession) {
            Task { @MainActor in
                manager.updateTracking(from: .notAvailable)
            }
        }

        func sessionInterruptionEnded(_ session: ARSession) {
            Task { @MainActor in
                let config = manager.makeConfiguration()
                session.run(config, options: [.resetTracking, .removeExistingAnchors])
                manager.diagnostics.reset()
            }
        }
    }
}
