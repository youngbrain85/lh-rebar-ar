import Photos
import RealityKit
import UIKit

/// Captures the live AR render (camera feed + measurement lines/labels), stamps
/// a measurement summary footer onto it, and saves the result to Photos. The
/// ARKit/RealityKit content is captured via `ARView.snapshot` because a plain
/// UIWindow render leaves the Metal-backed AR view black.
@MainActor
enum ScreenCaptureService {
    enum CaptureError: LocalizedError {
        case snapshotFailed
        case noPermission
        case saveFailed

        var errorDescription: String? {
            switch self {
            case .snapshotFailed: return "화면을 캡처하지 못했습니다."
            case .noPermission: return "사진 접근 권한이 필요합니다."
            case .saveFailed: return "사진 저장에 실패했습니다."
            }
        }
    }

    static func capture(
        _ arView: ARView,
        footerLines: [String],
        completion: @escaping (Result<UIImage, Error>) -> Void
    ) {
        arView.snapshot(saveToHDR: false) { image in
            // snapshot's completion may arrive off the main thread.
            DispatchQueue.main.async {
                guard let image else {
                    completion(.failure(CaptureError.snapshotFailed))
                    return
                }
                let stamped = footerLines.isEmpty ? image : annotate(image, lines: footerLines)
                save(stamped, completion: completion)
            }
        }
    }

    // MARK: - Save

    private static func save(
        _ image: UIImage,
        completion: @escaping (Result<UIImage, Error>) -> Void
    ) {
        guard let data = image.jpegData(compressionQuality: 0.9) else {
            completion(.failure(CaptureError.saveFailed))
            return
        }
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            DispatchQueue.main.async {
                guard status == .authorized || status == .limited else {
                    completion(.failure(CaptureError.noPermission))
                    return
                }
                PHPhotoLibrary.shared().performChanges {
                    let request = PHAssetCreationRequest.forAsset()
                    request.addResource(with: .photo, data: data, options: nil)
                } completionHandler: { ok, error in
                    DispatchQueue.main.async {
                        if ok {
                            completion(.success(image))
                        } else {
                            completion(.failure(error ?? CaptureError.saveFailed))
                        }
                    }
                }
            }
        }
    }

    // MARK: - Footer

    /// Draws a translucent strip with the measurement summary along the bottom.
    private static func annotate(_ image: UIImage, lines: [String]) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = image.scale
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: image.size, format: format)

        return renderer.image { ctx in
            image.draw(at: .zero)

            let pad: CGFloat = 16
            let font = UIFont.monospacedSystemFont(ofSize: 15, weight: .medium)
            let lineHeight = font.lineHeight + 4
            let stripHeight = CGFloat(lines.count) * lineHeight + pad * 2
            let strip = CGRect(
                x: 0,
                y: image.size.height - stripHeight,
                width: image.size.width,
                height: stripHeight
            )
            UIColor.black.withAlphaComponent(0.5).setFill()
            ctx.cgContext.fill(strip)

            let attributes: [NSAttributedString.Key: Any] = [
                .font: font,
                .foregroundColor: UIColor.white,
            ]
            var y = strip.minY + pad
            for line in lines {
                (line as NSString).draw(at: CGPoint(x: pad, y: y), withAttributes: attributes)
                y += lineHeight
            }
        }
    }
}
