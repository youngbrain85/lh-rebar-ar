"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Alert, AppShell, Badge, Box, Card, Center, Group, Loader, NavLink, Stack, Text, TextInput, Title,
} from "@mantine/core";
import SiteDetail, { type Site } from "../components/SiteDetail";

export default function Page() {
  const [openSite, setOpenSite] = useState<Site | null>(null);

  return (
    <AppShell header={{ height: 60 }} navbar={{ width: 232, breakpoint: "sm" }} padding="lg">
      <AppShell.Header
        style={{
          borderBottom: "1px solid var(--rule)",
          background: "rgba(255,255,255,0.86)",
          backdropFilter: "blur(8px)",
        }}
      >
        <Group h="100%" px="lg" justify="space-between">
          <Group gap={12}>
            <Box
              w={30}
              h={30}
              style={{
                background: "var(--mantine-color-brand-9)",
                display: "grid",
                placeItems: "center",
                clipPath: "polygon(0 0, 100% 0, 100% 72%, 72% 100%, 0 100%)",
              }}
            >
              <Text c="white" fw={700} size="sm" lh={1}>
                B
              </Text>
            </Box>
            <div>
              <Text fw={700} size="sm" c="brand.9" lh={1.15} style={{ letterSpacing: "0.02em" }}>
                BRICON LAB
              </Text>
              <span className="microlabel">현장 QA 대시보드</span>
            </div>
          </Group>
          <Badge variant="dot" color="teal" size="sm">
            ONLINE
          </Badge>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar
        p="sm"
        style={{ borderRight: "1px solid var(--rule)", background: "rgba(255,255,255,0.7)" }}
      >
        <NavLink
          label="현장 관리"
          description="3D 모델 · 시공 분석 · 실시간 협업"
          active
          leftSection={<Text size="sm">▦</Text>}
          onClick={() => setOpenSite(null)}
        />
        <Box mt="auto" p="xs">
          <Stack gap={2}>
            <span className="microlabel">연결</span>
            <Text size="xs" c="dimmed" className="mono">
              LiveKit · ar-w5h0quhi
            </Text>
            <Text size="xs" c="dimmed" className="mono">
              BriconLab · :50001
            </Text>
          </Stack>
        </Box>
      </AppShell.Navbar>

      <AppShell.Main style={{ height: "100dvh" }}>
        <Box h="calc(100dvh - 60px - 2 * var(--mantine-spacing-lg))">
          {openSite ? (
            <SiteDetailLoader site={openSite} onBack={() => setOpenSite(null)} />
          ) : (
            <SitesView onOpen={setOpenSite} />
          )}
        </Box>
      </AppShell.Main>
    </AppShell>
  );
}

/* --------------------------------------------------------------- 현장 목록 */

function SitesView({ onOpen }: { onOpen: (s: Site) => void }) {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveRooms, setLiveRooms] = useState<Record<string, number>>({});
  const [q, setQ] = useState("");

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

  // 현장별 LIVE 배지 — 카드에서 바로 진행 중인 협업을 알아볼 수 있게
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const d = await (await fetch("/api/live")).json();
        if (stop) return;
        const map: Record<string, number> = {};
        for (const room of d.rooms || []) map[room.name] = room.participants;
        setLiveRooms(map);
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

  const filtered = useMemo(() => {
    if (!sites) return null;
    const t = q.trim();
    return t ? sites.filter((s) => s.site_name.includes(t) || String(s.site_id) === t) : sites;
  }, [sites, q]);

  return (
    <Stack gap="lg" h="100%">
      <Group justify="space-between" align="flex-end">
        <div>
          <span className="microlabel">SITES</span>
          <Title order={2} lh={1.2} style={{ letterSpacing: "-0.03em" }}>
            시공 현장
          </Title>
          <Text size="sm" c="dimmed" mt={4}>
            현장을 선택하면 3D 모델 · 시공 분석 · 실시간 협업으로 들어갑니다
          </Text>
        </div>
        <Group gap="sm">
          <TextInput
            size="xs"
            w={220}
            placeholder="현장명 또는 번호 검색"
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
          />
          <Badge variant="light" color="brand" size="lg" className="mono">
            {sites ? `${filtered?.length ?? 0}/${sites.length}` : "…"}
          </Badge>
        </Group>
      </Group>

      {error ? (
        <Alert color="red" title="현장을 불러오지 못했습니다">
          {error}
        </Alert>
      ) : filtered == null ? (
        <Center py="xl">
          <Loader size="sm" />
        </Center>
      ) : filtered.length === 0 ? (
        <Alert color="gray" variant="light">
          검색 결과가 없습니다
        </Alert>
      ) : (
        <Box style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: 4 }}>
          <Stack gap="xs">
            {filtered.map((s, i) => {
              const live = (liveRooms[`site-${s.site_id}`] || 0) > 0;
              return (
                <Card
                  key={s.site_id}
                  className="rise"
                  padding="md"
                  onClick={() => onOpen(s)}
                  style={{
                    cursor: "pointer",
                    animationDelay: `${Math.min(i, 12) * 35}ms`,
                    background: "white",
                    transition: "box-shadow 140ms ease, transform 140ms ease, border-color 140ms ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.boxShadow = "0 6px 18px rgba(0,41,97,0.09)";
                    e.currentTarget.style.transform = "translateY(-1px)";
                    e.currentTarget.style.borderColor = "var(--mantine-color-brand-9)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow = "";
                    e.currentTarget.style.transform = "";
                    e.currentTarget.style.borderColor = "";
                  }}
                >
                  <Group justify="space-between" wrap="nowrap">
                    <Group gap="md" wrap="nowrap" style={{ minWidth: 0 }}>
                      <Text className="mono" size="lg" c="brand.9" fw={600} style={{ opacity: 0.35 }}>
                        {String(s.site_id).padStart(2, "0")}
                      </Text>
                      <Box style={{ minWidth: 0 }}>
                        <Group gap={8}>
                          <Text fw={600} size="sm" truncate>
                            {s.site_name}
                          </Text>
                          {live && (
                            <Badge size="xs" color="red" variant="filled">
                              ● LIVE
                            </Badge>
                          )}
                        </Group>
                        <Text size="xs" c="dimmed" mt={2}>
                          3D 모델 · 시공 분석 · 실시간 협업
                        </Text>
                      </Box>
                    </Group>
                    <Text c="brand.9" style={{ opacity: 0.4 }}>
                      →
                    </Text>
                  </Group>
                </Card>
              );
            })}
          </Stack>
        </Box>
      )}
    </Stack>
  );
}

/* ---------------------------------------------------- 현장 상세(LIVE 상태 포함) */

function SiteDetailLoader({ site, onBack }: { site: Site; onBack: () => void }) {
  const [live, setLive] = useState(false);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const d = await (await fetch("/api/live")).json();
        if (stop) return;
        const room = (d.rooms || []).find((r: { name: string }) => r.name === `site-${site.site_id}`);
        setLive((room?.participants || 0) > 0);
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
  }, [site.site_id]);

  return <SiteDetail site={site} live={live} onBack={onBack} />;
}
