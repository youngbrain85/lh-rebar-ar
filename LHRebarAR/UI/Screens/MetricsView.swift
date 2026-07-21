import SwiftUI

/// One sheet that surfaces every QA metric the app measures:
///   * Frame-pipeline latency (live)
///   * Jitter test (one-shot)
///   * Placement-latency log (per-tap history)
struct MetricsView: View {
    @ObservedObject var quality: QualityMetrics
    let placementHistory: [PlacementMeasurement]
    let placementLogURL: URL
    let jitterLogURL: URL
    let onClearPlacements: () -> Void
    let onClearJitter: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var shareItems: [Any]?

    private static let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "MM-dd HH:mm:ss"
        return f
    }()

    var body: some View {
        NavigationStack {
            List {
                trackingLatencySection
                jitterSection
                placementSection
            }
            .navigationTitle("Quality Metrics")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Done") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button {
                            shareItems = [placementLogURL, jitterLogURL]
                        } label: {
                            Label("Share log files", systemImage: "square.and.arrow.up")
                        }
                        Button(role: .destructive) {
                            onClearPlacements()
                            onClearJitter()
                        } label: {
                            Label("Clear all logs", systemImage: "trash")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .sheet(isPresented: Binding(
                get: { shareItems != nil },
                set: { if !$0 { shareItems = nil } }
            )) {
                if let items = shareItems {
                    ShareSheet(items: items)
                }
            }
        }
    }

    // MARK: - Tracking latency

    private var trackingLatencySection: some View {
        Section {
            HStack(spacing: LHSpacing.lg) {
                stat(label: "avg", value: quality.totalLatencyAvgMs)
                stat(label: "p95", value: quality.totalLatencyP95Ms)
                stat(label: "max", value: quality.totalLatencyMaxMs)
            }
            .padding(.vertical, LHSpacing.xs)

            VStack(alignment: .leading, spacing: 4) {
                Text(String(
                    format: "ARKit pipeline avg %.1f ms + display refresh %.1f ms (%d Hz).",
                    quality.frameLatencyAvgMs,
                    quality.displayLatencyMs,
                    quality.displayFps
                ))
                .font(LHTypography.monoSmall)
                .foregroundStyle(LHColors.mutedInk)

                Text(
                    "Note: GPU render time is not included; on modern A-series chips "
                    + "this is typically a fraction of one frame. For exact motion-to-screen "
                    + "delay, an external high-speed camera is required."
                )
                .font(LHTypography.monoSmall)
                .foregroundStyle(LHColors.mutedInk)
            }
            .padding(.vertical, LHSpacing.xs)
        } header: {
            Text("Estimated motion-to-screen latency")
        }
    }

    // MARK: - Jitter

    private var jitterSection: some View {
        Section {
            switch quality.jitterPhase {
            case .idle:
                HStack {
                    Button {
                        quality.startJitterTest(prepSeconds: 3, sampleSeconds: 10)
                        HapticsService.shared.impact()
                    } label: {
                        Label("Run jitter test", systemImage: "scope")
                            .font(LHTypography.body)
                    }
                    Spacer()
                    Text("3s prep + 10s")
                        .font(LHTypography.monoSmall)
                        .foregroundStyle(LHColors.mutedInk)
                }
            case .preparing(let s):
                HStack(spacing: LHSpacing.md) {
                    ProgressView()
                    Text("Get ready, hold still… \(s)s")
                        .font(LHTypography.mono)
                    Spacer()
                    Button("Cancel") {
                        quality.cancelJitterTest()
                    }
                    .foregroundStyle(LHColors.statusError)
                }
            case .sampling(let s):
                HStack(spacing: LHSpacing.md) {
                    ProgressView()
                    Text("Sampling… \(s)s remaining")
                        .font(LHTypography.mono)
                    Spacer()
                    Button("Cancel") {
                        quality.cancelJitterTest()
                    }
                    .foregroundStyle(LHColors.statusError)
                }
            }

            if let r = quality.lastJitterResult {
                VStack(alignment: .leading, spacing: LHSpacing.sm) {
                    HStack(spacing: LHSpacing.lg) {
                        stat(label: "pos σ", unit: "mm", value: r.positionStdDevMm)
                        stat(label: "pos max", unit: "mm", value: r.positionMaxMm)
                    }
                    HStack(spacing: LHSpacing.lg) {
                        stat(label: "rot σ", unit: "°", value: r.rotationStdDevDeg, fmt: "%.3f")
                        stat(label: "rot max", unit: "°", value: r.rotationMaxDeg, fmt: "%.3f")
                    }
                    Text("\(r.sampleCount) samples over \(r.durationSeconds)s · \(r.stableTracking ? "stable" : "tracking disturbed") · \(Self.timeFormatter.string(from: r.timestamp))")
                        .font(LHTypography.monoSmall)
                        .foregroundStyle(LHColors.mutedInk)
                }
                .padding(.vertical, LHSpacing.xs)
            }

            footnote(
                "Place the device on a stable surface. After tapping run, "
                + "hold still through the 3-second countdown. The 10-second "
                + "sampling window starts when the countdown ends. Position σ "
                + "< 1 mm and rotation σ < 0.05° is typical for LiDAR + "
                + "featureful scenes."
            )
        } header: {
            Text("Jitter (stationary)")
        }
    }

    // MARK: - Placement log

    private var placementSection: some View {
        Section {
            if placementHistory.isEmpty {
                Text("No placements yet.")
                    .font(LHTypography.monoCaption)
                    .foregroundStyle(LHColors.mutedInk)
            } else {
                placementSummary
                ForEach(placementHistory.reversed().prefix(20)) { m in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(Self.timeFormatter.string(from: m.timestamp))
                                .font(LHTypography.monoCaption)
                            Text(m.sourceLabel)
                                .font(LHTypography.monoSmall)
                                .foregroundStyle(LHColors.mutedInk)
                        }
                        Spacer()
                        Text(String(format: "%.1f ms", m.durationMs))
                            .font(LHTypography.mono.weight(.semibold))
                            .monospacedDigit()
                    }
                }
                if placementHistory.count > 20 {
                    Text("Showing last 20 of \(placementHistory.count). Full log in shared file.")
                        .font(LHTypography.monoSmall)
                        .foregroundStyle(LHColors.mutedInk)
                }
            }
        } header: {
            Text("Placement latency")
        }
    }

    private var placementSummary: some View {
        let durations = placementHistory.map(\.durationMs)
        let avg = durations.isEmpty ? 0 : durations.reduce(0, +) / Double(durations.count)
        let mn = durations.min() ?? 0
        let mx = durations.max() ?? 0
        return HStack(spacing: LHSpacing.lg) {
            stat(label: "avg", value: avg)
            stat(label: "min", value: mn)
            stat(label: "max", value: mx)
        }
        .padding(.vertical, LHSpacing.xs)
    }

    // MARK: - Building blocks

    private func stat(label: String, unit: String = "ms", value: Double, fmt: String = "%.1f") -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(LHTypography.monoSmall)
                .foregroundStyle(LHColors.mutedInk)
            Text(String(format: fmt + " " + unit, value))
                .font(LHTypography.mono.weight(.semibold))
                .monospacedDigit()
        }
    }

    private func footnote(_ text: String) -> some View {
        Text(text)
            .font(LHTypography.monoSmall)
            .foregroundStyle(LHColors.mutedInk)
            .padding(.vertical, LHSpacing.xs)
    }
}

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
