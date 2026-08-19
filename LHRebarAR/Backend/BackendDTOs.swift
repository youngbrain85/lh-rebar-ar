import Foundation

/// Common envelope: every endpoint wraps its payload with a `status`/`message`.
protocol APIResponse: Decodable {
    var status: String { get }
}

// MARK: - Sites

/// `GET /analysis/site-list`
struct SiteListResponse: APIResponse {
    let status: String
    let message: String?
    let siteList: [Site]

    enum CodingKeys: String, CodingKey {
        case status, message
        case siteList = "site_list"
    }
}

struct Site: Decodable, Identifiable, Hashable {
    let siteID: Int
    let siteName: String

    var id: Int { siteID }

    enum CodingKeys: String, CodingKey {
        case siteID = "site_id"
        case siteName = "site_name"
    }
}

// MARK: - AR models

/// `GET /analysis/ar-list?site_id=…`
struct ARListResponse: APIResponse {
    let status: String
    let message: String?
    let arList: [ARModel]

    enum CodingKeys: String, CodingKey {
        case status, message
        case arList = "ar_list"
    }
}

/// `GET /analysis/ar-details?ar_id=…` (returns a single-element array).
struct ARDetailsResponse: APIResponse {
    let status: String
    let message: String?
    let arDetails: [ARModel]

    enum CodingKeys: String, CodingKey {
        case status, message
        case arDetails = "ar_details"
    }
}

/// A site's AR model. The downloadable file (`ar_filename`) is currently FBX;
/// fetch it with `BackendClient.modelFileURL(arID:)`.
struct ARModel: Decodable, Identifiable, Hashable {
    let scanID: String
    let arID: String
    let siteID: Int
    let arFilename: String
    let arType: String
    /// 업로드 시각. **옵셔널인 것이 요점이다** — 이 값 하나 없다고 목록 전체가
    /// 죽던 것이 2026-08-18 장애의 원인이었다.
    let uploadAt: String?
    /// 타임스탬프가 아닌 나머지 설명(remark 또는 원본 파일명)
    let note: String?

    var id: String { arID }

    /// File extension of the server model (e.g. "usdz").
    var fileExtension: String {
        let ext = (arFilename as NSString).pathExtension
        return ext.isEmpty ? "fbx" : ext.lowercased()
    }

    /// 사용자에게 보이는 종류명. 서버 원문(`design`/`visuals`)을 그대로 띄우지 않는다.
    var typeLabel: String {
        switch arType.lowercased() {
        case "design":            return "설계모델"
        case "visual", "visuals": return "스캔모델"
        default:                  return arType
        }
    }

    /// 캐시 무효화용 버전 문자열. `uploadAt` 이 없으면 파일명으로 대신한다 —
    /// 실측 파일명이 `3e471a69…_002203.usdz` 처럼 해시+시각이라 재업로드마다 바뀐다.
    var versionStamp: String {
        (uploadAt ?? arFilename)
            .replacingOccurrences(of: " ", with: "_")
            .replacingOccurrences(of: ":", with: "")
            .replacingOccurrences(of: "-", with: "")
    }

    enum CodingKeys: String, CodingKey {
        case scanID = "scan_id"
        case arID = "ar_id"
        case siteID = "site_id"
        case arFilename = "ar_filename"
        case arType = "ar_type"
        case uploadAt = "upload_at"
        case uploadedAt = "uploaded_at"
        case sourceFilename = "source_filename"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)

        // 서버가 id 를 문자열로 주다가 정수로 바꿨다(2026-08-18 실측). 둘 다 받는다.
        scanID = Self.flexibleString(c, .scanID) ?? ""
        guard let ar = Self.flexibleString(c, .arID) else {
            throw DecodingError.keyNotFound(CodingKeys.arID, .init(
                codingPath: c.codingPath,
                debugDescription: "ar_id 가 없습니다 — 이 항목은 모델을 특정할 수 없습니다"))
        }
        arID = ar

        // site_id 는 모델을 여는 데 안 쓴다(ar_id 로 연다). 없다고 항목을 버리지 않는다.
        siteID = (try? c.decode(Int.self, forKey: .siteID)) ?? -1
        arFilename = (try? c.decode(String.self, forKey: .arFilename)) ?? ""
        arType = (try? c.decode(String.self, forKey: .arType)) ?? ""

        // ★ 키를 믿지 않고 형식으로 고른다.
        //   2026-08-18 실측: source_filename 자리에 "2026-08-18 00:22:03" 이,
        //   uploaded_at 자리에 remark "설계모델 벽체 45가닥" 이 들어왔다(서버가 밀림).
        //   세 후보를 다 보므로 서버가 밀림을 고쳐도 우리는 안 깨진다.
        let candidates: [String] = [CodingKeys.uploadedAt, .uploadAt, .sourceFilename]
            .compactMap { try? c.decode(String.self, forKey: $0) }
        uploadAt = candidates.first(where: Self.looksLikeTimestamp)
        note = candidates.first(where: { !Self.looksLikeTimestamp($0) })
    }

    /// String 이면 그대로, Int 면 문자열로. 둘 다 아니면 nil.
    /// `decodeIfPresent` 대신 `try? decode` 를 쓰는 이유: 값이 Int 인데 String 을
    /// 요구하면 `decodeIfPresent` 는 nil 이 아니라 typeMismatch 를 던진다.
    private static func flexibleString(_ c: KeyedDecodingContainer<CodingKeys>,
                                       _ key: CodingKeys) -> String? {
        if let s = try? c.decode(String.self, forKey: key) { return s }
        if let i = try? c.decode(Int.self, forKey: key) { return String(i) }
        return nil
    }

    /// `2026-08-18 …` / `2026-08-18T…` 처럼 앞 10자가 `YYYY-MM-DD` 인가.
    private static func looksLikeTimestamp(_ s: String) -> Bool {
        let head = Array(s.prefix(10))
        guard head.count == 10 else { return false }
        return head[0...3].allSatisfy(\.isNumber) && head[4] == "-"
            && head[5...6].allSatisfy(\.isNumber) && head[7] == "-"
            && head[8...9].allSatisfy(\.isNumber)
    }
}
