import SwiftUI

/// Pressing −/+ fires one step immediately. Holding fires a rapid stream of
/// steps with haptic tick per step, after a short initial delay.
struct NumericStepper: View {
    let axisLabel: String
    let valueText: String
    let onStep: (Int) -> Void  // sign: +1 or -1

    var body: some View {
        HStack(spacing: LHSpacing.sm) {
            stepButton(sign: -1, systemName: "minus")
            VStack(spacing: 1) {
                Text(axisLabel)
                    .font(LHTypography.monoSmall.weight(.semibold))
                    .foregroundStyle(LHColors.mutedInk)
                Text(valueText)
                    .font(LHTypography.mono)
                    .monospacedDigit()
                    .foregroundStyle(LHColors.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity)
            stepButton(sign: +1, systemName: "plus")
        }
    }

    @ViewBuilder
    private func stepButton(sign: Int, systemName: String) -> some View {
        StepHoldButton(
            systemName: systemName,
            onFire: {
                onStep(sign)
                HapticsService.shared.tick()
            }
        )
    }
}

/// Isolated hold-to-repeat button. Extracted so its internal @State is local.
private struct StepHoldButton: View {
    static let initialDelay: Duration = .milliseconds(400)
    static let repeatInterval: Duration = .milliseconds(80)

    let systemName: String
    let onFire: () -> Void

    @State private var repeatTask: Task<Void, Never>?
    @State private var isPressing: Bool = false

    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: 14, weight: .semibold))
            .frame(width: LHSpacing.stepButton, height: LHSpacing.stepButton)
            .foregroundStyle(.white)
            .background(
                isPressing ? LHColors.overlayStrong : LHColors.overlay,
                in: Circle()
            )
            .contentShape(Circle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in
                        guard !isPressing else { return }
                        isPressing = true
                        onFire()
                        startRepeating()
                    }
                    .onEnded { _ in
                        isPressing = false
                        stopRepeating()
                    }
            )
            .accessibilityLabel(systemName == "plus" ? "Increment" : "Decrement")
    }

    private func startRepeating() {
        repeatTask?.cancel()
        repeatTask = Task { @MainActor in
            try? await Task.sleep(for: Self.initialDelay)
            while !Task.isCancelled {
                onFire()
                try? await Task.sleep(for: Self.repeatInterval)
            }
        }
    }

    private func stopRepeating() {
        repeatTask?.cancel()
        repeatTask = nil
    }
}

#Preview {
    @Previewable @State var v: Int = 0
    return VStack(spacing: 12) {
        NumericStepper(axisLabel: "X", valueText: "\(v) mm") { v += $0 }
        NumericStepper(axisLabel: "Ry", valueText: String(format: "%.1f°", Double(v) / 10)) { v += $0 }
    }
    .padding()
    .background(.gray)
}
