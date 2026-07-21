import Combine
import Foundation
import RealityKit

enum ModelLoadError: LocalizedError {
    case notFound(String)
    case loadFailed(Error)

    var errorDescription: String? {
        switch self {
        case .notFound(let name): return "Model not bundled: \(name)"
        case .loadFailed(let err): return "Failed to load model: \(err.localizedDescription)"
        }
    }
}

enum ModelLoader {
    @MainActor
    static func load(_ model: RebarModel) async throws -> Entity {
        // Prefer an on-disk file (downloaded USDZ) when provided.
        if let local = model.localURL {
            return try await loadEntity(at: local)
        }
        guard let url = resolveURL(for: model) else {
            throw ModelLoadError.notFound(model.resourceName)
        }
        return try await loadEntity(at: url)
    }

    @MainActor
    private static func loadEntity(at url: URL) async throws -> Entity {
        try await withCheckedThrowingContinuation { continuation in
            var cancellable: AnyCancellable?
            cancellable = Entity.loadAsync(contentsOf: url)
                .sink(
                    receiveCompletion: { completion in
                        if case .failure(let error) = completion {
                            continuation.resume(throwing: ModelLoadError.loadFailed(error))
                        }
                        cancellable?.cancel()
                    },
                    receiveValue: { entity in
                        continuation.resume(returning: entity)
                        cancellable?.cancel()
                    }
                )
        }
    }

    private static func resolveURL(for model: RebarModel) -> URL? {
        let bundle = Bundle.main
        let stem = (model.resourceName as NSString).deletingPathExtension
        let ext = (model.resourceName as NSString).pathExtension.isEmpty
            ? "usdz"
            : (model.resourceName as NSString).pathExtension

        if let sub = model.subpath,
           let url = bundle.url(forResource: stem, withExtension: ext, subdirectory: sub) {
            return url
        }
        return bundle.url(forResource: stem, withExtension: ext)
    }
}
