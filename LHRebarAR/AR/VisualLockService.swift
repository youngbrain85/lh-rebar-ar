import ARKit
import RealityKit
import simd

/// Scene-to-scene visual lock ("기준 스캔 잠금").
///
/// When the user commits a model pose, we snapshot the LiDAR mesh of the REAL
/// structure around the model (the reference). Later, drift makes world-anchored
/// content slide; `relock` scans the current mesh of the same structure and
/// aligns it to the reference with point-to-plane ICP, then moves the model by
/// that correction so it re-attaches to the real structure.
///
/// The design model is never matched against anything — reference and target
/// are both scans of the same physical structure, so as-built deviation from
/// the design doesn't matter (the structure is its own marker).
@MainActor
final class VisualLockService: ObservableObject {

    struct Reference {
        var points: [SIMD3<Float>]          // world coords at lock time
        var modelTransform: simd_float4x4   // placementRoot world pose at lock
        var boxMin: SIMD3<Float>            // AABB of the reference points
        var boxMax: SIMD3<Float>
    }

    struct RelockOutcome {
        var newModelTransform: simd_float4x4?
        var message: String
    }

    @Published private(set) var hasReference = false
    private(set) var isRelocking = false

    private weak var arView: ARView?
    private(set) var reference: Reference?

    // Tunables
    private let regionMargin: Float = 0.8          // capture margin around model bbox
    private let refVoxel: Float = 0.03             // reference downsample (m)
    private let curVoxel: Float = 0.04             // current-scan downsample (m)
    private let maxRefPoints = 6000
    private let maxCurPoints = 4000
    private let minPoints = 400
    private let minInliers = 250
    private let maxCorrectionT: Float = 0.15       // reject corrections > 15 cm
    private let maxCorrectionR: Float = 5 * .pi / 180  // ... or > 5°

    func bind(arView: ARView) { self.arView = arView }

    func clear() {
        reference = nil
        hasReference = false
    }

    /// Snapshot the real-world mesh around the model as the alignment datum.
    /// Returns false when the surrounding scan is too sparse to be a datum.
    @discardableResult
    func captureReference(around root: Entity) -> Bool {
        guard let frame = arView?.session.currentFrame else { return false }
        let bounds = root.visualBounds(relativeTo: nil)
        let boxMin = bounds.min - SIMD3<Float>(repeating: regionMargin)
        let boxMax = bounds.max + SIMD3<Float>(repeating: regionMargin)
        let (pts, _) = Self.meshPoints(
            in: frame, boxMin: boxMin, boxMax: boxMax, voxel: refVoxel, cap: maxRefPoints
        )
        guard pts.count >= minPoints else { return false }
        var lo = pts[0], hi = pts[0]
        for p in pts { lo = simd_min(lo, p); hi = simd_max(hi, p) }
        reference = Reference(
            points: pts,
            modelTransform: root.transformMatrix(relativeTo: nil),
            boxMin: lo,
            boxMax: hi
        )
        hasReference = true
        return true
    }

    /// Re-align: scan the current mesh in the reference region, ICP it onto the
    /// stored reference, and return the corrected model transform.
    func relock() async -> RelockOutcome {
        guard let ref = reference else {
            return RelockOutcome(newModelTransform: nil, message: "기준 스캔 없음 — 모델을 조정하면 자동 저장됩니다")
        }
        guard !isRelocking else {
            return RelockOutcome(newModelTransform: nil, message: "재고정 진행 중")
        }
        guard let frame = arView?.session.currentFrame else {
            return RelockOutcome(newModelTransform: nil, message: "AR 프레임을 가져올 수 없습니다")
        }
        isRelocking = true
        defer { isRelocking = false }

        let margin: Float = 0.25
        let (cur, curN) = Self.meshPoints(
            in: frame,
            boxMin: ref.boxMin - SIMD3<Float>(repeating: margin),
            boxMax: ref.boxMax + SIMD3<Float>(repeating: margin),
            voxel: curVoxel,
            cap: maxCurPoints
        )
        guard cur.count >= minPoints else {
            return RelockOutcome(newModelTransform: nil, message: "주변 스캔 부족 — 구조물이 보이게 비춰주세요")
        }

        let refPts = ref.points
        let result = await Task.detached(priority: .userInitiated) {
            Self.runICP(reference: refPts, current: cur, currentNormals: curN)
        }.value

        guard result.inliers >= minInliers else {
            return RelockOutcome(newModelTransform: nil, message: "정합 신뢰도 부족 (겹침 \(result.inliers)점) — 잠금 위치 근처에서 시도하세요")
        }

        let t = SIMD3<Float>(result.T.columns.3.x, result.T.columns.3.y, result.T.columns.3.z)
        let dT = simd_length(t)
        let q = simd_quatf(result.T)
        var angle = abs(q.angle)
        if angle > .pi { angle = 2 * .pi - angle }
        guard dT <= maxCorrectionT, angle <= maxCorrectionR else {
            return RelockOutcome(
                newModelTransform: nil,
                message: String(format: "보정량 과대(%.0fmm/%.1f°) — 위치를 수동 확인하세요", dT * 1000, angle * 180 / .pi)
            )
        }

        let newModel = result.T * ref.modelTransform
        let msg = String(
            format: "재고정 완료 · 보정 %.0fmm · 잔차 %.0fmm",
            dT * 1000, result.meanAbsErrM * 1000
        )
        return RelockOutcome(newModelTransform: newModel, message: msg)
    }

    // MARK: - Mesh extraction

    /// Collects voxel-downsampled world-space vertices (+normals) from all
    /// ARMeshAnchors inside an AABB.
    nonisolated private static func meshPoints(
        in frame: ARFrame,
        boxMin: SIMD3<Float>,
        boxMax: SIMD3<Float>,
        voxel: Float,
        cap: Int
    ) -> ([SIMD3<Float>], [SIMD3<Float>]) {
        var pts: [SIMD3<Float>] = []
        var nrms: [SIMD3<Float>] = []
        var seen = Set<SIMD3<Int32>>()
        pts.reserveCapacity(min(cap, 4096))
        nrms.reserveCapacity(min(cap, 4096))

        for anchor in frame.anchors {
            guard let mesh = anchor as? ARMeshAnchor else { continue }
            let g = mesh.geometry
            let v = g.vertices
            let n = g.normals
            guard v.count == n.count else { continue }
            let vbuf = v.buffer.contents()
            let nbuf = n.buffer.contents()
            let m = mesh.transform
            let rot = simd_float3x3(
                SIMD3<Float>(m.columns.0.x, m.columns.0.y, m.columns.0.z),
                SIMD3<Float>(m.columns.1.x, m.columns.1.y, m.columns.1.z),
                SIMD3<Float>(m.columns.2.x, m.columns.2.y, m.columns.2.z)
            )
            for i in 0..<v.count {
                let vp = vbuf.advanced(by: v.offset + i * v.stride)
                    .assumingMemoryBound(to: Float.self)
                let local = SIMD3<Float>(vp[0], vp[1], vp[2])
                let w4 = m * SIMD4<Float>(local, 1)
                let w = SIMD3<Float>(w4.x, w4.y, w4.z)
                guard
                    w.x >= boxMin.x, w.x <= boxMax.x,
                    w.y >= boxMin.y, w.y <= boxMax.y,
                    w.z >= boxMin.z, w.z <= boxMax.z
                else { continue }
                let key = SIMD3<Int32>(
                    Int32(floorf(w.x / voxel)),
                    Int32(floorf(w.y / voxel)),
                    Int32(floorf(w.z / voxel))
                )
                guard seen.insert(key).inserted else { continue }
                let np = nbuf.advanced(by: n.offset + i * n.stride)
                    .assumingMemoryBound(to: Float.self)
                var wn = rot * SIMD3<Float>(np[0], np[1], np[2])
                let len = simd_length(wn)
                wn = len > 1e-6 ? wn / len : SIMD3<Float>(0, 1, 0)
                pts.append(w)
                nrms.append(wn)
                if pts.count >= cap { return (pts, nrms) }
            }
        }
        return (pts, nrms)
    }

    // MARK: - ICP (point-to-plane)

    /// Finds T minimizing point-to-plane error between T·reference and the
    /// current cloud. Small-angle Gauss-Newton, voxel-hash nearest neighbours,
    /// shrinking match threshold. Runs off the main thread.
    nonisolated private static func runICP(
        reference: [SIMD3<Float>],
        current: [SIMD3<Float>],
        currentNormals: [SIMD3<Float>]
    ) -> (T: simd_float4x4, meanAbsErrM: Float, inliers: Int) {
        let cell: Float = 0.12
        var grid = [SIMD3<Int32>: [Int32]]()
        grid.reserveCapacity(current.count)

        @inline(__always) func cellKey(_ p: SIMD3<Float>) -> SIMD3<Int32> {
            SIMD3<Int32>(
                Int32(floorf(p.x / cell)),
                Int32(floorf(p.y / cell)),
                Int32(floorf(p.z / cell))
            )
        }
        for (i, c) in current.enumerated() {
            grid[cellKey(c), default: []].append(Int32(i))
        }

        var T = matrix_identity_float4x4
        var lastErr: Float = 0
        var lastInliers = 0

        for iter in 0..<14 {
            let thr: Float = iter < 4 ? 0.12 : (iter < 8 ? 0.08 : 0.05)
            let thr2 = thr * thr
            var A = [Double](repeating: 0, count: 36)
            var b = [Double](repeating: 0, count: 6)
            var errSum: Float = 0
            var count = 0

            for r in reference {
                let q4 = T * SIMD4<Float>(r, 1)
                let q = SIMD3<Float>(q4.x, q4.y, q4.z)
                let k = cellKey(q)
                var best: Int32 = -1
                var bestD = thr2
                for dx in Int32(-1)...1 {
                    for dy in Int32(-1)...1 {
                        for dz in Int32(-1)...1 {
                            guard let idxs = grid[SIMD3<Int32>(k.x + dx, k.y + dy, k.z + dz)] else { continue }
                            for ci in idxs {
                                let d = simd_length_squared(current[Int(ci)] - q)
                                if d < bestD { bestD = d; best = ci }
                            }
                        }
                    }
                }
                guard best >= 0 else { continue }
                let c = current[Int(best)]
                let n = currentNormals[Int(best)]
                let e = simd_dot(q - c, n)
                let jr = simd_cross(q, n)
                let J: [Float] = [jr.x, jr.y, jr.z, n.x, n.y, n.z]
                for a in 0..<6 {
                    for bi in a..<6 { A[a * 6 + bi] += Double(J[a] * J[bi]) }
                    b[a] += Double(J[a] * e)
                }
                errSum += abs(e)
                count += 1
            }

            lastErr = count > 0 ? errSum / Float(count) : 0
            lastInliers = count
            guard count >= 50 else { break }

            for a in 0..<6 {
                for bi in 0..<a { A[a * 6 + bi] = A[bi * 6 + a] }
                A[a * 6 + a] += 1e-6  // Tikhonov: guards degenerate geometry
            }
            guard let delta = solve6(A: A, b: b.map { -$0 }) else { break }

            let w = SIMD3<Float>(Float(delta[0]), Float(delta[1]), Float(delta[2]))
            let t = SIMD3<Float>(Float(delta[3]), Float(delta[4]), Float(delta[5]))
            let ang = simd_length(w)
            var dM = matrix_identity_float4x4
            if ang > 1e-9 {
                dM = simd_float4x4(simd_quatf(angle: ang, axis: w / ang))
            }
            dM.columns.3 = SIMD4<Float>(t, 1)
            T = dM * T

            if ang < 0.0004, simd_length(t) < 0.0003 { break }  // converged
        }
        return (T, lastErr, lastInliers)
    }

    /// 6×6 linear solve via Gaussian elimination with partial pivoting.
    nonisolated private static func solve6(A: [Double], b: [Double]) -> [Double]? {
        var m = A
        var v = b
        for col in 0..<6 {
            var pivot = col
            var maxAbs = abs(m[col * 6 + col])
            for row in (col + 1)..<6 where abs(m[row * 6 + col]) > maxAbs {
                maxAbs = abs(m[row * 6 + col])
                pivot = row
            }
            guard maxAbs > 1e-12 else { return nil }
            if pivot != col {
                for k in 0..<6 { m.swapAt(col * 6 + k, pivot * 6 + k) }
                v.swapAt(col, pivot)
            }
            let inv = 1.0 / m[col * 6 + col]
            for row in (col + 1)..<6 {
                let f = m[row * 6 + col] * inv
                guard f != 0 else { continue }
                for k in col..<6 { m[row * 6 + k] -= f * m[col * 6 + k] }
                v[row] -= f * v[col]
            }
        }
        var x = [Double](repeating: 0, count: 6)
        for row in stride(from: 5, through: 0, by: -1) {
            var s = v[row]
            for k in (row + 1)..<6 { s -= m[row * 6 + k] * x[k] }
            x[row] = s / m[row * 6 + row]
        }
        return x
    }
}
