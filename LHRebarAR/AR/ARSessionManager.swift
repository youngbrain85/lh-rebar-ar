import ARKit
import Combine
import Foundation

@MainActor
final class ARSessionManager: ObservableObject {
    enum TrackingBadge: Equatable {
        case notAvailable
        case limited(ARCamera.TrackingState.Reason)
        case normal

        var label: String {
            switch self {
            case .notAvailable:
                return "N/A"
            case .limited(let reason):
                switch reason {
                case .initializing: return "Initializing"
                case .excessiveMotion: return "Slow down"
                case .insufficientFeatures: return "Low features"
                case .relocalizing: return "Relocalizing"
                @unknown default: return "Limited"
                }
            case .normal:
                return "Tracking"
            }
        }
    }

    @Published private(set) var tracking: TrackingBadge = .notAvailable
    @Published var showMeshDebug: Bool = false
    @Published var showDiagnostics: Bool = false
    @Published private(set) var sessionError: String?

    let diagnostics = ARDiagnostics()
    let quality = QualityMetrics()

    static var isLiDARSupported: Bool {
        ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh)
    }

    func makeConfiguration() -> ARWorldTrackingConfiguration {
        let config = ARWorldTrackingConfiguration()
        config.planeDetection = [.horizontal, .vertical]
        config.environmentTexturing = .automatic
        if ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
            config.sceneReconstruction = .mesh
        }
        if ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
            config.frameSemantics.insert(.sceneDepth)
        }
        return config
    }

    func updateTracking(from state: ARCamera.TrackingState) {
        switch state {
        case .normal:
            tracking = .normal
        case .limited(let reason):
            tracking = .limited(reason)
        case .notAvailable:
            tracking = .notAvailable
        }
    }

    func report(error: Error) {
        sessionError = error.localizedDescription
    }

    func clearError() {
        sessionError = nil
    }
}
