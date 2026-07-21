import { NextRequest, NextResponse } from "next/server";

// Streams a model's USDZ binary through the server (mixed-content workaround)
// for the in-browser three.js viewer. Files are small (~hundreds of KB).
// Note: BriconLab replaced the old /analysis/fbx endpoint with /analysis/usdz.
export const dynamic = "force-dynamic";

const BASE = "http://api.briconlab.com:50001";

export async function GET(req: NextRequest) {
  const arID = req.nextUrl.searchParams.get("ar_id");
  if (!arID) {
    return NextResponse.json({ error: "ar_id required" }, { status: 400 });
  }
  try {
    const res = await fetch(`${BASE}/analysis/usdz?ar_id=${encodeURIComponent(arID)}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ error: `upstream ${res.status}` }, { status: 502 });
    }
    const buf = await res.arrayBuffer();
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
