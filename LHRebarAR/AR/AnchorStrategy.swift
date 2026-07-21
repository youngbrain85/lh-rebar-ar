import ARKit
import RealityKit

struct PlacementHit {
    enum Source {
        case sceneMesh
        case existingPlane
        case estimatedPlane
    }

    let worldTransform: simd_float4x4
    let source: Source
}

enum AnchorStrategy {
    /// Raycast priority per CLAUDE.md: LiDAR mesh → existing plane → estimated plane.
    /// Scene-mesh hits require `sceneUnderstanding.options.insert(.collision)` upstream.
    @MainActor
    static func placementRaycast(from arView: ARView, at screenPoint: CGPoint) -> PlacementHit? {
        // 1. LiDAR scene mesh (RealityKit collision against scene reconstruction).
        if let hit = arView.raycast(
            from: screenPoint,
            allowing: .estimatedPlane,
            alignment: .any
        ).first(where: { $0.anchor is ARMeshAnchor }) {
            return PlacementHit(worldTransform: hit.worldTransform, source: .sceneMesh)
        }

        // 2. Existing detected plane (high confidence).
        if let query = arView.makeRaycastQuery(
            from: screenPoint,
            allowing: .existingPlaneGeometry,
            alignment: .any
        ), let hit = arView.session.raycast(query).first {
            return PlacementHit(worldTransform: hit.worldTransform, source: .existingPlane)
        }

        // 3. Estimated plane (feature-point based, last resort).
        if let query = arView.makeRaycastQuery(
            from: screenPoint,
            allowing: .estimatedPlane,
            alignment: .any
        ), let hit = arView.session.raycast(query).first {
            return PlacementHit(worldTransform: hit.worldTransform, source: .estimatedPlane)
        }

        return nil
    }
}
