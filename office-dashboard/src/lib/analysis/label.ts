// 표시용 간략명 부여 — 원본 모델의 긴 요소명 대신 "세로-내측-1" 형식으로 보여준다.
// 번호는 (방향군, 레이어) 그룹 내 위치순: 방향군 축이 up에 가까우면 X(벽 길이 방향),
// 아니면 Y(높이) 오름차순. 반환 배열은 그룹·번호순으로 정렬돼 있어 테이블 표시 순서로 그대로 쓴다.
import { samplePolyline } from "./geom";
import type { ClassifiedRebar, DirectionFamily, RebarRecord } from "./types";

const LAYER_KO = { inner: "내측", outer: "외측" } as const;

export function assignLabels(
  records: RebarRecord[],
  design: ClassifiedRebar[],
  scan: ClassifiedRebar[],
  families: DirectionFamily[],
): RebarRecord[] {
  const familyLabel = new Map(families.map((f) => [f.id, f.label]));
  const designById = new Map(design.map((r) => [r.id, r]));
  const scanById = new Map(scan.map((r) => [r.id, r]));

  // 위치 기준: 설계 중심선 우선(미시공 포함), 도면 외는 정합된 스캔 중심선 — 둘 다 설계 좌표계
  const axisOf = new Map(families.map((f) => [f.id, f.axis]));
  const sortPos = (rec: RebarRecord): number => {
    const rebar =
      (rec.designId != null ? designById.get(rec.designId) : undefined) ??
      (rec.scanId != null ? scanById.get(rec.scanId) : undefined);
    if (!rebar) return Number.POSITIVE_INFINITY;
    const mid = samplePolyline(rebar.centerline, 3)[1];
    const ax = axisOf.get(rec.direction);
    // 철근이 뻗은 방향이 수직에 가까우면 x로, 아니면 y로 줄을 세운다
    const vertical = ax ? Math.abs(ax[1]) > Math.SQRT1_2 : true;
    return vertical ? mid[0] : mid[1];
  };

  const withPos = records.map((rec) => ({ rec, pos: sortPos(rec) }));
  withPos.sort((a, b) => {
    if (a.rec.direction !== b.rec.direction) return a.rec.direction < b.rec.direction ? -1 : 1;
    if (a.rec.layer !== b.rec.layer) return a.rec.layer === "outer" ? -1 : 1;
    return a.pos - b.pos;
  });

  const counters = new Map<string, number>();
  return withPos.map(({ rec }) => {
    const groupKey = `${rec.direction}/${rec.layer}`;
    const n = (counters.get(groupKey) ?? 0) + 1;
    counters.set(groupKey, n);
    const dirLabel = familyLabel.get(rec.direction) ?? rec.direction;
    return {
      ...rec,
      directionLabel: dirLabel,
      label: `${dirLabel}-${LAYER_KO[rec.layer]}-${n}`,
    };
  });
}
