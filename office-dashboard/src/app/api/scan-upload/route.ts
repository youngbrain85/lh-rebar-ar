import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { parseRebarsJson } from "../../../lib/analysis/rebarsSchema";

// 라이다 스캔 앱이 as-built 철근 번들을 올리는 엔드포인트 (spec §4).
// BriconLab에 동일 스펙 요청 중 (api/SCAN_STORAGE_REQUEST.md) — 구현되면
// 이 라우트 내부만 프록시로 교체한다.
export const dynamic = "force-dynamic";

function err(status: number, message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ status: "error", message, ...extra }, { status });
}

export async function POST(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return err(500, "BLOB_READ_WRITE_TOKEN이 설정되지 않았습니다 (Vercel Blob 연결 필요)");
  }
  const token = process.env.SCAN_UPLOAD_TOKEN;
  if (!token) return err(500, "SCAN_UPLOAD_TOKEN이 설정되지 않았습니다");
  if (req.headers.get("authorization") !== `Bearer ${token}`) {
    return err(401, "인증 실패");
  }

  const form = await req.formData();
  const siteId = form.get("site_id");
  const capturedAt = form.get("captured_at");
  const rebarsFile = form.get("rebars");
  const meshFile = form.get("mesh");
  if (typeof siteId !== "string" || !/^\d+$/.test(siteId)) return err(400, "site_id가 없거나 숫자가 아닙니다");
  if (
    typeof capturedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(capturedAt) ||
    Number.isNaN(Date.parse(capturedAt))
  ) {
    return err(400, "captured_at이 없거나 ISO8601이 아닙니다");
  }
  if (!(rebarsFile instanceof File)) return err(400, "rebars 파일이 없습니다");

  const parsed = parseRebarsJson(await rebarsFile.text());
  if (!parsed.ok) return err(400, "rebars.json 검증 실패", { errors: parsed.errors });

  const scanId = crypto.randomUUID();
  const base = `scans/${siteId}/${scanId}`;
  const opts = { access: "public" as const, addRandomSuffix: false };
  const hasMesh = meshFile instanceof File && meshFile.size > 0;
  const meta = {
    scan_id: scanId,
    site_id: Number(siteId),
    captured_at: capturedAt,
    uploaded_at: new Date().toISOString(),
    rebar_count: parsed.data.rebars.length,
    has_mesh: hasMesh,
  };
  try {
    await put(`${base}/rebars.json`, JSON.stringify(parsed.data), {
      ...opts, contentType: "application/json",
    });
    if (hasMesh) {
      await put(`${base}/mesh.glb`, meshFile, { ...opts, contentType: "model/gltf-binary" });
    }
    await put(`${base}/meta.json`, JSON.stringify(meta), {
      ...opts, contentType: "application/json",
    });
  } catch (e) {
    return err(502, "스토리지 업로드 실패: " + (e instanceof Error ? e.message : String(e)));
  }
  return NextResponse.json({ status: "success", scan_id: scanId, rebar_count: meta.rebar_count });
}
