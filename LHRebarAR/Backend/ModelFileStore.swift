import Foundation

/// Downloads and caches converted USDZ model files under Caches/Models, keyed by
/// ar_id + upload timestamp so a re-uploaded model re-downloads. The USDZ comes
/// from the backend's (pending) `/analysis/usdz` endpoint; until that's live the
/// download surfaces `BackendError.notAvailable` so the UI shows "변환 대기".
@MainActor
final class ModelFileStore: ObservableObject {
    static let shared = ModelFileStore()

    private let directory: URL
    private let client = BackendClient()

    init() {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        directory = caches.appendingPathComponent("Models", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    func usdzURL(for model: ARModel) -> URL {
        directory.appendingPathComponent("\(model.arID)_\(versionStamp(model)).usdz")
    }

    func isCached(_ model: ARModel) -> Bool {
        FileManager.default.fileExists(atPath: usdzURL(for: model).path)
    }

    func cachedSize(_ model: ARModel) -> Int64? {
        let path = usdzURL(for: model).path
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: path),
              let size = attrs[.size] as? Int64 else { return nil }
        return size
    }

    /// Downloads the model's USDZ if not already cached. Returns the local URL.
    /// Throws `BackendError.notAvailable` when the server has no USDZ yet.
    @discardableResult
    func ensureUSDZ(_ model: ARModel) async throws -> URL {
        let dest = usdzURL(for: model)
        if FileManager.default.fileExists(atPath: dest.path) { return dest }

        let (tmp, response) = try await URLSession.shared.download(
            from: client.usdzFileURL(arID: model.arID)
        )
        if let http = response as? HTTPURLResponse {
            if http.statusCode == 404 || http.statusCode == 405 {
                throw BackendError.notAvailable
            }
            guard (200..<300).contains(http.statusCode) else {
                throw BackendError.badStatus(http.statusCode)
            }
        }
        // Guard against a non-USDZ payload (e.g. a JSON error returned with 200).
        // USDZ is an uncompressed zip → starts with the "PK" magic bytes.
        guard Self.looksLikeUSDZ(at: tmp) else {
            try? FileManager.default.removeItem(at: tmp)
            throw BackendError.notAvailable
        }
        if FileManager.default.fileExists(atPath: dest.path) {
            try? FileManager.default.removeItem(at: dest)
        }
        try FileManager.default.moveItem(at: tmp, to: dest)
        return dest
    }

    // MARK: - Helpers

    private func versionStamp(_ model: ARModel) -> String {
        model.uploadAt
            .replacingOccurrences(of: " ", with: "_")
            .replacingOccurrences(of: ":", with: "")
            .replacingOccurrences(of: "-", with: "")
    }

    private static func looksLikeUSDZ(at url: URL) -> Bool {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return false }
        defer { try? handle.close() }
        let head = try? handle.read(upToCount: 2)
        return head == Data([0x50, 0x4B]) // "PK"
    }
}
