// 허용오차 판정 + 요약 — spec §5.5. rejudgeRecords는 저장된 결과에도 그대로 적용 가능.
import type {
  AnalysisSummary, ClassifiedRebar, GroupSummary, Layer,
  MatchResult, RebarRecord,
} from "./types";

export function buildRecords(
  design: ClassifiedRebar[], scan: ClassifiedRebar[], match: MatchResult,
): RebarRecord[] {
  const records: RebarRecord[] = [];
  for (const p of match.pairs) {
    const d = design[p.designIdx];
    records.push({
      designId: d.id, scanId: scan[p.scanIdx].id,
      direction: d.direction, directionLabel: d.directionLabel, layer: d.layer,
      deviationMm: { mean: p.meanMm, max: p.maxMm },
      verdict: "pass",
    });
  }
  for (const i of match.missingDesign) {
    const d = design[i];
    records.push({
      designId: d.id, scanId: null,
      direction: d.direction, directionLabel: d.directionLabel, layer: d.layer,
      deviationMm: null, verdict: "missing",
    });
  }
  for (const i of match.extraScan) {
    const s = scan[i];
    records.push({
      designId: null, scanId: s.id,
      direction: s.direction, directionLabel: s.directionLabel, layer: s.layer,
      deviationMm: null, verdict: "extra",
    });
  }
  return records;
}

export function rejudgeRecords(
  records: RebarRecord[], toleranceMm: number,
): { rebars: RebarRecord[]; summary: AnalysisSummary } {
  const rebars: RebarRecord[] = records.map((r) =>
    r.deviationMm == null
      ? r
      : { ...r, verdict: r.deviationMm.mean > toleranceMm ? "out_of_tolerance" : "pass" },
  );

  const matched = rebars.filter((r) => r.deviationMm != null);
  const groups: GroupSummary[] = [];
  // 하드코딩된 방향×레이어 조합 대신, 레코드에 실제로 존재하는 조합만 순회한다
  // (경사 주철근·45° 사재군은 방향 개수가 2개로 고정돼 있지 않다)
  const seen = new Map<string, { direction: string; directionLabel: string; layer: Layer }>();
  for (const r of rebars) {
    const key = `${r.direction}/${r.layer}`;
    if (!seen.has(key)) {
      seen.set(key, {
        direction: r.direction,
        directionLabel: r.directionLabel ?? r.direction,
        layer: r.layer,
      });
    }
  }
  for (const { direction, directionLabel, layer } of seen.values()) {
    const g = rebars.filter((r) => r.direction === direction && r.layer === layer);
    const gm = g.filter((r) => r.deviationMm != null);
    groups.push({
      direction,
      directionLabel,
      layer,
      designCount: g.filter((r) => r.designId != null).length,
      scanCount: g.filter((r) => r.scanId != null).length,
      missing: g.filter((r) => r.verdict === "missing").length,
      outOfTolerance: g.filter((r) => r.verdict === "out_of_tolerance").length,
      meanDeviationMm: gm.length
        ? gm.reduce((s, r) => s + r.deviationMm!.mean, 0) / gm.length
        : null,
    });
  }
  const summary: AnalysisSummary = {
    designCount: rebars.filter((r) => r.designId != null).length,
    scanCount: rebars.filter((r) => r.scanId != null).length,
    matched: matched.length,
    missing: rebars.filter((r) => r.verdict === "missing").length,
    extra: rebars.filter((r) => r.verdict === "extra").length,
    outOfTolerance: rebars.filter((r) => r.verdict === "out_of_tolerance").length,
    deviationMm: matched.length
      ? {
          mean: matched.reduce((s, r) => s + r.deviationMm!.mean, 0) / matched.length,
          max: Math.max(...matched.map((r) => r.deviationMm!.max)),
        }
      : null,
    byGroup: groups,
  };
  return { rebars, summary };
}

export function judge(
  design: ClassifiedRebar[], scan: ClassifiedRebar[], match: MatchResult, toleranceMm: number,
): { rebars: RebarRecord[]; summary: AnalysisSummary } {
  return rejudgeRecords(buildRecords(design, scan, match), toleranceMm);
}
