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
    /// 길이 측정 — LH 전용. 발주처 기능표의 분류 그대로다.
    /// (이력: 2026-08-05 에 "두 앱 모두 유지"로 뒤집혔다가 2026-08-20 에 사용자가
    ///  다시 표대로 되돌렸다. 아래 #else 분기 주석 참조.)
    static let measurement = true
    /// 철근 계층별 필터 — LH 전용 앱 전용. 부위순(부재>면>기능, 발주처 분류표
    /// 그대로)과 종류순(종류>위치, 분류표의 kind 컬럼 기준) 두 축을 전환 토글로
    /// 제공한다(2026-08-18). 발주처 기능표의 "철근 종류별 필터링"이 곧 종류순 축이다.
    static let rebarFilter = true
    static let appName = "LH 철근검측"
    #else
    static let liveShare = true
    /// 길이 측정 — 연구과제 앱에서는 끈다. 발주처 기능표가 LH 전용으로 분류한
    /// 대로다.
    ///
    /// ★ 이 값은 두 번 뒤집혔다. 되돌리기 전에 이력을 읽을 것:
    ///   2026-08-04  기능표대로 LH 전용(false)으로 설계
    ///   2026-08-05  "이미 현장 검증까지 끝난 기존 기능이라 빼면 순손실"이라는
    ///               판단으로 사용자가 두 앱 모두 유지(true)로 결정
    ///   2026-08-20  사용자가 다시 연구과제 앱에서 제거(false)하기로 결정 —
    ///               연구과제 앱은 오차 시각화가 그 자리를 대신한다
    ///
    /// 끄면 `ARPlacementView` 의 8개 지점이 함께 막힌다(탭 처리·이름 프롬프트·
    /// 힌트 배너·활성 오버레이·상단바 토글·캡처 푸터). `Measurement/` 소스는
    /// 지우지 않는다 — LH 앱이 쓴다.
    static let measurement = false
    static let rebarFilter = false
    static let appName = "철근 AR 연구"
    #endif
}
