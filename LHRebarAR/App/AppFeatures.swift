// LHRebarAR/App/AppFeatures.swift
import Foundation

/// 앱별 기능 스위치.
///
/// 발주처 요청(AR 앱 등 요청사항_260803.pdf)으로 앱을 둘로 나눈다. 두 타겟은 **같은 소스를
/// 전부** 포함하고, 이 파일의 `LH_ONLY` 플래그만으로 화면에 무엇을 보일지 가른다.
/// 두 앱의 차이를 알고 싶으면 이 파일만 보면 된다 — 다른 곳에 분기를 흩지 말 것.
enum AppFeatures {
    #if LH_ONLY
    /// 실시간 다자간 협업 — 연구과제 앱 전용
    static let liveShare = false
    /// 길이 측정 — LH 전용 앱 전용
    static let measurement = true
    /// 철근 종류별 필터링 — LH 전용 앱 전용 (아직 미구현)
    static let rebarFilter = true
    static let appName = "LH 철근검측"
    #else
    static let liveShare = true
    static let measurement = false
    static let rebarFilter = false
    static let appName = "철근 AR 연구"
    #endif
}
