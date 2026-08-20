import SwiftUI

struct PrimaryActionButton: View {
    enum Variant { case filled, tinted, subtle }

    let title: String
    var systemImage: String?
    var variant: Variant = .filled
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: LHSpacing.sm) {
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(.system(size: LHSpacing.iconGlyph, weight: .semibold))
                }
                Text(title)
                    .font(LHTypography.labelBold)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
            // 세로 패딩(10+10)에 caption 한 줄을 더해도 ~36pt 라 HIG 하한에 못 미쳤다.
            // 하한을 명시해 둔다 — 패딩을 만지다 다시 44 아래로 내려가지 않게.
            .frame(minHeight: LHSpacing.iconChip)
            .background(background, in: Capsule())
            .foregroundStyle(foreground)
        }
    }

    private var background: some ShapeStyle {
        switch variant {
        case .filled: return AnyShapeStyle(LHColors.accent)
        case .tinted: return AnyShapeStyle(LHColors.accent.opacity(0.2))
        case .subtle: return AnyShapeStyle(LHColors.overlayStrong)
        }
    }

    private var foreground: some ShapeStyle {
        switch variant {
        case .filled: return AnyShapeStyle(Color.white)
        case .tinted: return AnyShapeStyle(LHColors.accent)
        case .subtle: return AnyShapeStyle(Color.white)
        }
    }
}

#Preview {
    VStack(spacing: 12) {
        PrimaryActionButton(title: "Place", systemImage: "scope") {}
        PrimaryActionButton(title: "Reset", systemImage: "arrow.counterclockwise", variant: .tinted) {}
        PrimaryActionButton(title: "Remove", systemImage: "trash", variant: .subtle) {}
    }
    .padding()
    .background(.gray)
}
