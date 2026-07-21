#if DEBUG
import SwiftUI

struct ARDiagnosticsHUD: View {
    @ObservedObject var diagnostics: ARDiagnostics

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            row("fps", String(format: "%.1f", diagnostics.fps))
            row("anchors", "\(diagnostics.anchorCount)")
            row("mesh", "\(diagnostics.meshAnchorCount)")
            row("state", diagnostics.trackingReasonSummary)
            row("uptime", formatUptime(diagnostics.uptimeSeconds))
        }
        .font(LHTypography.monoSmall)
        .padding(.horizontal, LHSpacing.md)
        .padding(.vertical, LHSpacing.sm)
        .background(LHColors.overlay,
                    in: RoundedRectangle(cornerRadius: LHSpacing.radiusSmall))
        .foregroundStyle(.white)
    }

    private func row(_ key: String, _ value: String) -> some View {
        HStack(spacing: LHSpacing.sm) {
            Text(key)
                .foregroundStyle(.white.opacity(0.55))
                .frame(width: 48, alignment: .leading)
            Text(value)
                .monospacedDigit()
        }
    }

    private func formatUptime(_ seconds: TimeInterval) -> String {
        let total = Int(seconds)
        let s = total % 60
        let m = (total / 60) % 60
        let h = total / 3600
        return h > 0
            ? String(format: "%d:%02d:%02d", h, m, s)
            : String(format: "%02d:%02d", m, s)
    }
}
#endif
