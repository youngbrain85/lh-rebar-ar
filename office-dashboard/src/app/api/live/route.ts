import { RoomServiceClient } from "livekit-server-sdk";
import { NextResponse } from "next/server";

// Lists active LiveKit rooms (server-side, using the API secret) so the
// dashboard can badge sites that currently have a live AR session.
export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!url || !key || !secret) {
    return NextResponse.json({ rooms: [], error: "LiveKit not configured" }, { status: 500 });
  }
  try {
    const svc = new RoomServiceClient(url.replace(/^wss?:\/\//, "https://"), key, secret);
    const rooms = await svc.listRooms();
    return NextResponse.json({
      rooms: rooms
        .filter((r) => r.numParticipants > 0)
        .map((r) => ({ name: r.name, participants: r.numParticipants })),
    });
  } catch (e) {
    return NextResponse.json(
      { rooms: [], error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
