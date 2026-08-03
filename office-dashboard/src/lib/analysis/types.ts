// 분석 엔진 공용 타입. 이 파일은 순수 타입만 — 런타임 코드 금지.

export type Vec3 = [number, number, number];
/** 길이 16, column-major (three.js Matrix4.elements 호환) */
export type Mat4 = number[];

export interface Rebar {
  id: string;
  /** 2점 이상, 미터 단위 */
  centerline: Vec3[];
  /** 미터 단위 */
  radius: number;
}

export type Direction = "horizontal" | "vertical";

/** 방향군 식별자 — "v1"(세로) "h1"(가로) "d1"(사재) 형태. 설계모델에서 자동 추출된다. */
export type DirectionId = string;

/** 방향군: 대표 축과 표시 이름 */
export interface DirectionFamily {
  id: DirectionId;
  /** "세로" | "가로" | "사재 45°" 등 표시용 */
  label: string;
  /** 부호 정규화된 단위 축 */
  axis: Vec3;
}

export type Layer = "outer" | "inner";
export type ClassifiedRebar = Rebar & { direction: Direction; layer: Layer };

export interface RegistrationResult {
  matrix: Mat4;
  rmsMm: number;
  method: "auto" | "manual";
}

export interface MatchPair {
  designIdx: number;
  scanIdx: number;
  meanMm: number;
  maxMm: number;
}

export interface MatchResult {
  pairs: MatchPair[];
  missingDesign: number[]; // 매칭 안 된 설계 철근 인덱스 → 미시공
  extraScan: number[];     // 매칭 안 된 스캔 철근 인덱스 → 도면 외
}

export type Verdict = "pass" | "out_of_tolerance" | "missing" | "extra";

export interface RebarRecord {
  designId: string | null; // null = 도면 외
  scanId: string | null;   // null = 미시공
  direction: Direction;
  layer: Layer;
  deviationMm: { mean: number; max: number } | null;
  verdict: Verdict;
  /** 표시용 간략명 (예: "수직-내측-1") — assignLabels가 부여, 저장 결과에도 포함 */
  label?: string;
}

export interface GroupSummary {
  direction: Direction;
  layer: Layer;
  designCount: number;
  scanCount: number;
  missing: number;
  outOfTolerance: number;
  meanDeviationMm: number | null;
}

export interface AnalysisSummary {
  designCount: number;
  scanCount: number;
  matched: number;
  missing: number;
  extra: number;
  outOfTolerance: number;
  deviationMm: { mean: number; max: number } | null;
  byGroup: GroupSummary[];
}

export interface AnalysisResult {
  version: 1;
  scanId: string;
  arId: string;
  registration: RegistrationResult;
  toleranceMm: number;
  rebars: RebarRecord[];
  summary: AnalysisSummary;
}

/** 라이다 앱이 업로드하는 rebars.json (spec §4) */
export interface RebarsFile {
  version: 1;
  unit: "m";
  rebars: { id: string; centerline: Vec3[]; radius: number }[];
}
