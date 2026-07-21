import SwiftUI

@MainActor
final class SiteListViewModel: ObservableObject {
    @Published private(set) var sites: [Site] = []
    @Published private(set) var isLoading = false
    @Published private(set) var error: String?

    private let client = BackendClient()

    func load() async {
        isLoading = true
        error = nil
        do {
            sites = try await client.fetchSites()
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}

/// Backend home: lists construction sites from the API. A toolbar shortcut
/// keeps the bundled-USDZ sample reachable for local AR testing.
struct SiteListView: View {
    @StateObject private var vm = SiteListViewModel()
    @State private var showSamples = false

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("시공 현장")
                .navigationDestination(for: Site.self) { SiteModelListView(site: $0) }
                .navigationDestination(for: RebarModel.self) { ARPlacementView(model: $0) }
                // Sample-model picker is a dev-only escape hatch (local USDZ,
                // no backend needed) — hidden from TestFlight/Release builds.
                #if DEBUG
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            showSamples = true
                        } label: {
                            Label("샘플", systemImage: "cube")
                        }
                    }
                }
                .sheet(isPresented: $showSamples) {
                    ModelPickerView(models: ModelLibrary.all)
                }
                #endif
                .task {
                    if vm.sites.isEmpty { await vm.load() }
                }
                .refreshable { await vm.load() }
        }
    }

    @ViewBuilder
    private var content: some View {
        if vm.isLoading && vm.sites.isEmpty {
            ProgressView("현장 불러오는 중…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let err = vm.error, vm.sites.isEmpty {
            BackendErrorView(title: "현장을 불러오지 못했습니다", message: err) {
                Task { await vm.load() }
            }
        } else {
            List(vm.sites) { site in
                NavigationLink(value: site) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(site.siteName)
                            .font(LHTypography.body)
                        Text("site_id \(site.siteID)")
                            .font(LHTypography.monoCaption)
                            .foregroundStyle(LHColors.mutedInk)
                    }
                    .padding(.vertical, LHSpacing.xs)
                }
            }
        }
    }
}

/// Shared error state for backend screens.
struct BackendErrorView: View {
    let title: String
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: LHSpacing.md) {
            Image(systemName: "wifi.exclamationmark")
                .font(.largeTitle)
                .foregroundStyle(LHColors.adjusting)
            Text(title)
                .font(LHTypography.monoHeader)
            Text(message)
                .font(LHTypography.monoCaption)
                .foregroundStyle(LHColors.mutedInk)
                .multilineTextAlignment(.center)
            Button("다시 시도", action: retry)
                .buttonStyle(.borderedProminent)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
