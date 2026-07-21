import UIKit

@MainActor
final class HapticsService {
    static let shared = HapticsService()

    private let selection = UISelectionFeedbackGenerator()
    private let lightImpact = UIImpactFeedbackGenerator(style: .light)
    private let notification = UINotificationFeedbackGenerator()

    private init() {
        selection.prepare()
        lightImpact.prepare()
        notification.prepare()
    }

    /// Subtle click for per-step fine adjustment.
    func tick() {
        selection.selectionChanged()
    }

    /// Stronger beat used when a step-size changes or a long-press begins.
    func impact() {
        lightImpact.impactOccurred()
    }

    func success() {
        notification.notificationOccurred(.success)
    }
}
