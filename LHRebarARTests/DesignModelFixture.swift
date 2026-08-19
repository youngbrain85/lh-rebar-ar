// LHRebarARTests/DesignModelFixture.swift
import Foundation

/// 2026-08-18 BriconLab 이 업로드한 **실제** 설계모델에서 뜬 픽스처.
/// 합성 데이터가 아니다 — 아래 두 값은 그날 실제 응답을 그대로 옮긴 것이다.
///
///   USDZ : GET http://api.briconlab.com:50001/analysis/usdz?ar_id=2
///          model.usda / defaultPrim "RebarModel" / upAxis "Y" / metersPerUnit 1
///          doc "Design rebar model from Mock-up(2)_2.ifc (structure=wall, bars=45)"
///   목록 : GET http://api.briconlab.com:50001/analysis/ar-list?site_id=1
enum DesignModelFixture {

    /// `def Mesh` 45개의 절대 prim 경로. 파일에 나오는 순서 그대로다.
    static let paths: [String] = {
        func seq(_ token: String, _ count: Int) -> [String] {
            (1...count).map { "/RebarModel/\(token)_\(String(format: "%02d", $0))" }
        }
        return seq("Wall_FrontRear_Shear", 13)
            + seq("Wall_Front_Horiz", 9)
            + seq("Wall_Front_Vert", 9)
            + seq("Wall_Rear_Horiz", 9)
            + seq("Wall_Rear_Vert", 5)
    }()

    /// 분류표 경로별 기대 개수.
    static let expectedCounts: [String: Int] = [
        "벽체>전면-배면>간격재(전단철근)": 13,
        "벽체>전면>수평철근(배력철근)": 9,
        "벽체>전면>수직철근": 9,
        "벽체>배면>수평철근(배력철근)": 9,
        "벽체>배면>수직철근(주철근)": 5,
    ]

    /// site 1 의 `ar-list` 응답 원문. **필드가 밀려 있는 그대로**다 —
    /// source_filename 자리에 타임스탬프가, uploaded_at 자리에 remark 가 들어 있고
    /// scan_id/ar_id 가 따옴표 없는 정수다. T2 의 관용 디코딩이 이걸 견뎌야 한다.
    static let arListJSON = Data("""
    {"status":"success","message":"AR 모델 리스트를 조회했습니다.","ar_list":[
      {"scan_id":99,"ar_id":1,"site_id":1,"ar_filename":"temp.usdz",
       "ar_type":"visuals","source_filename":"2026-07-23 15:22:31",
       "uploaded_at":"설계모델 벽체 45가닥"},
      {"scan_id":101,"ar_id":2,"site_id":1,
       "ar_filename":"3e471a69bafe402084378cd0cf6dd9f1_002203.usdz",
       "ar_type":"design","source_filename":"2026-08-18 00:22:03",
       "uploaded_at":"설계모델 벽체 45가닥"}]}
    """.utf8)
}
