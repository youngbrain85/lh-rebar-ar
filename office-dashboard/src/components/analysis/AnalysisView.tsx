// office-dashboard/src/components/analysis/AnalysisView.tsx
"use client";

// 분석 실행 + 결과 시각화 화면 — spec §6·§7.
// 흐름: 설계 USDZ + rebars.json 로드 → 메인스레드 분석 → 뷰어/카드/테이블 표시.
// 기존 결과가 저장돼 있으면 자동 로드하고, 재분석 버튼으로 다시 돌릴 수 있다.
import {
  Alert, Badge, Box, Button, Card, Center, Checkbox, Chip, Group, Loader, NumberInput,
  Paper, ScrollArea, SegmentedControl, SimpleGrid, Slider, Stack, Table, Tabs, Text,
} from "@mantine/core";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import type * as THREE from "three";
import {
  buildContourField, CONTOUR_COLORS, contourColor, DEFAULT_CONTOUR_MAX, MAX_NORMAL_SPREAD_M,
  normalSpread, type ContourSample,
} from "../../lib/analysis/contour";
import { barMidpoint } from "../../lib/analysis/geom";
import { rejudgeRecords } from "../../lib/analysis/judge";
import { assignLabels } from "../../lib/analysis/label";
import type { AnalysisOutput } from "../../lib/analysis/pipeline";
import { parseRebarsJson } from "../../lib/analysis/rebarsSchema";
import {
  frameOfMethod, INITIAL_REQUIRED_SPACING_STATE, requiredSpacingReducer, usableRequiredSpacing,
  type FrameSource,
} from "../../lib/analysis/requiredSpacingState";
import { computeSpacing, spacingGroupKey, suggestRequiredSpacing } from "../../lib/analysis/spacing";
import { matchesModel, parseRebarMeta } from "../../lib/analysis/rebarMetaSchema";
import {
  allValues, buildTree, taxonomyFromClassified, taxonomyFromGeometry, taxonomyFromPrimNames,
  taxonomyFromSidecar, visibleIdsFromChecked, type Taxonomy,
} from "../../lib/analysis/taxonomy";
import type {
  AnalysisResult, ClassifiedRebar, Mat4, Rebar, RebarRecord, Verdict,
} from "../../lib/analysis/types";
import AnalysisViewer, { LAYER_COLOR } from "./AnalysisViewer";
import { loadDesign } from "./loadDesign";
import RebarTree from "./RebarTree";
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

export default function AnalysisView({
  scan, arId, noDesignMode, onNoDesignModeChange,
}: {
  scan: ScanMeta;
  arId: string;
  /** 「설계모델 없이 분석」 체크박스 상태 — SiteAnalysis가 소유한다(모델 선택 화면의
   *  ar_type 경고를 이 상태로 같이 억제해야 하므로, 여기서 로컬 state로 들고 있지 않는다) */
  noDesignMode: boolean;
  onNoDesignModeChange: (v: boolean) => void;
}) {
  const { run, stage } = useAnalysis();
  const [designObject, setDesignObject] = useState<THREE.Object3D | null>(null);
  const [designRebars, setDesignRebars] = useState<Rebar[] | null>(null);
  const [scanRebars, setScanRebars] = useState<Rebar[] | null>(null);
  const [meshUrl, setMeshUrl] = useState<string | null>(null);
  const [output, setOutput] = useState<AnalysisOutput | null>(null);
  const [savedRecords, setSavedRecords] = useState<RebarRecord[] | null>(null);
  const [savedMatrix, setSavedMatrix] = useState<number[] | null>(null);
  /** 저장된 결과의 정합 방식 — "none"이면 그 결과는 frameSource:"scan"으로 만들어졌다는
   *  뜻이라, output이 아직 없는 "저장본만 로드된" 화면에서도 판정 위젯을 숨겨야 한다 */
  const [savedMethod, setSavedMethod] = useState<"auto" | "manual" | "none" | null>(null);
  /** 저장된 결과의 designId 규칙 — "name"이면 사이드카 prim 경로와 조인되지 않는다 */
  const [savedIdScheme, setSavedIdScheme] = useState<"name" | "path" | null>(null);
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
  /**
   * 그룹별 요구 간격(mm, key = `${directionId}/${layer}`)과 그 값이 나온 프레임을
   * 하나의 상태로 묶어 리듀서로 관리한다 — directionId는 프레임(design 대 scan)마다
   * 다시 배정되므로, 값과 프레임이 짝이 안 맞으면 다른 물리적 그룹의 값을 갖다 쓰게
   * 된다. "사용자가 체크박스를 눌렀다"(userToggledFrame)와 "로드가 저장된 결과의
   * method에 맞춰 체크박스를 동기화했다"(loadedResult)는 결과적으로 noDesignMode를
   * 똑같이 바꾸지만 리듀서에는 서로 다른 이벤트로 도착한다 — 이 구분이 없으면(예:
   * noDesignMode 하나만 보는 useEffect) 로드 직후의 동기화가 "사용자가 눌렀다"로
   * 오인되어 방금 로드한, 프레임이 이미 맞는 값을 지워버린다(3라운드째 반복된 버그).
   * 자세한 사정은 requiredSpacingState.ts 상단 주석 참조.
   */
  const [requiredSpacingState, dispatchRequiredSpacing] = useReducer(
    requiredSpacingReducer, INITIAL_REQUIRED_SPACING_STATE,
  );

  // ---- 입력 데이터 로드: 설계 + 스캔 + 기존 결과 ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 이 로드가 끝날 때 체크박스를 어디로 맞출지 — null이면 손대지 않는다(저장된
      // 결과가 아예 없어서 판단할 근거가 없는 경우. 이때는 SiteAnalysis가 스캔을 열 때
      // 이미 false로 리셋해 둔 값을 그대로 믿는다). 저장된 유효한 결과를 찾으면 그
      // 결과의 실제 method로, 로드 도중 예외가 나면(전형적으로 저장된 결과 JSON이
      // 깨졌을 때) 안전한 기본값 false로 확정한다 — rebars는 예외 이전에 이미 로드돼
      // 분석은 계속 가능한데 체크박스만 이전 상태의 잔상을 들고 있으면 안 된다.
      let nextNoDesignMode: boolean | null = null;
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
            // 필드가 없는 저장본은 옛 규칙("name") — 그 designId는 prim 경로가 아니라
            // 메시 데이터블록 이름이라 사이드카와 조인되지 않는다 (spec §6.1)
            setSavedIdScheme(prev.idScheme ?? "name");
            const method = prev.registration?.method ?? null;
            setSavedMethod(method);
            // loadedResult는 "지금 모드"와 비교하지 않는다 — 저장된 결과 자신의 method가
            // map의 프레임을 확정하므로 항상 짝이 맞는다. requiredSpacingMm이 아예 없어도
            // 디스패치해 프레임만이라도 맞춰 둔다(다음 analyze()가 참조할 기준이 된다).
            dispatchRequiredSpacing({ type: "loadedResult", method, map: prev.requiredSpacingMm ?? {} });
            if (Array.isArray(prev.registration?.matrix) && prev.registration.matrix.length === 16) {
              setSavedMatrix(prev.registration.matrix);
            }
            // 유효한 저장 결과를 찾았을 때만 체크박스를 그 결과의 실제 방식에 맞춘다.
            nextNoDesignMode = method === "none";
          }
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          nextNoDesignMode = false;
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          if (nextNoDesignMode !== null) onNoDesignModeChange(nextNoDesignMode);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [arId, scan.site_id, scan.scan_id, onNoDesignModeChange]);

  // ---- 분석 실행 ----
  const analyze = useCallback(
    async (manualInit?: Mat4) => {
      if (!designRebars || !scanRebars) return;
      setError(null);
      setSaveWarning(null);
      // 지금 이 실행이 어느 프레임인지, 그리고 requiredSpacingState의 map이 그
      // 프레임에서 나온 게 맞는지 — 맞을 때만 쓴다. 어긋나면(예: 설계 모드에서 만든
      // 값이 아직 state에 남아 있는데 스캔 모드로 막 전환한 직후) 빈 값에서 시작해
      // 그룹 실측 중앙값 폴백에 맡긴다.
      const currentFrame: FrameSource = noDesignMode ? "scan" : "design";
      const usable = usableRequiredSpacing(requiredSpacingState, currentFrame);
      try {
        const out = await run({
          design: designRebars, scan: scanRebars,
          toleranceMm: tolerance, up: [0, 1, 0], manualInit,
          requiredSpacingMm: usable,
          // 발주처 13개 현장 전부 built-in 설계모델이 없다(전부 ar_type:"visual", site 1은
          // 아예 바닥판) — 그 프레임을 벽 분석에 쓰면 간격이 무의미해진다. 체크박스가 켜져
          // 있으면 설계를 아예 읽지 않고 스캔 자신의 형상에서 프레임을 뽑는다.
          frameSource: noDesignMode ? "scan" : undefined,
        });
        // 표시용 간략명 부여 (세로-내측-1 …) — 저장 결과에도 포함되도록 출력을 교체.
        // 방향군은 파이프라인이 이미 뽑아 out.families로 내보낸다 — 다시 뽑지 않는다.
        // frameSource:"scan"에서는 designClassified가 빈 배열이라 assignLabels가 만들
        // 라벨도 없다 — rebars 자체가 []이므로 그대로 통과해도 안전하다.
        out.rebars = assignLabels(out.rebars, out.designClassified, out.scanTransformed, out.families);
        setOutput(out);
        setSavedRecords(null);
        setSavedMethod(null);
        setSavedIdScheme(null);
        if (!out.registration.failed) {
          // 편차 지도 칩은 기본 체크 상태로 렌더되므로, 사용자가 직접 눌러야만 발동하는
          // onChange 가드로는 "분석 실행 → 지도가 뜨는" 기본 경로에서 한 번도 실행되지
          // 않는다. 설계 고스트가 지도를 덮는 걸 막으려면 분석 성공 시점에도 같은 규칙을
          // 적용해야 한다. 칩의 onChange는 그대로 둬 사용자가 다시 켤 수 있게 한다.
          // ★ 반드시 registration.failed 분기 안에서만 실행할 것 — 정합 실패 시엔 지도가
          // 아예 뜨지 않는데(칩도 렌더 안 됨) 여기서 고스트까지 꺼버리면, "자동 정합 실패"
          // 경고가 X/Y/Z/요 수동 입력을 요구하는 바로 그 순간 참조할 설계 형상이 화면에서
          // 사라진다.
          if (showContour) setShowDesign(false);
          // 그룹 실측 중앙값으로 기본값을 제안하되, 사용자가 이미 입력해 둔(같은 프레임의)
          // 값은 덮지 않는다. 리듀서를 직접 호출해(순수 함수라 부작용 없음) 저장 페이로드에
          // 쓸 merged를 동기적으로 얻고, 같은 이벤트를 dispatch해 실제 state도 갱신한다 —
          // 두 번 계산하지 않고 한 번의 진실을 공유한다.
          const analyzedEvent = {
            type: "analyzed" as const, frame: currentFrame,
            suggested: suggestRequiredSpacing(out.spacing.groups),
          };
          const merged = requiredSpacingReducer(requiredSpacingState, analyzedEvent).map;
          dispatchRequiredSpacing(analyzedEvent);
          const result: AnalysisResult = {
            version: 2, idScheme: "path", scanId: scan.scan_id, arId,
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
    [
      designRebars, scanRebars, tolerance, run, scan.site_id, scan.scan_id, arId,
      requiredSpacingState, showContour, noDesignMode,
    ],
  );

  const changeMetric = useCallback((v: string) => {
    const m = v === "position" ? "position" : "spacing";
    setMetric(m);
    setContourMax(DEFAULT_CONTOUR_MAX[m]);
  }, []);

  // (3차 리뷰, BLOCKING) 여기 있던 "noDesignMode가 바뀌면 requiredSpacing을 비운다"
  // useEffect는 삭제했다 — 그 자리가 버그의 근원이었다. noDesignMode는 사용자가
  // 체크박스를 눌러도, 로드가 저장된 결과의 method에 맞춰 동기화해도 똑같이 바뀌는데,
  // useEffect는 그 결과값만 보므로 둘을 구분할 수 없었다. 로드 직후의 동기화도
  // "사용자가 눌렀다"로 오인해, 방금 loadedResult로 들여온(프레임이 이미 맞는) 값을
  // 지워버렸다 — 발주처 전 현장이 method:"none"으로 저장되는 이 브랜치의 주력
  // 경로에서 항상 벌어졌다. 이제 requiredSpacingState는 userToggledFrame과
  // loadedResult를 서로 다른 이벤트로 받으므로(체크박스 onChange가 전자를, 로드
  // 이펙트가 후자를 디스패치한다) 이 클래스의 버그 자체가 구조적으로 불가능하다.

  // 체크박스가 켜지면 이 화면을 "간격 편차만" 모드로 고정한다 — 위치 편차는 설계 없이는
  // 정의되지 않고(비교 대상이 없다), 정합되지 않은 설계 고스트는 노이즈일 뿐이다.
  useEffect(() => {
    if (!noDesignMode) return;
    setMetric("spacing");
    setContourMax(DEFAULT_CONTOUR_MAX.spacing);
    setShowDesign(false);
  }, [noDesignMode]);

  // 지금 화면에 나와 있는 결과(라이브 우선, 없으면 저장본)가 frameSource:"scan"으로
  // 만들어졌는가 — 판정 위젯(통계 카드·필터 칩·범례·정합 배지)을 숨길지는 체크박스가
  // 아니라 이 값으로 결정한다. 체크박스는 "다음 분석을 어떻게 돌릴지"고, 이 값은
  // "지금 보이는 결과가 실제로 무엇으로 만들어졌는지"라 저장본만 로드된 화면(체크박스는
  // 아직 사용자 조작 전 기본값일 수 있다)에서도 0을 판정 결과처럼 보여주지 않는다.
  const resultIsNoDesign = output
    ? output.registration.method === "none"
    : savedMethod === "none";
  // metric 자체는 체크박스 on 시점에만 "spacing"으로 되돌린다(위 이펙트) — 그 사이
  // 사용자가 다시 만졌거나 이전 설계 모드 결과가 남아 있는 과도기 상태를 렌더링에서까지
  // 신뢰하지 않도록, 실제로 화면에 나온 결과가 설계 없는 결과일 땐 렌더 시점에도
  // "간격 편차"로 강제한다. 위치 편차는 애초에 이 결과에 존재하지 않는다.
  const effectiveMetric = resultIsNoDesign ? "spacing" : metric;

  // ---- 표시 데이터: 라이브 출력 우선, 없으면 저장본. 슬라이더는 재판정만 ----
  const view = useMemo(() => {
    const base = output?.rebars ?? savedRecords;
    if (!base) return null;
    return rejudgeRecords(base, tolerance);
  }, [output, savedRecords, tolerance]);

  /**
   * 요구 간격이 바뀌면 정합을 다시 돌리지 않고 간격만 다시 잰다.
   * 정합 실패 시 null — 컨투어와 같은 기준이다. 실패한 정합의 scanTransformed는 엉뚱한
   * 자리라 간격도 무의미하므로, 지도만 끄고 표에는 숫자를 남기면 안 된다.
   */
  const spacing = useMemo(() => {
    if (!output || output.registration.failed) return null;
    // 여기서는 usableRequiredSpacing으로 프레임을 다시 확인하지 않는다 — 체크박스만
    // 토글된 경우(아직 재분석 전) requiredSpacingState.frame은 output보다 앞서
    // 바뀌지만, 그 순간 map은 이미 비어 있으므로({}, userToggledFrame이 지운다)
    // 폴백(중앙값)으로 안전하게 떨어진다. map이 비어 있지 않은 채로 프레임만
    // 어긋나는 경우는 사용자가 그 사이에 입력칸을 편집했을 때뿐인데, 그 경로는
    // 아래 requiredSpacingStale이 입력칸 자체를 잠가 막는다.
    return computeSpacing(
      output.scanTransformed, output.families, output.wallNormal, requiredSpacingState.map,
    );
  }, [output, requiredSpacingState]);

  /**
   * 위치 편차 지표의 표본: 시공 철근 중점 + 그 철근의 편차.
   * 계층 필터가 스캔 id로 걸러야 하므로 scanId를 함께 들고 다닌다 (spec §6.4.1).
   */
  const positionSamples = useMemo<{ sample: ContourSample; scanId: string }[]>(() => {
    if (!output || !view) return [];
    const byId = new Map(output.scanTransformed.map((r) => [r.id, r]));
    const out: { sample: ContourSample; scanId: string }[] = [];
    for (const rec of view.rebars) {
      if (!rec.scanId || !rec.deviationMm) continue;
      const bar = byId.get(rec.scanId);
      if (!bar) continue;
      // ★ 중심선은 보통 2점이다. line[Math.floor(length/2)]는 중점이 아니라 **끝점**이라
      //   모든 표본이 벽 한쪽 모서리에 몰리고, IDW 반경(0.6m) 밖은 전부 비어 지도가
      //   가느다란 띠 하나로 나온다. 간격 지표와 같은 호길이 중점을 공유해야 두 지표가
      //   같은 자리를 가리킨다.
      out.push({
        sample: { midpoint: barMidpoint(bar), deviationMm: rec.deviationMm.mean },
        scanId: rec.scanId,
      });
    }
    return out;
  }, [output, view]);


  // ---- 철근 계층 트리 (spec §6.2 · §8) ----

  /**
   * 트리에 올릴 설계 철근 id 전체. 분석 전에는 로드된 설계 철근에서,
   * 저장본만 로드된 화면에서는 그 designId에서 온다 — output에 의존하면
   * 재분석 전까지 트리도 비어 있게 된다.
   */
  const taxonomyIds = useMemo(() => {
    if (designRebars && designRebars.length > 0) return designRebars.map((r) => r.id);
    const recs = output?.rebars ?? savedRecords;
    return recs
      ? recs.map((r) => r.designId).filter((x): x is string => x != null)
      : [];
  }, [designRebars, output, savedRecords]);

  /** 사이드카 계층 JSON — 없으면(404·스키마 불일치) 폴백으로 내려간다 */
  const [sidecarMeta, setSidecarMeta] = useState<ReturnType<typeof parseRebarMeta> | null>(null);
  useEffect(() => {
    let cancelled = false;
    setSidecarMeta(null);
    (async () => {
      try {
        const res = await fetch(`/api/rebar-meta?ar_id=${encodeURIComponent(arId)}`);
        if (!res.ok) return; // 404 = 이 모델엔 계층 정보가 없다 → 폴백
        const parsed = parseRebarMeta(await res.json());
        if (cancelled) return;
        if (!parsed.ok) console.warn("[rebar-meta] 스키마 불일치 — 폴백", parsed.errors);
        setSidecarMeta(parsed);
      } catch {
        /* 네트워크 실패도 폴백. 계층은 없으면 없는 대로 동작해야 한다 */
      }
    })();
    return () => { cancelled = true; };
  }, [arId]);

  const { taxonomy, taxonomyNotice } = useMemo<{
    taxonomy: Taxonomy | null;
    taxonomyNotice: string | null;
  }>(() => {
    const recs = view?.rebars ?? null;
    // 「설계모델 없이 분석」 결과는 rebars가 비어 있고 3D가 그리는 것도 설계가 아니라
    // 스캔 철근이다 — 설계 id로 만든 트리를 걸면 키가 하나도 안 맞아 필터가 아무
    // 일도 안 한다. 발주처가 실제로 쓰는 경로이므로 여기서는 스캔 철근이 주체다.
    if (resultIsNoDesign && output && output.scanTransformed.length > 0) {
      return { taxonomy: taxonomyFromClassified(output.scanTransformed), taxonomyNotice: null };
    }
    if (taxonomyIds.length > 0) {
      if (sidecarMeta?.ok) {
        // prim_count 대조. upload_at은 이 화면이 모델 메타를 들고 있지 않아 비교하지
        // 않는다. 우리 개수는 반경·길이 필터와 연결요소 분리를 거친 뒤라 BriconLab의
        // prim 수와 정확히 같으리란 보장이 없으므로, 어긋나도 **버리지 않고 경고만**
        // 한다 — 잘못된 폴백보다 눈에 보이는 경고가 낫다.
        const primCount = new Set(taxonomyIds.map((id) => id.split("#")[0])).size;
        const m = matchesModel(sidecarMeta.data, { primCount });
        const t = taxonomyFromSidecar(sidecarMeta.data, taxonomyIds);
        const notes: string[] = [];
        if (!m.ok) notes.push(m.reason);
        if (t.byId.size === 0) {
          notes.push("계층 정보가 이 모델의 철근과 하나도 연결되지 않았습니다 (prim 경로 불일치).");
        } else if (t.unmatchedPrims.length > 0) {
          notes.push(`계층 정보에만 있고 모델에 없는 철근 ${t.unmatchedPrims.length}개.`);
        }
        if (t.byId.size > 0) {
          return { taxonomy: t, taxonomyNotice: notes.join(" ") || null };
        }
        // 하나도 못 붙었으면 사이드카는 쓸모가 없다 — 폴백으로 내려간다
      }
      const byName = taxonomyFromPrimNames(taxonomyIds);
      if (byName) return { taxonomy: byName, taxonomyNotice: null };
    }
    if (recs && recs.length > 0) {
      return { taxonomy: taxonomyFromGeometry(recs), taxonomyNotice: null };
    }
    return { taxonomy: null, taxonomyNotice: null };
  }, [sidecarMeta, taxonomyIds, view, resultIsNoDesign, output]);

  const treeNodes = useMemo(() => (taxonomy ? buildTree(taxonomy) : []), [taxonomy]);

  const [checkedNodes, setCheckedNodes] = useState<string[]>([]);
  // 트리가 갈리면(재분석·모델 변경) 전부 체크 상태로 되돌린다 — 이전 트리의 value가
  // 남으면 새 트리에서는 아무것도 안 고르는 상태가 되고, 증상은 "3D가 비었다"뿐이다.
  useEffect(() => {
    setCheckedNodes(allValues(treeNodes));
  }, [treeNodes]);

  const totalTreeIds = useMemo(
    () => treeNodes.reduce((n, x) => n + x.count, 0),
    [treeNodes],
  );
  /** 체크된 노드가 가리키는 Rebar.id 집합. 필터가 안 걸렸으면 null(전체 표시) */
  const visibleDesignIds = useMemo(() => {
    if (treeNodes.length === 0) return null;
    const set = visibleIdsFromChecked(treeNodes, new Set(checkedNodes));
    return set.size === totalTreeIds ? null : set;
  }, [treeNodes, checkedNodes, totalTreeIds]);

  /**
   * 트리 선택(설계 id 공간) → 뷰어 키 공간 변환.
   *
   * noDesign 결과에서는 트리 자체가 스캔 철근으로 만들어져(위) 키가 이미 뷰어 키다.
   * 설계 경로에서는 뷰어 키가 `designId ?? scanId`라 매핑이 필요하다.
   *
   * ★ 도면 외(designId=null)는 트리에 노드가 없으므로 **항상 보인다.** 안 그러면
   *   어떤 필터를 켜든 「도면 외」가 통째로 사라지는데 미시공은 남아, 화면이 한쪽으로
   *   편향된 거짓을 말하게 된다.
   */
  const visibleViewerKeys = useMemo<ReadonlySet<string> | null>(() => {
    if (!visibleDesignIds) return null;
    if (resultIsNoDesign) return visibleDesignIds;
    const out = new Set<string>();
    for (const rec of view?.rebars ?? []) {
      const key = rec.designId ?? rec.scanId ?? "";
      if (rec.designId == null || visibleDesignIds.has(rec.designId)) out.add(key);
    }
    return out;
  }, [visibleDesignIds, resultIsNoDesign, view]);

  /** 필터가 걸린 동안 보이는 스캔 철근 id — 컨투어 표본을 거를 때 쓴다 (spec §6.4.1) */
  const visibleScanIds = useMemo<ReadonlySet<string> | null>(() => {
    if (!visibleDesignIds) return null;
    if (resultIsNoDesign) return visibleDesignIds;
    const out = new Set<string>();
    for (const rec of view?.rebars ?? []) {
      if (!rec.scanId) continue;
      if (rec.designId == null || visibleDesignIds.has(rec.designId)) out.add(rec.scanId);
    }
    return out;
  }, [visibleDesignIds, resultIsNoDesign, view]);

  /**
   * 필터가 걸린 동안의 통계.
   *
   * 판정 카운트와 편차 평균·최대는 **같은 모집단**으로 함께 다시 계산한다 —
   * 카운트만 다시 세고 편차는 전체 기준으로 두면 "미시공 0 · 허용초과 0 · 최대
   * 61mm" 같은 자기모순이 나오고, 그 61mm는 화면에 보이지도 않는 철근의 값이다.
   *
   * 간격 통계(중앙값 등)는 **다시 계산하지 않는다** — 간격은 인접 쌍이라 가운데
   * 철근을 빼면 양옆이 새 이웃이 되어 값 자체가 달라진다.
   */
  const filteredSummary = useMemo(() => {
    if (!view || !visibleViewerKeys) return null;
    let missing = 0, outOfTolerance = 0, extra = 0, matched = 0;
    let sum = 0, n = 0, max = -Infinity;
    for (const rec of view.rebars) {
      const key = rec.designId ?? rec.scanId ?? "";
      if (!visibleViewerKeys.has(key)) continue;
      if (rec.verdict === "missing") missing += 1;
      else if (rec.verdict === "out_of_tolerance") outOfTolerance += 1;
      else if (rec.verdict === "extra") extra += 1;
      if (rec.designId != null && rec.scanId != null) matched += 1;
      if (rec.deviationMm) {
        sum += rec.deviationMm.mean; n += 1;
        if (rec.deviationMm.max > max) max = rec.deviationMm.max;
      }
    }
    return {
      missing, outOfTolerance, extra, matched,
      deviationMm: n > 0 ? { mean: sum / n, max } : null,
    };
  }, [view, visibleViewerKeys]);

  /** 옛 id 규칙으로 저장된 결과는 사이드카와 조인되지 않는다 */
  const idSchemeNotice =
    savedRecords && !output && savedIdScheme === "name"
      ? "이전 식별 방식으로 저장돼 계층 정보를 붙일 수 없습니다 — 「재분석」을 눌러 주세요."
      : null;

  // ---- 편차 지도(컨투어) 표본 ----
  // ★ 반드시 useMemo로 감쌀 것. 뷰어의 컨투어 이펙트는 이 값의 identity로 갱신을 판단하고,
  //   갱신 때마다 DataTexture·지오메트리·머티리얼을 dispose하고 새로 만든다. 렌더마다 새
  //   ContourField를 만들면 요구간격 입력에 한 글자 칠 때마다 GPU 자원이 갈린다.
  const { contour, contourBlockedReason } = useMemo<{
    contour: ReturnType<typeof buildContourField> | null;
    contourBlockedReason: string | null;
  }>(() => {
    // 정합 실패 시 scanTransformed는 엉뚱한 자리라 간격·평면이 무의미하다 — 지도를 끈다
    if (!output || !showContour || output.registration.failed) {
      return { contour: null, contourBlockedReason: null };
    }
    // ★ 트리 선택은 설계 id 공간, 컨투어 표본은 스캔 id 공간이다. 변환 없이 그대로
    //   거르면 교집합이 항상 공집합이 되어 편차 지도가 통째로 사라진다 (spec §6.4.1).
    const samples: ContourSample[] =
      effectiveMetric === "spacing"
        ? (spacing?.gaps ?? []).filter(
            // 간격은 두 철근 사이의 값이다 — 양 끝이 모두 보일 때만 표본으로 쓴다
            (g) => !visibleScanIds || (visibleScanIds.has(g.aId) && visibleScanIds.has(g.bId)),
          )
        : positionSamples
            .filter((p) => !visibleScanIds || visibleScanIds.has(p.scanId))
            .map((p) => p.sample);

    if (samples.length === 0) {
      return {
        contour: null,
        contourBlockedReason: visibleScanIds
          ? "선택한 철근에는 표본 구간이 없습니다 — 트리에서 더 고르세요."
          : null,
      };
    }
    // 벽면 정사영은 법선 성분을 버린다. 저판·헌치처럼 깊이 방향으로 퍼진 철근만
    // 골라놓으면 깊이가 다른 수십 개가 같은 칸에 겹쳐 무의미한 색 띠가 나온다.
    //
    // ★ 필터가 걸린 경우에만 본다. 무필터 상태의 지도는 이 기능 이전부터 그렇게
    //   그려져 왔고(바닥판 스캔은 퍼짐이 늘 임계를 넘는다), 필터 기능이 기존 화면을
    //   말없이 꺼버리면 그건 이 작업의 범위를 넘는 회귀다. 부위별 평면은 범위 밖(§10).
    if (visibleScanIds && normalSpread(samples, output.plane) > MAX_NORMAL_SPREAD_M) {
      return {
        contour: null,
        contourBlockedReason:
          "이 부위는 벽면 지도에 투영할 수 없습니다 (깊이 방향 정보 손실).",
      };
    }
    return { contour: buildContourField(samples, output.plane), contourBlockedReason: null };
  }, [output, showContour, effectiveMetric, spacing, positionSamples, visibleScanIds]);

  /** 요구 간격 입력 폼에 띄울 그룹 목록 */
  const spacingGroups = spacing?.groups.filter((g) => g.count > 0) ?? [];
  const familyLabel = useCallback(
    (id: string) => output?.families.find((f) => f.id === id)?.label ?? id,
    [output],
  );

  // spacingGroups(요구 간격 입력칸의 키)는 output에서 나온다 — 그 프레임은
  // output.registration.method가 확정한다. 체크박스를 토글하면 requiredSpacingState
  // .frame은 즉시 바뀌지만 output은 다음 재분석까지 이전 프레임 그대로다. 그 사이
  // (토글 후 재분석 전) 이 표에 입력하면, 표의 키는 옛 프레임인데 값은 새 프레임의
  // map으로 들어가 같은 키가 물리적으로 다른 그룹을 가리키는 조작된 편차가 나온다
  // (리뷰 실측: 슬래브 프레임의 h1/inner가 스캔 프레임의 h1/inner와 다른 그룹).
  // 두 프레임이 어긋나 있으면 입력칸을 잠근다 — 지금 보이는 표는 "다른 결과"이므로
  // 의미 있게 편집할 수 없다는 뜻이다.
  const outputFrame: FrameSource | null = output ? frameOfMethod(output.registration.method) : null;
  const requiredSpacingStale = outputFrame !== null && outputFrame !== requiredSpacingState.frame;

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
          noDesign={resultIsNoDesign}
          showDesign={showDesign}
          showScanBars={showScanBars}
          showMesh={showMesh}
          meshUrl={meshUrl}
          registrationMatrix={output?.registration.failed ? null : output?.registration.matrix ?? savedMatrix}
          contour={contour}
          contourMax={contourMax}
          focusKey={focusKey}
          visibleKeys={visibleViewerKeys}
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
            {/* 정합 실패 시엔 아예 내보내지 않는다. 칩만 남기면 눌러도 지도는 안 뜨는데
                설계 고스트만 사라져, 수동 초기정합에 필요한 참조가 화면에서 없어진다. */}
            {output && !output.registration.failed && (
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
          {/* 판정별 필터 (시공 철근을 켰을 때만 의미 있음) — 설계모델 없이 분석한
              결과는 판정 자체가 없다(전부 verdict:undefined인 빈 배열)이므로 필터가
              고를 게 없다. */}
          {!resultIsNoDesign && (
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
          )}
        </Stack>

        {/* 색상 범례 */}
        <Paper
          withBorder radius="sm" p={8}
          style={{ position: "absolute", top: 8, right: 8, background: "rgba(255,255,255,0.92)" }}
        >
          <Text size="xs" fw={700} mb={4}>색상 안내</Text>
          {/* 지도가 실제로 그려질 때만 — 눈금만 뜨고 색은 없는 상태를 만들지 않는다 */}
          {contour && (
            <Box mb={8}>
              <Text size="xs" fw={600} mb={3}>
                {effectiveMetric === "spacing" ? "간격 편차" : "위치 편차"} (mm)
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
            {/* 판정 색은 설계 대비 매칭 결과다 — 설계모델 없이 분석한 결과에는 애초에
                존재하지 않으므로 범례에서도 뺀다(색이 안 쓰이는데 범례만 남으면 판정이
                된 것처럼 보인다). */}
            {resultIsNoDesign ? (
              // 판정색이 아닌 중립색(AnalysisViewer가 실제로 그리는 색과 동일 출처)임을
              // 범례에서도 밝힌다 — 정상/도면외 같은 판정 팔레트와 헷갈리지 않게.
              <LegendRow color={LAYER_COLOR.asBuilt} label="시공 철근 (판정 없음)" />
            ) : (
              <>
                <LegendRow color={LAYER_COLOR.pass} label="정상 (허용오차 이내)" />
                <LegendRow color={LAYER_COLOR.out_of_tolerance} label="허용초과" />
                <LegendRow color={LAYER_COLOR.missing} label="미시공 (설계 위치)" />
                <LegendRow color={LAYER_COLOR.extra} label="도면 외 (설계에 없음)" />
              </>
            )}
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
        <Tabs defaultValue="analysis" keepMounted={false}>
          <Tabs.List grow>
            <Tabs.Tab value="analysis">분석</Tabs.Tab>
            <Tabs.Tab value="rebars">
              철근
              {visibleDesignIds && (
                <Badge size="xs" variant="filled" color="orange" ml={6}>
                  필터
                </Badge>
              )}
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="rebars" pt="sm">
            <Stack gap="xs">
              <RebarTree
                nodes={treeNodes}
                checked={checkedNodes}
                onCheckedChange={setCheckedNodes}
                source={taxonomy?.source ?? "geometry"}
                notice={idSchemeNotice ?? taxonomyNotice}
              />
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="analysis" pt="sm">
            <Stack gap="sm">
        <Group gap="xs">
          <Button size="xs" onClick={() => void analyze()} loading={stage != null}>
            {stage ? STAGE_LABEL[stage] ?? stage : output || savedRecords ? "재분석" : "분석 실행"}
          </Button>
          {output && (
            <Badge variant="light" color={output.registration.failed ? "red" : "teal"}>
              {output.registration.method === "none"
                ? "정합 생략 (설계모델 미사용)"
                : `정합 RMS ${output.registration.rmsMm.toFixed(1)}mm · ${
                    output.registration.method === "auto" ? "자동" : "수동"
                  }`}
            </Badge>
          )}
        </Group>

        {/* 발주처 13개 현장 전부 built-in 설계모델이 없다 — 있는 모델을 정합·분류 기준으로
            쓰면(site 1은 아예 바닥판) 간격이 무의미해진다. 체크하면 설계를 아예 읽지 않고
            스캔 자신의 형상에서 벽면 법선·방향군을 뽑아 간격 편차만 잰다. */}
        <Checkbox
          size="xs"
          label="설계모델 없이 분석 (간격 편차만)"
          checked={noDesignMode}
          // 분석이 도는 동안 잠근다 — 요구 간격 입력칸과 같은 이유다(stage != null).
          // 토글하면 noDesignMode(다음 프레임)와 analyze()가 이미 스냅샷한 requiredSpacingState
          // (이번 실행 프레임)가 그 순간부터 어긋난다: merged는 옛 프레임·옛 map으로 클로저에
          // 고정된 채 계산되는데 dispatch는 최신 state에 적용되므로 usable이 빠진 채 PUT되고,
          // noDesignMode ⟺ requiredSpacingState.frame 불변식도 그 사이 잠깐 깨진다. 결과 자체는
          // 항상 프레임 일관됨을 유지해 조작된 편차로 이어지진 않지만(다음 재분석이 정리한다),
          // 같은 이음매에서 다섯 번째로 문제가 났던 자리라 아예 만질 수 없게 막는다.
          disabled={stage != null}
          onChange={(e) => {
            const checked = e.currentTarget.checked;
            onNoDesignModeChange(checked);
            // 사용자가 직접 눌렀다 — userToggledFrame. 로드 이펙트가 같은 noDesignMode를
            // 동기화할 때는(loadedResult) 이 핸들러를 거치지 않으므로 서로 섞이지 않는다.
            dispatchRequiredSpacing({ type: "userToggledFrame", frame: checked ? "scan" : "design" });
          }}
        />

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
            {/* 설계모델 없이 분석한 결과는 이 통계가 전부 0이다 — "미시공 0건"처럼
                실제 판정 결과로 보이면 안 되므로 카드 자체를 숨긴다(값을 0으로 채워
                내보내는 것과 화면에 안 보여주는 것은 다르다 — 저장은 그대로 0으로
                되고, 여기서는 그 0을 "찾아낸 사실"처럼 제시하지 않는다). */}
            {!resultIsNoDesign && (
              <>
                {/* 필터가 걸리면 카운트와 편차를 같은 모집단으로 함께 다시 센다.
                    한쪽만 다시 세면 "미시공 0 · 최대 61mm" 같은 자기모순이 나온다. */}
                {filteredSummary && (
                  <Badge size="xs" variant="light" color="orange">
                    선택한 철근 기준
                  </Badge>
                )}
                <SimpleGrid cols={3} spacing={6}>
                  <StatCard label="설계 철근" value={`${view.summary.designCount}`} />
                  <StatCard label="시공 철근" value={`${view.summary.scanCount}`} />
                  <StatCard label="매칭" value={`${(filteredSummary ?? view.summary).matched}`} />
                  <StatCard label="미시공" value={`${(filteredSummary ?? view.summary).missing}`} tone="red" />
                  <StatCard label="허용초과" value={`${(filteredSummary ?? view.summary).outOfTolerance}`} tone="orange" />
                  <StatCard label="도면 외" value={`${(filteredSummary ?? view.summary).extra}`} tone="blue" />
                </SimpleGrid>
                {(filteredSummary ?? view.summary).deviationMm && (
                  <Text size="xs" c="dimmed">
                    편차 평균 {(filteredSummary ?? view.summary).deviationMm!.mean.toFixed(1)}mm · 최대{" "}
                    {(filteredSummary ?? view.summary).deviationMm!.max.toFixed(1)}mm
                  </Text>
                )}
              </>
            )}

            {/* 위치 편차는 설계 대비 편차라 설계모델 없이는 정의되지 않는다 */}
            {!resultIsNoDesign && (
              <SegmentedControl
                size="xs" fullWidth value={metric} onChange={changeMetric}
                data={[
                  { value: "spacing", label: "간격 편차" },
                  { value: "position", label: "위치 편차" },
                ]}
              />
            )}

            {contourBlockedReason && (
              <Alert color="yellow" p="xs" radius="sm">
                <Text size="xs">{contourBlockedReason}</Text>
              </Alert>
            )}

            <Box>
              <Text size="xs" fw={600} mb={2}>
                컨투어 상한 {contourMax}mm — 최상위 색은 상한의 80%부터, 초과분도 모두 포함
              </Text>
              <Slider min={5} max={200} step={5} value={contourMax} onChange={setContourMax}
                marks={[{ value: 30 }, { value: 50 }, { value: 100 }]} size="sm" />
              <Text size="xs" c="dimmed" mt={2}>
                KDS 10 20 50은 최소 간격만 규정하고 오차 기준이 없어 상한은 사용자가 정합니다.
              </Text>
            </Box>

            {effectiveMetric === "spacing" ? (
              <Box>
                <Text size="xs" fw={600} mb={4}>요구 간격 (mm)</Text>
                <Text size="xs" c="dimmed" mb={4}>
                  순간격 20mm 미만 구간은 이음으로 보고 측정에서 제외됩니다.
                </Text>
                {requiredSpacingStale && (
                  <Text size="xs" c="orange" mb={4}>
                    체크박스를 바꾼 뒤 아직 재분석하지 않았습니다 — 지금 보이는 표는 이전
                    결과라 입력칸을 잠급니다. 「재분석」을 눌러야 다시 고칠 수 있습니다.
                  </Text>
                )}
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
                          // requiredSpacingStale: 표(옛 프레임)와 map(새 프레임)이 어긋난
                          // 동안은 편집을 막는다(위 주석 참조). stage != null: 분석이 도는
                          // 동안은(패널은 계속 조작 가능하다) 편집을 막아, analyze()가
                          // 클로저로 스냅샷한 usable/merged와 화면에 보이는 state가
                          // 갈라지는 걸 애초에 막는다 — 조정보다 경합을 없애는 쪽을 골랐다.
                          disabled={requiredSpacingStale || stage != null}
                          value={requiredSpacingState.map[key] ?? Math.round(g.medianMm / 5) * 5}
                          onChange={(v) => {
                            const n = Number(v);
                            // 빈칸·0·음수는 "지정 안 함"(null)으로 보내 중앙값 폴백을 살린다.
                            // 0을 저장하면 computeSpacing의 `?? med`가 0을 유효값으로 받아
                            // (?? 는 0을 통과시킨다) 그룹 전체가 최상위 색으로 포화된다.
                            const value = Number.isFinite(n) && n > 0 ? n : null;
                            // frame은 이 입력칸이 속한 표를 만든 output의 프레임이다 —
                            // requiredSpacingStale이 이미 입력을 막아 두 값이 어긋나는
                            // 경우가 없어야 하지만, 리듀서에도 같은 가드를 둬(userEdited
                            // 케이스) UI가 놓치더라도 조작된 편차가 새어 들어가지 않게
                            // 이중으로 막는다.
                            dispatchRequiredSpacing({
                              type: "userEdited", key, value, frame: outputFrame ?? requiredSpacingState.frame,
                            });
                          }}
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
                {effectiveMetric === "spacing" && !spacing ? (
                  <Text size="xs" c="dimmed" p="sm">
                    {output?.registration.failed
                      ? "정합에 실패해 간격을 신뢰할 수 없습니다 — 수동 초기정합으로 다시 분석하세요."
                      : "간격은 저장되지 않습니다 — 「재분석」을 눌러야 표시됩니다."}
                  </Text>
                ) : effectiveMetric === "spacing" ? (
                  <Table striped highlightOnHover stickyHeader verticalSpacing={4} fz="xs">
                    <Table.Thead>
                      {visibleScanIds && (
                        <Table.Tr>
                          <Table.Th colSpan={4} style={{ fontWeight: 500 }}>
                            <Text size="xs" c="orange">
                              필터 중 — 간격은 전체 기준입니다 (인접 쌍이라 부분집합으로
                              다시 재면 값 자체가 달라집니다)
                            </Text>
                          </Table.Th>
                        </Table.Tr>
                      )}
                      <Table.Tr>
                        <Table.Th>구간</Table.Th>
                        <Table.Th ta="right">실측</Table.Th>
                        <Table.Th ta="right">요구</Table.Th>
                        <Table.Th ta="right">편차</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {(spacing?.gaps ?? []).map((g) => {
                        // 숨긴 철근이 낀 구간은 흐리게 — 행을 지우지는 않는다.
                        // 지우면 "필터가 간격을 다시 쟀다"는 인상을 주기 때문이다.
                        const dim = !!visibleScanIds &&
                          !(visibleScanIds.has(g.aId) && visibleScanIds.has(g.bId));
                        return (
                        <Table.Tr key={`${g.aId}|${g.bId}`} style={{ opacity: dim ? 0.35 : 1 }}>
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
                        );
                      })}
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
                      {/* 철근 표는 보이는 것만 — 간격 구간 표와 달리 행 하나가
                          철근 하나라 걸러도 다른 행의 숫자가 변하지 않는다 */}
                      {view.rebars.filter((r) => {
                        if (!visibleViewerKeys) return true;
                        return visibleViewerKeys.has(r.designId ?? r.scanId ?? "");
                      }).map((r) => {
                        const key = r.designId ?? r.scanId ?? "";
                        return (
                          <Table.Tr key={key} style={{ cursor: "pointer" }}
                            bg={focusKey === key ? "var(--mantine-color-yellow-0)" : undefined}
                            onClick={() => setFocusKey(key)}>
                            <Table.Td title={key}>{r.label ?? key}</Table.Td>
                            <Table.Td>
                              {/* 저장된 결과를 다시 열면 output이 null이라 familyLabel이 원본
                                  id(v1/h1/d1)를 그대로 반환한다 — 저장 시점에 구운
                                  directionLabel(세로/사재 45° 등)을 우선 쓴다. */}
                              {r.directionLabel ?? familyLabel(r.direction)}·
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
                )}
              </ScrollArea>
            </Paper>
          </>
        )}
            </Stack>
          </Tabs.Panel>
        </Tabs>
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
