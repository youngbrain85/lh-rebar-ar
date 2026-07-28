import { list, put } from "@vercel/blob";
import { NextResponse } from "next/server";

// 분석결과 JSON 저장/로드 — 재방문 시 재계산을 생략하기 위함 (spec §5.6).
export const dynamic = "force-dynamic";

const SITE_ID_RE = /^\d+$/;
const SCAN_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_LENGTH = 2_000_000;

function keyOf(req: Request): { siteId: string; scanId: string } | null {
  const p = new URL(req.url).searchParams;
  const siteId = p.get("site_id");
  const scanId = p.get("scan_id");
  return siteId && scanId ? { siteId, scanId } : null;
}

function invalidParams() {
  return NextResponse.json(
    { status: "error", message: "site_id, scan_id 형식이 올바르지 않습니다" },
    { status: 400 },
  );
}

function isValidKey(k: { siteId: string; scanId: string }): boolean {
  return SITE_ID_RE.test(k.siteId) && SCAN_ID_RE.test(k.scanId);
}

/** 저장된 AnalysisResult의 최소 형태 검증 (버전 + 필수 필드 타입) */
function isAnalysisResultShape(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return o.version === 1 && Array.isArray(o.rebars) && typeof o.summary === "object" && o.summary !== null;
}

function noToken() {
  return NextResponse.json(
    { status: "error", message: "BLOB_READ_WRITE_TOKEN이 설정되지 않았습니다" },
    { status: 500 },
  );
}

export async function PUT(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return noToken();
  const k = keyOf(req);
  if (!k) return NextResponse.json({ status: "error", message: "site_id, scan_id 필요" }, { status: 400 });
  if (!isValidKey(k)) return invalidParams();

  // 존재하지 않는 스캔에 결과가 쓰이는 것을 방지 — meta.json이 스캔 존재의 증거
  try {
    const { blobs } = await list({ prefix: `scans/${k.siteId}/${k.scanId}/` });
    if (!blobs.some((b) => b.pathname.endsWith("/meta.json"))) {
      return NextResponse.json({ status: "error", message: "스캔이 존재하지 않습니다" }, { status: 404 });
    }
  } catch (e) {
    return NextResponse.json(
      { status: "error", message: "스토리지 조회 실패: " + (e instanceof Error ? e.message : String(e)) },
      { status: 502 },
    );
  }

  const body = await req.text();
  if (body.length > MAX_BODY_LENGTH) {
    return NextResponse.json({ status: "error", message: "본문이 너무 큽니다 (2MB 제한)" }, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return NextResponse.json({ status: "error", message: "JSON 본문이 아닙니다" }, { status: 400 });
  }
  if (!isAnalysisResultShape(parsed)) {
    return NextResponse.json({ status: "error", message: "AnalysisResult 형식이 아닙니다" }, { status: 400 });
  }

  try {
    await put(`scans/${k.siteId}/${k.scanId}/analysis-result.json`, body, {
      access: "public", addRandomSuffix: false, contentType: "application/json",
    });
  } catch (e) {
    return NextResponse.json(
      { status: "error", message: "스토리지 저장 실패: " + (e instanceof Error ? e.message : String(e)) },
      { status: 502 },
    );
  }
  return NextResponse.json({ status: "success" });
}

export async function GET(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return noToken();
  const k = keyOf(req);
  if (!k) return NextResponse.json({ status: "error", message: "site_id, scan_id 필요" }, { status: 400 });
  if (!isValidKey(k)) return invalidParams();
  try {
    const { blobs } = await list({ prefix: `scans/${k.siteId}/${k.scanId}/` });
    const hit = blobs.find((b) => b.pathname.endsWith("/analysis-result.json"));
    if (!hit) return NextResponse.json({ status: "error", message: "결과 없음" }, { status: 404 });
    const data = await (await fetch(hit.url, { cache: "no-store" })).json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { status: "error", message: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
