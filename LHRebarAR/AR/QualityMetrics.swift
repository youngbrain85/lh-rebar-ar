import ARKit
import Foundation
import QuartzCore
import UIKit
import simd

struct JitterResult: Hashable {
    let timestamp: Date
    let sampleCount: Int
    let durationSeconds: Int
    /// Std-dev of camera position around its centroid, in millimeters.
    let positionStdDevMm: Double
    /// Peak-to-centroid camera position deviation, in millimeters.
    let positionMaxMm: Double
    /// Std-dev of camera orientation deviation from the first sample, in degrees.
    let rotationStdDevDeg: Double
    /// Maximum orientation deviation in degrees.
    let rotationMaxDeg: Double
    /// Sustained tracking state for the duration of the test.
    let stableTracking: Bool
}

enum JitterPhase: Equatable {
    case idle
    case preparing(secondsLeft: Int)
    case sampling(secondsLeft: Int)

    var isActive: Bool { self != .idle }
    var isPreparing: Bool {
        if case .preparing = self { return true }
        return false
    }
    var isSampling: Bool {
        if case .sampling = self { return true }
        return false
    }
}

/// Live frame-pipeline latency + on-demand jitter test.
///
/// **Frame latency** = `CACurrentMediaTime() - ARFrame.timestamp` measured the
/// moment our delegate receives the frame (ARKit visual-inertial fusion).
/// We add an estimated **display latency** (one display-refresh interval at
/// the device's native frame rate) to approximate full motion-to-screen
/// delay. This estimate omits GPU render time, which on modern A-series chips
/// is typically a fraction of a frame at 60–120 Hz.
///
/// **Jitter test** runs in two phases: a 3-second countdown so the user can
/// stabilise the device, then a 10-second sampling window. Position and
/// rotation std-dev of the camera transform are reported.
@MainActor
final class QualityMetrics: ObservableObject {
    @Published private(set) var frameLatencyAvgMs: Double = 0
    @Published private(set) var frameLatencyP95Ms: Double = 0
    @Published private(set) var frameLatencyMaxMs: Double = 0

    @Published private(set) var jitterPhase: JitterPhase = .idle
    @Published private(set) var lastJitterResult: JitterResult?

    /// One display refresh interval (ms) for this device. 8.3 ms on a 120 Hz
    /// ProMotion display, 16.7 ms on a 60 Hz panel.
    let displayLatencyMs: Double
    let displayFps: Int

    private var latencyWindow: [Double] = []
    private let latencyWindowSize = 120
    private var sinceLastPublish = 0
    private let publishEvery = 8

    private var jitterSamples: [(SIMD3<Float>, simd_quatf, ARCamera.TrackingState)] = []
    private var jitterTask: Task<Void, Never>?

    init() {
        let fps = QualityMetrics.detectDisplayFps()
        self.displayFps = fps
        self.displayLatencyMs = 1000.0 / Double(fps)
    }

    // MARK: - Computed totals (motion → screen estimate)

    var totalLatencyAvgMs: Double { frameLatencyAvgMs + displayLatencyMs }
    var totalLatencyP95Ms: Double { frameLatencyP95Ms + displayLatencyMs }
    var totalLatencyMaxMs: Double { frameLatencyMaxMs + displayLatencyMs }

    // MARK: - Frame observation

    func reset() {
        latencyWindow.removeAll()
        sinceLastPublish = 0
        frameLatencyAvgMs = 0
        frameLatencyP95Ms = 0
        frameLatencyMaxMs = 0
    }

    func observe(frame: ARFrame) {
        let latencyMs = (CACurrentMediaTime() - frame.timestamp) * 1000.0
        latencyWindow.append(latencyMs)
        if latencyWindow.count > latencyWindowSize {
            latencyWindow.removeFirst(latencyWindow.count - latencyWindowSize)
        }
        sinceLastPublish += 1
        if sinceLastPublish >= publishEvery {
            sinceLastPublish = 0
            updateLatencyStats()
        }

        if jitterPhase.isSampling {
            let m = frame.camera.transform
            let pos = SIMD3<Float>(m.columns.3.x, m.columns.3.y, m.columns.3.z)
            let rot = simd_quatf(m)
            jitterSamples.append((pos, rot, frame.camera.trackingState))
        }
    }

    private func updateLatencyStats() {
        guard !latencyWindow.isEmpty else { return }
        let sorted = latencyWindow.sorted()
        let sum = latencyWindow.reduce(0, +)
        frameLatencyAvgMs = sum / Double(latencyWindow.count)
        frameLatencyMaxMs = sorted.last ?? 0
        let p95Index = max(0, min(sorted.count - 1, Int((Double(sorted.count - 1)) * 0.95)))
        frameLatencyP95Ms = sorted[p95Index]
    }

    // MARK: - Jitter test

    func startJitterTest(prepSeconds: Int = 3, sampleSeconds: Int = 10) {
        guard !jitterPhase.isActive else { return }
        jitterTask?.cancel()
        jitterTask = Task { @MainActor in
            for s in stride(from: prepSeconds, through: 1, by: -1) {
                guard !Task.isCancelled else { return }
                jitterPhase = .preparing(secondsLeft: s)
                try? await Task.sleep(for: .seconds(1))
            }
            jitterSamples.removeAll(keepingCapacity: true)
            for s in stride(from: sampleSeconds, through: 1, by: -1) {
                guard !Task.isCancelled else { return }
                jitterPhase = .sampling(secondsLeft: s)
                try? await Task.sleep(for: .seconds(1))
            }
            jitterPhase = .idle
            self.computeJitter(durationSeconds: sampleSeconds)
        }
    }

    func cancelJitterTest() {
        jitterTask?.cancel()
        jitterTask = nil
        jitterPhase = .idle
        jitterSamples.removeAll()
    }

    private func computeJitter(durationSeconds: Int) {
        guard jitterSamples.count > 10 else {
            lastJitterResult = nil
            return
        }
        let positions = jitterSamples.map(\.0)
        let centroid = positions.reduce(SIMD3<Float>(repeating: 0), +) / Float(positions.count)
        let posDevsMm = positions.map { simd_distance($0, centroid) * 1000.0 }
        let posVar = posDevsMm.map { Double($0 * $0) }.reduce(0, +) / Double(posDevsMm.count)
        let posStd = sqrt(posVar)
        let posMax = posDevsMm.map(Double.init).max() ?? 0

        let refRot = jitterSamples[0].1
        let rotDeltas: [Double] = jitterSamples.map { sample in
            let q = sample.1 * refRot.inverse
            return Double(abs(q.angle)) * 180.0 / .pi
        }
        let rotVar = rotDeltas.map { $0 * $0 }.reduce(0, +) / Double(rotDeltas.count)
        let rotStd = sqrt(rotVar)
        let rotMax = rotDeltas.max() ?? 0

        let stable = jitterSamples.allSatisfy { sample in
            if case .normal = sample.2 { return true }
            return false
        }

        let result = JitterResult(
            timestamp: Date(),
            sampleCount: jitterSamples.count,
            durationSeconds: durationSeconds,
            positionStdDevMm: Double(posStd),
            positionMaxMm: posMax,
            rotationStdDevDeg: rotStd,
            rotationMaxDeg: rotMax,
            stableTracking: stable
        )
        lastJitterResult = result
        AppLogger.shared.logJitterResult(result)
        jitterSamples.removeAll(keepingCapacity: true)
    }

    // MARK: - Display detection

    private static func detectDisplayFps() -> Int {
        if let scene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .first {
            let fps = scene.screen.maximumFramesPerSecond
            if fps > 0 { return fps }
        }
        return 60
    }
}
