import RealityKit
import SwiftUI
import UIKit

struct ARPlacementView: View {
    let model: RebarModel

    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @StateObject private var session = ARSessionManager()
    @StateObject private var placement: PlacementViewModel
    @StateObject private var measurement = MeasurementViewModel()
    @StateObject private var liveShare = LiveShareService()
    @StateObject private var memoController = MemoAnnotationController()
    @State private var isPadExpanded: Bool = false
    @State private var showHistory: Bool = false

    // Screen capture
    @State private var arViewRef: ARView?
    @State private var captureFlash: Bool = false
    @State private var captureToastMessage: String?
    @State private var captureToastIcon: String = "exclamationmark.triangle.fill"
    @State private var captureThumbnail: UIImage?
    @State private var isRelocking: Bool = false
    /// 철근 계층 필터 패널 — LH 전용 앱에서만 열린다 (AppFeatures.rebarFilter)
    @State private var showRebarTree: Bool = false

    // Measurement naming
    @State private var showNamePrompt: Bool = false
    @State private var pendingNameText: String = ""
    @State private var pendingNameID: UUID?

    /// iPad OR iPhone landscape → side panel. Portrait iPhone → bottom sheet.
    private var useSidePanelLayout: Bool {
        horizontalSizeClass == .regular || verticalSizeClass == .compact
    }

    /// Portrait iPhone: tighter top bar, icon-only secondary buttons.
    private var isCompactTop: Bool {
        horizontalSizeClass == .compact && verticalSizeClass == .regular
    }

    init(model: RebarModel) {
        self.model = model
        _placement = StateObject(wrappedValue: PlacementViewModel(model: model))
    }

    var body: some View {
        GeometryReader { _ in
            ZStack(alignment: .top) {
                ARViewContainer(
                    manager: session,
                    onViewReady: { arView in
                        placement.bind(arView: arView)
                        measurement.bind(arView: arView)
                        memoController.bind(arView: arView)
                        // Office memos → world-locked 3D pins; office clear →
                        // remove them all.
                        liveShare.memoHandler = { [weak memoController] u, v, text in
                            memoController?.place(u: u, v: v, text: text) ?? false
                        }
                        liveShare.clearMemosHandler = { [weak memoController] in
                            memoController?.clearAll()
                        }
                        // Defer the @State write out of the SwiftUI view-update
                        // cycle — setting @State synchronously from makeUIView is
                        // unreliable (the write can be dropped), which left
                        // arViewRef nil and made the capture button do nothing.
                        DispatchQueue.main.async { arViewRef = arView }
                    },
                    onTap: { arView, point in
                        // Measurement mode swallows the tap; otherwise place the model.
                        // 측정 기능이 꺼진 앱에서는 handleTap 자체를 호출하지 않는다 — isActive가
                        // 항상 false라 지금은 안전하지만, 나중에 다른 setActive 호출부가 생기면
                        // 깨질 수 있는 간접 의존을 없앤다(쉼표 조건은 단락 평가되어 뒤 항은 평가 안 됨).
                        if AppFeatures.measurement, measurement.handleTap(in: arView, at: point) { return }
                        placement.handleTap(in: arView, at: point)
                    }
                )
                .ignoresSafeArea()

                overlay

                if !showsFinePad {
                    captureButton
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                        .padding(.trailing, LHSpacing.lg)
                        .padding(.top, 84)
                }

                captureToast
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    .padding(.top, 110)

                // 발주처 요청으로 앱을 둘로 나눴다 — 협업(라이브 공유) 관련 UI는 연구과제 앱에서만 보인다
                if AppFeatures.liveShare {
                    liveShareBanner
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                        .padding(.top, 60)

                    annotationOverlay
                }
            }
            .overlay {
                Color.white
                    .opacity(captureFlash ? 0.85 : 0)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
            }
        }
        .statusBarHidden(true)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await placement.loadModel()
        }
        .onChange(of: session.tracking) { _, newValue in
            let locked: Bool
            switch newValue {
            case .normal: locked = false
            case .limited, .notAvailable: locked = true
            }
            placement.setAdjustmentEnabled(!locked)
        }
        .onChange(of: placement.state) { _, newValue in
            // Collapse the pad when the user removes the placement or the
            // model fails to load. New placements start collapsed too.
            switch newValue {
            case .ready, .loading, .failed:
                isPadExpanded = false
            default:
                break
            }
        }
        // 철근 계층 필터 — 기능이 꺼진 앱에서는 바인딩 자체가 항상 false다
        .sheet(isPresented: Binding(
            get: { AppFeatures.rebarFilter && showRebarTree },
            set: { showRebarTree = $0 }
        )) {
            RebarTreePad(
                nodes: placement.rebarTree,
                source: placement.rebarSource,
                checked: Binding(
                    get: { placement.checkedRebarNodes },
                    set: { placement.checkedRebarNodes = $0 }
                ),
                nodeCount: placement.rebarNodeCount,
                onClose: { showRebarTree = false }
            )
            .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showHistory) {
            MetricsView(
                quality: session.quality,
                placementHistory: placement.placementHistory,
                placementLogURL: AppLogger.shared.placementLogURL,
                jitterLogURL: AppLogger.shared.jitterLogURL,
                onClearPlacements: { placement.clearPlacementHistory() },
                onClearJitter: {
                    AppLogger.shared.clearJitterLog()
                }
            )
        }
        // 측정 기능이 꺼진 앱(연구과제)에서는 얼럿이 뜨지 않아야 한다. 뷰 수식자(.alert)는
        // if로 감쌀 수 없으므로 조건을 Binding 안에 넣는다
        .alert("측정 이름", isPresented: Binding(
            get: { AppFeatures.measurement && showNamePrompt },
            set: { showNamePrompt = $0 }
        )) {
            TextField("예: 가로철근-1", text: $pendingNameText)
            Button("저장") {
                if let id = pendingNameID {
                    measurement.renameMeasurement(
                        id: id,
                        to: pendingNameText.trimmingCharacters(in: .whitespacesAndNewlines)
                    )
                }
            }
            Button("취소", role: .cancel) {}
        } message: {
            Text("이 측정의 이름을 입력하세요 (값 옆과 사진·기록에 표시됩니다)")
        }
    }

    private func startNaming(_ m: DistanceMeasurement) {
        pendingNameText = m.name
        pendingNameID = m.id
        showNamePrompt = true
    }

    // MARK: - Overlay

    @ViewBuilder
    private var overlay: some View {
        if useSidePanelLayout {
            sidePanelOverlay
        } else {
            bottomSheetOverlay
        }
    }

    private var bottomSheetOverlay: some View {
        ZStack(alignment: .topTrailing) {
            VStack(spacing: LHSpacing.md) {
                topBar
                    .padding(.horizontal)
                    .padding(.top, LHSpacing.lg - 2)

                Spacer(minLength: 0)

                if AppFeatures.measurement { measurementHintBanner }
                trackingLimitedBanner
                errorBanners
                if AppFeatures.measurement && measurement.isActive {
                    measurementPlusButton
                        .padding(.bottom, LHSpacing.lg + 6)
                        .transition(.opacity.combined(with: .scale(scale: 0.85)))
                } else if showsFinePad {
                    FineAdjustPad(
                        vm: placement.fine,
                        modelOpacity: Binding(
                            get: { placement.modelOpacity },
                            set: { placement.modelOpacity = $0 }
                        ),
                        onClose: {
                            isPadExpanded = false
                            placement.commitAdjustments()
                        },
                        layout: .bottomSheet
                    )
                        .padding(.horizontal)
                        .padding(.bottom, LHSpacing.lg + 2)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                } else if showsAdjustChip {
                    adjustChip
                        .padding(.bottom, LHSpacing.xl)
                        .transition(.opacity.combined(with: .scale(scale: 0.95)))
                }
            }
            diagnosticsOverlay
                .padding(.trailing)
                .padding(.top, 60)
        }
        .animation(.easeInOut(duration: 0.2), value: isPadExpanded)
        .animation(.easeInOut(duration: 0.2), value: placementActive)
    }

    /// iPad portrait/landscape + iPhone landscape → side-panel layout.
    /// Side panel width adapts: iPad uses `sidePanelWidth`, iPhone landscape
    /// uses a tighter width so the AR view keeps breathing room.
    private var sidePanelOverlay: some View {
        let panelWidth: CGFloat = horizontalSizeClass == .regular
            ? LHSpacing.sidePanelWidth          // iPad
            : 280                               // iPhone landscape
        return ZStack(alignment: .topTrailing) {
            HStack(alignment: .top, spacing: 0) {
                VStack {
                    topBar
                        .padding(.horizontal)
                        .padding(.top, LHSpacing.lg - 2)
                    Spacer()
                    if AppFeatures.measurement { measurementHintBanner }
                    if AppFeatures.measurement && measurement.isActive {
                        measurementPlusButton
                            .padding(.bottom, LHSpacing.lg + 4)
                            .transition(.opacity.combined(with: .scale(scale: 0.85)))
                    }
                    trackingLimitedBanner
                        .padding(.bottom, LHSpacing.lg + 2)
                }

                if showsFinePad {
                    FineAdjustPad(
                        vm: placement.fine,
                        modelOpacity: Binding(
                            get: { placement.modelOpacity },
                            set: { placement.modelOpacity = $0 }
                        ),
                        onClose: {
                            isPadExpanded = false
                            placement.commitAdjustments()
                        },
                        layout: .sidePanel
                    )
                        .padding(.trailing, LHSpacing.lg + 2)
                        .padding(.top, LHSpacing.lg - 2)
                        .frame(width: panelWidth)
                        .transition(.move(edge: .trailing).combined(with: .opacity))
                } else if showsAdjustChip {
                    VStack {
                        Spacer()
                        adjustChip
                        Spacer()
                    }
                    .padding(.trailing, LHSpacing.lg + 2)
                    .transition(.opacity.combined(with: .scale(scale: 0.95)))
                }
            }
            diagnosticsOverlay
                .padding(.trailing, showsFinePad ? panelWidth + LHSpacing.xl : LHSpacing.lg + 2)
                .padding(.top, 60)
        }
        .animation(.easeInOut(duration: 0.2), value: isPadExpanded)
        .animation(.easeInOut(duration: 0.2), value: placementActive)
    }

    // MARK: - Top bar

    private var topBar: some View {
        HStack(spacing: isCompactTop ? LHSpacing.xs : LHSpacing.sm) {
            StatusBadge(label: trackingBadgeLabel, tint: trackingTint)
            placementBadge
            latencyBadge
            Spacer(minLength: LHSpacing.xs)
            // Mesh visualization is a scan-quality debug aid — dev builds only,
            // like the diagnostics toggle. Field users don't need it.
            #if DEBUG
            diagnosticsToggle
            meshToggle
            #endif
            // 발주처 요청으로 앱을 둘로 나눴다 — 어느 앱에 무엇이 보이는지는 AppFeatures 한 곳에서 정한다
            if AppFeatures.measurement { measurementToggle }
            if AppFeatures.liveShare {
                liveShareToggle
                if liveShare.isSharing { micToggle }
            }
            if AppFeatures.rebarFilter, placementActive { rebarTreeToggle }
            if placementActive { relockButton }
            if case .placed = placement.state { removeButton }
            if case .adjusting = placement.state { removeButton }
        }
    }

    /// 철근 계층 필터 — `AppFeatures.rebarFilter`를 실제로 읽는 유일한 지점.
    /// 앱별 차이는 AppFeatures 한 곳에서만 정한다 (고차 #13).
    private var rebarTreeToggle: some View {
        Button {
            HapticsService.shared.impact()
            showRebarTree.toggle()
        } label: {
            Image(systemName: "list.bullet.indent")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(showRebarTree ? LHColors.adjusting : .white)
                .frame(width: LHSpacing.iconChip, height: LHSpacing.iconChip)
                .background(LHColors.overlay, in: Circle())
        }
        .accessibilityLabel("철근 종류 선택")
    }

    private var measurementToggle: some View {
        Button {
            measurement.toggleActive()
            HapticsService.shared.impact()
        } label: {
            Image(systemName: "ruler")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(measurement.isActive ? LHColors.adjusting : .white)
                .frame(width: LHSpacing.iconChip, height: LHSpacing.iconChip)
                .background(LHColors.overlay, in: Circle())
        }
        .accessibilityLabel("Measure distance")
    }

    /// Visual re-lock: ICP-aligns the current LiDAR scan to the datum captured
    /// at the last adjustment and snaps the model back onto the real structure.
    private var relockButton: some View {
        Button {
            guard !isRelocking else { return }
            HapticsService.shared.impact()
            isRelocking = true
            Task {
                let (ok, message) = await placement.relockNow()
                isRelocking = false
                captureThumbnail = nil
                showCaptureToast(message, icon: ok ? "scope" : "exclamationmark.triangle.fill")
            }
        } label: {
            Image(systemName: "scope")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: LHSpacing.iconChip, height: LHSpacing.iconChip)
                .background(LHColors.overlay, in: Circle())
                .opacity(isRelocking ? 0.4 : 1.0)
        }
        .disabled(isRelocking)
        .accessibilityLabel("재고정 — 실물 기준으로 모델 위치 보정")
    }

    // MARK: - Live share (office collaboration)

    /// Per-site collaboration room (falls back to the demo room for bundled
    /// sample models that have no backend site).
    private var liveRoomName: String {
        model.siteID.map { "site-\($0)" } ?? "ar-demo"
    }

    private var liveShareToggle: some View {
        Button {
            HapticsService.shared.impact()
            Task {
                if liveShare.isSharing {
                    await liveShare.stop()
                } else {
                    await liveShare.start(roomName: liveRoomName)
                }
            }
        } label: {
            Image(systemName: liveShare.isSharing
                  ? "dot.radiowaves.left.and.right"
                  : "shareplay")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(liveShare.isSharing ? .red : .white)
                .frame(width: LHSpacing.iconChip, height: LHSpacing.iconChip)
                .background(LHColors.overlay, in: Circle())
        }
        .accessibilityLabel("오피스와 화면 공유")
    }

    /// Opt-in field microphone (two-way voice), shown only while sharing.
    /// Failing to start the mic never affects the ongoing screen share.
    private var micToggle: some View {
        Button {
            HapticsService.shared.impact()
            Task {
                let ok = await liveShare.toggleMic()
                if !ok {
                    showCaptureToast("음성 시작 실패 — 영상 공유는 유지됩니다")
                }
            }
        } label: {
            Image(systemName: liveShare.micEnabled ? "mic.fill" : "mic.slash.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(liveShare.micEnabled ? .red : .white)
                .frame(width: LHSpacing.iconChip, height: LHSpacing.iconChip)
                .background(LHColors.overlay, in: Circle())
        }
        .accessibilityLabel("음성 말하기")
    }

    @ViewBuilder
    private var liveShareBanner: some View {
        switch liveShare.state {
        case .connecting:
            liveSharePill("오피스 연결 중…", color: LHColors.adjusting,
                          icon: "antenna.radiowaves.left.and.right")
        case .sharing:
            liveSharePill("LIVE · 오피스 공유 중", color: .red,
                          icon: "dot.radiowaves.left.and.right")
        case .failed(let message):
            liveSharePill("공유 실패: \(message)", color: .red,
                          icon: "exclamationmark.triangle.fill")
        case .idle:
            EmptyView()
        }
    }

    /// Office → field markers: pulsing rings at the normalized screen position
    /// the office clicked on the live view. Expire after a few seconds.
    private var annotationOverlay: some View {
        GeometryReader { geo in
            ForEach(liveShare.annotations) { a in
                AnnotationPing()
                    .position(
                        x: geo.size.width * CGFloat(a.u),
                        y: geo.size.height * CGFloat(a.v)
                    )
            }
        }
        .allowsHitTesting(false)
        .ignoresSafeArea()
        .onReceive(Timer.publish(every: 1, on: .main, in: .common).autoconnect()) { _ in
            liveShare.expireAnnotations()
        }
    }

    private func liveSharePill(_ text: String, color: Color, icon: String) -> some View {
        HStack(spacing: LHSpacing.sm) {
            Image(systemName: icon)
            Text(text).font(LHTypography.monoCaption)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, LHSpacing.md)
        .padding(.vertical, LHSpacing.sm)
        .background(color.opacity(0.88), in: Capsule())
        .shadow(radius: 3)
    }

    @ViewBuilder
    private var latencyBadge: some View {
        if let ms = placement.lastPlacementMs, placementActive {
            Button {
                showHistory = true
                HapticsService.shared.impact()
            } label: {
                HStack(spacing: LHSpacing.xs) {
                    Image(systemName: "clock")
                        .font(.system(size: 11, weight: .semibold))
                    Text(String(format: "%.0f ms", ms))
                        .font(LHTypography.monoSmall)
                        .monospacedDigit()
                }
                .foregroundStyle(.white)
                .padding(.horizontal, LHSpacing.sm + 2)
                .padding(.vertical, LHSpacing.xs + 1)
                .background(LHColors.overlay, in: Capsule())
            }
        }
    }

    #if DEBUG
    private var diagnosticsToggle: some View {
        Button {
            session.showDiagnostics.toggle()
            HapticsService.shared.impact()
        } label: {
            Image(systemName: session.showDiagnostics ? "waveform.circle.fill" : "waveform.circle")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(session.showDiagnostics ? LHColors.accent : .white)
                .frame(width: LHSpacing.iconChip, height: LHSpacing.iconChip)
                .background(LHColors.overlay, in: Circle())
        }
    }
    #endif

    /// Shortened labels on compact width so the top bar fits on iPhone portrait.
    private var trackingBadgeLabel: String {
        guard isCompactTop else { return session.tracking.label }
        switch session.tracking {
        case .normal: return "OK"
        case .limited: return session.tracking.label  // already short
        case .notAvailable: return "N/A"
        }
    }

    @ViewBuilder
    private var diagnosticsOverlay: some View {
        #if DEBUG
        if session.showDiagnostics {
            ARDiagnosticsHUD(diagnostics: session.diagnostics)
                .transition(.opacity.combined(with: .move(edge: .top)))
        }
        #else
        EmptyView()
        #endif
    }

    private var trackingTint: Color {
        switch session.tracking {
        case .normal: return LHColors.statusOK
        case .limited: return LHColors.statusWarning
        case .notAvailable: return LHColors.statusError
        }
    }

    @ViewBuilder
    private var placementBadge: some View {
        switch placement.state {
        case .loading:
            StatusBadge(label: isCompactTop ? "Load…" : "Loading…", tint: LHColors.idle)
        case .ready:
            StatusBadge(label: isCompactTop ? "Tap" : "Tap to place", tint: LHColors.neutral)
        case .placed:
            StatusBadge(label: hitLabel, tint: LHColors.placed)
        case .adjusting:
            StatusBadge(label: "Adjusting", tint: LHColors.adjusting)
        case .locked:
            StatusBadge(label: "Locked", tint: LHColors.locked)
        case .failed:
            StatusBadge(label: isCompactTop ? "Fail" : "Load failed", tint: LHColors.statusError)
        }
    }

    private var hitLabel: String {
        if isCompactTop {
            switch placement.lastHitSource {
            case .sceneMesh: return "mesh"
            case .existingPlane: return "plane"
            case .estimatedPlane: return "est."
            case .none: return "Placed"
            }
        } else {
            switch placement.lastHitSource {
            case .sceneMesh: return "Placed / mesh"
            case .existingPlane: return "Placed / plane"
            case .estimatedPlane: return "Placed / est."
            case .none: return "Placed"
            }
        }
    }

    private var meshToggle: some View {
        Button {
            session.showMeshDebug.toggle()
            HapticsService.shared.impact()
        } label: {
            if isCompactTop {
                // Icon-only pill on portrait iPhone to save width.
                Image(systemName: session.showMeshDebug
                      ? "square.grid.3x3.fill"
                      : "square.grid.3x3")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(session.showMeshDebug ? LHColors.accent : .white)
                    .frame(width: LHSpacing.iconChip, height: LHSpacing.iconChip)
                    .background(LHColors.overlay, in: Circle())
            } else {
                HStack(spacing: LHSpacing.sm) {
                    Image(systemName: session.showMeshDebug
                          ? "square.grid.3x3.fill"
                          : "square.grid.3x3")
                    Text("Mesh")
                        .font(LHTypography.monoCaption)
                }
                .foregroundStyle(session.showMeshDebug ? LHColors.accent : .white)
                .padding(.horizontal, LHSpacing.md)
                .padding(.vertical, LHSpacing.sm)
                .background(LHColors.overlay, in: Capsule())
            }
        }
    }

    private var removeButton: some View {
        Button {
            placement.resetPlacement()
            HapticsService.shared.impact()
        } label: {
            Image(systemName: "trash")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: LHSpacing.iconChip, height: LHSpacing.iconChip)
                .background(LHColors.overlay, in: Circle())
        }
    }

    // MARK: - Banners

    @ViewBuilder
    private var measurementHintBanner: some View {
        if measurement.isActive {
            let label = hintLabel
            VStack(alignment: .leading, spacing: LHSpacing.xs) {
                HStack(spacing: LHSpacing.sm) {
                    Image(systemName: "ruler")
                    Text(label)
                        .font(LHTypography.mono)
                    Spacer()
                    if measurement.hasPendingFirstPoint {
                        Button {
                            measurement.cancelPending()
                            HapticsService.shared.impact()
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 16, weight: .semibold))
                                .padding(LHSpacing.xs + 1)
                        }
                        .foregroundStyle(.white)
                    }
                    if !measurement.measurements.isEmpty {
                        Button {
                            measurement.removeLast()
                            HapticsService.shared.impact()
                        } label: {
                            Image(systemName: "arrow.uturn.backward")
                                .font(.system(size: 13, weight: .semibold))
                                .padding(LHSpacing.xs + 1)
                        }
                        .foregroundStyle(.white)
                        Button {
                            measurement.clearAll()
                            HapticsService.shared.impact()
                        } label: {
                            Image(systemName: "trash")
                                .font(.system(size: 13, weight: .semibold))
                                .padding(LHSpacing.xs + 1)
                        }
                        .foregroundStyle(.white)
                    }
                }
                if let breakdown = activeBreakdown {
                    measurementBreakdownRow(breakdown)
                }
            }
            .foregroundStyle(.white)
            .padding(.horizontal, LHSpacing.md + 2)
            .padding(.vertical, LHSpacing.md - 2)
            .background(
                LHColors.adjusting.opacity(0.9),
                in: RoundedRectangle(cornerRadius: LHSpacing.radiusSmall)
            )
            .padding(.horizontal)
        }
    }

    /// Total straight-line distance plus a gravity-referenced breakdown —
    /// horizontal (ground-plane gap √(ΔX²+ΔZ²)) and vertical (height gap |ΔY|)
    /// — of either the in-progress preview or the last completed measurement.
    /// These are unambiguous regardless of the AR session's heading.
    private var activeBreakdown: (total: Float, horizontal: Float, vertical: Float)? {
        func decompose(_ dx: Float, _ dy: Float, _ dz: Float, _ total: Float)
            -> (Float, Float, Float)
        {
            ((total), (dx * dx + dz * dz).squareRoot(), abs(dy))
        }
        if measurement.hasPendingFirstPoint,
           let c = measurement.previewComponents,
           let total = measurement.previewDistanceMeters {
            return decompose(c.x, c.y, c.z, total)
        }
        if let last = measurement.measurements.last {
            return decompose(
                last.pointB.x - last.pointA.x,
                last.pointB.y - last.pointA.y,
                last.pointB.z - last.pointA.z,
                last.distanceMeters
            )
        }
        return nil
    }

    @ViewBuilder
    private func measurementBreakdownRow(_ b: (total: Float, horizontal: Float, vertical: Float)) -> some View {
        let unit = b.total < 1.0 ? "mm" : "m"
        HStack(spacing: LHSpacing.md) {
            Text("D \(axisValue(b.total, totalMeters: b.total))")
            Text("수평 \(axisValue(b.horizontal, totalMeters: b.total))")
                .foregroundStyle(.white.opacity(0.85))
            Text("수직 \(axisValue(b.vertical, totalMeters: b.total))")
                .foregroundStyle(.white.opacity(0.85))
            Text(unit).foregroundStyle(.white.opacity(0.6))
        }
        .font(LHTypography.monoSmall)
        .monospacedDigit()
    }

    /// Formats one component in the unit chosen by the total magnitude
    /// (mm under 1 m, otherwise m) so all values in the row share a unit.
    private func axisValue(_ v: Float, totalMeters: Float) -> String {
        totalMeters < 1.0
            ? String(format: "%.1f", v * 1000)
            : String(format: "%.2f", v)
    }

    private var hintLabel: String {
        let targetTag: String = {
            switch measurement.currentTargetSource {
            case .model: return " · 모델"
            case .real: return " · 실제"
            case nil: return ""
            }
        }()
        let base: String
        if measurement.hasPendingFirstPoint {
            if let live = measurement.previewDistanceMeters {
                base = "Aim at second point\(targetTag) · \(DistanceMeasurement.formattedDistance(live))"
            } else {
                base = "Aim at second point\(targetTag)"
            }
        } else {
            base = measurement.reticleLocked
                ? "Aim at first point\(targetTag)"
                : "Looking for surface…"
        }
        return base
    }

    // MARK: - Plus button (Apple Measure style; reticle is rendered in 3D
    // inside MeasurementController so it sits on the actual surface).

    @ViewBuilder
    private var measurementPlusButton: some View {
        if measurement.isActive {
            Button {
                switch measurement.addPointAtReticle() {
                case .ignored:
                    break
                case .startedFirst:
                    HapticsService.shared.impact()
                case .completed(let m):
                    HapticsService.shared.impact()
                    startNaming(m)
                }
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 64, height: 64)
                    .background(
                        Circle()
                            .fill(measurement.reticleLocked
                                  ? LHColors.adjusting
                                  : Color.gray.opacity(0.5))
                    )
                    .overlay(
                        Circle().stroke(.white.opacity(0.6), lineWidth: 2)
                    )
                    .shadow(radius: 4)
            }
            .disabled(!measurement.reticleLocked)
            .opacity(measurement.reticleLocked ? 1.0 : 0.7)
        }
    }

    @ViewBuilder
    private var trackingLimitedBanner: some View {
        let placementActive: Bool = {
            switch placement.state {
            case .placed, .adjusting: return true
            default: return false
            }
        }()
        if !placement.gesturesEnabled, placementActive {
            Text("Tracking limited — gestures paused")
                .font(LHTypography.mono)
                .foregroundStyle(.white)
                .padding(.horizontal, LHSpacing.md + 2)
                .padding(.vertical, LHSpacing.md - 2)
                .background(LHColors.adjusting.opacity(0.9),
                            in: RoundedRectangle(cornerRadius: LHSpacing.radiusSmall))
                .padding(.horizontal)
        }
    }

    @ViewBuilder
    private var errorBanners: some View {
        if let err = session.sessionError {
            banner(err, tint: .red) { session.clearError() }
                .padding(.horizontal)
        }
        if case .failed(let message) = placement.state {
            banner(message, tint: .red) { Task { await placement.loadModel() } }
                .padding(.horizontal)
        }
    }

    private func banner(_ message: String, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(message)
                .font(LHTypography.mono)
                .foregroundStyle(.white)
                .padding(.horizontal, LHSpacing.md + 2)
                .padding(.vertical, LHSpacing.md - 2)
                .background(tint.opacity(0.85),
                            in: RoundedRectangle(cornerRadius: LHSpacing.radiusSmall))
        }
    }

    // MARK: - Gating

    private var placementActive: Bool {
        switch placement.state {
        case .placed, .adjusting: return true
        default: return false
        }
    }

    /// Full pad is shown only when placed AND user has tapped the Adjust chip.
    private var showsFinePad: Bool { placementActive && isPadExpanded }

    /// Minimized chip appears when placement is done but pad is collapsed.
    private var showsAdjustChip: Bool { placementActive && !isPadExpanded }

    /// Pulsing orange ring used for office → field annotations.
    private struct AnnotationPing: View {
        @State private var animate = false

        var body: some View {
            ZStack {
                Circle()
                    .stroke(Color.orange, lineWidth: 3)
                    .frame(width: 34, height: 34)
                    .scaleEffect(animate ? 1.7 : 0.7)
                    .opacity(animate ? 0.15 : 0.95)
                Circle()
                    .fill(Color.orange)
                    .frame(width: 10, height: 10)
            }
            .shadow(color: .orange.opacity(0.8), radius: 6)
            .onAppear {
                withAnimation(.easeOut(duration: 1.1).repeatForever(autoreverses: false)) {
                    animate = true
                }
            }
        }
    }

    private var adjustChip: some View {
        Button {
            isPadExpanded = true
            HapticsService.shared.impact()
        } label: {
            HStack(spacing: LHSpacing.sm) {
                Image(systemName: "slider.horizontal.3")
                    .font(.system(size: 13, weight: .semibold))
                Text("Adjust")
                    .font(LHTypography.monoCaption.weight(.semibold))
            }
            .foregroundStyle(.white)
            .padding(.horizontal, LHSpacing.lg)
            .padding(.vertical, LHSpacing.md - 2)
            .background(Color.black.opacity(0.45), in: Capsule())
        }
    }

    // MARK: - Screen capture

    private var captureButton: some View {
        Button {
            triggerCapture()
        } label: {
            Image(systemName: "camera.fill")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 58, height: 58)
                .background(Circle().fill(Color.black.opacity(0.5)))
                .overlay(Circle().stroke(.white.opacity(0.7), lineWidth: 2.5))
                .shadow(radius: 4)
        }
        .accessibilityLabel("화면 캡처 — 현재 AR 화면을 사진으로 저장")
    }

    @ViewBuilder
    private var captureToast: some View {
        if let message = captureToastMessage {
            HStack(spacing: LHSpacing.sm) {
                if let thumb = captureThumbnail {
                    Image(uiImage: thumb)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .frame(width: 38, height: 38)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                        .overlay(
                            RoundedRectangle(cornerRadius: 6)
                                .stroke(.white.opacity(0.5), lineWidth: 1)
                        )
                } else {
                    Image(systemName: captureToastIcon)
                        .foregroundStyle(LHColors.adjusting)
                }
                Text(message)
                    .font(LHTypography.mono)
                    .foregroundStyle(.white)
            }
            .padding(.horizontal, LHSpacing.md)
            .padding(.vertical, LHSpacing.sm)
            .background(Color.black.opacity(0.72), in: Capsule())
            .shadow(radius: 4)
            .transition(.move(edge: .top).combined(with: .opacity))
        }
    }

    private func triggerCapture() {
        guard let arView = arViewRef else {
            showCaptureToast("AR 준비 중 — 잠시 후 다시 시도")
            return
        }
        HapticsService.shared.impact()
        withAnimation(.easeOut(duration: 0.06)) { captureFlash = true }
        let lines = captureFooterLines()
        ScreenCaptureService.capture(arView, footerLines: lines) { result in
            withAnimation(.easeIn(duration: 0.3)) { captureFlash = false }
            switch result {
            case .success(let image):
                captureThumbnail = image
                showCaptureToast("사진에 저장됨")
            case .failure(let error):
                captureThumbnail = nil
                showCaptureToast(error.localizedDescription)
            }
        }
    }

    /// Measurement summary stamped onto the saved photo so it stands alone as
    /// QA evidence.
    private func captureFooterLines() -> [String] {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        let all = measurement.measurements
        var lines = ["\(AppFeatures.appName) · \(model.displayName) · \(formatter.string(from: Date()))"]
        guard !all.isEmpty else {
            // 측정 기능이 없는 앱(연구과제)은 이 줄 자체를 사진에 남기지 않는다 —
            // "측정 없음"이라는 문구도 발주처가 요청한 분리의 흔적이 될 수 있다.
            // LH 앱(측정 기능 있음, 아직 측정 안 함)의 기존 동작은 그대로 유지한다.
            if AppFeatures.measurement { lines.append("측정 없음") }
            return lines
        }
        func fmt(_ m: Float) -> String {
            m < 1 ? String(format: "%.0fmm", m * 1000) : String(format: "%.2fm", m)
        }
        let maxShown = 6
        for (i, m) in all.prefix(maxShown).enumerated() {
            let dx = m.pointB.x - m.pointA.x
            let dy = m.pointB.y - m.pointA.y
            let dz = m.pointB.z - m.pointA.z
            let horizontal = (dx * dx + dz * dz).squareRoot()
            let label = m.name.isEmpty ? "#\(i + 1)" : m.name
            lines.append("\(label)  D \(fmt(m.distanceMeters)) 수평 \(fmt(horizontal)) 수직 \(fmt(abs(dy)))")
        }
        if all.count > maxShown {
            lines.append("외 \(all.count - maxShown)개 더 · 총 \(all.count)개")
        }
        return lines
    }

    private func showCaptureToast(_ message: String, icon: String = "exclamationmark.triangle.fill") {
        captureToastIcon = icon
        withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
            captureToastMessage = message
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.6) {
            if captureToastMessage == message {
                withAnimation(.easeOut(duration: 0.25)) {
                    captureToastMessage = nil
                    captureThumbnail = nil
                }
            }
        }
    }
}
