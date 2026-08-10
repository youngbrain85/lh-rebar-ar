import { NextRequest, NextResponse } from "next/server";

// Server-side proxy for the BriconLab AR model list (plain-HTTP upstream —
// browsers would block it as mixed content from an HTTPS page).
export const dynamic = "force-dynamic";

const BASE = "http://api.briconlab.com:50001";

export async function GET(req: NextRequest) {
  const siteID = req.nextUrl.searchParams.get("site_id");
  if (!siteID) {
    return NextResponse.json({ status: "error", message: "site_id required" }, { status: 400 });
  }
  try {
    const res = await fetch(`${BASE}/analysis/ar-list?site_id=${encodeURIComponent(siteID)}`, {
      cache: "no-store",
    });
    const data = await res.json();
    // ★ 상류 상태코드를 보존한다. 예전에는 res.ok를 보지 않고 본문만 그대로 relay해서,
    //   상류 500(`{"detail":"DB 오류 발생."}`)이 클라이언트에 **200**으로 도착했다.
    //   그러면 화면은 원인 없는 빨간 배너만 띄우고 개발자 도구에도 단서가 없다.
    //   (상류는 모델이 0건인 현장에도 500을 준다 — BriconLab 쪽 수정 대기 중.
    //    그렇다고 여기서 빈 목록으로 뭉개지는 않는다. 진짜 DB 장애를 숨기게 된다.)
    if (!res.ok) {
      const detail = typeof data?.detail === "string" ? data.detail : `upstream ${res.status}`;
      return NextResponse.json(
        { status: "error", message: detail, upstreamStatus: res.status, ar_list: [] },
        { status: res.status },
      );
    }
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { status: "error", message: e instanceof Error ? e.message : String(e), ar_list: [] },
      { status: 502 }
    );
  }
}
