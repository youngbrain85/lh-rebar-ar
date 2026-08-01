// office-dashboard/src/components/analysis/AnalysisTab.tsx
"use client";

import { Alert, Box, Button, Group, Select, Stack, Text, Title } from "@mantine/core";
import { useEffect, useState } from "react";
import AnalysisView from "./AnalysisView";
import ScanList, { scanTitle, type ScanMeta } from "./ScanList";

type Site = { site_id: number; site_name: string };
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

/// 시공 분석 탭 컨테이너: 현장 선택 → 설계모델 선택 → 스캔 목록 → 분석 화면.
export default function AnalysisTab() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [models, setModels] = useState<ARModel[]>([]);
  const [arId, setArId] = useState<string | null>(null);
  const [open, setOpen] = useState<ScanMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const d = await (await fetch("/api/sites")).json();
        if (d.status !== "success") throw new Error(d.message || "현장 조회 실패");
        setSites(d.site_list || []);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  // 현장이 바뀌면 그 현장의 설계모델 목록을 다시 읽고 기본값을 고른다
  useEffect(() => {
    if (siteId == null) {
      setModels([]);
      setArId(null);
      return;
    }
    let cancelled = false;
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
      <Stack gap="sm" h="100%">
        <Group justify="space-between">
          <Title order={4}>
            시공 분석 — {scanTitle(open)}
          </Title>
          <Group gap="xs">
            {models.length > 1 && (
              <Select
                size="xs"
                w={320}
                label={undefined}
                data={modelOptions}
                value={arId}
                onChange={(v) => v && setArId(v)}
                comboboxProps={{ withinPortal: true }}
              />
            )}
            <Button variant="default" size="xs" onClick={() => setOpen(null)}>
              ← 목록으로
            </Button>
          </Group>
        </Group>
        <Box style={{ flex: 1, minHeight: 0, display: "flex" }}>
          {/* 모델을 바꾸면 로드·분석 상태를 새로 시작한다 */}
          <AnalysisView key={arId} scan={open} arId={arId} />
        </Box>
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <div>
        <Title order={4}>시공 분석</Title>
        <Text size="sm" c="dimmed">
          라이다 스캔(as-built)을 설계모델과 비교해 미시공·허용초과 철근을 찾습니다
        </Text>
      </div>
      {error && <Alert color="red">{error}</Alert>}
      <Group align="flex-end" gap="sm">
        <Select
          label="현장"
          placeholder="현장을 선택하세요"
          searchable
          data={sites.map((s) => ({ value: String(s.site_id), label: `${s.site_id} · ${s.site_name}` }))}
          value={siteId == null ? null : String(siteId)}
          onChange={(v) => setSiteId(v == null ? null : Number(v))}
          w={420}
        />
        {siteId != null && models.length > 0 && (
          <Select
            label="비교할 설계모델"
            data={modelOptions}
            value={arId}
            onChange={(v) => v && setArId(v)}
            w={420}
          />
        )}
      </Group>
      {selectedModel && selectedModel.ar_type !== "built-in" && (
        <Alert color="yellow" variant="light">
          선택한 모델의 종류가 <b>{selectedModel.ar_type}</b>입니다. 시공 분석의 비교 기준은
          설계모델(built-in)이어야 합니다 — 스캔에서 생성된 모델을 고르면 전부 미시공·도면 외로
          나옵니다.
        </Alert>
      )}
      {siteId != null && (
        <ScanList siteId={siteId} arId={arId} onOpen={(scan) => setOpen(scan)} />
      )}
    </Stack>
  );
}
