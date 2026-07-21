import SwiftUI

/// SF Pro Text for UI labels; SF Mono for **every** numeric readout
/// (coordinates, angles, steps, diagnostics). No mixing.
enum LHTypography {
    // Labels (SF Pro)
    static let label: Font = .system(.caption, design: .default)
    static let labelBold: Font = .system(.caption, design: .default).weight(.semibold)
    static let title: Font = .system(.title3, design: .default).weight(.semibold)
    static let body: Font = .system(.body, design: .default)

    // Numeric readouts (SF Mono)
    static let mono: Font = .system(.footnote, design: .monospaced)
    static let monoBold: Font = .system(.footnote, design: .monospaced).weight(.semibold)
    static let monoCaption: Font = .system(.caption, design: .monospaced)
    static let monoSmall: Font = .system(.caption2, design: .monospaced)
    static let monoHeader: Font = .system(.title3, design: .monospaced)
}
