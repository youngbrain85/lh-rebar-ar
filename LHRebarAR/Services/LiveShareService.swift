import Foundation
import LiveKit
import UIKit

/// An office → field annotation marker ("여기 봐주세요"), in normalized screen
/// coordinates (0…1, relative to the shared screen).
struct LiveAnnotation: Identifiable, Equatable {
    let id = UUID()
    let u: Double
    let v: Double
    let receivedAt = Date()
}

/// Connects to a LiveKit room and shares this app's screen (in-app capture — no
/// broadcast extension needed) plus the microphone, so an office viewer can
/// watch the field AR session live, talk both ways, and drop markers on the
/// screen via the data channel.
@MainActor
final class LiveShareService: NSObject, ObservableObject {
    enum State: Equatable {
        case idle
        case connecting
        case sharing
        case failed(String)
    }

    @Published private(set) var state: State = .idle
    /// Markers received from the office; the AR screen overlays and expires them.
    @Published private(set) var annotations: [LiveAnnotation] = []

    /// Whether the field microphone is currently publishing. Mic is **opt-in**
    /// (a toggle) and is NOT enabled at connect: enabling it during connect
    /// could fail the whole share with an audio-engine error (-9000) on some
    /// devices/routes. Screen sharing must never depend on the mic.
    @Published private(set) var micEnabled = false

    /// Office memo → world-locked 3D pin. Wired by the AR screen; falls back to
    /// a 2D ping when the handler is absent or placement fails (no surface).
    var memoHandler: ((_ u: Double, _ v: Double, _ text: String) -> Bool)?
    /// Office asked to clear all 3D memos.
    var clearMemosHandler: (() -> Void)?

    private let room = Room()

    var isSharing: Bool { state == .sharing }

    override init() {
        super.init()
        room.add(delegate: self)
    }

    /// Starts sharing into `roomName` (e.g. "site-5"). Prefers a fresh token
    /// from the dashboard token endpoint; falls back to the static dev token
    /// (room "ar-demo") when the endpoint is unreachable.
    func start(roomName: String) async {
        switch state {
        case .connecting, .sharing: return
        default: break
        }
        state = .connecting

        guard !LiveShareConfig.serverURL.isEmpty else {
            state = .failed("LiveKit 설정이 비어 있습니다.")
            return
        }

        // Token candidates, tried in order. A freshly minted token can be
        // rejected once with 401 when the minting server's clock is a touch
        // ahead of LiveKit's (not-yet-valid) — so retry the same token once
        // after a short pause before falling back to the static demo token.
        var attempts: [(token: String, label: String)] = []
        if let fetched = await fetchToken(room: roomName) {
            attempts.append((fetched, roomName))
            attempts.append((fetched, roomName))   // retry once (clock skew)
        }
        if !LiveShareConfig.devToken.isEmpty {
            attempts.append((LiveShareConfig.devToken, "ar-demo"))
        }
        guard !attempts.isEmpty else {
            state = .failed("토큰을 준비할 수 없습니다.")
            return
        }

        var lastError = "연결 실패"
        for (index, attempt) in attempts.enumerated() {
            if index > 0 {
                try? await Task.sleep(nanoseconds: 1_500_000_000)
            }
            do {
                // Connect with the mic OFF — video-first. The mic is a separate
                // opt-in toggle so an audio-engine failure can never abort the
                // screen share.
                try await room.connect(
                    url: LiveShareConfig.serverURL,
                    token: attempt.token,
                    connectOptions: ConnectOptions(enableMicrophone: false)
                )
                // In-app screen capture (prompts the system recording permission).
                try await room.localParticipant.setScreenShare(enabled: true)
                state = .sharing
                return
            } catch {
                lastError = error.localizedDescription
            }
        }
        state = .failed(lastError)
    }

    func stop() async {
        await room.disconnect()
        state = .idle
        annotations = []
        micEnabled = false
    }

    /// Toggles the field microphone (opt-in two-way voice). A failure here must
    /// NOT affect the ongoing screen share — we simply leave the mic off and
    /// report failure so the UI can inform the user.
    @discardableResult
    func toggleMic() async -> Bool {
        guard isSharing else { return false }
        let next = !micEnabled
        do {
            try await room.localParticipant.setMicrophone(enabled: next)
            micEnabled = next
            return true
        } catch {
            micEnabled = false
            return false
        }
    }

    /// Drops annotations older than their display window.
    func expireAnnotations(olderThan seconds: TimeInterval = 5) {
        let cutoff = Date().addingTimeInterval(-seconds)
        if annotations.contains(where: { $0.receivedAt < cutoff }) {
            annotations.removeAll { $0.receivedAt < cutoff }
        }
    }

    // MARK: - Token

    private func fetchToken(room roomName: String) async -> String? {
        guard !LiveShareConfig.tokenEndpoint.isEmpty,
              var comps = URLComponents(string: LiveShareConfig.tokenEndpoint)
        else { return nil }
        let device = UIDevice.current.name.prefix(12)
        comps.queryItems = [
            URLQueryItem(name: "room", value: roomName),
            URLQueryItem(name: "identity", value: "field-\(UUID().uuidString.prefix(6))"),
            URLQueryItem(name: "name", value: "현장 \(device)"),
        ]
        guard let url = comps.url else { return nil }
        var request = URLRequest(url: url)
        request.timeoutInterval = 8
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse, http.statusCode == 200,
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = obj["token"] as? String
        else { return nil }
        return token
    }
}

// MARK: - RoomDelegate (annotation receive)

extension LiveShareService: RoomDelegate {
    nonisolated func room(
        _ room: Room,
        participant: RemoteParticipant?,
        didReceiveData data: Data,
        forTopic topic: String,
        encryptionType: EncryptionType
    ) {
        guard topic == "annotation",
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return }
        let type = (obj["type"] as? String) ?? "ping"
        Task { @MainActor in
            switch type {
            case "clearMemos":
                clearMemosHandler?()
                HapticsService.shared.impact()
            case "memo":
                guard let u = obj["u"] as? Double, let v = obj["v"] as? Double else { return }
                let text = (obj["text"] as? String) ?? ""
                let placed = memoHandler?(u, v, text) ?? false
                if !placed {
                    // No surface hit (or AR screen not active) → 2D ping fallback.
                    annotations.append(LiveAnnotation(u: u, v: v))
                }
                HapticsService.shared.impact()
            default: // "ping"
                guard let u = obj["u"] as? Double, let v = obj["v"] as? Double else { return }
                annotations.append(LiveAnnotation(u: u, v: v))
                if annotations.count > 6 { annotations.removeFirst(annotations.count - 6) }
                HapticsService.shared.impact()
            }
        }
    }
}
