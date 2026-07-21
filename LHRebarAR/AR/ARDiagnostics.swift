import ARKit
import Foundation
import QuartzCore

/// Rolling session metrics for the diagnostics HUD (debug builds only).
/// Published updates are throttled to ~4 Hz to avoid dirtying SwiftUI every frame.
@MainActor
final class ARDiagnostics: ObservableObject {
    @Published private(set) var fps: Double = 0
    @Published private(set) var anchorCount: Int = 0
    @Published private(set) var meshAnchorCount: Int = 0
    @Published private(set) var uptimeSeconds: TimeInterval = 0
    @Published private(set) var trackingReasonSummary: String = "—"

    private var timestamps: [TimeInterval] = []
    private let maxSamples = 30
    private var startTime: TimeInterval = CACurrentMediaTime()
    private var lastPublish: TimeInterval = 0
    private let publishInterval: TimeInterval = 0.25

    func reset() {
        timestamps.removeAll(keepingCapacity: true)
        startTime = CACurrentMediaTime()
        lastPublish = 0
        fps = 0
        anchorCount = 0
        meshAnchorCount = 0
        uptimeSeconds = 0
        trackingReasonSummary = "—"
    }

    func observe(frame: ARFrame) {
        timestamps.append(frame.timestamp)
        if timestamps.count > maxSamples {
            timestamps.removeFirst(timestamps.count - maxSamples)
        }

        let now = CACurrentMediaTime()
        guard now - lastPublish >= publishInterval else { return }
        lastPublish = now

        if timestamps.count >= 2, let first = timestamps.first, let last = timestamps.last,
           last > first {
            fps = Double(timestamps.count - 1) / (last - first)
        }
        uptimeSeconds = now - startTime
        anchorCount = frame.anchors.count
        meshAnchorCount = frame.anchors.reduce(0) { $0 + (($1 is ARMeshAnchor) ? 1 : 0) }
        trackingReasonSummary = Self.describe(trackingState: frame.camera.trackingState)
    }

    private static func describe(trackingState: ARCamera.TrackingState) -> String {
        switch trackingState {
        case .normal: return "normal"
        case .notAvailable: return "n/a"
        case .limited(let r):
            switch r {
            case .initializing: return "init"
            case .excessiveMotion: return "motion"
            case .insufficientFeatures: return "features"
            case .relocalizing: return "reloc"
            @unknown default: return "limited"
            }
        }
    }
}
