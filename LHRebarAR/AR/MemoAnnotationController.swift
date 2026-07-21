import ARKit
import Combine
import RealityKit
import UIKit
import simd

/// Office → field 3D memos: the dashboard sends a normalized screen point plus
/// text; we raycast that point into the scene and pin a world-locked marker
/// with a billboarded label there. Unlike the transient 2D pings, memos stay
/// anchored in the real world until cleared.
@MainActor
final class MemoAnnotationController: ObservableObject {
    @Published private(set) var count: Int = 0

    private weak var arView: ARView?
    private var anchors: [AnchorEntity] = []
    private var labels: [Entity] = []
    private var subscription: Cancellable?
    private let maxMemos = 20

    func bind(arView: ARView) {
        self.arView = arView
        subscription = arView.scene.subscribe(to: SceneEvents.Update.self) { [weak self] _ in
            self?.billboardLabels()
        }
    }

    /// Places a memo at the normalized screen point (u,v ∈ 0…1). The shared
    /// screen IS this device's screen, so the point maps directly onto the
    /// ARView; raycast it onto the real structure. Returns false when no
    /// surface hit was found (caller may fall back to the 2D ping).
    @discardableResult
    func place(u: Double, v: Double, text: String) -> Bool {
        guard let arView else { return false }
        let point = CGPoint(
            x: arView.bounds.width * CGFloat(u),
            y: arView.bounds.height * CGFloat(v)
        )
        guard let transform = raycast(arView: arView, at: point) else { return false }
        let position = SIMD3<Float>(
            transform.columns.3.x, transform.columns.3.y, transform.columns.3.z
        )

        let anchor = AnchorEntity(world: position)

        // Pin: thin stem + head, unlit orange so it reads in any light.
        let orange = UnlitMaterial(color: UIColor(red: 1.0, green: 0.55, blue: 0.0, alpha: 1.0))
        let stem = ModelEntity(
            mesh: .generateBox(width: 0.004, height: 0.09, depth: 0.004, cornerRadius: 0.002),
            materials: [orange]
        )
        stem.position = SIMD3<Float>(0, 0.045, 0)
        anchor.addChild(stem)
        let head = ModelEntity(mesh: .generateSphere(radius: 0.012), materials: [orange])
        head.position = SIMD3<Float>(0, 0.09, 0)
        anchor.addChild(head)

        let label = Self.makeLabel(text.isEmpty ? "확인 요청" : text)
        label.position = SIMD3<Float>(0, 0.135, 0)
        anchor.addChild(label)

        arView.scene.addAnchor(anchor)
        anchors.append(anchor)
        labels.append(label)

        if anchors.count > maxMemos {
            let old = anchors.removeFirst()
            labels.removeFirst()
            arView.scene.removeAnchor(old)
        }
        count = anchors.count
        return true
    }

    func clearAll() {
        guard let arView else { return }
        for anchor in anchors {
            arView.scene.removeAnchor(anchor)
        }
        anchors.removeAll()
        labels.removeAll()
        count = 0
    }

    // MARK: - Internals

    private func raycast(arView: ARView, at point: CGPoint) -> simd_float4x4? {
        let targets: [ARRaycastQuery.Target] = [.estimatedPlane, .existingPlaneInfinite]
        for target in targets {
            if
                let query = arView.makeRaycastQuery(from: point, allowing: target, alignment: .any),
                let hit = arView.session.raycast(query).first
            {
                return hit.worldTransform
            }
        }
        return nil
    }

    /// Compact white plate + black text (same look as measurement labels).
    private static func makeLabel(_ string: String) -> Entity {
        let mesh = MeshResource.generateText(
            string,
            extrusionDepth: 0.001,
            font: .systemFont(ofSize: 0.02, weight: .semibold),
            containerFrame: .zero,
            alignment: .center,
            lineBreakMode: .byTruncatingTail
        )
        let text = ModelEntity(mesh: mesh, materials: [UnlitMaterial(color: .black)])
        let bounds = mesh.bounds
        text.position = -bounds.center

        let pad: Float = 0.0045
        let plate = ModelEntity(
            mesh: .generateBox(
                width: bounds.extents.x + pad * 2,
                height: bounds.extents.y + pad * 2,
                depth: 0.001,
                cornerRadius: 0.004
            ),
            materials: [UnlitMaterial(color: UIColor(white: 1.0, alpha: 0.95))]
        )
        plate.position = SIMD3<Float>(0, 0, -0.0015)

        let group = Entity()
        group.addChild(plate)
        group.addChild(text)
        return group
    }

    private func billboardLabels() {
        guard
            let arView,
            !labels.isEmpty,
            let cam = arView.session.currentFrame?.camera.transform
        else { return }
        let cameraPos = SIMD3<Float>(cam.columns.3.x, cam.columns.3.y, cam.columns.3.z)
        for label in labels {
            let pos = label.position(relativeTo: nil)
            var forward = cameraPos - pos
            let len = simd_length(forward)
            guard len > 1e-4 else { continue }
            forward /= len
            let worldUp = SIMD3<Float>(0, 1, 0)
            var right = simd_cross(worldUp, forward)
            let rl = simd_length(right)
            right = rl < 1e-4 ? SIMD3<Float>(1, 0, 0) : right / rl
            let up = simd_cross(forward, right)
            label.setOrientation(simd_quatf(simd_float3x3(right, up, forward)), relativeTo: nil)
        }
    }
}
