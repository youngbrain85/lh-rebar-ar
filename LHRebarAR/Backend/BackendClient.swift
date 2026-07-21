import Foundation

enum BackendError: LocalizedError {
    case invalidResponse
    case badStatus(Int)
    case apiStatus(String)
    /// The USDZ for this model isn't on the server yet (endpoint 404/not a USDZ).
    case notAvailable

    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "응답을 해석할 수 없습니다."
        case .badStatus(let code): return "서버 오류 (HTTP \(code))"
        case .apiStatus(let s): return "API 응답 실패: \(s)"
        case .notAvailable: return "서버에 USDZ가 아직 준비되지 않았습니다 (변환 대기)."
        }
    }
}

/// Thin async client over the BriconLab analysis API.
struct BackendClient {
    var baseURL: URL = BackendConfig.baseURL
    var session: URLSession = .shared

    func fetchSites() async throws -> [Site] {
        let data = try await get("analysis/site-list")
        return try decode(SiteListResponse.self, data).siteList
    }

    func fetchModels(siteID: Int) async throws -> [ARModel] {
        let data = try await get("analysis/ar-list", query: ["site_id": String(siteID)])
        return try decode(ARListResponse.self, data).arList
    }

    func fetchDetails(arID: String) async throws -> ARModel? {
        let data = try await get("analysis/ar-details", query: ["ar_id": arID])
        return try decode(ARDetailsResponse.self, data).arDetails.first
    }

    /// URL of the raw model file (FBX) for an AR model.
    func modelFileURL(arID: String) -> URL {
        url(for: "analysis/fbx", query: ["ar_id": arID])
    }

    /// URL of the converted USDZ for an AR model.
    ///
    /// Proposed contract pending BriconLab implementation (currently 404). If
    /// they finalize a different path/param, this single line is the only place
    /// to change.
    func usdzFileURL(arID: String) -> URL {
        url(for: "analysis/usdz", query: ["ar_id": arID])
    }

    // MARK: - Helpers

    private func url(for path: String, query: [String: String] = [:]) -> URL {
        var comps = URLComponents(
            url: baseURL.appendingPathComponent(path),
            resolvingAgainstBaseURL: false
        )!
        if !query.isEmpty {
            comps.queryItems = query
                .sorted { $0.key < $1.key }
                .map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        return comps.url!
    }

    private func get(_ path: String, query: [String: String] = [:]) async throws -> Data {
        let (data, response) = try await session.data(from: url(for: path, query: query))
        guard let http = response as? HTTPURLResponse else { throw BackendError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else { throw BackendError.badStatus(http.statusCode) }
        return data
    }

    private func decode<T: APIResponse>(_ type: T.Type, _ data: Data) throws -> T {
        let decoded = try JSONDecoder().decode(T.self, from: data)
        guard decoded.status == "success" else { throw BackendError.apiStatus(decoded.status) }
        return decoded
    }
}
