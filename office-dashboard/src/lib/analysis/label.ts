// 표시용 간략명 부여 — 원본 모델의 긴 요소명 대신 "세로-내측-1" 형식으로 보여준다.
// 번호는 (방향군, 레이어) 그룹 내 위치순: 각 철근군 축에 수직인 성분으로 줄을 세운다.
// 반환 배열은 그룹·번호순으로 정렬돼 있어 테이블 표시 순서로 그대로 쓴다.
import { dot, samplePolyline } from "./geom";
import type { ClassifiedRebar, DirectionFamily, RebarRecord, Vec3 } from "./types";

const LAYER_KO = { inner: "내측", outer: "외측" } as const;
/** 부동소수 노이즈로 순서가 뒤집히지 않도록 하는 동률 판정 폭(m) — 실제 그룹 내 간격은
 * 수 cm~수십 cm이므로 이보다 훨씬 크다 */
const TIE_EPS = 1e-6;
const cmp = (a: number, b: number) => (Math.abs(a - b) < TIE_EPS ? 0 : a - b);

export function assignLabels(
  records: RebarRecord[],
  design: ClassifiedRebar[],
  scan: ClassifiedRebar[],
  families: DirectionFamily[],
): RebarRecord[] {
  const familyLabel = new Map(families.map((f) => [f.id, f.label]));
  // deriveDirectionFamilies가 up과의 각도 오름차순(세로 → 사재 → 가로)으로 반환하므로,
  // 이 순서를 그대로 그룹 순서로 쓴다 — id 문자열 사전순은 "h1" < "v1"이라 뒤집힌다
  const familyIndex = new Map(families.map((f, i) => [f.id, i]));
  const designById = new Map(design.map((r) => [r.id, r]));
  const scanById = new Map(scan.map((r) => [r.id, r]));

  // 위치 기준: 설계 중심선 우선(미시공 포함), 도면 외는 정합된 스캔 중심선 — 둘 다 설계 좌표계
  const axisOf = new Map(families.map((f) => [f.id, f.axis]));
  // 철근군 축 방향 성분을 제거한 위치 — 같은 축을 따라 늘어선 철근들을 축에 수직한
  // 방향으로 줄 세우기 위함. 세계 좌표축(x/y) 중 하나를 고정으로 고르면 45° 근처에서
  // 부동소수 오차로 정렬 방향이 뒤집힐 수 있어(경계값 코인플립), 축 자체를 기준으로 뺀다.
  const perpPos = (rec: RebarRecord): Vec3 => {
    const rebar =
      (rec.designId != null ? designById.get(rec.designId) : undefined) ??
      (rec.scanId != null ? scanById.get(rec.scanId) : undefined);
    if (!rebar) return [Infinity, Infinity, Infinity];
    const mid = samplePolyline(rebar.centerline, 3)[1];
    const ax = axisOf.get(rec.direction);
    if (!ax) return mid;
    const along = dot(mid, ax);
    return [mid[0] - along * ax[0], mid[1] - along * ax[1], mid[2] - along * ax[2]];
  };

  const withPos = records.map((rec) => ({ rec, pos: perpPos(rec) }));
  withPos.sort((a, b) => {
    if (a.rec.direction !== b.rec.direction) {
      const ai = familyIndex.get(a.rec.direction) ?? Infinity;
      const bi = familyIndex.get(b.rec.direction) ?? Infinity;
      return ai - bi;
    }
    if (a.rec.layer !== b.rec.layer) return a.rec.layer === "outer" ? -1 : 1;
    return cmp(a.pos[0], b.pos[0]) || cmp(a.pos[2], b.pos[2]) || cmp(a.pos[1], b.pos[1]);
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
