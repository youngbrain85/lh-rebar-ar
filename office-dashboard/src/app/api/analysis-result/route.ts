import { list, put } from "@vercel/blob";
import { NextResponse } from "next/server";

// 분석결과 JSON 저장/로드 — 재방문 시 재계산을 생략하기 위함 (spec §5.6).
export const dynamic = "force-dynamic";

function keyOf(req: Request): { siteId: string; scanId: string } | null {
  const p = new URL(req.url).searchParams;
  const siteId = p.get("site_id");
  const scanId = p.get("scan_id");
  return siteId && scanId ? { siteId, scanId } : null;
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
  const body = await req.text();
  try {
    JSON.parse(body);
  } catch {
    return NextResponse.json({ status: "error", message: "JSON 본문이 아닙니다" }, { status: 400 });
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
