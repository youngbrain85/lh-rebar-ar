import ARKit
import Combine
import Foundation
import RealityKit

@MainActor
final class MeasurementViewModel: ObservableObject {
    @Published private(set) var isActive: Bool = false
    @Published private(set) var hasPendingFirstPoint: Bool = false
    @Published private(set) var measurements: [DistanceMeasurement] = []
    @Published private(set) var lastDistanceMeters: Float?
    /// True when the center reticle has a valid surface raycast.
    @Published private(set) var reticleLocked: Bool = false
    /// Live preview distance between the pending first point and the current
    /// reticle position. Updated continuously while aiming the second point.
    @Published private(set) var previewDistanceMeters: Float?
    /// Which surface the reticle is currently snapped to (model vs real), so
    /// the UI can tell the user what the next point will land on.
    @Published private(set) var currentTargetSource: MeasurementPointSource?
    /// Live signed per-axis delta (curr − first) while aiming the second point,
    /// for the X/Y/Z breakdown readout.
    @Published private(set) var previewComponents: SIMD3<Float>?

    private var controller: MeasurementController?

    func bind(arView: ARView) {
        // Tear down any previous controller first so a recreated ARView can't
        // leave an orphaned instance ticking the scene behind the live one.
        controller?.teardown()
        let c = MeasurementController(arView: arView)
        c.liveStateHandler = { [weak self] state in
            guard let self else { return }
            // Only mutate @Published when values change to limit SwiftUI
            // re-renders. Frame events fire at 60 Hz.
            if self.reticleLocked != state.locked {
                self.reticleLocked = state.locked
            }
            if self.previewDistanceMeters != state.previewDistanceM {
                self.previewDistanceMeters = state.previewDistanceM
            }
            if self.currentTargetSource != state.source {
                self.currentTargetSource = state.source
            }
            if self.previewComponents != state.previewDelta {
                self.previewComponents = state.previewDelta
            }
        }
        controller = c
    }

    func setActive(_ active: Bool) {
        isActive = active
        controller?.setMeasurementActive(active)
        if !active {
            hasPendingFirstPoint = false
            reticleLocked = false
            previewDistanceMeters = nil
            currentTargetSource = nil
            previewComponents = nil
        }
    }

    func toggleActive() {
        setActive(!isActive)
    }

    /// Swallows taps while in measurement mode so they don't trigger model
    /// placement. All point commits happen via `addPointAtReticle()`.
    func handleTap(in arView: ARView, at screenPoint: CGPoint) -> Bool {
        isActive
    }

    enum CommitOutcome {
        case ignored
        case startedFirst
        case completed(DistanceMeasurement)
    }

    /// Commits the current reticle position. Returns the outcome so the UI can
    /// react (e.g. prompt to name a just-completed measurement).
    @discardableResult
    func addPointAtReticle() -> CommitOutcome {
        guard let controller, let outcome = controller.commitCurrentPoint() else {
            return .ignored
        }
        switch outcome {
        case .startedFirstPoint:
            hasPendingFirstPoint = true
            return .startedFirst
        case .completed(let m):
            hasPendingFirstPoint = false
            measurements = controller.measurements
            lastDistanceMeters = m.distanceMeters
            AppLogger.shared.logMeasurement(m)
            return .completed(m)
        }
    }

    /// Renames a measurement (updates its 3D label and the published list).
    func renameMeasurement(id: UUID, to name: String) {
        controller?.renameMeasurement(id: id, to: name)
        measurements = controller?.measurements ?? []
    }

    func clearAll() {
        controller?.clearAll()
        measurements = []
        hasPendingFirstPoint = false
        lastDistanceMeters = nil
        previewDistanceMeters = nil
    }

    func removeLast() {
        controller?.removeLast()
        measurements = controller?.measurements ?? []
        if measurements.isEmpty {
            lastDistanceMeters = nil
        }
    }

    func cancelPending() {
        controller?.cancelPending()
        hasPendingFirstPoint = false
        previewDistanceMeters = nil
    }
}
