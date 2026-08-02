"use client";

// 현장의 3D 모델 목록 + 뷰어. 모델을 고르면 오른쪽(모바일에선 아래)에 렌더한다.
import { Alert, Badge, Card, Center, Grid, Group, Loader, Paper, Stack, Text } from "@mantine/core";
import { useEffect, useState, type ReactNode } from "react";

type ARModel = {
  ar_id: string;
  ar_filename: string;
  ar_type: string;
  upload_at: string;
  remark?: string | null;
  source_filename?: string | null;
};

/** 해시 파일명 대신 사람이 알아볼 이름 */
export function modelTitle(m: ARModel): string {
  return m.ar_type === "built-in" ? "설계모델" : `${m.ar_type} 모델`;
}
export function modelSubtitle(m: ARModel): string {
  return m.remark || m.source_filename || m.ar_filename;
}

export default function SiteModels({
  siteId,
  renderViewer,
}: {
  siteId: number;
  renderViewer: (arId: string) => ReactNode;
}) {
  const [models, setModels] = useState<ARModel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    setModels(null);
    setError(null);
    setSelected(null);
    (async () => {
      try {
        const d = await (await fetch(`/api/models?site_id=${siteId}`)).json();
        if (d.status !== "success") throw new Error(d.message || "모델 조회 실패");
        const list: ARModel[] = d.ar_list || [];
        setModels(list);
        const first = list.find((m) => m.ar_type === "built-in") ?? list[0];
        setSelected(first?.ar_id ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [siteId]);

  if (error) return <Alert color="red" title="모델을 불러오지 못했습니다">{error}</Alert>;
  if (models == null)
    return (
      <Center py="xl">
        <Loader size="sm" />
      </Center>
    );
  if (models.length === 0)
    return (
      <Alert color="gray" variant="light">
        이 현장에 등록된 3D 모델이 없습니다
      </Alert>
    );

  return (
    <Grid gap="md" style={{ height: "100%" }}>
      <Grid.Col span={{ base: 12, md: 4, lg: 3 }}>
        <Stack gap="xs">
          {models.map((m, i) => {
            const on = selected === m.ar_id;
            return (
              <Card
                key={m.ar_id}
                className="rise"
                padding="sm"
                onClick={() => setSelected(m.ar_id)}
                style={{
                  cursor: "pointer",
                  animationDelay: `${i * 40}ms`,
                  borderColor: on ? "var(--mantine-color-brand-9)" : undefined,
                  boxShadow: on ? "inset 3px 0 0 var(--mantine-color-brand-9)" : undefined,
                  background: on ? "var(--mantine-color-brand-0)" : "white",
                }}
              >
                <Group gap={6} mb={4}>
                  <Text size="sm" fw={600}>
                    {modelTitle(m)}
                  </Text>
                  {m.ar_type !== "built-in" && (
                    <Badge size="xs" variant="light" color="gray">
                      참고
                    </Badge>
                  )}
                </Group>
                <Text size="xs" c="dimmed" truncate title={modelSubtitle(m)}>
                  {modelSubtitle(m)}
                </Text>
                <Text size="xs" c="dimmed" className="mono" mt={2}>
                  {m.upload_at.slice(0, 10)}
                </Text>
              </Card>
            );
          })}
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 8, lg: 9 }}>
        <Paper withBorder h="100%" mih={420} style={{ position: "relative", overflow: "hidden", background: "white" }}>
          {selected && renderViewer(selected)}
        </Paper>
      </Grid.Col>
    </Grid>
  );
}
