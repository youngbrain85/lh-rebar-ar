"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  AppShell,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Drawer,
  Group,
  Loader,
  Modal,
  NavLink,
  Paper,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import dynamic from "next/dynamic";
import LiveSession from "../components/LiveSession";

// three.js is heavy and browser-only — load it lazily when the 3D modal opens
// so it stays out of the initial bundle.
const ModelViewer = dynamic(() => import("../components/ModelViewer"), {
  ssr: false,
  loading: () => null,
});

type Site = { site_id: number; site_name: string };
type ARModel = {
  scan_id: string;
  ar_id: string;
  site_id: number;
  ar_filename: string;
  ar_type: string;
  upload_at: string;
};
type View = "sites" | "live";

const DEMO_ROOM = "ar-demo";

export default function Page() {
  const [view, setView] = useState<View>("sites");
  const [liveRoom, setLiveRoom] = useState(DEMO_ROOM);

  return (
    <AppShell header={{ height: 58 }} navbar={{ width: 220, breakpoint: "sm" }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap={10}>
            <Box
              w={30}
              h={30}
              style={{
                background: "var(--mantine-color-brand-9)",
                borderRadius: 6,
                display: "grid",
                placeItems: "center",
              }}
            >
              <Text c="white" fw={800} size="sm">
                B
              </Text>
            </Box>
            <div>
              <Text fw={800} size="sm" c="brand.9" lh={1.1}>
                BRICON LAB
              </Text>
              <Text size="xs" c="dimmed" lh={1.1}>
                현장 AR 협업 대시보드
              </Text>
            </div>
          </Group>
          <Badge variant="dot" color="teal" size="sm">
            ONLINE
          </Badge>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        <NavLink
          label="현장 관리"
          description="현장 · 3D 모델"
          active={view === "sites"}
          onClick={() => setView("sites")}
          leftSection={<Text size="sm">▦</Text>}
        />
        <NavLink
          label="라이브 협업"
          description="실시간 AR 화면"
          active={view === "live"}
          onClick={() => setView("live")}
          leftSection={<Text size="sm">◉</Text>}
        />
        <Box mt="auto" p="xs">
          <Text size="xs" c="dimmed">
            LiveKit · ar-w5h0quhi
          </Text>
          <Text size="xs" c="dimmed">
            BriconLab API · :50001
          </Text>
        </Box>
      </AppShell.Navbar>

      <AppShell.Main style={{ background: "var(--mantine-color-gray-0)", height: "100dvh" }}>
        {view === "sites" ? (
          <SitesView
            onLive={(room) => {
              setLiveRoom(room);
              setView("live");
            }}
          />
        ) : (
          <Box h="calc(100dvh - 58px - 2 * var(--mantine-spacing-md))">
            <LiveSession room={liveRoom} onLeave={() => setView("sites")} />
          </Box>
        )}
      </AppShell.Main>
    </AppShell>
  );
}

/* ------------------------------------------------------------------ sites */

function SitesView({ onLive }: { onLive: (room: string) => void }) {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openSite, setOpenSite] = useState<Site | null>(null);
  const [liveRooms, setLiveRooms] = useState<Record<string, number>>({});

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/sites");
        const d = await r.json();
        if (d.status !== "success") throw new Error(d.message || "현장 조회 실패");
        setSites(d.site_list || []);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Poll active LiveKit rooms so rows can show a LIVE badge the moment a field
  // device starts sharing.
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/live");
        const d = await r.json();
        if (!stop) {
          const map: Record<string, number> = {};
          for (const room of d.rooms || []) map[room.name] = room.participants;
          setLiveRooms(map);
        }
      } catch {
        /* transient */
      }
    };
    void tick();
    const id = setInterval(tick, 6000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <div>
          <Title order={4}>시공 현장</Title>
          <Text size="sm" c="dimmed">
            현장을 선택해 3D 모델을 보거나 실시간 협업을 시작하세요
          </Text>
        </div>
        <Group gap="xs">
          {liveRooms["ar-demo"] > 0 && (
            <Badge variant="filled" color="red" size="lg">
              데모 세션 LIVE
            </Badge>
          )}
          <Badge variant="light" color="brand" size="lg">
            {loading ? "…" : `${sites.length}개 현장`}
          </Badge>
        </Group>
      </Group>

      {loading ? (
        <Center py="xl">
          <Loader size="sm" />
        </Center>
      ) : error ? (
        <Alert color="red" title="현장을 불러오지 못했습니다">
          {error}
        </Alert>
      ) : (
        <Paper withBorder radius="md">
          <Table striped highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={70}>ID</Table.Th>
                <Table.Th>현장명</Table.Th>
                <Table.Th w={220} ta="right">
                  작업
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {sites.map((s) => {
                const room = `site-${s.site_id}`;
                const isLive = (liveRooms[room] || 0) > 0;
                return (
                  <Table.Tr key={s.site_id}>
                    <Table.Td>
                      <Text ff="monospace" size="sm" c="dimmed">
                        {String(s.site_id).padStart(2, "0")}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs">
                        <Text size="sm" fw={500}>
                          {s.site_name}
                        </Text>
                        {isLive && (
                          <Badge size="xs" variant="filled" color="red">
                            ● LIVE
                          </Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Group gap="xs" justify="flex-end">
                        <Button size="xs" variant="light" onClick={() => setOpenSite(s)}>
                          3D 모델
                        </Button>
                        <Button
                          size="xs"
                          color={isLive ? "red" : "brand"}
                          onClick={() => onLive(room)}
                        >
                          {isLive ? "라이브 보기" : "실시간 협업"}
                        </Button>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Paper>
      )}

      <Drawer
        opened={openSite != null}
        onClose={() => setOpenSite(null)}
        position="right"
        size="md"
        title={
          <Text fw={700} size="sm">
            {openSite?.site_name}
          </Text>
        }
      >
        {openSite && (
          <SiteModelsPanel site={openSite} onLive={() => onLive(`site-${openSite.site_id}`)} />
        )}
      </Drawer>
    </Stack>
  );
}

/* ----------------------------------------------------------- site models */

function SiteModelsPanel({ site, onLive }: { site: Site; onLive: () => void }) {
  const [models, setModels] = useState<ARModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewerModel, setViewerModel] = useState<ARModel | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/models?site_id=${site.site_id}`);
      const d = await r.json();
      if (d.status !== "success") throw new Error(d.message || "모델 조회 실패");
      setModels(d.ar_list || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [site.site_id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Stack gap="sm">
      {loading ? (
        <Center py="lg">
          <Loader size="sm" />
        </Center>
      ) : error ? (
        <Alert color="red">{error}</Alert>
      ) : models.length === 0 ? (
        <Alert color="gray" variant="light">
          이 현장에 등록된 AR 모델이 없습니다
        </Alert>
      ) : (
        models.map((m) => (
          <Card key={m.ar_id} withBorder radius="md" padding="sm">
            <Group justify="space-between" wrap="nowrap">
              <div style={{ minWidth: 0 }}>
                <Text size="sm" fw={600} truncate>
                  {m.ar_filename}
                </Text>
                <Group gap={6} mt={2}>
                  <Badge size="xs" variant="light" color="brand">
                    {m.ar_type}
                  </Badge>
                  <Text size="xs" c="dimmed">
                    {m.upload_at}
                  </Text>
                </Group>
              </div>
              <Group gap="xs" wrap="nowrap">
                <Button size="xs" variant="default" onClick={() => setViewerModel(m)}>
                  3D 보기
                </Button>
                <Button size="xs" onClick={onLive}>
                  협업
                </Button>
              </Group>
            </Group>
          </Card>
        ))
      )}

      <Modal
        opened={viewerModel != null}
        onClose={() => setViewerModel(null)}
        size="80%"
        title={
          <Text fw={700} size="sm">
            {viewerModel?.ar_filename} — 3D 미리보기
          </Text>
        }
      >
        <Box h="65vh">{viewerModel && <ModelViewer arId={viewerModel.ar_id} />}</Box>
      </Modal>
    </Stack>
  );
}
