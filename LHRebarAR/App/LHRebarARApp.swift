import SwiftUI

@main
struct LHRebarARApp: App {
    init() {
        UIApplication.shared.isIdleTimerDisabled = true
    }

    var body: some Scene {
        WindowGroup {
            AppRootView()
        }
    }
}
