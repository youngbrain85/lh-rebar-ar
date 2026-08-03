// office-dashboard/src/components/analysis/AnalysisView.tsx
"use client";

// 분석 실행 + 결과 시각화 화면 — spec §6·§7.
// 흐름: 설계 USDZ + rebars.json 로드 → 메인스레드 분석 → 뷰어/카드/테이블 표시.
// 기존 결과가 저장돼 있으면 자동 로드하고, 재분석 버튼으로 다시 돌릴 수 있다.
import {
  Alert, Badge, Box, Button, Card, Center, Chip, Group, Loader, NumberInput,
  Paper, ScrollArea, SimpleGrid, Slider, Stack, Table, Text,
} from "@mantine/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import type * as THREE from "three";
import { deriveDirectionFamilies } from "../../lib/analysis/direction";
import { rejudgeRecords } from "../../lib/analysis/judge";
import { assignLabels } from "../../lib/analysis/label";
import type { AnalysisOutput } from "../../lib/analysis/pipeline";
import { parseRebarsJson } from "../../lib/analysis/rebarsSchema";
import type {
  AnalysisResult, ClassifiedRebar, Mat4, Rebar, RebarRecord, Verdict,
} from "../../lib/analysis/types";
import AnalysisViewer, { LAYER_COLOR } from "./AnalysisViewer";
import { loadDesign } from "./loadDesign";
import type { ScanMeta } from "./ScanList";
import { useAnalysis } from "./useAnalysis";

const ALL_VERDICTS: Verdict[] = ["pass", "out_of_tolerance", "missing", "extra"];
const VERDICT_LABEL: Record<Verdict, string> = {
  pass: "정상", out_of_tolerance: "허용초과", missing: "미시공", extra: "도면 외",
};
const VERDICT_BADGE: Record<Verdict, string> = {
  pass: "green", out_of_tolerance: "orange", missing: "red", extra: "blue",
};
const STAGE_LABEL: Record<string, string> = {
  register: "정합 중…", classify: "분류 중…", match: "매칭 중…", judge: "판정 중…",
};

// 뷰어 props 참조 안정성용 — AnalysisViewer의 이펙트가 배열 identity에 의존하므로
// 매 렌더마다 새 배열 리터럴(`?? []`)을 인라인으로 만들지 않는다.
const EMPTY_CLASSIFIED: ClassifiedRebar[] = [];
const EMPTY_RECORDS: RebarRecord[] = [];

/** 수동 폴백: XYZ 이동(m) + 요(°)로 초기정합 행렬 구성 (column-major) */
function nudgeMat4(tx: number, ty: number, tz: number, yawDeg: number): Mat4 {
  const a = (yawDeg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, tx, ty, tz, 1];
}

export default function AnalysisView({ scan, arId }: { scan: ScanMeta; arId: string }) {
  const { run, stage } = useAnalysis();
  const [designObject, setDesignObject] = useState<THREE.Object3D | null>(null);
  const [designRebars, setDesignRebars] = useState<Rebar[] | null>(null);
  const [scanRebars, setScanRebars] = useState<Rebar[] | null>(null);
  const [meshUrl, setMeshUrl] = useState<string | null>(null);
  const [output, setOutput] = useState<AnalysisOutput | null>(null);
  const [savedRecords, setSavedRecords] = useState<RebarRecord[] | null>(null);
  const [savedMatrix, setSavedMatrix] = useState<number[] | null>(null);
  const [tolerance, setTolerance] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showVerdicts, setShowVerdicts] = useState<Verdict[]>(ALL_VERDICTS);
  const [showDesign, setShowDesign] = useState(true);
  const [showScanBars, setShowScanBars] = useState(true);
  const [showMesh, setShowMesh] = useState(false);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  // 수동 폴백 입력 (정합 실패 시에만 노출)
  const [nudge, setNudge] = useState({ tx: 0, ty: 0, tz: 0, yaw: 0 });

  // ---- 입력 데이터 로드: 설계 + 스캔 + 기존 결과 ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [design, scanRes, prevRes] = await Promise.all([
          loadDesign(arId),
          fetch(`/api/scan?site_id=${scan.site_id}&scan_id=${scan.scan_id}`).then((r) => r.json()),
          fetch(`/api/analysis-result?site_id=${scan.site_id}&scan_id=${scan.scan_id}`),
        ]);
        if (cancelled) return;
        if (scanRes.status !== "success") throw new Error(scanRes.message || "스캔 조회 실패");
        const rebarsText = await (await fetch(scanRes.rebars_url)).text();
        const parsed = parseRebarsJson(rebarsText);
        if (!parsed.ok) throw new Error(`rebars.json 오류: ${parsed.errors.join(", ")}`);
        if (cancelled) return;
        setDesignObject(design.object);
        setDesignRebars(design.rebars);
        setScanRebars(parsed.data.rebars);
        setMeshUrl(scanRes.mesh_url ?? null);
        if (prevRes.ok) {
          const prev: AnalysisResult = await prevRes.json();
          if (
            !cancelled &&
            prev.version === 1 &&
            Array.isArray(prev.rebars) &&
            typeof prev.toleranceMm === "number"
          ) {
            setSavedRecords(prev.rebars);
            setTolerance(prev.toleranceMm);
            if (Array.isArray(prev.registration?.matrix) && prev.registration.matrix.length === 16) {
              setSavedMatrix(prev.registration.matrix);
            }
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [arId, scan.site_id, scan.scan_id]);

  // ---- 분석 실행 ----
  const analyze = useCallback(
    async (manualInit?: Mat4) => {
      if (!designRebars || !scanRebars) return;
      setError(null);
      setSaveWarning(null);
      try {
        const out = await run({
          design: designRebars, scan: scanRebars,
          toleranceMm: tolerance, up: [0, 1, 0], manualInit,
        });
        // 표시용 간략명 부여 (세로-내측-1 …) — 저장 결과에도 포함되도록 출력을 교체.
        // 방향군은 파이프라인과 같은 기준(설계모델 + up)으로 다시 뽑는다 — 정식 배선은 Task 5.
        const families = deriveDirectionFamilies(designRebars, [0, 1, 0]);
        out.rebars = assignLabels(out.rebars, out.designClassified, out.scanTransformed, families);
        setOutput(out);
        setSavedRecords(null);
        if (!out.registration.failed) {
          const result: AnalysisResult = {
            version: 1, scanId: scan.scan_id, arId,
            registration: {
              matrix: out.registration.matrix,
              rmsMm: out.registration.rmsMm,
              method: out.registration.method,
            },
            toleranceMm: tolerance,
            rebars: out.rebars,
            summary: out.summary,
          };
          try {
            const saveRes = await fetch(
              `/api/analysis-result?site_id=${scan.site_id}&scan_id=${scan.scan_id}`,
              { method: "PUT", body: JSON.stringify(result) },
            );
            if (!saveRes.ok) {
              const d = await saveRes.json().catch(() => null);
              setSaveWarning(d?.message ?? `결과 저장 실패 (HTTP ${saveRes.status})`);
            }
          } catch (e) {
            setSaveWarning(e instanceof Error ? e.message : String(e));
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [designRebars, scanRebars, tolerance, run, scan.site_id, scan.scan_id, arId],
  );

  // ---- 표시 데이터: 라이브 출력 우선, 없으면 저장본. 슬라이더는 재판정만 ----
  const view = useMemo(() => {
    const base = output?.rebars ?? savedRecords;
    if (!base) return null;
    return rejudgeRecords(base, tolerance);
  }, [output, savedRecords, tolerance]);

  if (loading)
    return (
      <Center py="xl">
        <Loader size="sm" />
      </Center>
    );

  return (
    <Group align="stretch" gap="md" wrap="nowrap" style={{ flex: 1, minHeight: 0 }}>
      {/* ---- 좌: 3D 뷰어 ---- */}
      <Paper withBorder radius="md" style={{ flex: 1, position: "relative", minWidth: 0 }}>
        <AnalysisViewer
          designObject={designObject}
          records={view?.rebars ?? EMPTY_RECORDS}
          design={output?.designClassified ?? EMPTY_CLASSIFIED}
          scan={output?.scanTransformed ?? EMPTY_CLASSIFIED}
          showVerdicts={showVerdicts}
          showDesign={showDesign}
          showScanBars={showScanBars}
          showMesh={showMesh}
          meshUrl={meshUrl}
          registrationMatrix={output?.registration.failed ? null : output?.registration.matrix ?? savedMatrix}
          focusKey={focusKey}
        />

        {/* 레이어 토글: 설계모델 / 시공 철근을 따로 볼 수 있다 */}
        <Stack gap={6} style={{ position: "absolute", top: 8, left: 8 }}>
          <Group gap={6}>
            <Chip size="xs" color="gray" checked={showDesign} onChange={setShowDesign}>
              설계모델
            </Chip>
            <Chip size="xs" checked={showScanBars} onChange={setShowScanBars}>
              시공 철근
            </Chip>
            {meshUrl && (output?.registration.failed === false || savedMatrix) && (
              <Chip size="xs" color="indigo" checked={showMesh} onChange={setShowMesh}>
                스캔 메시
              </Chip>
            )}
          </Group>
          {/* 판정별 필터 (시공 철근을 켰을 때만 의미 있음) */}
          <Group gap={6}>
            {ALL_VERDICTS.map((v) => (
              <Chip
                key={v} size="xs" color={VERDICT_BADGE[v]} disabled={!showScanBars}
                checked={showVerdicts.includes(v)}
                onChange={(on) =>
                  setShowVerdicts((prev) => (on ? [...prev, v] : prev.filter((x) => x !== v)))
                }
              >
                {VERDICT_LABEL[v]}
              </Chip>
            ))}
          </Group>
        </Stack>

        {/* 색상 범례 */}
        <Paper
          withBorder radius="sm" p={8}
          style={{ position: "absolute", top: 8, right: 8, background: "rgba(255,255,255,0.92)" }}
        >
          <Text size="xs" fw={700} mb={4}>색상 안내</Text>
          <Stack gap={3}>
            <LegendRow color={LAYER_COLOR.pass} label="정상 (허용오차 이내)" />
            <LegendRow color={LAYER_COLOR.out_of_tolerance} label="허용초과" />
            <LegendRow color={LAYER_COLOR.missing} label="미시공 (설계 위치)" />
            <LegendRow color={LAYER_COLOR.extra} label="도면 외 (설계에 없음)" />
            <LegendRow color={LAYER_COLOR.design} label="설계모델" />
            {meshUrl && <LegendRow color={LAYER_COLOR.scanMesh} label="스캔 메시" />}
          </Stack>
        </Paper>

        {savedRecords && !output && (
          <Badge style={{ position: "absolute", bottom: 8, left: 8 }} variant="light">
            저장된 결과 (3D는 재분석 후 표시)
          </Badge>
        )}
      </Paper>

      {/* ---- 우: 패널 ---- */}
      <Stack gap="sm" w={380} style={{ overflow: "hidden" }}>
        <Group gap="xs">
          <Button size="xs" onClick={() => void analyze()} loading={stage != null}>
            {stage ? STAGE_LABEL[stage] ?? stage : output || savedRecords ? "재분석" : "분석 실행"}
          </Button>
          {output && (
            <Badge variant="light" color={output.registration.failed ? "red" : "teal"}>
              정합 RMS {output.registration.rmsMm.toFixed(1)}mm ·{" "}
              {output.registration.method === "auto" ? "자동" : "수동"}
            </Badge>
          )}
        </Group>

        {error && <Alert color="red">{error}</Alert>}
        {saveWarning && (
          <Alert color="yellow" title="분석은 완료됐지만 결과 저장에 실패했습니다">
            {saveWarning}
          </Alert>
        )}

        {output?.registration.failed && (
          <Alert color="orange" title="자동 정합 실패 — 수동 초기정합">
            <Stack gap={6}>
              <Group gap={6} grow>
                <NumberInput size="xs" label="X (m)" value={nudge.tx} step={0.1}
                  onChange={(v) => setNudge({ ...nudge, tx: Number(v) || 0 })} />
                <NumberInput size="xs" label="Y (m)" value={nudge.ty} step={0.1}
                  onChange={(v) => setNudge({ ...nudge, ty: Number(v) || 0 })} />
              </Group>
              <Group gap={6} grow>
                <NumberInput size="xs" label="Z (m)" value={nudge.tz} step={0.1}
                  onChange={(v) => setNudge({ ...nudge, tz: Number(v) || 0 })} />
                <NumberInput size="xs" label="요 (°)" value={nudge.yaw} step={5}
                  onChange={(v) => setNudge({ ...nudge, yaw: Number(v) || 0 })} />
              </Group>
              <Button size="xs" variant="light"
                onClick={() => void analyze(nudgeMat4(nudge.tx, nudge.ty, nudge.tz, nudge.yaw))}>
                이 초기값으로 재정합
              </Button>
            </Stack>
          </Alert>
        )}

        {view && (
          <>
            <SimpleGrid cols={3} spacing={6}>
              <StatCard label="설계 철근" value={`${view.summary.designCount}`} />
              <StatCard label="시공 철근" value={`${view.summary.scanCount}`} />
              <StatCard label="매칭" value={`${view.summary.matched}`} />
              <StatCard label="미시공" value={`${view.summary.missing}`} tone="red" />
              <StatCard label="허용초과" value={`${view.summary.outOfTolerance}`} tone="orange" />
              <StatCard label="도면 외" value={`${view.summary.extra}`} tone="blue" />
            </SimpleGrid>
            {view.summary.deviationMm && (
              <Text size="xs" c="dimmed">
                편차 평균 {view.summary.deviationMm.mean.toFixed(1)}mm · 최대{" "}
                {view.summary.deviationMm.max.toFixed(1)}mm
              </Text>
            )}

            <Box>
              <Text size="xs" fw={600} mb={2}>
                허용오차 ±{tolerance}mm
              </Text>
              <Slider min={1} max={50} value={tolerance} onChange={setTolerance}
                marks={[{ value: 10 }, { value: 25 }, { value: 50 }]} size="sm" />
            </Box>

            <Paper withBorder radius="md" style={{ flex: 1, minHeight: 0 }}>
              <ScrollArea h="100%">
                <Table striped highlightOnHover stickyHeader verticalSpacing={4} fz="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>철근</Table.Th>
                      <Table.Th>분류</Table.Th>
                      <Table.Th ta="right">편차(mm)</Table.Th>
                      <Table.Th>판정</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {view.rebars.map((r) => {
                      const key = r.designId ?? r.scanId ?? "";
                      return (
                        <Table.Tr key={key} style={{ cursor: "pointer" }}
                          bg={focusKey === key ? "var(--mantine-color-yellow-0)" : undefined}
                          onClick={() => setFocusKey(key)}>
                          {/* 표시는 간략명, 원본 요소명은 툴팁으로 */}
                          <Table.Td title={key}>{r.label ?? key}</Table.Td>
                          <Table.Td>
                            {/* 방향군 표시 이름 — 없으면(예: 마이그레이션 전 저장본) id를 그대로 보여준다 */}
                            {r.directionLabel ?? r.direction}·
                            {r.layer === "outer" ? "외측" : "내측"}
                          </Table.Td>
                          <Table.Td ta="right" ff="monospace">
                            {r.deviationMm ? r.deviationMm.mean.toFixed(1) : "—"}
                          </Table.Td>
                          <Table.Td>
                            <Badge size="xs" color={VERDICT_BADGE[r.verdict]} variant="light">
                              {VERDICT_LABEL[r.verdict]}
                            </Badge>
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            </Paper>
          </>
        )}
      </Stack>
    </Group>
  );
}

/** 범례 한 줄: 색 스와치 + 설명 */
function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <Group gap={6} wrap="nowrap">
      <Box w={12} h={12} style={{ background: color, borderRadius: 3, flexShrink: 0 }} />
      <Text size="xs">{label}</Text>
    </Group>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <Card withBorder radius="md" padding={8}>
      <Text size="xs" c="dimmed">{label}</Text>
      <Text fw={700} ff="monospace" c={tone}>{value}</Text>
    </Card>
  );
}
