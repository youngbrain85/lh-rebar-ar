// office-dashboard/src/components/analysis/SiteAnalysis.tsx
"use client";

// 한 현장의 시공 분석: 설계모델 선택 → 스캔 목록 → 분석 화면.
// (현장 선택은 상위 화면이 이미 했으므로 여기서는 다루지 않는다)
import { Alert, Box, Button, Group, Select, Stack, Text } from "@mantine/core";
import { useEffect, useState } from "react";
import AnalysisView from "./AnalysisView";
import ScanList, { scanTitle, type ScanMeta } from "./ScanList";

type ARModel = {
  ar_id: string;
  ar_filename: string;
  ar_type: string;
  upload_at: string;
  remark?: string | null;
  source_filename?: string | null;
};

/// 한 현장에 모델이 여러 개일 수 있다 (BriconLab 원본 설계모델 = built-in,
/// 스캔/도구에서 올린 모델 = visual 등). 비교 기준은 설계모델이어야 하므로
/// built-in을 우선 선택하고, 사용자가 바꿀 수 있게 한다.
function pickDefaultModel(models: ARModel[]): string | null {
  if (models.length === 0) return null;
  return (models.find((m) => m.ar_type === "built-in") ?? models[0]).ar_id;
}

export default function SiteAnalysis({ siteId }: { siteId: number }) {
  const [models, setModels] = useState<ARModel[]>([]);
  const [arId, setArId] = useState<string | null>(null);
  const [open, setOpen] = useState<ScanMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 「설계모델 없이 분석」체크박스 — AnalysisView 안에 있지만, 여기서도 알아야
  // 모델 선택 화면의 ar_type 경고("비교 기준은 설계모델이어야…")를 억제할 수 있다.
  // 그 경고는 이 화면(스캔을 아직 열지 않은 상태)에서 뜨는데, 발주처 13개 현장 전부
  // built-in 모델이 없어 이 모드를 쓰기로 한 사용자에게는 매번 뜨는 게 노이즈다.
  const [noDesignMode, setNoDesignMode] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setOpen(null);
    (async () => {
      try {
        const d = await (await fetch(`/api/models?site_id=${siteId}`)).json();
        if (cancelled) return;
        const list: ARModel[] = d.ar_list || [];
        setModels(list);
        setArId(pickDefaultModel(list));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [siteId]);

  // BriconLab은 저장 파일명을 해시로 만든다(b4e8f2a9…usdz). 사람이 알아볼 수 있게
  // 종류 + 비고/원본파일명 + 등록일 순으로 이름을 만든다.
  const modelOptions = models.map((m) => {
    const kind = m.ar_type === "built-in" ? "설계모델" : `${m.ar_type} 모델`;
    const detail = m.remark || m.source_filename || m.ar_filename;
    return { value: m.ar_id, label: `${kind} · ${detail} (${m.upload_at.slice(0, 10)})` };
  });
  const selectedModel = models.find((m) => m.ar_id === arId);

  if (open && arId) {
    return (
      <Stack gap="sm" style={{ flex: 1, minHeight: 0 }}>
        <Group justify="space-between" wrap="nowrap">
          <Text fw={600} size="sm" truncate>
            {scanTitle(open)}
          </Text>
          <Group gap="xs" wrap="nowrap">
            {models.length > 1 && (
              <Select
                size="xs"
                w={300}
                data={modelOptions}
                value={arId}
                onChange={(v) => v && setArId(v)}
                comboboxProps={{ withinPortal: true }}
              />
            )}
            <Button variant="default" size="xs" onClick={() => setOpen(null)}>
              ← 스캔 목록
            </Button>
          </Group>
        </Group>
        <Box style={{ flex: 1, minHeight: 0, display: "flex" }}>
          {/* 모델을 바꾸면 로드·분석 상태를 새로 시작한다 */}
          <AnalysisView
            key={arId} scan={open} arId={arId}
            noDesignMode={noDesignMode} onNoDesignModeChange={setNoDesignMode}
          />
        </Box>
      </Stack>
    );
  }

  return (
    <Stack gap="md" style={{ flex: 1, minHeight: 0 }}>
      {error && <Alert color="red">{error}</Alert>}
      {models.length > 0 && (
        <Group align="flex-end" gap="sm">
          <Select
            label="비교할 설계모델"
            data={modelOptions}
            value={arId}
            onChange={(v) => v && setArId(v)}
            w={460}
          />
        </Group>
      )}
      {/* 설계모델 없이 분석하기로 한 사용자에게는 무의미한 경고다 — 그 모드는 애초에
          이 모델을 비교 기준으로 쓰지 않는다. */}
      {selectedModel && selectedModel.ar_type !== "built-in" && !noDesignMode && (
        <Alert color="yellow" variant="light">
          선택한 모델의 종류가 <b>{selectedModel.ar_type}</b>입니다. 시공 분석의 비교 기준은
          설계모델(built-in)이어야 합니다 — 스캔에서 생성된 모델을 고르면 전부 미시공·도면 외로
          나옵니다. 설계모델이 없거나 다른 구조물이면 분석 화면의 「설계모델 없이 분석」
          체크박스로 간격 편차만 잴 수 있습니다.
        </Alert>
      )}
      <ScanList
        siteId={siteId} arId={arId}
        onOpen={(scan) => {
          // 체크박스는 "스캔"에 속한 상태다 — 모델(arId)이 아니라. 여기서(스캔을 여는
          // 시점에) false로 리셋해 두면, 이 스캔에 저장된 결과가 있을 때 AnalysisView의
          // 로드 이펙트가 그 결과의 실제 method로 다시 맞춘다(finding 2 참조). 리셋을
          // 안 하면 이전에 열었던 스캔에서 켜 둔 체크박스가 새 스캔에 잔상으로 남는다.
          setNoDesignMode(false);
          setOpen(scan);
        }}
      />
    </Stack>
  );
}
