import Foundation

struct PlacementMeasurement: Identifiable, Hashable {
    let id = UUID()
    let timestamp: Date
    /// Tap → model anchored on scene, in milliseconds.
    let durationMs: Double
    let hitSource: PlacementHit.Source

    var sourceLabel: String {
        switch hitSource {
        case .sceneMesh: return "mesh"
        case .existingPlane: return "plane"
        case .estimatedPlane: return "est."
        }
    }
}

enum PlacementState: Equatable {
    case loading
    case ready
    case placed
    case adjusting
    case locked
    case failed(String)

    var canPlace: Bool {
        if case .ready = self { return true }
        return false
    }
}
