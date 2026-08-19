// LHRebarAR/UI/Components/RebarTreePad.swift
import SwiftUI

/// 철근 계층 트리 — spec §7.3. LH 전용 앱에서만 뜬다(`AppFeatures.rebarFilter`).
///
/// 색을 쓰지 않는다. 대시보드와 같은 규칙이다 — 판정색·컨투어색과 섞이면 안 되고,
/// 새 색 체계를 만들 이유도 없다. 체크박스 + 텍스트로 충분하다.
struct RebarTreePad: View {
    let nodes: [RebarTaxonomy.TreeNode]
    let source: RebarTaxonomy.Source
    @Binding var checked: Set<String>
    /// 모델에서 찾은 메시 노드 수 — 0이면 이름 있는 노드가 하나도 없다
    let nodeCount: Int
    /// 트리를 쌓는 축(부위순/종류순). 뷰모델이 들고 있어 시트를 닫았다 열어도 유지된다.
    @Binding var axis: RebarTaxonomy.Axis
    let onClose: () -> Void

    private var total: Int { nodes.reduce(0) { $0 + $1.count } }

    var body: some View {
        VStack(alignment: .leading, spacing: LHSpacing.sm) {
            HStack {
                Text("철근 표시")
                    .font(.headline)
                Spacer()
                Button("닫기", action: onClose)
                    .font(.subheadline)
            }

            // 부위순 = 발주처 분류표 그대로, 종류순 = 발주처 기능표의 "철근 종류별".
            // 잎이 같아서 전환해도 체크가 유지된다.
            Picker("", selection: $axis) {
                Text("부위순").tag(RebarTaxonomy.Axis.member)
                Text("종류순").tag(RebarTaxonomy.Axis.kind)
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            // ★ 출처 배지는 필수다 — 없으면 형상 자동 분류가 도면 기반 분류인 척한다.
            //   문구는 대시보드와 **같은 문자열**을 쓴다.
            if let notice = source.notice {
                Label(notice, systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
            if nodeCount == 0 {
                Label("모델에서 철근 노드를 찾지 못했습니다", systemImage: "xmark.circle")
                    .font(.caption)
                    .foregroundStyle(.red)
            }

            HStack(spacing: LHSpacing.sm) {
                Button("전체 선택") { checked = RebarTaxonomy.leafValues(nodes) }
                Button("전체 해제") { checked = [] }
                Spacer()
                Text("철근 \(total)개")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .font(.subheadline)

            if nodes.isEmpty {
                Text("모델을 배치하면 철근 목록이 나옵니다.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(nodes, id: \.value) { node in
                            RebarTreeRow(node: node, depth: 0, checked: $checked)
                        }
                    }
                }
                .frame(maxHeight: 320)
            }
        }
        .padding(LHSpacing.md)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
    }
}

/// 한 노드와 그 자손. 부모를 켜고 끄면 자손이 함께 따라간다.
private struct RebarTreeRow: View {
    let node: RebarTaxonomy.TreeNode
    let depth: Int
    @Binding var checked: Set<String>
    @State private var expanded = true

    /// 이 서브트리의 **잎** value 만. 조상 value 는 체크 집합에 넣지 않는다.
    private var leaves: Set<String> { RebarTaxonomy.leafValues(node) }
    private var state: RebarTaxonomy.CheckState {
        RebarTaxonomy.checkState(node, checked: checked)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: LHSpacing.xs) {
                if node.children.isEmpty {
                    Spacer().frame(width: 14)
                } else {
                    Button {
                        expanded.toggle()
                    } label: {
                        Image(systemName: expanded ? "chevron.down" : "chevron.right")
                            .font(.system(size: 10, weight: .semibold))
                            .frame(width: 14)
                    }
                    .buttonStyle(.plain)
                }

                Button {
                    if state == .on { checked.subtract(leaves) } else { checked.formUnion(leaves) }
                } label: {
                    Image(systemName: {
                        switch state {
                        case .on:    return "checkmark.square.fill"
                        case .mixed: return "minus.square.fill"
                        case .off:   return "square"
                        }
                    }())
                    .font(.system(size: 15))
                }
                .buttonStyle(.plain)

                Text(node.label)
                    .font(.subheadline)
                    .lineLimit(1)
                Spacer(minLength: LHSpacing.xs)
                Text("\(node.count)")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            // 클릭 대상 최소 32pt — 디자인 시스템 §7 규칙
            .frame(minHeight: 32)
            .padding(.leading, CGFloat(depth) * 14)

            if expanded {
                ForEach(node.children, id: \.value) { child in
                    RebarTreeRow(node: child, depth: depth + 1, checked: $checked)
                }
            }
        }
    }
}
