import ARKit
import RealityKit

@MainActor
final class ModelAnchorController {
    static let placementRootName = "placementRoot"
    static let modelEntityName = "modelEntity"
    static let arAnchorName = "LHRebarAR.placement"

    /// Collision group the design model is tagged with so the measurement
    /// reticle can ray-test the model surface independently of the real-world
    /// scene-reconstruction collision (which lives in `.sceneUnderstanding`).
    static let modelCollisionGroup = CollisionGroup(rawValue: 1 << 7)

    /// Number of mesh nodes that received collision on the last placement —
    /// surfaced for on-device diagnostics of model↔structure measuring.
    static private(set) var lastCollisionNodeCount = 0

    private weak var arView: ARView?

    private(set) var arAnchor: ARAnchor?
    private(set) var anchorEntity: AnchorEntity?
    private(set) var placementRoot: Entity?
    private(set) var modelEntity: Entity?

    init(arView: ARView) {
        self.arView = arView
    }

    @discardableResult
    func place(model: Entity, at worldTransform: simd_float4x4) -> AnchorEntity? {
        guard let arView else { return nil }
        removeCurrent()

        // World-anchored, NOT ARAnchor-backed. RealityKit only renders content
        // bound to an ARAnchor while that anchor is actively tracked, so in
        // low-feature / narrow spaces the model vanished a few seconds after
        // placement (ARKit relocalizes → anchor goes untracked → content
        // hidden). A world anchor is positioned in the session's world space
        // with no per-anchor tracking lifecycle, so it stays visible; drift is
        // handled by re-anchoring + visual lock. Mirrors reanchor().
        let anchorEntity = AnchorEntity(world: worldTransform)
        let root = Entity()
        root.name = Self.placementRootName
        model.name = Self.modelEntityName

        root.addChild(model)
        anchorEntity.addChild(root)
        arView.scene.addAnchor(anchorEntity)

        // Tag the model with collision shapes so the measurement tool can snap
        // a point onto the design surface (model↔structure measuring).
        Self.installCollision(on: model)

        self.arAnchor = nil
        self.anchorEntity = anchorEntity
        self.placementRoot = root
        self.modelEntity = model
        return anchorEntity
    }

    /// Re-anchors the placed model at its CURRENT world pose: adds a fresh
    /// ARAnchor exactly where the model now sits (after coarse/fine adjustment)
    /// and reparents placementRoot under it with an identity local transform.
    ///
    /// Why: adjustments offset the model away from the original tap-point
    /// anchor. ARKit stabilizes content per-anchor, so a large offset acts as a
    /// lever arm — tiny anchor rotation errors amplify with distance and the
    /// model appears to wander as the phone moves. A fresh anchor at the final
    /// pose removes the lever arm and lets ARKit track the model from up close.
    func reanchor() {
        guard
            let arView,
            let root = placementRoot,
            let oldAnchorEntity = anchorEntity
        else { return }

        let world = root.transformMatrix(relativeTo: nil)
        // Skip when the model still sits (almost) on its anchor — nothing to gain.
        let anchorWorld = oldAnchorEntity.transformMatrix(relativeTo: nil)
        if simd_distance(world.translation, anchorWorld.translation) < 0.01 { return }

        // World-fixed anchor (NOT ARAnchor-backed): an ARAnchor-backed entity
        // sits at the origin until ARKit reports the anchor, and the anchoring
        // system can override a manually seeded pose in that window — which
        // made the model blink/vanish right after adjustments. A world-anchored
        // entity has no such lifecycle; drift correction is handled by the
        // visual-lock (재고정) instead.
        let newAnchorEntity = AnchorEntity(world: world)
        root.removeFromParent()
        newAnchorEntity.addChild(root)
        root.transform = .identity  // local identity == exactly the new anchor pose
        arView.scene.addAnchor(newAnchorEntity)

        arView.scene.removeAnchor(oldAnchorEntity)
        if let old = arAnchor {
            arView.session.remove(anchor: old)
            arAnchor = nil
        }
        anchorEntity = newAnchorEntity
    }

    func removeCurrent() {
        if let arView, let anchor = anchorEntity {
            arView.scene.removeAnchor(anchor)
        }
        if let arView, let arAnchor {
            arView.session.remove(anchor: arAnchor)
        }
        arAnchor = nil
        anchorEntity = nil
        placementRoot = nil
        modelEntity = nil
    }

    /// Walk the model tree and give every mesh-bearing node a collision shape
    /// tagged with `modelCollisionGroup`, so `ARView.hitTest(_:query:mask:)`
    /// can return points on the design model.
    ///
    /// We key off `ModelComponent` (not the `ModelEntity` class) because USDZ
    /// loaded via `Entity.loadAsync` often produces plain `Entity` nodes that
    /// merely carry a `ModelComponent` — guarding on `as? ModelEntity` would
    /// install nothing. A per-node box from the node's visual bounds is built
    /// synchronously (no deferred shape generation) so the filter group is set
    /// reliably. For a multi-part rebar model each box approximates one bar.
    static func installCollision(on root: Entity) {
        var count = 0
        var stack: [Entity] = [root]
        while let entity = stack.popLast() {
            stack.append(contentsOf: entity.children)
            guard entity.components[ModelComponent.self] != nil else { continue }
            let bounds = entity.visualBounds(relativeTo: entity)
            let e = bounds.extents
            let size = SIMD3<Float>(max(e.x, 0.001), max(e.y, 0.001), max(e.z, 0.001))
            let shape = ShapeResource.generateBox(size: size)
                .offsetBy(translation: bounds.center)
            entity.components.set(CollisionComponent(
                shapes: [shape],
                mode: .default,
                filter: CollisionFilter(group: modelCollisionGroup, mask: .all)
            ))
            count += 1
        }
        lastCollisionNodeCount = count
    }

    // MARK: - 철근 계층 필터 (spec §7.1)

    /// `ModelComponent`를 가진 노드의 **정규화된 경로** 목록.
    ///
    /// 경로는 `modelEntity` 기준으로 조립한 뒤 `RebarTaxonomy.normalizePrimPath`를
    /// 거친다 — 배치 wrapper 세그먼트를 떼야 사이드카의 prim 경로와 맞는다.
    /// 형제 중 이름이 겹치면 `#k`를 붙여 유일하게 만든다(대시보드의 `경로#k`와 같은 규칙).
    static func meshNodePaths(of root: Entity) -> [String] {
        var out: [String] = []
        var seen: [String: Int] = [:]
        var stack: [(Entity, String)] = [(root, "")]
        while let (entity, prefix) = stack.popLast() {
            for child in entity.children {
                stack.append((child, prefix + "/" + child.name))
            }
            guard entity.components[ModelComponent.self] != nil else { continue }
            let key = RebarTaxonomy.normalizePrimPath(prefix)
            let n = seen[key] ?? 0
            seen[key] = n + 1
            out.append(n == 0 ? key : "\(key)#\(n)")
        }
        return out
    }

    /// 보여야 할 경로 집합을 통째로 적용한다(그 밖은 숨긴다). 반환값은 매칭된 노드 수.
    /// `visible`이 nil이면 전부 켠다.
    ///
    /// 투명도가 아니라 `isEnabled`를 쓰는 이유(고차 §3.6):
    ///  - 전역 투명도 슬라이더가 개별 노드 상태를 덮어쓴다
    ///  - 철근마다 충돌체가 붙어 있어(installCollision) 투명하게만 만들면 **안 보이는
    ///    철근에 측정 레티클이 계속 스냅된다**
    ///  - `applyOpacity`는 PBR/Simple 외 머티리얼에 조용히 실패한다
    ///
    /// 매칭 실패(반환값 0)와 "사용자가 전부 숨김"은 다른 사건이므로 이 함수는 둘을
    /// 구분하지 않는다 — 조인 성패는 트리를 만들 때 `rebarNodeCount`로 한 번만
    /// 판정한다(고차 #16, CLAUDE.md).
    @discardableResult
    func applyVisibility(_ visible: Set<String>?) -> Int {
        guard let modelEntity else { return 0 }
        var matched = 0
        var seen: [String: Int] = [:]
        var stack: [(Entity, String)] = [(modelEntity, "")]
        while let (entity, prefix) = stack.popLast() {
            for child in entity.children {
                stack.append((child, prefix + "/" + child.name))
            }
            guard entity.components[ModelComponent.self] != nil else { continue }
            let key = RebarTaxonomy.normalizePrimPath(prefix)
            let n = seen[key] ?? 0
            seen[key] = n + 1
            let id = n == 0 ? key : "\(key)#\(n)"
            guard let visible else {
                entity.isEnabled = true
                matched += 1
                continue
            }
            entity.isEnabled = visible.contains(id)
            if entity.isEnabled { matched += 1 }
        }
        return matched
    }

    #if DEBUG
    /// 기기 검증용 엔티티 트리 덤프 — spec §7.0.
    /// RealityKit이 USD prim 이름을 `Entity.name`으로 보존하는지는 코드로 확인할 수
    /// 없다. 이 덤프의 경로 집합이 대시보드가 뽑은 id 집합을 **포함**하면 통과다.
    static func dumpEntityTree(of root: Entity) -> String {
        var lines: [String] = []
        func walk(_ e: Entity, depth: Int, prefix: String) {
            let hasModel = e.components[ModelComponent.self] != nil
            let pad = String(repeating: "  ", count: depth)
            lines.append("\(pad)\(e.name.isEmpty ? "(무명)" : e.name)\(hasModel ? " [mesh]" : "")")
            for c in e.children { walk(c, depth: depth + 1, prefix: prefix + "/" + c.name) }
        }
        walk(root, depth: 0, prefix: "")
        let paths = meshNodePaths(of: root)
        lines.append("— mesh 노드 \(paths.count)개, 충돌체 \(lastCollisionNodeCount)개")
        lines.append(contentsOf: paths.prefix(10).map { "  \($0)" })
        return lines.joined(separator: "\n")
    }
    #endif

    /// Override every material's opacity on the current model entity.
    /// `opacity` is absolute (0 = invisible, 1 = fully opaque).
    func setOpacity(_ opacity: Float) {
        guard let modelEntity else { return }
        Self.applyOpacity(opacity, to: modelEntity)
    }

    /// Walk the entity tree and stamp a transparent blending on every
    /// PhysicallyBasedMaterial found on any ModelEntity.
    static func applyOpacity(_ opacity: Float, to root: Entity) {
        let clamped = max(0, min(1, opacity))
        var stack: [Entity] = [root]
        while let entity = stack.popLast() {
            stack.append(contentsOf: entity.children)
            guard var modelComp = entity.components[ModelComponent.self] as ModelComponent? else {
                continue
            }
            modelComp.materials = modelComp.materials.map { material in
                if var pbm = material as? PhysicallyBasedMaterial {
                    pbm.blending = .transparent(opacity: .init(floatLiteral: clamped))
                    return pbm
                }
                if var simple = material as? SimpleMaterial {
                    let color = simple.color.tint
                    simple.color = .init(
                        tint: color.withAlphaComponent(CGFloat(clamped)),
                        texture: simple.color.texture
                    )
                    return simple
                }
                return material
            }
            entity.components[ModelComponent.self] = modelComp
        }
    }
}
