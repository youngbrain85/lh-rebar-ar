import SwiftUI

enum LHColors {
    /// Engineering-orange accent. Defined in Assets.xcassets → AccentColor.
    static let accent = Color.accentColor

    // Ink (text on opaque surfaces, light/dark adaptive)
    static let ink = Color.primary
    static let mutedInk = Color.secondary

    // Overlay backgrounds sitting on top of the AR camera feed.
    static let overlay = Color.black.opacity(0.55)
    static let overlayStrong = Color.black.opacity(0.75)

    // Tracking state indicator
    static let statusOK = Color.green
    static let statusWarning = Color.yellow
    static let statusError = Color.red

    // Placement workflow states
    static let placed = Color.cyan
    static let adjusting = Color.orange
    static let locked = Color.green
    static let neutral = Color.white
    static let idle = Color.gray
}
