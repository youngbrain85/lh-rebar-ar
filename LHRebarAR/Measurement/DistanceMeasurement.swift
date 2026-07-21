import Foundation
import simd

/// Which surface a measurement endpoint was snapped to.
enum MeasurementPointSource: String, Hashable {
    case real   // real-world structure (LiDAR / plane raycast)
    case model  // the virtual AR design model

    /// Short tag for labels/logs.
    var tag: String {
        switch self {
        case .real: return "R"
        case .model: return "M"
        }
    }
}

struct DistanceMeasurement: Identifiable, Hashable {
    let id = UUID()
    let timestamp: Date
    let pointA: SIMD3<Float>
    let pointB: SIMD3<Float>
    var sourceA: MeasurementPointSource = .real
    var sourceB: MeasurementPointSource = .real
    /// User-entered label (e.g. "가로철근-1"). Shown next to the value and
    /// included in captures/uploads. Empty = unnamed (shows distance only).
    var name: String = ""

    var distanceMeters: Float { simd_distance(pointA, pointB) }

    /// True when one endpoint is on the design model and the other is on the
    /// real structure — i.e. this is a model↔structure deviation measurement.
    var isModelToStructure: Bool { sourceA != sourceB }

    static func formattedDistance(_ meters: Float) -> String {
        if meters < 0.01 {
            return String(format: "%.1f mm", meters * 1000)
        } else if meters < 1.0 {
            return String(format: "%.1f cm", meters * 100)
        }
        return String(format: "%.2f m", meters)
    }
}
