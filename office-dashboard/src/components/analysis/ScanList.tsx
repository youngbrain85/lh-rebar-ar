// office-dashboard/src/components/analysis/ScanList.tsx
"use client";

import { Alert, Badge, Button, Card, Center, Group, Loader, Stack, Text } from "@mantine/core";
import { useEffect, useState } from "react";

export type ScanMeta = {
  scan_id: string;
  site_id: number;
  captured_at: string;
  uploaded_at: string;
  rebar_count: number;
  has_mesh: boolean;
};

/// 사이트의 as-built 스캔 목록. 비교할 설계모델(arId)은 상위(AnalysisTab)에서 고른 값을 받는다.
export default function ScanList({
  siteId,
  arId,
  onOpen,
}: {
  siteId: number;
  arId: string | null;
  onOpen: (scan: ScanMeta) => void;
}) {
  const [scans, setScans] = useState<ScanMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setScans(null);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/scans?site_id=${siteId}`);
        const data = await res.json();
        if (data.status !== "success") throw new Error(data.message || "스캔 조회 실패");
        setScans(data.scans || []);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [siteId]);

  if (error) return <Alert color="red" title="스캔 목록을 불러오지 못했습니다">{error}</Alert>;
  if (scans == null)
    return (
      <Center py="xl">
        <Loader size="sm" />
      </Center>
    );
  if (scans.length === 0)
    return (
      <Alert color="gray" variant="light">
        이 현장에 업로드된 스캔이 없습니다. 라이다 앱에서 업로드하거나
        데모 스크립트(node office-dashboard/scripts/make-demo-scan.mjs --upload)를 사용하세요.
      </Alert>
    );
  return (
    <Stack gap="sm">
      {arId == null && (
        <Alert color="yellow" variant="light">
          이 현장에 설계모델(AR 모델)이 없어 분석을 실행할 수 없습니다
        </Alert>
      )}
      {scans.map((s) => (
        <Card key={s.scan_id} withBorder radius="md" padding="sm">
          <Group justify="space-between" wrap="nowrap">
            <div style={{ minWidth: 0 }}>
              <Text size="sm" fw={600} ff="monospace" truncate>
                {s.scan_id.slice(0, 8)}
              </Text>
              <Group gap={6} mt={2}>
                <Badge size="xs" variant="light" color="brand">
                  철근 {s.rebar_count}개
                </Badge>
                <Text size="xs" c="dimmed">
                  촬영 {s.captured_at} · 업로드 {s.uploaded_at.slice(0, 19).replace("T", " ")}
                </Text>
              </Group>
            </div>
            <Button size="xs" disabled={arId == null} onClick={() => arId && onOpen(s)}>
              분석
            </Button>
          </Group>
        </Card>
      ))}
    </Stack>
  );
}
