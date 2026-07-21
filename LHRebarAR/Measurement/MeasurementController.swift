import ARKit
import Combine
import RealityKit
import UIKit
import simd

@MainActor
final class MeasurementController {
    enum Outcome {
        case startedFirstPoint
        case completed(DistanceMeasurement)
    }

    /// Periodic update result delivered to the view model so the UI can mirror
    /// the live state (reticle lock + preview distance + which surface the
    /// reticle is currently snapped to).
    struct LiveState: Equatable {
        var locked: Bool
        var previewDistanceM: Float?
        var source: MeasurementPointSource?
        /// Signed per-axis delta (curr − first) while aiming the second point.
        var previewDelta: SIMD3<Float>?
    }

    private weak var arView: ARView?

    // Existing finalized measurements
    private(set) var measurements: [DistanceMeasurement] = []
    private var measurementAnchors: [UUID: AnchorEntity] = [:]
    private var textLabels: [UUID: Entity] = [:]

    // First-point marker (between commits)
    private var pendingAnchor: AnchorEntity?
    private var pendingPosition: SIMD3<Float>?
    private var pendingSource: MeasurementPointSource?

    // Live preview anchor (cylinder from first point → reticle, end sphere,
    // and a floating distance label that tracks the line midpoint).
    private var previewAnchor: AnchorEntity?
    private var previewCylinder: ModelEntity?
    private var previewEnd: ModelEntity?
    private var previewLabel: Entity?
    /// Cache of the last string rendered into the preview label so we only
    /// regenerate the (expensive) text mesh when the displayed value changes.
    private var previewLabelString: String?

    // Per-frame state
    private var isMeasurementActive: Bool = false
    private(set) var currentCenterPosition: SIMD3<Float>?
    /// Most recent reticle transform (position + orientation in world).
    private var currentCenterTransform: simd_float4x4?
    /// Which surface the reticle is currently snapped to (model vs real).
    private(set) var currentCenterSource: MeasurementPointSource?
    private var sceneSubscription: Cancellable?

    // Short "hold" so a momentary raycast dropout (common while panning the
    // phone from the first point to the second) doesn't make the reticle and
    // preview line flicker out. We reuse the last valid hit for a few frames.
    private var lastValidTransform: simd_float4x4?
    private var lastValidSource: MeasurementPointSource?
    private var framesSinceValidHit: Int = 0
    private let maxHoldFrames = 15

    // 3D reticle that sits on the target surface (real surface = normal-aligned,
    // model surface = camera-facing).
    private var reticleAnchor: AnchorEntity?
    private var reticleRing: ModelEntity?
    private var reticleDot: ModelEntity?
    /// Tracks the reticle's last colour so materials are swapped only when the
    /// snapped surface (real vs model) actually changes (not every frame).
    private var reticleSourceState: MeasurementPointSource?
    private let reticleRealMaterial = UnlitMaterial(color: UIColor(white: 1.0, alpha: 1.0))
    private let reticleModelMaterial = UnlitMaterial(
        color: UIColor(red: 0.2, green: 1.0, blue: 0.45, alpha: 1.0)
    )

    /// Invoked each frame so the view model can publish live UI state.
    var liveStateHandler: ((LiveState) -> Void)?

    init(arView: ARView) {
        self.arView = arView
        sceneSubscription = arView.scene.subscribe(to: SceneEvents.Update.self) { [weak self] _ in
            self?.onFrame()
        }
    }

    /// Cancels this controller's per-frame subscription and removes every
    /// entity it owns. Called before re-binding so a recreated ARView never
    /// leaves an orphaned controller ticking the scene behind the live one.
    func teardown() {
        sceneSubscription?.cancel()
        sceneSubscription = nil
        setMeasurementActive(false)
        clearAll()
    }

    // MARK: - Lifecycle

    func setMeasurementActive(_ active: Bool) {
        isMeasurementActive = active
        if !active {
            removePreviewLine()
            removePendingMarker()
            removeReticle()
            currentCenterPosition = nil
            currentCenterTransform = nil
            currentCenterSource = nil
            lastValidTransform = nil
            lastValidSource = nil
            framesSinceValidHit = 0
            liveStateHandler?(LiveState(locked: false, previewDistanceM: nil, source: nil))
        }
    }

    // MARK: - Point commits

    /// Adds a point at the current reticle position. Returns nil if reticle
    /// has no surface lock.
    func commitCurrentPoint() -> Outcome? {
        guard let pos = currentCenterPosition else { return nil }
        return addPoint(at: pos, source: currentCenterSource ?? .real)
    }

    private func addPoint(at world: SIMD3<Float>, source: MeasurementPointSource) -> Outcome {
        if let first = pendingPosition {
            let m = DistanceMeasurement(
                timestamp: Date(),
                pointA: first,
                pointB: world,
                sourceA: pendingSource ?? .real,
                sourceB: source,
                name: "측정-\(measurements.count + 1)"
            )
            placeVisualization(for: m)
            measurements.append(m)
            removePendingMarker()
            removePreviewLine()
            return .completed(m)
        } else {
            pendingPosition = world
            pendingSource = source
            placePendingMarker(at: world, source: source)
            return .startedFirstPoint
        }
    }

    func cancelPending() {
        removePendingMarker()
        removePreviewLine()
    }

    func clearAll() {
        guard let arView else { return }
        removePendingMarker()
        removePreviewLine()
        for (_, anchor) in measurementAnchors {
            arView.scene.removeAnchor(anchor)
        }
        measurementAnchors.removeAll()
        textLabels.removeAll()
        measurements.removeAll()
    }

    func removeLast() {
        guard let arView, let last = measurements.last else { return }
        if let anchor = measurementAnchors[last.id] {
            arView.scene.removeAnchor(anchor)
        }
        measurementAnchors.removeValue(forKey: last.id)
        textLabels.removeValue(forKey: last.id)
        measurements.removeLast()
    }

    /// Updates a measurement's user-entered name. The 3D label shows only the
    /// number + length, so no label refresh is needed — the name appears in the
    /// capture footer, logs, and uploads.
    func renameMeasurement(id: UUID, to name: String) {
        guard let idx = measurements.firstIndex(where: { $0.id == id }) else { return }
        measurements[idx].name = name
    }

    // MARK: - Frame update

    private func onFrame() {
        if isMeasurementActive {
            updateCenterRaycast()
            updateReticle()
            updatePreviewLine()
            publishLiveState()
        } else if reticleAnchor != nil {
            removeReticle()
        }
        updateBillboards()
    }

    private func updateCenterRaycast() {
        guard let arView, arView.bounds.width > 0, arView.bounds.height > 0 else {
            clearCenter()
            return
        }
        let bounds = arView.bounds
        let center = CGPoint(x: bounds.midX, y: bounds.midY)
        if let (transform, source) = bestCenterTarget(arView: arView, at: center) {
            lastValidTransform = transform
            lastValidSource = source
            framesSinceValidHit = 0
            currentCenterTransform = transform
            currentCenterPosition = transform.translation
            currentCenterSource = source
        } else if let held = lastValidTransform, framesSinceValidHit < maxHoldFrames {
            // Brief hold through momentary dropouts so the reticle/preview stay
            // put while the phone is panning between the two points.
            framesSinceValidHit += 1
            currentCenterTransform = held
            currentCenterPosition = held.translation
            currentCenterSource = lastValidSource
        } else {
            clearCenter()
        }
    }

    private func clearCenter() {
        currentCenterTransform = nil
        currentCenterPosition = nil
        currentCenterSource = nil
    }

    /// Picks whichever surface the center ray meets first — the virtual design
    /// model or the real-world structure — and returns its reticle transform
    /// plus source. This is what makes model↔structure measuring work: aim at
    /// the model to snap a point on it, aim at the structure to snap on that.
    private func bestCenterTarget(arView: ARView, at point: CGPoint)
        -> (simd_float4x4, MeasurementPointSource)?
    {
        let camera = arView.cameraTransform.translation

        // Real-world surface (plane / estimated / LiDAR depth).
        let realTransform = bestRealHit(arView: arView, at: point)
        let realDist = realTransform.map { simd_distance($0.translation, camera) }

        // Virtual model surface (collision raycast against the design model).
        let modelHit = arView.hitTest(
            point,
            query: .nearest,
            mask: ModelAnchorController.modelCollisionGroup
        ).first
        let modelDist = modelHit?.distance

        // Whichever the ray reaches first wins.
        if let m = modelDist, realDist == nil || m <= realDist!, let hit = modelHit {
            // hitTest gives no surface normal → orient the ring to face camera.
            return (Self.transform(position: hit.position, facing: camera), .model)
        }
        if let t = realTransform {
            return (t, .real)
        }
        return nil
    }

    /// Real-world hit: an estimated-plane hit first (uses LiDAR depth on Pro
    /// devices and follows local geometry), then an infinite-plane fallback so
    /// aiming just past a surface edge still locks on rather than dropping out.
    private func bestRealHit(arView: ARView, at point: CGPoint) -> simd_float4x4? {
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

    /// Transform placing the reticle ring at `position` with its face (+Y
    /// normal) pointing toward the camera — used for model hits, which carry no
    /// surface normal.
    private static func transform(position: SIMD3<Float>, facing camera: SIMD3<Float>) -> simd_float4x4 {
        var m = simd_float4x4(orientation(alongY: camera - position))
        m.columns.3 = SIMD4<Float>(position.x, position.y, position.z, 1)
        return m
    }

    // MARK: - Reticle (3D surface-aligned ring)

    private func updateReticle() {
        guard let arView else { return }
        if let transform = currentCenterTransform {
            let (anchor, ring, dot) = ensureReticleEntities(arView: arView)
            anchor.setTransformMatrix(transform, relativeTo: nil)
            anchor.isEnabled = true

            // Colour reflects the snapped surface: green on the design model,
            // white on the real structure. Swap materials only when it changes.
            let source = currentCenterSource ?? .real
            if reticleSourceState != source {
                reticleSourceState = source
                let material = (source == .model) ? reticleModelMaterial : reticleRealMaterial
                ring.model?.materials = [material]
                dot.model?.materials = [material]
            }
        } else {
            reticleAnchor?.isEnabled = false
        }
    }

    private func ensureReticleEntities(arView: ARView)
        -> (AnchorEntity, ModelEntity, ModelEntity)
    {
        if let a = reticleAnchor, let r = reticleRing, let d = reticleDot {
            return (a, r, d)
        }
        // Ring lying flat in the local XZ plane (Y up = surface normal).
        let ringMesh = Self.generateRingMesh(radius: 0.045, thickness: 0.006)
        let ring = ModelEntity(mesh: ringMesh, materials: [reticleRealMaterial])

        let dotMesh = MeshResource.generateSphere(radius: 0.005)
        let dot = ModelEntity(mesh: dotMesh, materials: [reticleRealMaterial])
        // Lift dot a hair above the surface so it doesn't z-fight.
        dot.position = SIMD3<Float>(0, 0.001, 0)

        let anchor = AnchorEntity(world: SIMD3<Float>(repeating: 0))
        anchor.addChild(ring)
        anchor.addChild(dot)
        arView.scene.addAnchor(anchor)

        reticleAnchor = anchor
        reticleRing = ring
        reticleDot = dot
        reticleSourceState = .real
        return (anchor, ring, dot)
    }

    private func removeReticle() {
        if let arView, let anchor = reticleAnchor {
            arView.scene.removeAnchor(anchor)
        }
        reticleAnchor = nil
        reticleRing = nil
        reticleDot = nil
        reticleSourceState = nil
    }

    /// Builds a flat annulus in the local XZ plane (Y up).
    private static func generateRingMesh(radius: Float, thickness: Float, segments: Int = 48) -> MeshResource {
        var positions: [SIMD3<Float>] = []
        var normals: [SIMD3<Float>] = []
        var indices: [UInt32] = []
        let inner = radius - thickness / 2
        let outer = radius + thickness / 2

        for i in 0..<segments {
            let angle = Float(i) / Float(segments) * 2 * .pi
            let c = cos(angle)
            let s = sin(angle)
            positions.append(SIMD3<Float>(inner * c, 0, inner * s))
            positions.append(SIMD3<Float>(outer * c, 0, outer * s))
            normals.append(SIMD3<Float>(0, 1, 0))
            normals.append(SIMD3<Float>(0, 1, 0))
        }
        for i in 0..<segments {
            let next = (i + 1) % segments
            let i0 = UInt32(i * 2)
            let i1 = UInt32(i * 2 + 1)
            let i2 = UInt32(next * 2)
            let i3 = UInt32(next * 2 + 1)
            // Two triangles per ring segment, drawn for both face windings so
            // the ring is visible whether viewed from above or below.
            indices.append(contentsOf: [i0, i1, i3, i0, i3, i2])
            indices.append(contentsOf: [i0, i3, i1, i0, i2, i3])
        }
        var descriptor = MeshDescriptor(name: "ring")
        descriptor.positions = MeshBuffer(positions)
        descriptor.normals = MeshBuffer(normals)
        descriptor.primitives = .triangles(indices)
        // swiftlint:disable:next force_try
        return try! MeshResource.generate(from: [descriptor])
    }

    private func publishLiveState() {
        let locked = currentCenterPosition != nil
        var previewDist: Float? = nil
        var previewDelta: SIMD3<Float>? = nil
        if let first = pendingPosition, let curr = currentCenterPosition {
            previewDist = simd_distance(first, curr)
            previewDelta = curr - first
        }
        liveStateHandler?(LiveState(
            locked: locked,
            previewDistanceM: previewDist,
            source: currentCenterSource,
            previewDelta: previewDelta
        ))
    }

    private func updatePreviewLine() {
        guard
            let arView,
            let first = pendingPosition,
            let curr = currentCenterPosition
        else {
            removePreviewLine()
            return
        }
        let distance = simd_distance(first, curr)
        guard distance > 0.001 else {
            removePreviewLine()
            return
        }
        let midpoint = (first + curr) / 2

        // Ensure preview entities exist
        let (anchor, cylinder, endSphere, label) = ensurePreviewEntities(arView: arView)
        anchor.setPosition(midpoint, relativeTo: nil)
        anchor.setOrientation(simd_quatf(ix: 0, iy: 0, iz: 0, r: 1), relativeTo: nil)
        cylinder.scale = SIMD3<Float>(1, distance, 1)
        cylinder.orientation = Self.orientation(alongY: curr - first)
        // End sphere sits at the reticle position in world coords
        endSphere.position = curr - midpoint

        // Live distance label floats just above the line midpoint. Regenerate
        // the text mesh only when the formatted value changes.
        let string = DistanceMeasurement.formattedDistance(distance)
        if previewLabelString != string {
            previewLabelString = string
            setLabelText(label, string)
        }
        label.position = labelOffset(direction: curr - first)
    }

    private func ensurePreviewEntities(arView: ARView)
        -> (AnchorEntity, ModelEntity, ModelEntity, Entity)
    {
        if
            let a = previewAnchor,
            let c = previewCylinder,
            let s = previewEnd,
            let l = previewLabel
        {
            return (a, c, s, l)
        }
        let anchor = AnchorEntity(world: SIMD3<Float>(repeating: 0))
        // Cylinder of unit length; we scale Y per frame to span first→reticle.
        // Unlit + opaque + thick so the live line is unmistakable in any light.
        let thickness: Float = 0.009
        let cylMesh = MeshResource.generateBox(
            width: thickness,
            height: 1.0,
            depth: thickness,
            cornerRadius: thickness * 0.5
        )
        let cylMat = UnlitMaterial(color: UIColor(red: 1.0, green: 0.55, blue: 0.0, alpha: 1.0))
        let cylinder = ModelEntity(mesh: cylMesh, materials: [cylMat])
        anchor.addChild(cylinder)

        let endSphere = makeSphere(color: UIColor(red: 1.0, green: 0.5, blue: 0.0, alpha: 1.0))
        anchor.addChild(endSphere)

        let label = Entity()
        anchor.addChild(label)

        arView.scene.addAnchor(anchor)
        previewAnchor = anchor
        previewCylinder = cylinder
        previewEnd = endSphere
        previewLabel = label
        previewLabelString = nil
        return (anchor, cylinder, endSphere, label)
    }

    private func removePreviewLine() {
        if let arView, let anchor = previewAnchor {
            arView.scene.removeAnchor(anchor)
        }
        previewAnchor = nil
        previewCylinder = nil
        previewEnd = nil
        previewLabel = nil
        previewLabelString = nil
    }

    // MARK: - Marker helpers

    private func placePendingMarker(at world: SIMD3<Float>, source: MeasurementPointSource) {
        guard let arView else { return }
        // Remove only the previous marker entity here — must NOT call
        // removePendingMarker(), which also nils `pendingPosition` and would
        // wipe the position the caller just set.
        if let existing = pendingAnchor {
            arView.scene.removeAnchor(existing)
        }
        let anchor = AnchorEntity(world: world)
        anchor.addChild(makeSphere(color: Self.markerColor(for: source)))
        arView.scene.addAnchor(anchor)
        pendingAnchor = anchor
    }

    private func removePendingMarker() {
        if let arView, let anchor = pendingAnchor {
            arView.scene.removeAnchor(anchor)
        }
        pendingAnchor = nil
        pendingPosition = nil
        pendingSource = nil
    }

    /// Endpoint/marker colour by source: green on the design model, cyan on the
    /// real structure — so a finished measurement shows at a glance which end is
    /// which.
    private static func markerColor(for source: MeasurementPointSource) -> UIColor {
        source == .model
            ? UIColor(red: 0.2, green: 1.0, blue: 0.45, alpha: 1.0)
            : .cyan
    }

    private func placeVisualization(for m: DistanceMeasurement) {
        guard let arView else { return }
        let midpoint = (m.pointA + m.pointB) / 2
        let anchor = AnchorEntity(world: midpoint)

        let sphereA = makeSphere(color: Self.markerColor(for: m.sourceA))
        sphereA.position = m.pointA - midpoint
        anchor.addChild(sphereA)

        let sphereB = makeSphere(color: Self.markerColor(for: m.sourceB))
        sphereB.position = m.pointB - midpoint
        anchor.addChild(sphereB)

        // Persistent line — scale-based for consistency with preview.
        let distance = m.distanceMeters
        let thickness: Float = 0.009
        let cylMesh = MeshResource.generateBox(
            width: thickness,
            height: 1.0,
            depth: thickness,
            cornerRadius: thickness * 0.5
        )
        let cylMat = UnlitMaterial(color: UIColor(red: 1.0, green: 0.42, blue: 0.0, alpha: 1.0))
        let cylinder = ModelEntity(mesh: cylMesh, materials: [cylMat])
        cylinder.scale = SIMD3<Float>(1, distance, 1)
        cylinder.orientation = Self.orientation(alongY: m.pointB - m.pointA)
        anchor.addChild(cylinder)

        let label = Entity()
        setLabelText(label, Self.labelText(number: measurements.count + 1, distanceMeters: distance))
        label.position = labelOffset(direction: m.pointB - m.pointA)
        anchor.addChild(label)
        textLabels[m.id] = label

        arView.scene.addAnchor(anchor)
        measurementAnchors[m.id] = anchor
    }

    private func updateBillboards() {
        guard
            let arView,
            let cameraTransform = arView.session.currentFrame?.camera.transform
        else { return }
        if textLabels.isEmpty, previewLabel == nil { return }
        let cameraPos = cameraTransform.translation
        for (_, label) in textLabels {
            faceCamera(label, cameraPos: cameraPos)
        }
        if let preview = previewLabel {
            faceCamera(preview, cameraPos: cameraPos)
        }
    }

    // MARK: - Mesh helpers

    private func makeSphere(color: UIColor) -> ModelEntity {
        let mesh = MeshResource.generateSphere(radius: 0.013)
        // Unlit so endpoint markers stay bright and readable regardless of the
        // scene's lighting.
        return ModelEntity(mesh: mesh, materials: [UnlitMaterial(color: color)])
    }

    /// The 3D label text for a finalized measurement — kept minimal for AR
    /// legibility: a short sequence number and the length only. The full name
    /// and source pair still live in the data (capture footer, logs, upload).
    private static func labelText(number: Int, distanceMeters: Float) -> String {
        "#\(number) \(DistanceMeasurement.formattedDistance(distanceMeters))"
    }

    /// (Re)builds the dark plate + white text children of a label entity for a
    /// new string. Reused for both the live preview label and finalized labels.
    private func setLabelText(_ group: Entity, _ string: String) {
        while let child = group.children.first {
            child.removeFromParent()
        }
        // Compact white plate + black text for AR legibility (small enough not
        // to cover the scene, high contrast against any background).
        let mesh = MeshResource.generateText(
            string,
            extrusionDepth: 0.001,
            font: .systemFont(ofSize: 0.02, weight: .semibold),
            containerFrame: .zero,
            alignment: .center,
            lineBreakMode: .byTruncatingTail
        )
        let material = UnlitMaterial(color: UIColor.black)
        let text = ModelEntity(mesh: mesh, materials: [material])
        let bounds = mesh.bounds
        text.position = -bounds.center

        let pad: Float = 0.0045
        let plateMesh = MeshResource.generateBox(
            width: bounds.extents.x + pad * 2,
            height: bounds.extents.y + pad * 2,
            depth: 0.001,
            cornerRadius: 0.004
        )
        let plateMat = UnlitMaterial(color: UIColor(white: 1.0, alpha: 0.95))
        let plate = ModelEntity(mesh: plateMesh, materials: [plateMat])
        plate.position = SIMD3<Float>(0, 0, -0.0015)

        group.addChild(plate)
        group.addChild(text)
    }

    /// Offset that places a measurement label BESIDE its line instead of on it.
    /// For a vertical measurement the old fixed "+4 cm up" offset put the label
    /// right on the bar, which hid the value (field feedback 그림 1-1). We move
    /// it perpendicular to the line, toward the camera's right, so the value
    /// sits next to the bar regardless of the line's orientation.
    private func labelOffset(direction: SIMD3<Float>) -> SIMD3<Float> {
        let len = simd_length(direction)
        guard len > 1e-5 else { return SIMD3<Float>(0, 0.05, 0) }
        let d = direction / len
        var camRight = SIMD3<Float>(1, 0, 0)
        if let t = arView?.cameraTransform.matrix {
            camRight = SIMD3<Float>(t.columns.0.x, t.columns.0.y, t.columns.0.z)
        }
        // Component of camera-right perpendicular to the line.
        var o = camRight - d * simd_dot(d, camRight)
        let ol = simd_length(o)
        if ol < 0.1 {
            // Line runs along camera-right (horizontal) → offset upward instead.
            var up = SIMD3<Float>(0, 1, 0) - d * d.y
            let ul = simd_length(up)
            up = ul > 1e-4 ? up / ul : SIMD3<Float>(0, 1, 0)
            return up * 0.05
        }
        return (o / ol) * 0.06
    }

    // MARK: - Geometry helpers

    /// Orientation that maps the local +Y axis onto `vector`, with a stable
    /// fallback when the vector is (anti)parallel to +Y — e.g. a vertical line,
    /// where `simd_quatf(from:to:)` is otherwise numerically undefined.
    private static func orientation(alongY vector: SIMD3<Float>) -> simd_quatf {
        let len = simd_length(vector)
        guard len > 1e-5 else { return simd_quatf(ix: 0, iy: 0, iz: 0, r: 1) }
        let dir = vector / len
        let y = SIMD3<Float>(0, 1, 0)
        let d = simd_dot(y, dir)
        if d > 0.99999 { return simd_quatf(ix: 0, iy: 0, iz: 0, r: 1) }
        if d < -0.99999 { return simd_quatf(angle: .pi, axis: SIMD3<Float>(1, 0, 0)) }
        return simd_quatf(from: y, to: dir)
    }

    /// Orients an entity so its +Z (text front) faces the camera while staying
    /// upright relative to world up, avoiding the roll a shortest-arc rotation
    /// would introduce.
    private func faceCamera(_ entity: Entity, cameraPos: SIMD3<Float>) {
        let pos = entity.position(relativeTo: nil)
        var forward = cameraPos - pos
        let len = simd_length(forward)
        guard len > 1e-4 else { return }
        forward /= len
        let worldUp = SIMD3<Float>(0, 1, 0)
        var right = simd_cross(worldUp, forward)
        let rl = simd_length(right)
        if rl < 1e-4 {
            right = SIMD3<Float>(1, 0, 0)   // looking straight up/down
        } else {
            right /= rl
        }
        let up = simd_cross(forward, right)
        let basis = simd_float3x3(right, up, forward)
        entity.setOrientation(simd_quatf(basis), relativeTo: nil)
    }
}
