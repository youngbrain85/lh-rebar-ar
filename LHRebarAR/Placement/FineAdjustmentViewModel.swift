import Combine
import Foundation
import RealityKit
import simd

/// Stores all fine-adjustment state as integers to avoid float drift.
/// Translation unit: 1/10 mm (so 1 mm = 10, 1 cm = 100).
/// Rotation unit:    1/10 degree (so 1° = 10, 0.1° = 1).
@MainActor
final class FineAdjustmentViewModel: ObservableObject {
    struct Delta: Equatable {
        var tx10: Int = 0
        var ty10: Int = 0
        var tz10: Int = 0
        var rx10: Int = 0
        var ry10: Int = 0
        var rz10: Int = 0

        static let zero = Delta()
    }

    enum Axis: String, CaseIterable, Identifiable {
        case x, y, z, rx, ry, rz
        var id: String { rawValue }
        var isRotation: Bool {
            switch self {
            case .rx, .ry, .rz: return true
            default: return false
            }
        }
        var label: String {
            switch self {
            case .x: return "X"; case .y: return "Y"; case .z: return "Z"
            case .rx: return "Rx"; case .ry: return "Ry"; case .rz: return "Rz"
            }
        }
    }

    enum TranslationStep: Int, CaseIterable, Identifiable {
        case mm1 = 1, mm5 = 5, mm10 = 10, mm50 = 50
        var id: Int { rawValue }
        /// 1/10 mm per click.
        var tenthMm: Int { rawValue * 10 }
        var display: String { "\(rawValue) mm" }
    }

    enum RotationStep: Int, CaseIterable, Identifiable {
        case deg01 = 1   // 0.1°
        case deg05 = 5   // 0.5°
        case deg10 = 10  // 1.0°
        var id: Int { rawValue }
        /// 1/10 degree per click.
        var tenthDeg: Int { rawValue }
        var display: String {
            switch self {
            case .deg01: return "0.1°"
            case .deg05: return "0.5°"
            case .deg10: return "1°"
            }
        }
    }

    // MARK: - Published state

    @Published private(set) var delta: Delta = .zero
    @Published var translationStep: TranslationStep = .mm1
    @Published var rotationStep: RotationStep = .deg01
    @Published private(set) var canUndo: Bool = false
    @Published private(set) var canRedo: Bool = false

    // MARK: - Undo/redo

    private var undoStack: [Delta] = []
    private var redoStack: [Delta] = []
    private let capacity = 50

    // MARK: - Base transform (captured after placement / coarse gesture end)

    private weak var anchorController: ModelAnchorController?
    private var baseTranslation: SIMD3<Float> = .zero
    private var baseRotation: simd_quatf = simd_quatf(ix: 0, iy: 0, iz: 0, r: 1)

    /// Fine adjustments accumulated across re-baselines (pad close, gesture
    /// end, re-lock). The readout shows accumulated + current so closing and
    /// reopening the pad no longer appears to "reset" the values (field
    /// feedback 그림 1-2); it only resets when the placement is removed.
    private var accumulated: Delta = .zero

    // MARK: - Setup

    func bind(to controller: ModelAnchorController) {
        anchorController = controller
    }

    /// Capture the current placementRoot world transform as the base and reset
    /// fine delta + undo history. Called after initial placement and after
    /// each coarse gesture ends, so fine deltas are always additive on top of
    /// the latest coarse pose.
    func captureBase() {
        guard let root = anchorController?.placementRoot else { return }
        let m = root.transformMatrix(relativeTo: nil)
        baseTranslation = m.translation
        baseRotation = simd_quatf(m)
        // Roll the session delta into the running total before zeroing, so the
        // readout keeps showing the cumulative adjustment since placement.
        accumulated.tx10 += delta.tx10
        accumulated.ty10 += delta.ty10
        accumulated.tz10 += delta.tz10
        accumulated.rx10 += delta.rx10
        accumulated.ry10 += delta.ry10
        accumulated.rz10 += delta.rz10
        delta = .zero
        undoStack.removeAll()
        redoStack.removeAll()
        refreshUndoRedoFlags()
    }

    func clear() {
        delta = .zero
        accumulated = .zero
        undoStack.removeAll()
        redoStack.removeAll()
        baseTranslation = .zero
        baseRotation = simd_quatf(ix: 0, iy: 0, iz: 0, r: 1)
        refreshUndoRedoFlags()
    }

    // MARK: - Nudging

    /// One step in the given axis, sign = +1 or -1.
    func nudge(_ axis: Axis, sign: Int) {
        guard sign == 1 || sign == -1 else { return }
        var next = delta
        switch axis {
        case .x: next.tx10 += sign * translationStep.tenthMm
        case .y: next.ty10 += sign * translationStep.tenthMm
        case .z: next.tz10 += sign * translationStep.tenthMm
        case .rx: next.rx10 += sign * rotationStep.tenthDeg
        case .ry: next.ry10 += sign * rotationStep.tenthDeg
        case .rz: next.rz10 += sign * rotationStep.tenthDeg
        }
        pushUndo(current: delta)
        redoStack.removeAll()
        delta = next
        apply()
        refreshUndoRedoFlags()
    }

    func undo() {
        guard let prev = undoStack.popLast() else { return }
        redoStack.append(delta)
        trim(&redoStack)
        delta = prev
        apply()
        refreshUndoRedoFlags()
    }

    func redo() {
        guard let next = redoStack.popLast() else { return }
        undoStack.append(delta)
        trim(&undoStack)
        delta = next
        apply()
        refreshUndoRedoFlags()
    }

    // MARK: - Readouts

    var translationReadoutMm: (Float, Float, Float) {
        (
            Float(accumulated.tx10 + delta.tx10) / 10,
            Float(accumulated.ty10 + delta.ty10) / 10,
            Float(accumulated.tz10 + delta.tz10) / 10
        )
    }

    var rotationReadoutDeg: (Float, Float, Float) {
        (
            Float(accumulated.rx10 + delta.rx10) / 10,
            Float(accumulated.ry10 + delta.ry10) / 10,
            Float(accumulated.rz10 + delta.rz10) / 10
        )
    }

    // MARK: - Internals

    private func pushUndo(current: Delta) {
        undoStack.append(current)
        trim(&undoStack)
    }

    private func trim(_ stack: inout [Delta]) {
        if stack.count > capacity {
            stack.removeFirst(stack.count - capacity)
        }
    }

    private func refreshUndoRedoFlags() {
        canUndo = !undoStack.isEmpty
        canRedo = !redoStack.isEmpty
    }

    private func apply() {
        guard let root = anchorController?.placementRoot else { return }
        let tenthMmToMeters: Float = 1.0 / 10000.0  // 1 tenth-mm = 0.0001 m
        let tenthDegToRadians: Float = (.pi / 180.0) / 10.0

        let fineT = SIMD3<Float>(
            Float(delta.tx10) * tenthMmToMeters,
            Float(delta.ty10) * tenthMmToMeters,
            Float(delta.tz10) * tenthMmToMeters
        )
        let qx = simd_quatf(angle: Float(delta.rx10) * tenthDegToRadians, axis: [1, 0, 0])
        let qy = simd_quatf(angle: Float(delta.ry10) * tenthDegToRadians, axis: [0, 1, 0])
        let qz = simd_quatf(angle: Float(delta.rz10) * tenthDegToRadians, axis: [0, 0, 1])
        let fineR = qz * qy * qx  // Z ∘ Y ∘ X local-frame composition

        root.setPosition(baseTranslation + fineT, relativeTo: nil)
        root.setOrientation(baseRotation * fineR, relativeTo: nil)
    }
}
