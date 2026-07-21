import SwiftUI

struct FineAdjustPad: View {
    @ObservedObject var vm: FineAdjustmentViewModel
    @Binding var modelOpacity: Float
    /// Optional close action. When provided, an X button appears in the top
    /// right so the user can collapse the pad.
    var onClose: (() -> Void)?

    /// Layout mode. `.bottomSheet` packs axes horizontally for iPhone.
    /// `.sidePanel` stacks axes vertically for iPad.
    enum Layout { case bottomSheet, sidePanel }
    let layout: Layout

    var body: some View {
        VStack(spacing: LHSpacing.lg) {
            if let onClose {
                padHeader(onClose: onClose)
            }
            translationSection
            rotationSection
            opacitySection
            undoRedoBar
        }
        .padding(LHSpacing.lg)
        .background(
            Color.black.opacity(0.35),
            in: RoundedRectangle(cornerRadius: LHSpacing.radiusLarge)
        )
    }

    private func padHeader(onClose: @escaping () -> Void) -> some View {
        HStack {
            Text("Adjust")
                .font(LHTypography.monoCaption.weight(.semibold))
                .foregroundStyle(.white)
            Spacer()
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 28, height: 28)
                    .background(Color.white.opacity(0.15), in: Circle())
            }
        }
    }

    // MARK: - Opacity

    private var opacitySection: some View {
        VStack(alignment: .leading, spacing: LHSpacing.sm) {
            HStack {
                Text("Opacity")
                    .font(LHTypography.monoCaption.weight(.semibold))
                    .foregroundStyle(LHColors.mutedInk)
                Spacer()
                Text("\(Int((modelOpacity * 100).rounded()))%")
                    .font(LHTypography.monoSmall)
                    .monospacedDigit()
                    .foregroundStyle(LHColors.ink)
            }
            Slider(
                value: Binding(
                    get: { Double(modelOpacity) },
                    set: { modelOpacity = Float($0) }
                ),
                in: 0.0...1.0
            )
            .tint(LHColors.accent)
        }
    }

    // MARK: - Sections

    private var translationSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionHeader(title: "Translation") {
                stepChips(
                    selection: vm.translationStep,
                    options: FineAdjustmentViewModel.TranslationStep.allCases,
                    label: { $0.display },
                    onSelect: { vm.translationStep = $0; HapticsService.shared.impact() }
                )
            }
            axisRow(axes: [.x, .y, .z], valueFor: translationValueText)
        }
    }

    private var rotationSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionHeader(title: "Rotation") {
                stepChips(
                    selection: vm.rotationStep,
                    options: FineAdjustmentViewModel.RotationStep.allCases,
                    label: { $0.display },
                    onSelect: { vm.rotationStep = $0; HapticsService.shared.impact() }
                )
            }
            axisRow(axes: [.rx, .ry, .rz], valueFor: rotationValueText)
        }
    }

    @ViewBuilder
    private func axisRow(
        axes: [FineAdjustmentViewModel.Axis],
        valueFor: @escaping (FineAdjustmentViewModel.Axis) -> String
    ) -> some View {
        // Both layouts stack axes vertically; bottomSheet just uses tighter
        // spacing so the pad stays compact vertically on iPhone portrait.
        VStack(spacing: layout == .bottomSheet ? LHSpacing.xs : LHSpacing.sm + 2) {
            ForEach(axes) { axis in
                NumericStepper(
                    axisLabel: axis.label,
                    valueText: valueFor(axis),
                    onStep: { sign in vm.nudge(axis, sign: sign) }
                )
                .frame(maxWidth: .infinity)
            }
        }
    }

    // MARK: - Header / chips / readouts

    private func sectionHeader<Content: View>(
        title: String,
        @ViewBuilder trailing: () -> Content
    ) -> some View {
        HStack {
            Text(title)
                .font(LHTypography.monoCaption.weight(.semibold))
                .foregroundStyle(LHColors.mutedInk)
            Spacer()
            trailing()
        }
    }

    private func stepChips<T: Identifiable & Equatable>(
        selection: T,
        options: [T],
        label: @escaping (T) -> String,
        onSelect: @escaping (T) -> Void
    ) -> some View {
        HStack(spacing: LHSpacing.xs) {
            ForEach(options) { opt in
                Button {
                    onSelect(opt)
                } label: {
                    Text(label(opt))
                        .font(LHTypography.monoSmall)
                        .padding(.horizontal, LHSpacing.sm + 2)
                        .padding(.vertical, LHSpacing.xs)
                        .background(
                            opt == selection
                            ? LHColors.accent.opacity(0.9)
                            : Color.black.opacity(0.25),
                            in: Capsule()
                        )
                        .foregroundStyle(opt == selection ? .white : LHColors.ink)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var undoRedoBar: some View {
        HStack(spacing: LHSpacing.md) {
            Button {
                vm.undo(); HapticsService.shared.impact()
            } label: {
                Label("Undo", systemImage: "arrow.uturn.backward")
                    .font(LHTypography.monoCaption)
            }
            .disabled(!vm.canUndo)

            Spacer()

            Button {
                vm.redo(); HapticsService.shared.impact()
            } label: {
                Label("Redo", systemImage: "arrow.uturn.forward")
                    .font(LHTypography.monoCaption)
            }
            .disabled(!vm.canRedo)
        }
    }

    // MARK: - Value text

    private func translationValueText(for axis: FineAdjustmentViewModel.Axis) -> String {
        let (x, y, z) = vm.translationReadoutMm
        let v: Float
        switch axis {
        case .x: v = x; case .y: v = y; case .z: v = z
        default: v = 0
        }
        return String(format: "%+.1f mm", v)
    }

    private func rotationValueText(for axis: FineAdjustmentViewModel.Axis) -> String {
        let (rx, ry, rz) = vm.rotationReadoutDeg
        let v: Float
        switch axis {
        case .rx: v = rx; case .ry: v = ry; case .rz: v = rz
        default: v = 0
        }
        return String(format: "%+.1f°", v)
    }
}
