// office-dashboard/src/components/analysis/RebarTree.tsx
"use client";

// 철근 계층 트리 — spec §6.3.
// AnalysisView에 종속되지 않는 순수 표시 컴포넌트다. (노드 배열, 체크 상태,
// 출처)만 받으므로 「현장 관리 → 3D 모델 뷰」에도 그대로 꽂을 수 있다.
import { Alert, Badge, Box, Button, Checkbox, Group, ScrollArea, Text, Tree, useTree } from "@mantine/core";
import type { RenderTreeNodePayload, TreeNodeData } from "@mantine/core";
import { useEffect, useMemo } from "react";
import {
  allValues, leafCount, SOURCE_NOTICE, type Taxonomy, type TaxonomyTreeNode,
} from "../../lib/analysis/taxonomy";

/** 이 수를 넘으면 기본 접힘 — Mantine Tree는 가상화가 없어 토글마다 전체가 재렌더된다 */
const EXPAND_ALL_MAX_LEAVES = 500;

/** TaxonomyTreeNode(UI 비의존) → Mantine TreeNodeData. count는 nodeProps로 나른다 */
function toMantine(nodes: TaxonomyTreeNode[]): TreeNodeData[] {
  return nodes.map((n) => ({
    value: n.value,
    label: n.label,
    nodeProps: { count: n.count },
    ...(n.children ? { children: toMantine(n.children) } : {}),
  }));
}

function expandedTop(nodes: TaxonomyTreeNode[], all: boolean): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  const walk = (ns: TaxonomyTreeNode[], depth: number) => {
    for (const n of ns) {
      if (n.children) {
        out[n.value] = all || depth === 0;
        walk(n.children, depth + 1);
      }
    }
  };
  walk(nodes, 0);
  return out;
}

export default function RebarTree({
  nodes, checked, onCheckedChange, source, notice,
}: {
  nodes: TaxonomyTreeNode[];
  /** 체크된 노드 value 목록 (제어 상태) */
  checked: string[];
  onCheckedChange: (values: string[]) => void;
  source: Taxonomy["source"];
  /** 추가 경고 — 빌드 대조 실패, 옛 id 스킴 등 */
  notice?: string | null;
}) {
  const data = useMemo(() => toMantine(nodes), [nodes]);
  const initialExpanded = useMemo(
    () => expandedTop(nodes, leafCount(nodes) <= EXPAND_ALL_MAX_LEAVES),
    [nodes],
  );

  const tree = useTree({
    initialExpandedState: initialExpanded,
    checkedState: checked,
    onCheckedStateChange: onCheckedChange,
  });

  // 데이터가 갈리면(재분석·모델 변경) 펼침 상태를 새 트리에 맞춘다
  useEffect(() => {
    tree.setExpandedState(initialExpanded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialExpanded]);

  const sourceNotice = SOURCE_NOTICE[source];
  const total = nodes.reduce((n, x) => n + x.count, 0);
  const shown = new Set(checked);

  if (nodes.length === 0) {
    return <Text size="xs" c="dimmed">표시할 철근이 없습니다. 분석을 먼저 실행하세요.</Text>;
  }

  return (
    <>
      {/* ★ 출처 배지는 필수다 — 없으면 형상 자동 분류가 도면 기반 분류인 척한다 */}
      {sourceNotice && (
        <Alert color="yellow" p="xs" radius="sm">
          <Text size="xs">{sourceNotice}</Text>
        </Alert>
      )}
      {notice && (
        <Alert color="orange" p="xs" radius="sm">
          <Text size="xs">{notice}</Text>
        </Alert>
      )}

      <Group gap={6}>
        <Button size="compact-xs" variant="light" onClick={() => onCheckedChange(allValues(nodes))}>
          전체 선택
        </Button>
        <Button size="compact-xs" variant="light" onClick={() => onCheckedChange([])}>
          전체 해제
        </Button>
        <Text size="xs" c="dimmed">
          {shown.size === 0 ? "0" : ""}철근 {total}개
        </Text>
      </Group>

      <ScrollArea.Autosize mah={340} type="auto">
        <Tree
          data={data}
          tree={tree}
          levelOffset={18}
          renderNode={({ node, expanded, hasChildren, elementProps, tree }: RenderTreeNodePayload) => (
            // 색을 쓰지 않는다 — 판정 6색·컨투어 5색과 섞이면 안 되고(design-system §213),
            // 새 색 체계를 만들 이유도 없다. 체크박스 + 텍스트로 충분하다.
            <Group gap={6} wrap="nowrap" {...elementProps} style={{ ...elementProps.style, minHeight: 32 }}>
              <Box w={12} style={{ flexShrink: 0 }}>
                {hasChildren && (
                  <Text size="xs" c="dimmed">{expanded ? "▾" : "▸"}</Text>
                )}
              </Box>
              <Checkbox
                size="xs"
                checked={tree.isNodeChecked(node.value)}
                indeterminate={tree.isNodeIndeterminate(node.value)}
                onChange={() =>
                  tree.isNodeChecked(node.value)
                    ? tree.uncheckNode(node.value)
                    : tree.checkNode(node.value)
                }
                onClick={(e) => e.stopPropagation()}
                aria-label={String(node.label)}
              />
              <Text size="xs" style={{ flex: 1, minWidth: 0 }} truncate>
                {node.label}
              </Text>
              <Badge size="xs" variant="light" color="gray">
                {node.nodeProps?.count ?? 0}
              </Badge>
            </Group>
          )}
        />
      </ScrollArea.Autosize>
    </>
  );
}
