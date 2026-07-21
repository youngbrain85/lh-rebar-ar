import SwiftUI

struct AppRootView: View {
    var body: some View {
        if ARSessionManager.isLiDARSupported {
            SiteListView()
        } else {
            UnsupportedDeviceView()
        }
    }
}

struct UnsupportedDeviceView: View {
    var body: some View {
        VStack(spacing: LHSpacing.lg - 2) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.largeTitle)
                .foregroundStyle(LHColors.adjusting)
            Text("LiDAR 센서가 필요합니다")
                .font(LHTypography.monoHeader)
            Text("iPad Pro (M1 이상) 또는 iPhone 12 Pro 이상에서\n실행해 주세요.")
                .font(LHTypography.mono)
                .foregroundStyle(LHColors.mutedInk)
                .multilineTextAlignment(.center)
        }
        .padding()
    }
}

#Preview {
    UnsupportedDeviceView()
}
