import SwiftUI

@MainActor
final class SiteModelListViewModel: ObservableObject {
    @Published private(set) var models: [ARModel] = []
    @Published private(set) var isLoading = false
    @Published private(set) var error: String?

    let site: Site
    private let client = BackendClient()

    init(site: Site) { self.site = site }

    func load() async {
        isLoading = true
        error = nil
        do {
            models = try await client.fetchModels(siteID: site.siteID)
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}

/// Lists the AR models attached to a site. Tapping one opens its detail, which
/// downloads + caches the file.
struct SiteModelListView: View {
    @StateObject private var vm: SiteModelListViewModel

    init(site: Site) {
        _vm = StateObject(wrappedValue: SiteModelListViewModel(site: site))
    }

    var body: some View {
        content
            .navigationTitle(vm.site.siteName)
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: ARModel.self) { ARModelDetailView(model: $0) }
            .task {
                if vm.models.isEmpty { await vm.load() }
            }
            .refreshable { await vm.load() }
    }

    @ViewBuilder
    private var content: some View {
        if vm.isLoading && vm.models.isEmpty {
            ProgressView("모델 불러오는 중…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let err = vm.error, vm.models.isEmpty {
            BackendErrorView(title: "모델을 불러오지 못했습니다", message: err) {
                Task { await vm.load() }
            }
        } else if vm.models.isEmpty {
            VStack(spacing: LHSpacing.sm) {
                Image(systemName: "cube")
                    .font(.largeTitle)
                    .foregroundStyle(LHColors.mutedInk)
                Text("이 현장에 등록된 AR 모델이 없습니다")
                    .font(LHTypography.mono)
                    .foregroundStyle(LHColors.mutedInk)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            List(vm.models) { model in
                NavigationLink(value: model) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(model.arFilename)
                            .font(LHTypography.body)
                        HStack(spacing: LHSpacing.sm) {
                            Text(model.arType)
                            Text(model.uploadAt)
                        }
                        .font(LHTypography.monoCaption)
                        .foregroundStyle(LHColors.mutedInk)
                    }
                    .padding(.vertical, LHSpacing.xs)
                }
            }
        }
    }
}
