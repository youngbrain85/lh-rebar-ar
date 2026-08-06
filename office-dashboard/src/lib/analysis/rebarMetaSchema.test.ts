import { describe, expect, it } from "vitest";
import { matchesModel, parseRebarMeta, type RebarMetaFile } from "./rebarMetaSchema";

const valid = {
  version: 1,
  ar_id: "abc",
  structure: "옹벽",
  rebars: [
    { prim: "/RebarModel/Stem_Front_Vert_01", label: "전벽-전면-수직철근-01",
      path: ["전벽철근", "전면", "수직철근"], no: 1 },
  ],
};

describe("parseRebarMeta", () => {
  it("유효한 사이드카를 통과시킨다", () => {
    const r = parseRebarMeta(valid);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.rebars[0].path).toEqual(["전벽철근", "전면", "수직철근"]);
  });

  it("label 없이도 통과한다 — 라벨은 §4.2 규칙으로 조립된다", () => {
    const r = parseRebarMeta({
      ...valid,
      rebars: [{ prim: "/R/Haunch_01", path: ["헌치철근"], no: 1 }],
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
    const r = parseRebarMeta({ ...valid, model_upload_at: "2026-08-05T10:22:31", prim_count: 60 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.prim_count).toBe(60);
  });
});

describe("matchesModel", () => {
  const meta = { ...valid, model_upload_at: "2026-08-05T10:22:31", prim_count: 60 } as RebarMetaFile;

  it("둘 다 맞으면 통과", () => {
    expect(matchesModel(meta, { uploadAt: "2026-08-05T10:22:31", primCount: 60 }).ok).toBe(true);
  });

  it("upload_at 이 다르면 막는다", () => {
    const r = matchesModel(meta, { uploadAt: "2026-08-06T09:00:00", primCount: 60 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("다른 모델 빌드");
  });

  it("prim 개수가 다르면 막는다", () => {
    const r = matchesModel(meta, { uploadAt: "2026-08-05T10:22:31", primCount: 248 });
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
