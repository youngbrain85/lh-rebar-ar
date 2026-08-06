// LHRebarAR/Backend/RebarMetaFile.swift
import Foundation

/// 철근 계층 사이드카 JSON — `api/REBAR_TAXONOMY_REQUEST.md` §요청 1.
/// 대시보드의 `src/lib/analysis/rebarMetaSchema.ts`와 같은 필드를 갖는다.
struct RebarMetaFile: Decodable {
    struct Entry: Decodable {
        /// USDZ 안 prim 절대 경로 — 조인 키
        let prim: String
        /// 화면 표시명. 없으면 `RebarTaxonomy.composeLabel`로 조립한다
        let label: String?
        /// 트리 경로 (잎 제외). 깊이는 부위마다 다르다
        let path: [String]
        let no: Int?
    }

    let version: Int
    let arID: String
    /// 대상 USDZ의 `upload_at` — 빌드 대조용
    let modelUploadAt: String?
    /// 그 USDZ의 철근 prim 총수 — 빌드 대조용
    let primCount: Int?
    /// 트리 루트 표시명
    let structure: String
    let rebars: [Entry]

    enum CodingKeys: String, CodingKey {
        case version
        case arID = "ar_id"
        case modelUploadAt = "model_upload_at"
        case primCount = "prim_count"
        case structure
        case rebars
    }

    /// 스키마가 우리가 아는 버전인지 + 최소 요건을 갖췄는지.
    /// 어긋나면 사이드카를 버리고 이름 기반 분류로 폴백한다.
    var isUsable: Bool {
        version == 1 && !structure.isEmpty && !rebars.isEmpty
            && rebars.allSatisfy { !$0.prim.isEmpty && !$0.path.isEmpty }
    }

    /// 이 계층 정보가 지금 로드한 모델을 가리키는지.
    ///
    /// 모델을 다시 내보내면서 **배근만 바뀌고 prim 이름은 그대로**인 경우가 가장 흔한데,
    /// 그때 계층 정보가 예전 것이면 조인은 100% 성공하고 라벨만 엉뚱한 철근에 붙는다 —
    /// 오류도 경고도 나지 않는다. 대조 필드가 없으면(구버전 사이드카) 통과시킨다.
    func mismatchReason(modelUploadAt uploadAt: String?, primCount count: Int?) -> String? {
        if let mine = modelUploadAt, let theirs = uploadAt, mine != theirs {
            return "계층 정보가 다른 모델 빌드를 가리킵니다"
        }
        if let mine = primCount, let theirs = count, mine != theirs {
            return "철근 개수가 맞지 않습니다 (계층 \(mine)개 ≠ 모델 \(theirs)개)"
        }
        return nil
    }
}
