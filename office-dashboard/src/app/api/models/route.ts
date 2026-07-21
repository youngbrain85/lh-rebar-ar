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
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { status: "error", message: e instanceof Error ? e.message : String(e), ar_list: [] },
      { status: 502 }
    );
  }
}
