import { list } from "@vercel/blob";
import { NextResponse } from "next/server";

// 단일 스캔의 파일 URL 해석. Blob public URL을 그대로 반환한다 (CORS 허용됨).
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { status: "error", message: "BLOB_READ_WRITE_TOKEN이 설정되지 않았습니다" },
      { status: 500 },
    );
  }
  const params = new URL(req.url).searchParams;
  const siteId = params.get("site_id");
  const scanId = params.get("scan_id");
  if (!siteId || !scanId) {
    return NextResponse.json({ status: "error", message: "site_id, scan_id 필요" }, { status: 400 });
  }
  try {
    const { blobs } = await list({ prefix: `scans/${siteId}/${scanId}/` });
    const find = (suffix: string) => blobs.find((b) => b.pathname.endsWith(suffix))?.url ?? null;
    const rebarsUrl = find("/rebars.json");
    const metaUrl = find("/meta.json");
    if (!rebarsUrl || !metaUrl) {
      return NextResponse.json({ status: "error", message: "스캔을 찾을 수 없습니다" }, { status: 404 });
    }
    const meta = await (await fetch(metaUrl, { cache: "no-store" })).json();
    return NextResponse.json({
      status: "success",
      rebars_url: rebarsUrl,
      mesh_url: find("/mesh.glb"),
      meta,
    });
  } catch (e) {
    return NextResponse.json(
      { status: "error", message: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
