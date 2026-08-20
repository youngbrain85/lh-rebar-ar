import SwiftUI

@MainActor
final class ARModelLoadViewModel: ObservableObject {
    enum LoadState: Equatable {
        case idle
        case loading
        case ready(URL)
        case unavailable
        case failed(String)
    }

    @Published private(set) var state: LoadState = .idle

    let model: ARModel
    private let store = ModelFileStore.shared

    init(model: ARModel) {
        self.model = model
        if store.isCached(model) {
            state = .ready(store.usdzURL(for: model))
        }
    }

    func fetch() async {
        switch state {
        case .loading, .ready: return
        default: break
        }
        state = .loading
        do {
            state = .ready(try await store.ensureUSDZ(model))
        } catch BackendError.notAvailable {
            state = .unavailable
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    /// A `RebarModel` pointing at the cached USDZ, ready for `ARPlacementView`.
    var rebarModel: RebarModel? {
        guard case .ready(let url) = state else { return nil }
        return RebarModel(
            id: model.arID,
            displayName: model.arFilename,
            resourceName: model.arFilename,
            subpath: nil,
            localURL: url,
            siteID: model.siteID
        )
    }
}

/// Model detail: metadata + USDZ fetch. When the server has the USDZ, offers
/// "AR로 보기"; until BriconLab adds the endpoint, shows a "변환 대기" state.
struct ARModelDetailView: View {
    @StateObject private var vm: ARModelLoadViewModel

    init(model: ARModel) {
        _vm = StateObject(wrappedValue: ARModelLoadViewModel(model: model))
    }

    var body: some View {
        Form {
            Section("모델 정보") {
                infoRow("ar_id", vm.model.arID)
                infoRow("scan_id", vm.model.scanID)
                infoRow("파일", vm.model.arFilename)
                infoRow("타입", vm.model.typeLabel)
                infoRow("업로드", vm.model.uploadAt ?? "—")
                if let note = vm.model.note { infoRow("설명", note) }
            }

            Section("AR") {
                arSection
            }
        }
        .navigationTitle("모델 상세")
        .navigationBarTitleDisplayMode(.inline)
        .task { await vm.fetch() }
    }

    @ViewBuilder
    private var arSection: some View {
        switch vm.state {
        case .ready:
            if let rebar = vm.rebarModel {
                NavigationLink(value: rebar) {
                    Label("AR로 보기", systemImage: "arkit")
                }
                if let size = ModelFileStore.shared.cachedSize(vm.model) {
                    infoRow("USDZ", ByteCountFormatter.string(fromByteCount: size, countStyle: .file))
                }
            }
        case .loading:
            HStack(spacing: LHSpacing.sm) {
                ProgressView()
                Text("USDZ 불러오는 중…").font(LHTypography.mono)
            }
        case .unavailable:
            Label("서버 USDZ 미준비 — 변환 대기", systemImage: "clock.badge.exclamationmark")
                .foregroundStyle(LHColors.adjusting)
            Text("BriconLab이 USDZ 변환 엔드포인트(GET /analysis/usdz?ar_id=…)를 추가하면 여기서 바로 AR로 열립니다.")
                .font(.caption)
                .foregroundStyle(LHColors.mutedInk)
            Button("다시 시도") { Task { await vm.fetch() } }
        case .failed(let message):
            Text(message)
                .font(.caption)
                .foregroundStyle(.red)
            Button("다시 시도") { Task { await vm.fetch() } }
        case .idle:
            Button {
                Task { await vm.fetch() }
            } label: {
                Label("USDZ 불러오기", systemImage: "arrow.down.circle")
            }
        }
    }

    private func infoRow(_ key: String, _ value: String) -> some View {
        HStack(alignment: .top) {
            Text(key)
                .foregroundStyle(LHColors.mutedInk)
            Spacer(minLength: LHSpacing.md)
            Text(value)
                .font(LHTypography.monoCaption)
                .multilineTextAlignment(.trailing)
                .textSelection(.enabled)
        }
    }
}
