"use client";

// 현장 상세 — 한 현장 안에서 3D 모델 / 시공 분석 / 실시간 협업을 탭으로 오간다.
// (내비게이션은 "현장 관리" 하나뿐이고, 기능은 현장 밑으로 들어온다)
import { Badge, Box, Button, Group, Stack, Tabs, Text, Title } from "@mantine/core";
import dynamic from "next/dynamic";
import { useState } from "react";
import LiveSession from "./LiveSession";
import SiteAnalysis from "./analysis/SiteAnalysis";
import SiteModels from "./SiteModels";

const ModelViewer = dynamic(() => import("./ModelViewer"), { ssr: false, loading: () => null });

export type Site = { site_id: number; site_name: string };

export default function SiteDetail({
  site,
  live,
  onBack,
}: {
  site: Site;
  live: boolean;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<string | null>("models");

  return (
    <Stack gap="md" h="100%" style={{ minHeight: 0 }}>
      {/* 헤더: 현장명 + 상태 */}
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Box style={{ minWidth: 0 }}>
          <Group gap={8} mb={2}>
            <span className="microlabel">현장 {String(site.site_id).padStart(2, "0")}</span>
            {live && (
              <Badge size="xs" color="red" variant="filled">
                ● LIVE
              </Badge>
            )}
          </Group>
          <Title order={3} lh={1.2} style={{ letterSpacing: "-0.02em" }}>
            {site.site_name}
          </Title>
        </Box>
        <Button variant="subtle" size="xs" color="gray" onClick={onBack}>
          ← 현장 목록
        </Button>
      </Group>

      <Tabs value={tab} onChange={setTab} keepMounted={false} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <Tabs.List>
          <Tabs.Tab value="models">3D 모델 뷰</Tabs.Tab>
          <Tabs.Tab value="analysis">시공 분석</Tabs.Tab>
          <Tabs.Tab value="live">
            실시간 협업{live && <Text component="span" c="red" ml={6}>●</Text>}
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="models" pt="md" style={{ flex: 1, minHeight: 0 }}>
          <SiteModels siteId={site.site_id} renderViewer={(arId) => <ModelViewer arId={arId} />} />
        </Tabs.Panel>

        <Tabs.Panel value="analysis" pt="md" style={{ flex: 1, minHeight: 0, display: "flex" }}>
          <SiteAnalysis siteId={site.site_id} />
        </Tabs.Panel>

        <Tabs.Panel value="live" pt="md" style={{ flex: 1, minHeight: 0 }}>
          <Box h="100%">
            <LiveSession room={`site-${site.site_id}`} onLeave={() => setTab("models")} />
          </Box>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
