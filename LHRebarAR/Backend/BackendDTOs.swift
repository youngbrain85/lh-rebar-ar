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
    let uploadAt: String

    var id: String { arID }

    /// File extension of the server model (e.g. "fbx").
    var fileExtension: String {
        let ext = (arFilename as NSString).pathExtension
        return ext.isEmpty ? "fbx" : ext.lowercased()
    }

    enum CodingKeys: String, CodingKey {
        case scanID = "scan_id"
        case arID = "ar_id"
        case siteID = "site_id"
        case arFilename = "ar_filename"
        case arType = "ar_type"
        case uploadAt = "upload_at"
    }
}
