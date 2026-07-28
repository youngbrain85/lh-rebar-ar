import { put } from "@vercel/blob";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { parseRebarsJson } from "../../../lib/analysis/rebarsSchema";

// 라이다 스캔 앱이 as-built 철근 번들을 올리는 엔드포인트 (spec §4).
// BriconLab에 동일 스펙 요청 중 (api/SCAN_STORAGE_REQUEST.md) — 구현되면
// 이 라우트 내부만 프록시로 교체한다.
export const dynamic = "force-dynamic";

// 라이다 앱은 브라우저 기반 웹 도구(크로스오리진)에서 직접 POST한다.
// 인증이 Bearer 토큰(쿠키 아님)이므로 오리진 와일드카드가 안전하다.
// 에러 응답에도 반드시 붙여야 브라우저가 400/401 본문을 읽을 수 있다.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function err(status: number, message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ status: "error", message, ...extra }, { status, headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return err(500, "BLOB_READ_WRITE_TOKEN이 설정되지 않았습니다 (Vercel Blob 연결 필요)");
  }
  const token = process.env.SCAN_UPLOAD_TOKEN;
  if (!token) return err(500, "SCAN_UPLOAD_TOKEN이 설정되지 않았습니다");
  const provided = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${token}`;
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
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
  return NextResponse.json(
    { status: "success", scan_id: scanId, rebar_count: meta.rebar_count },
    { headers: CORS_HEADERS },
  );
}
