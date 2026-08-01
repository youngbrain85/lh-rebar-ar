import { list } from "@vercel/blob";
import { NextResponse } from "next/server";
import { scanDisplayName } from "../../../lib/analysis/scanName";

// 사이트별 as-built 스캔 목록: scans/<site_id>/*/meta.json을 나열해 메타를 취합.
// 응답의 name은 저장값이 아니라 읽을 때 만든다 — 기존 스캔에도 이름이 붙는다.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { status: "error", message: "BLOB_READ_WRITE_TOKEN이 설정되지 않았습니다", scans: [] },
      { status: 500 },
    );
  }
  const siteId = new URL(req.url).searchParams.get("site_id");
  if (!siteId || !/^\d+$/.test(siteId)) {
    return NextResponse.json({ status: "error", message: "site_id 필요", scans: [] }, { status: 400 });
  }
  try {
    const { blobs } = await list({ prefix: `scans/${siteId}/` });
    const metas = blobs.filter((b) => b.pathname.endsWith("/meta.json"));
    const raw = await Promise.all(
      metas.map(async (b) => (await fetch(b.url, { cache: "no-store" })).json()),
    );
    const scans = raw.map((m) => ({ ...m, name: scanDisplayName(m) }));
    scans.sort((a, b) => String(b.uploaded_at).localeCompare(String(a.uploaded_at)));
    return NextResponse.json({ status: "success", scans });
  } catch (e) {
    return NextResponse.json(
      { status: "error", message: e instanceof Error ? e.message : String(e), scans: [] },
      { status: 502 },
    );
  }
}
