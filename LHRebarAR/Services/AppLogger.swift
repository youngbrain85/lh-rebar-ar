import Foundation
import os

/// Lightweight logging facade. Writes each event to:
///  - the unified system log (visible in Console.app on a connected Mac)
///  - a tab-separated file inside the app's Documents directory so testers
///    can review or share the history later via Files app / share sheet.
@MainActor
final class AppLogger {
    static let shared = AppLogger()

    private let logger = os.Logger(subsystem: "kr.lh.rebar-ar", category: "placement")
    private let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    let placementLogURL: URL = {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        return docs.appendingPathComponent("placements.log")
    }()

    let jitterLogURL: URL = {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        return docs.appendingPathComponent("jitter.log")
    }()

    let measurementLogURL: URL = {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        return docs.appendingPathComponent("measurements.log")
    }()

    private init() {}

    func logPlacementLatency(_ ms: Double, hitSource: String) {
        logger.notice("placement \(ms, privacy: .public) ms hit=\(hitSource, privacy: .public)")
        let line = "\(isoFormatter.string(from: Date()))\t\(String(format: "%.2f", ms))\tms\t\(hitSource)"
        appendLine(line, to: placementLogURL)
    }

    func logJitterResult(_ result: JitterResult) {
        let stable = result.stableTracking ? "stable" : "tracking-disturbed"
        logger.notice(
            "jitter posStd=\(result.positionStdDevMm, privacy: .public) mm rotStd=\(result.rotationStdDevDeg, privacy: .public) deg samples=\(result.sampleCount, privacy: .public) tracking=\(stable, privacy: .public)"
        )
        let line = [
            isoFormatter.string(from: result.timestamp),
            "duration_s=\(result.durationSeconds)",
            "samples=\(result.sampleCount)",
            "pos_std_mm=\(String(format: "%.2f", result.positionStdDevMm))",
            "pos_max_mm=\(String(format: "%.2f", result.positionMaxMm))",
            "rot_std_deg=\(String(format: "%.3f", result.rotationStdDevDeg))",
            "rot_max_deg=\(String(format: "%.3f", result.rotationMaxDeg))",
            "tracking=\(stable)"
        ].joined(separator: "\t")
        appendLine(line, to: jitterLogURL)
    }

    func clearPlacementLog() {
        try? FileManager.default.removeItem(at: placementLogURL)
        logger.notice("placement log cleared")
    }

    func clearJitterLog() {
        try? FileManager.default.removeItem(at: jitterLogURL)
        logger.notice("jitter log cleared")
    }

    func logMeasurement(_ m: DistanceMeasurement) {
        let meters = m.distanceMeters
        let kind = "\(m.sourceA.rawValue)->\(m.sourceB.rawValue)"
        logger.notice("measurement \(meters, privacy: .public) m \(kind, privacy: .public)")
        let line = [
            isoFormatter.string(from: m.timestamp),
            String(format: "%.4f", meters),
            "m",
            kind,
            String(format: "A=%.3f,%.3f,%.3f", m.pointA.x, m.pointA.y, m.pointA.z),
            String(format: "B=%.3f,%.3f,%.3f", m.pointB.x, m.pointB.y, m.pointB.z)
        ].joined(separator: "\t")
        appendLine(line, to: measurementLogURL)
    }

    func clearMeasurementLog() {
        try? FileManager.default.removeItem(at: measurementLogURL)
        logger.notice("measurement log cleared")
    }

    private func appendLine(_ line: String, to url: URL) {
        let payload = (line + "\n").data(using: .utf8) ?? Data()
        if FileManager.default.fileExists(atPath: url.path) {
            if let handle = try? FileHandle(forWritingTo: url) {
                defer { try? handle.close() }
                _ = try? handle.seekToEnd()
                try? handle.write(contentsOf: payload)
            }
        } else {
            try? payload.write(to: url, options: .atomic)
        }
    }
}
