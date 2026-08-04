// office-dashboard/src/components/analysis/AnalysisView.tsx
"use client";

// 분석 실행 + 결과 시각화 화면 — spec §6·§7.
// 흐름: 설계 USDZ + rebars.json 로드 → 메인스레드 분석 → 뷰어/카드/테이블 표시.
// 기존 결과가 저장돼 있으면 자동 로드하고, 재분석 버튼으로 다시 돌릴 수 있다.
import {
  Alert, Badge, Box, Button, Card, Center, Chip, Group, Loader, NumberInput,
  Paper, ScrollArea, SegmentedControl, SimpleGrid, Slider, Stack, Table, Text,
} from "@mantine/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import type * as THREE from "three";
import {
  buildContourField, CONTOUR_COLORS, contourColor, DEFAULT_CONTOUR_MAX, type ContourSample,
} from "../../lib/analysis/contour";
import { rejudgeRecords } from "../../lib/analysis/judge";
import { assignLabels } from "../../lib/analysis/label";
import type { AnalysisOutput } from "../../lib/analysis/pipeline";
import { parseRebarsJson } from "../../lib/analysis/rebarsSchema";
import { computeSpacing, spacingGroupKey, suggestRequiredSpacing } from "../../lib/analysis/spacing";
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
  // 지표: 간격 편차(기본) ↔ 위치 편차
  const [metric, setMetric] = useState<"spacing" | "position">("spacing");
  const [showContour, setShowContour] = useState(true);
  const [contourMax, setContourMax] = useState<number>(DEFAULT_CONTOUR_MAX.spacing);
  /** 그룹별 요구 간격 (mm). key = `${direction}/${layer}` */
  const [requiredSpacing, setRequiredSpacing] = useState<Record<string, number>>({});

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
            prev.version === 2 &&
            Array.isArray(prev.rebars) &&
            typeof prev.toleranceMm === "number"
          ) {
            setSavedRecords(prev.rebars);
            setTolerance(prev.toleranceMm);
            if (prev.requiredSpacingMm) setRequiredSpacing(prev.requiredSpacingMm);
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
          requiredSpacingMm: requiredSpacing,
        });
        // 표시용 간략명 부여 (세로-내측-1 …) — 저장 결과에도 포함되도록 출력을 교체.
        // 방향군은 파이프라인이 이미 뽑아 out.families로 내보낸다 — 다시 뽑지 않는다.
        out.rebars = assignLabels(out.rebars, out.designClassified, out.scanTransformed, out.families);
        setOutput(out);
        setSavedRecords(null);
        if (!out.registration.failed) {
          // 그룹 실측 중앙값으로 기본값을 제안하되, 사용자가 이미 입력해 둔 값은 덮지 않는다
          const suggested = suggestRequiredSpacing(out.spacing.groups);
          const merged = { ...suggested, ...requiredSpacing };
          setRequiredSpacing(merged);
          const result: AnalysisResult = {
            version: 2, scanId: scan.scan_id, arId,
            registration: {
              matrix: out.registration.matrix,
              rmsMm: out.registration.rmsMm,
              method: out.registration.method,
            },
            toleranceMm: tolerance,
            families: out.families,
            requiredSpacingMm: merged,
            spacingGroups: out.spacing.groups,
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
    [designRebars, scanRebars, tolerance, run, scan.site_id, scan.scan_id, arId, requiredSpacing],
  );

  const changeMetric = useCallback((v: string) => {
    const m = v === "position" ? "position" : "spacing";
    setMetric(m);
    setContourMax(DEFAULT_CONTOUR_MAX[m]);
  }, []);

  // ---- 표시 데이터: 라이브 출력 우선, 없으면 저장본. 슬라이더는 재판정만 ----
  const view = useMemo(() => {
    const base = output?.rebars ?? savedRecords;
    if (!base) return null;
    return rejudgeRecords(base, tolerance);
  }, [output, savedRecords, tolerance]);

  /** 요구 간격이 바뀌면 정합을 다시 돌리지 않고 간격만 다시 잰다 */
  const spacing = useMemo(() => {
    if (!output) return null;
    return computeSpacing(output.scanTransformed, output.families, output.wallNormal, requiredSpacing);
  }, [output, requiredSpacing]);

  /** 위치 편차 지표의 표본: 시공 철근 중점 + 그 철근의 편차 */
  const positionSamples = useMemo<ContourSample[]>(() => {
    if (!output || !view) return [];
    const byId = new Map(output.scanTransformed.map((r) => [r.id, r]));
    const out: ContourSample[] = [];
    for (const rec of view.rebars) {
      if (!rec.scanId || !rec.deviationMm) continue;
      const bar = byId.get(rec.scanId);
      if (!bar) continue;
      const line = bar.centerline;
      const mid = line[Math.floor(line.length / 2)];
      out.push({ midpoint: mid, deviationMm: rec.deviationMm.mean });
    }
    return out;
  }, [output, view]);

  // ★ 반드시 useMemo로 감쌀 것. 뷰어의 컨투어 이펙트는 이 값의 identity로 갱신을 판단하고,
  //   갱신 때마다 DataTexture·지오메트리·머티리얼을 dispose하고 새로 만든다. 렌더마다 새
  //   ContourField를 만들면 요구간격 입력에 한 글자 칠 때마다 GPU 자원이 갈린다.
  const contour = useMemo(() => {
    // 정합 실패 시 scanTransformed는 엉뚱한 자리라 간격·평면이 무의미하다 — 지도를 끈다
    if (!output || !showContour || output.registration.failed) return null;
    const samples: ContourSample[] = metric === "spacing" ? spacing?.gaps ?? [] : positionSamples;
    if (samples.length === 0) return null;
    return buildContourField(samples, output.plane);
  }, [output, showContour, metric, spacing, positionSamples]);

  /** 요구 간격 입력 폼에 띄울 그룹 목록 */
  const spacingGroups = spacing?.groups.filter((g) => g.count > 0) ?? [];
  const familyLabel = useCallback(
    (id: string) => output?.families.find((f) => f.id === id)?.label ?? id,
    [output],
  );

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
          contour={contour}
          contourMax={contourMax}
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
            {output && (
              <Chip
                size="xs" color="grape" checked={showContour}
                onChange={(on) => {
                  setShowContour(on);
                  // 지도를 켜면 설계 고스트를 내린다. 고스트는 depthWrite:false + 렌더순서상
                  // 평면보다 뒤에 있어도 위에 덮여 그려지므로(순서 무관 투명의 한계), 회색이
                  // 색 띠를 씌워 단계 구분을 흐린다. 사용자가 칩으로 다시 켤 수 있다.
                  if (on) setShowDesign(false);
                }}
              >
                편차 지도
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
          {output && showContour && (
            <Box mb={8}>
              <Text size="xs" fw={600} mb={3}>
                {metric === "spacing" ? "간격 편차" : "위치 편차"} (mm)
              </Text>
              <Group gap={0} wrap="nowrap">
                {CONTOUR_COLORS.map((c) => (
                  <Box key={c} h={10} style={{ flex: 1, background: c }} />
                ))}
              </Group>
              <Group justify="space-between">
                <Text size="10px" ff="monospace">0</Text>
                <Text size="10px" ff="monospace">≥{contourMax}</Text>
              </Group>
            </Box>
          )}
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

            <SegmentedControl
              size="xs" fullWidth value={metric} onChange={changeMetric}
              data={[
                { value: "spacing", label: "간격 편차" },
                { value: "position", label: "위치 편차" },
              ]}
            />

            <Box>
              <Text size="xs" fw={600} mb={2}>
                컨투어 상한 {contourMax}mm — 이 값 이상은 모두 최상위 색
              </Text>
              <Slider min={5} max={200} step={5} value={contourMax} onChange={setContourMax}
                marks={[{ value: 30 }, { value: 50 }, { value: 100 }]} size="sm" />
              <Text size="xs" c="dimmed" mt={2}>
                KDS 10 20 50은 최소 간격만 규정하고 오차 기준이 없어 상한은 사용자가 정합니다.
              </Text>
            </Box>

            {metric === "spacing" ? (
              <Box>
                <Text size="xs" fw={600} mb={4}>요구 간격 (mm)</Text>
                <Stack gap={4}>
                  {spacingGroups.map((g) => {
                    const key = spacingGroupKey(g.direction, g.layer);
                    return (
                      <Group key={key} gap={6} wrap="nowrap">
                        <Text size="xs" style={{ flex: 1 }}>
                          {familyLabel(g.direction)}·{g.layer === "outer" ? "외측" : "내측"}
                          <Text span size="xs" c="dimmed"> (실측 중앙값 {g.medianMm.toFixed(0)})</Text>
                        </Text>
                        <NumberInput
                          size="xs" w={92} step={5} min={10}
                          value={requiredSpacing[key] ?? Math.round(g.medianMm / 5) * 5}
                          onChange={(v) =>
                            setRequiredSpacing((prev) => ({ ...prev, [key]: Number(v) || 0 }))
                          }
                        />
                      </Group>
                    );
                  })}
                </Stack>
              </Box>
            ) : (
              <Box>
                <Text size="xs" fw={600} mb={2}>허용오차 ±{tolerance}mm</Text>
                <Slider min={1} max={50} value={tolerance} onChange={setTolerance}
                  marks={[{ value: 10 }, { value: 25 }, { value: 50 }]} size="sm" />
              </Box>
            )}

            <Paper withBorder radius="md" style={{ flex: 1, minHeight: 0 }}>
              <ScrollArea h="100%">
                {metric === "spacing" && !spacing ? (
                  <Text size="xs" c="dimmed" p="sm">
                    간격은 저장되지 않습니다 — 「재분석」을 눌러야 표시됩니다.
                  </Text>
                ) : metric === "spacing" ? (
                  <Table striped highlightOnHover stickyHeader verticalSpacing={4} fz="xs">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>구간</Table.Th>
                        <Table.Th ta="right">실측</Table.Th>
                        <Table.Th ta="right">요구</Table.Th>
                        <Table.Th ta="right">편차</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {(spacing?.gaps ?? []).map((g) => (
                        <Table.Tr key={`${g.aId}|${g.bId}`}>
                          <Table.Td>
                            {familyLabel(g.direction)}·{g.layer === "outer" ? "외측" : "내측"}
                          </Table.Td>
                          <Table.Td ta="right" ff="monospace">{g.spacingMm.toFixed(0)}</Table.Td>
                          <Table.Td ta="right" ff="monospace">{g.requiredMm.toFixed(0)}</Table.Td>
                          <Table.Td ta="right" ff="monospace"
                            style={{ color: contourColor(Math.abs(g.deviationMm), contourMax) }}>
                            {g.deviationMm > 0 ? "+" : ""}{g.deviationMm.toFixed(0)}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                ) : (
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
                            <Table.Td title={key}>{r.label ?? key}</Table.Td>
                            <Table.Td>
                              {familyLabel(r.direction)}·{r.layer === "outer" ? "외측" : "내측"}
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
                )}
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
