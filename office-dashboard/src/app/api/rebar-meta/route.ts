import { NextRequest, NextResponse } from "next/server";

// 철근 계층 사이드카 JSON 프록시 — spec §5.3.
// /api/model 과 같은 이유로 서버를 거친다 (HTTPS→HTTP 혼합 콘텐츠 회피).
//
// ★ 모델(/api/model)은 1시간 캐시하지만 사이드카는 **캐시하지 않는다**.
// 모델과 사이드카가 어긋난 조합이 캐시에 남으면 재현이 어렵고, 증상이
// "라벨이 엉뚱한 철근에 붙는다"라 눈치채기도 어렵다.
export const dynamic = "force-dynamic";

const BASE = "http://api.briconlab.com:50001";

export async function GET(req: NextRequest) {
  const arID = req.nextUrl.searchParams.get("ar_id");
  if (!arID) {
    return NextResponse.json({ error: "ar_id required" }, { status: 400 });
  }
  try {
    const res = await fetch(
      `${BASE}/analysis/rebar-meta?ar_id=${encodeURIComponent(arID)}`,
      { cache: "no-store" },
    );
    // 404는 "이 모델엔 계층 정보가 없다"는 정상 응답이다 — 502로 뭉개지 않고
    // 그대로 전달해야 클라이언트가 폴백(spec §8)으로 넘어갈 수 있다.
    if (res.status === 404) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (!res.ok) {
      return NextResponse.json({ error: `upstream ${res.status}` }, { status: 502 });
    }
    const json = await res.json();
    return NextResponse.json(json, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
