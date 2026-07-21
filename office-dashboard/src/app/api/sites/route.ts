import { NextResponse } from "next/server";

// Server-side proxy to the BriconLab API. The dashboard is served over HTTPS;
// browsers block direct calls to the plain-HTTP API (mixed content), so we fetch
// it here on the server and relay the JSON.
export const dynamic = "force-dynamic";

const BASE = "http://api.briconlab.com:50001";

export async function GET() {
  try {
    const res = await fetch(`${BASE}/analysis/site-list`, { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { status: "error", message: e instanceof Error ? e.message : String(e), site_list: [] },
      { status: 502 }
    );
  }
}
