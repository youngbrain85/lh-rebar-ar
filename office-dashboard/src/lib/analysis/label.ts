// 표시용 간략명 부여 — 원본 모델의 긴 요소명 대신 "수직-내측-1" 형식으로 보여준다.
// 번호는 (방향, 레이어) 그룹 내 위치순: 수직근은 X(벽 길이 방향), 수평근은 Y(높이) 오름차순.
// 반환 배열은 그룹·번호순으로 정렬돼 있어 테이블 표시 순서로 그대로 쓴다.
import { samplePolyline } from "./geom";
import type { ClassifiedRebar, RebarRecord } from "./types";

const DIRECTION_KO = { vertical: "수직", horizontal: "수평" } as const;
const LAYER_KO = { inner: "내측", outer: "외측" } as const;

export function assignLabels(
  records: RebarRecord[],
  design: ClassifiedRebar[],
  scan: ClassifiedRebar[],
): RebarRecord[] {
  const designById = new Map(design.map((r) => [r.id, r]));
  const scanById = new Map(scan.map((r) => [r.id, r]));

  // 위치 기준: 설계 중심선 우선(미시공 포함), 도면 외는 정합된 스캔 중심선 — 둘 다 설계 좌표계
  const sortPos = (rec: RebarRecord): number => {
    const rebar =
      (rec.designId != null ? designById.get(rec.designId) : undefined) ??
      (rec.scanId != null ? scanById.get(rec.scanId) : undefined);
    if (!rebar) return Number.POSITIVE_INFINITY;
    const mid = samplePolyline(rebar.centerline, 3)[1];
    return rec.direction === "vertical" ? mid[0] : mid[1];
  };

  const withPos = records.map((rec) => ({ rec, pos: sortPos(rec) }));
  withPos.sort((a, b) => {
    if (a.rec.direction !== b.rec.direction) return a.rec.direction === "vertical" ? -1 : 1;
    if (a.rec.layer !== b.rec.layer) return a.rec.layer === "outer" ? -1 : 1;
    return a.pos - b.pos;
  });

  const counters = new Map<string, number>();
  return withPos.map(({ rec }) => {
    const groupKey = `${rec.direction}/${rec.layer}`;
    const n = (counters.get(groupKey) ?? 0) + 1;
    counters.set(groupKey, n);
    return { ...rec, label: `${DIRECTION_KO[rec.direction]}-${LAYER_KO[rec.layer]}-${n}` };
  });
}
