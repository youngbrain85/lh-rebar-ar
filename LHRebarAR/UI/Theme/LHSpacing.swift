import CoreGraphics

enum LHSpacing {
    static let xxs: CGFloat = 2
    static let xs: CGFloat = 4
    static let sm: CGFloat = 6
    static let md: CGFloat = 10
    static let lg: CGFloat = 14
    static let xl: CGFloat = 20

    static let radiusSmall: CGFloat = 8
    static let radiusMedium: CGFloat = 12
    static let radiusLarge: CGFloat = 16

    static let badgeDot: CGFloat = 8

    // MARK: - 터치 대상
    //
    // ★ 44pt 는 Apple HIG 의 최소 권장치다. 임의로 낮추지 말 것.
    //   `docs/design-system.md` §8 의 「클릭 대상 최소 32×32px」은 **대시보드용**
    //   규칙이다 — 브라우저 + 마우스 + CSS px 기준. 그 값이 여기로 복사돼 있었고,
    //   현장에서 "누르기가 너무 어렵다"는 피드백으로 돌아왔다(2026-08-20, 기기 실사용).
    //   iOS 는 단위가 pt 이고 입력이 장갑 낀 손가락이다. 두 플랫폼이 갈리는 게
    //   아니라 입력 장치가 다른 것이다.

    /// 미세조정 스테퍼 버튼 (mm / 0.1° 를 반복해서 누른다)
    static let stepButton: CGFloat = 44
    /// 상단바 아이콘 버튼 — 측정·재고정·철근트리·공유·삭제 등
    static let iconChip: CGFloat = 44
    /// 위 두 버튼 안에 들어가는 SF Symbol 글리프 크기
    static let iconGlyph: CGFloat = 17

    static let sidePanelWidth: CGFloat = 320
}
