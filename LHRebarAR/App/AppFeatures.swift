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
    /// 길이 측정 — 두 앱 모두 켠다. 발주처 기능표는 LH 전용으로 분류했지만,
    /// 이미 현장 검증까지 끝난 기존 기능이라 연구과제 앱에서 빼면 순손실이라고
    /// 판단해 사용자가 유지하기로 결정했다(2026-08). 두 앱의 실질적인 기능
    /// 차이는 실시간 협업(그리고 추후 철근 종류별 필터링)만 남는다.
    static let measurement = true
    /// 철근 계층(부위/면/방향)별 필터 — LH 전용 앱 전용.
    /// 발주처 기능표의 "철근 종류별 필터링"과 축이 다르다 — 이건 옹벽의 부위 계층
    /// (전벽/저판/헌치 × 면 × 방향)이고, 주철근/스터럽 같은 종류 축은 아직 없다.
    static let rebarFilter = true
    static let appName = "LH 철근검측"
    #else
    static let liveShare = true
    /// 길이 측정 — 발주처 기능표는 LH 전용으로 분류했지만, 이미 현장 검증까지
    /// 끝난 기존 기능이라 연구과제 앱에서 빼면 순손실이라고 판단해 사용자가
    /// 두 앱 모두에 유지하기로 결정했다(2026-08). 위 LH_ONLY 분기의 설명과
    /// 같은 이유이니, 표에 맞춰 false로 "고치지" 말 것.
    static let measurement = true
    static let rebarFilter = false
    static let appName = "철근 AR 연구"
    #endif
}
