import { describe, expect, it } from "vitest";
import { matchesModel, parseRebarMeta, type RebarMetaFile } from "./rebarMetaSchema";

const valid = {
  version: 1,
  ar_id: "abc",
  structure: "옹벽",
  rebars: [
    { prim: "/RebarModel/Wall_Front_Vert_01", label: "벽체-전면-수직철근-01",
      path: ["벽체", "전면", "수직철근"], no: 1 },
  ],
};

describe("parseRebarMeta", () => {
  it("유효한 사이드카를 통과시킨다", () => {
    const r = parseRebarMeta(valid);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.rebars[0].path).toEqual(["벽체", "전면", "수직철근"]);
  });

  it("label 없이도 통과한다 — 라벨은 §4.2 규칙으로 조립된다", () => {
    const r = parseRebarMeta({
      ...valid,
      rebars: [{ prim: "/R/WallBase_Haunch_01", path: ["벽체-저판", "보강철근(헌치철근)"], no: 1 }],
    });
    expect(r.ok).toBe(true);
  });

  it("version 2 는 거부한다", () => {
    const r = parseRebarMeta({ ...valid, version: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain("version");
  });

  it("path 가 빈 배열이면 거부한다", () => {
    const r = parseRebarMeta({ ...valid, rebars: [{ prim: "/R/x", path: [] }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain("path는 1단계 이상");
  });

  it("rebars 가 비면 거부한다", () => {
    const r = parseRebarMeta({ ...valid, rebars: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain("rebars가 비어 있음");
  });

  it("빌드 대조 필드는 선택이다", () => {
    const r = parseRebarMeta({ ...valid, model_upload_at: "2026-07-29 20:33:49", prim_count: 60 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.prim_count).toBe(60);
  });
});

describe("matchesModel", () => {
  // BriconLab의 upload_at 실제 형식 — varchar(32), 공백 구분 (DB 실측)
  const meta = { ...valid, model_upload_at: "2026-07-29 20:33:49", prim_count: 60 } as RebarMetaFile;

  it("둘 다 맞으면 통과", () => {
    expect(matchesModel(meta, { uploadAt: "2026-07-29 20:33:49", primCount: 60 }).ok).toBe(true);
  });

  it("구분자만 다른 같은 시각은 통과시킨다 (T vs 공백)", () => {
    // 사이드카를 만드는 쪽이 ISO 관례로 T를 쓸 수 있다. 문자열 완전일치로 보면
    // 같은 빌드인데 "다른 모델"로 판정해 정상 사이드카를 통째로 버린다.
    expect(matchesModel(meta, { uploadAt: "2026-07-29T20:33:49" }).ok).toBe(true);
    const isoMeta = { ...meta, model_upload_at: "2026-07-29T20:33:49" } as RebarMetaFile;
    expect(matchesModel(isoMeta, { uploadAt: "2026-07-29 20:33:49" }).ok).toBe(true);
  });

  it("소수 초·타임존 표기가 붙어도 같은 시각이면 통과", () => {
    expect(matchesModel(meta, { uploadAt: "2026-07-29T20:33:49.000Z" }).ok).toBe(true);
    expect(matchesModel(meta, { uploadAt: "2026-07-29 20:33:49+09:00" }).ok).toBe(true);
  });

  it("upload_at 이 다르면 막는다", () => {
    const r = matchesModel(meta, { uploadAt: "2026-07-30 09:00:00", primCount: 60 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("다른 모델 빌드");
  });

  it("prim 개수가 다르면 막는다", () => {
    const r = matchesModel(meta, { uploadAt: "2026-07-29 20:33:49", primCount: 248 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("철근 개수");
  });

  it("대조 필드가 없는 구버전 사이드카는 통과시킨다", () => {
    expect(matchesModel(valid as RebarMetaFile, { uploadAt: "x", primCount: 1 }).ok).toBe(true);
  });

  it("모델 쪽 정보를 모르면 통과시킨다", () => {
    expect(matchesModel(meta, {}).ok).toBe(true);
  });
});
