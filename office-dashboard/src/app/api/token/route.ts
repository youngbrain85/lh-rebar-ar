import { AccessToken } from "livekit-server-sdk";
import { NextRequest, NextResponse } from "next/server";

// Mints a LiveKit viewer token server-side. The API secret never reaches the
// client — only this short-lived JWT does.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const room = req.nextUrl.searchParams.get("room") || "ar-demo";
  const identity =
    req.nextUrl.searchParams.get("identity") ||
    `office-${Math.random().toString(36).slice(2, 8)}`;
  const name = req.nextUrl.searchParams.get("name") || "오피스";

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;

  if (!apiKey || !apiSecret || !url) {
    return NextResponse.json(
      { error: "LiveKit not configured — set NEXT_PUBLIC_LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET in .env.local" },
      { status: 500 }
    );
  }

  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    name,
    ttl: "4h",
  });
  // Viewer can subscribe (watch) and publish (talk back via mic).
  at.addGrant({
    room,
    roomJoin: true,
    canSubscribe: true,
    canPublish: true,
    canPublishData: true,
  });

  const token = await at.toJwt();
  return NextResponse.json({ token, url, room, identity });
}
