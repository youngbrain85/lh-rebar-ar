import SwiftUI

struct StatusBadge: View {
    let label: String
    let tint: Color

    var body: some View {
        HStack(spacing: LHSpacing.sm) {
            Circle()
                .fill(tint)
                .frame(width: LHSpacing.badgeDot, height: LHSpacing.badgeDot)
            Text(label)
                .font(LHTypography.monoCaption)
                .foregroundStyle(.white)
        }
        .padding(.horizontal, LHSpacing.md)
        .padding(.vertical, LHSpacing.sm)
        .background(LHColors.overlay, in: Capsule())
    }
}

#Preview {
    VStack(spacing: 8) {
        StatusBadge(label: "Tracking", tint: LHColors.statusOK)
        StatusBadge(label: "Initializing", tint: LHColors.statusWarning)
        StatusBadge(label: "N/A", tint: LHColors.statusError)
    }
    .padding()
    .background(.gray)
}
