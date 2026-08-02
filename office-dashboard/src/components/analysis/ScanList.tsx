// office-dashboard/src/components/analysis/ScanList.tsx
"use client";

import {
  ActionIcon, Alert, Badge, Box, Button, Card, Center, Group, Loader, Stack, Text,
} from "@mantine/core";
import { useCallback, useEffect, useState } from "react";

import { scanDisplayName } from "../../lib/analysis/scanName";

export type ScanMeta = {
  scan_id: string;
  site_id: number;
  /** 라이다 앱이 보낸 사람이 읽을 이름 (선택) */
  label?: string;
  /** 서버가 만들어 준 표시 이름 ("이름 · YYYY-MM-DD HH:mm") */
  name?: string;
  captured_at: string;
  uploaded_at: string;
  rebar_count: number;
  has_mesh: boolean;
};

/** 표시명: 서버가 준 name을 쓰고, 없으면 같은 규칙으로 직접 만든다 */
export function scanTitle(s: ScanMeta): string {
  return s.name || scanDisplayName(s);
}

/// 사이트의 as-built 스캔 목록. 비교할 설계모델(arId)은 상위에서 고른 값을 받는다.
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
  const [pendingDelete, setPendingDelete] = useState<ScanMeta | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setScans(null);
    setError(null);
    try {
      const res = await fetch(`/api/scans?site_id=${siteId}`);
      const data = await res.json();
      if (data.status !== "success") throw new Error(data.message || "스캔 조회 실패");
      setScans(data.scans || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [siteId]);

  useEffect(() => {
    void load();
  }, [load]);

  const doDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(
        `/api/scan?site_id=${pendingDelete.site_id}&scan_id=${pendingDelete.scan_id}`,
        { method: "DELETE" },
      );
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.message ?? `삭제 실패 (HTTP ${res.status})`);
      setPendingDelete(null);
      await load();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  if (error) return <Alert color="red" title="스캔 목록을 불러오지 못했습니다">{error}</Alert>;
  if (scans == null)
    return (
      <Center py="xl">
        <Loader size="sm" />
      </Center>
    );

  return (
    <>
      {scans.length === 0 ? (
        <Alert color="gray" variant="light">
          이 현장에 업로드된 스캔이 없습니다. 라이다 앱에서 업로드하면 여기에 나타납니다.
        </Alert>
      ) : (
        <Stack gap="xs">
          {arId == null && (
            <Alert color="yellow" variant="light">
              이 현장에 설계모델이 없어 분석을 실행할 수 없습니다
            </Alert>
          )}
          {scans.map((s, i) => (
            <Card key={s.scan_id} className="rise" padding="sm" style={{ animationDelay: `${i * 40}ms`, background: "white" }}>
              <Group justify="space-between" wrap="nowrap">
                <div style={{ minWidth: 0 }}>
                  <Text size="sm" fw={600} truncate>
                    {scanTitle(s)}
                  </Text>
                  <Group gap={6} mt={3}>
                    <Badge size="xs" variant="light" color="brand">
                      철근 {s.rebar_count}
                    </Badge>
                    {s.has_mesh && (
                      <Badge size="xs" variant="light" color="gray">
                        메시
                      </Badge>
                    )}
                    <Text size="xs" c="dimmed" className="mono">
                      {s.uploaded_at.slice(0, 16).replace("T", " ")} · {s.scan_id.slice(0, 8)}
                    </Text>
                  </Group>
                </div>
                <Group gap={6} wrap="nowrap">
                  <Button size="xs" disabled={arId == null} onClick={() => arId && onOpen(s)}>
                    분석
                  </Button>
                  <ActionIcon
                    variant="subtle" color="red" size="lg" aria-label="스캔 삭제"
                    onClick={() => { setDeleteError(null); setPendingDelete(s); }}
                  >
                    ✕
                  </ActionIcon>
                </Group>
              </Group>

              {/* 삭제 확인은 카드 안에서 바로 — 되돌릴 수 없으므로 한 단계 더 거친다 */}
              {pendingDelete?.scan_id === s.scan_id && (
                <Box
                  mt="sm" pt="sm"
                  style={{ borderTop: "1px solid var(--rule)" }}
                >
                  <Text size="xs" c="red.9" fw={600} mb={6}>
                    이 스캔을 삭제할까요? 철근 데이터·메시·분석결과가 함께 지워지며 되돌릴 수 없습니다.
                  </Text>
                  {deleteError && <Alert color="red" mb={6} py={6}>{deleteError}</Alert>}
                  <Group gap="xs" justify="flex-end">
                    <Button
                      variant="default" size="xs" disabled={deleting}
                      onClick={() => setPendingDelete(null)}
                    >
                      취소
                    </Button>
                    <Button color="red" size="xs" loading={deleting} onClick={() => void doDelete()}>
                      삭제 확인
                    </Button>
                  </Group>
                </Box>
              )}
            </Card>
          ))}
        </Stack>
      )}
    </>
  );
}
