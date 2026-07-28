// office-dashboard/src/components/analysis/AnalysisTab.tsx
"use client";

import { Alert, Button, Group, Select, Stack, Text, Title } from "@mantine/core";
import { useEffect, useState } from "react";
import ScanList, { type ScanMeta } from "./ScanList";

type Site = { site_id: number; site_name: string };

/// 시공 분석 탭 컨테이너: 현장 선택 → 스캔 목록 → 분석 화면.
export default function AnalysisTab() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [open, setOpen] = useState<{ scan: ScanMeta; arId: string } | null>(null);
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

  if (open) {
    return (
      <Stack gap="sm" h="100%">
        <Group justify="space-between">
          <Title order={4}>
            시공 분석 — 스캔 {open.scan.scan_id.slice(0, 8)}
          </Title>
          <Button variant="default" size="xs" onClick={() => setOpen(null)}>
            ← 목록으로
          </Button>
        </Group>
        {/* Task 17에서 <AnalysisView …/>로 교체 */}
        <Alert color="gray">분석 화면은 Task 17에서 구현됩니다</Alert>
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
      <Select
        label="현장"
        placeholder="현장을 선택하세요"
        searchable
        data={sites.map((s) => ({ value: String(s.site_id), label: `${s.site_id} · ${s.site_name}` }))}
        value={siteId == null ? null : String(siteId)}
        onChange={(v) => setSiteId(v == null ? null : Number(v))}
        maw={420}
      />
      {siteId != null && (
        <ScanList siteId={siteId} onOpen={(scan, arId) => setOpen({ scan, arId })} />
      )}
    </Stack>
  );
}
