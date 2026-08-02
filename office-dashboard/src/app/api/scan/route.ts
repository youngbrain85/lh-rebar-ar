import { del, list } from "@vercel/blob";
import { NextResponse } from "next/server";
import { scanDisplayName } from "../../../lib/analysis/scanName";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    const rawMeta = await (await fetch(metaUrl, { cache: "no-store" })).json();
    const meta = { ...rawMeta, name: scanDisplayName(rawMeta) };
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

// 스캔 삭제 — rebars/mesh/meta/analysis-result를 한 폴더 통째로 지운다.
// 되돌릴 수 없으므로 UI에서 확인 대화상자를 거친 뒤에만 호출한다.
// 인증은 업로드와 같은 규칙: SCAN_UPLOAD_TOKEN이 설정돼 있으면 Bearer 일치를 요구한다.
export async function DELETE(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { status: "error", message: "BLOB_READ_WRITE_TOKEN이 설정되지 않았습니다" },
      { status: 500 },
    );
  }
  const token = process.env.SCAN_UPLOAD_TOKEN;
  if (token && req.headers.get("authorization") !== `Bearer ${token}`) {
    return NextResponse.json({ status: "error", message: "인증 실패" }, { status: 401 });
  }
  const params = new URL(req.url).searchParams;
  const siteId = params.get("site_id");
  const scanId = params.get("scan_id");
  if (!siteId || !/^\d+$/.test(siteId) || !scanId || !UUID_RE.test(scanId)) {
    return NextResponse.json(
      { status: "error", message: "site_id, scan_id 형식이 올바르지 않습니다" },
      { status: 400 },
    );
  }
  try {
    const { blobs } = await list({ prefix: `scans/${siteId}/${scanId}/` });
    if (blobs.length === 0) {
      return NextResponse.json({ status: "error", message: "스캔을 찾을 수 없습니다" }, { status: 404 });
    }
    for (const b of blobs) await del(b.url);
    return NextResponse.json({ status: "success", deleted: blobs.length });
  } catch (e) {
    return NextResponse.json(
      { status: "error", message: "삭제 실패: " + (e instanceof Error ? e.message : String(e)) },
      { status: 502 },
    );
  }
}
