import { list } from "@vercel/blob";
import { NextResponse } from "next/server";

// 사이트별 as-built 스캔 목록: scans/<site_id>/*/meta.json을 나열해 메타를 취합.
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
    const scans = await Promise.all(
      metas.map(async (b) => (await fetch(b.url, { cache: "no-store" })).json()),
    );
    scans.sort((a, b) => String(b.uploaded_at).localeCompare(String(a.uploaded_at)));
    return NextResponse.json({ status: "success", scans });
  } catch (e) {
    return NextResponse.json(
      { status: "error", message: e instanceof Error ? e.message : String(e), scans: [] },
      { status: 502 },
    );
  }
}
