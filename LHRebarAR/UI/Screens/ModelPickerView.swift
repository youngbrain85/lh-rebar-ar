import SwiftUI

struct ModelPickerView: View {
    let models: [RebarModel]

    var body: some View {
        NavigationStack {
            List(models) { model in
                NavigationLink(value: model) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(model.displayName)
                            .font(LHTypography.body)
                        Text(model.resourceName)
                            .font(LHTypography.monoCaption)
                            .foregroundStyle(LHColors.mutedInk)
                    }
                    .padding(.vertical, LHSpacing.xs)
                }
            }
            .navigationTitle("Rebar Models")
            .navigationDestination(for: RebarModel.self) { model in
                ARPlacementView(model: model)
            }
        }
    }
}

#Preview {
    ModelPickerView(models: ModelLibrary.all)
}
