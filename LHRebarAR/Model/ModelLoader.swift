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
        let entity: Entity
        // Prefer an on-disk file (downloaded USDZ) when provided.
        if let local = model.localURL {
            entity = try await loadEntity(at: local)
        } else {
            guard let url = resolveURL(for: model) else {
                throw ModelLoadError.notFound(model.resourceName)
            }
            entity = try await loadEntity(at: url)
        }
        return normalizedToBottomCenter(entity)
    }

    /// Re-pivots a loaded model so its origin sits at the **bottom-center of its
    /// bounding box** — i.e. the concrete base's bottom face, center. This makes
    /// every model (backend USDZ or bundled sample) sit on the tapped surface
    /// consistently, regardless of where the source asset authored its origin.
    ///
    /// The model is wrapped in a parent whose origin becomes the pivot; the
    /// geometry is shifted within it. Idempotent for assets already pivoted at
    /// bottom-center (offset ≈ 0). Fine-adjustment / anchoring act on the
    /// placementRoot above this, so they are unaffected.
    @MainActor
    private static func normalizedToBottomCenter(_ entity: Entity) -> Entity {
        let wrapper = Entity()
        wrapper.addChild(entity)
        let bounds = entity.visualBounds(relativeTo: wrapper)
        let e = bounds.extents
        guard e.x > 0, e.y > 0, e.z > 0 else { return wrapper }
        let bottomCenter = SIMD3<Float>(bounds.center.x, bounds.min.y, bounds.center.z)
        entity.position -= bottomCenter
        return wrapper
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
