"use client";

import "@livekit/components-styles";

import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  useConnectionState,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import { ConnectionState, Track } from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Divider,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";

/// Live AR collaboration: joins the LiveKit room, shows the field device's
/// shared AR screen at its native aspect ratio, with voice talk-back.
export default function LiveSession({
  room,
  onLeave,
}: {
  room: string;
  onLeave: () => void;
}) {
  const [conn, setConn] = useState<{ token: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/token?room=${encodeURIComponent(room)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "토큰 발급 실패");
      setConn({ token: data.token, url: data.url });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [room]);

  useEffect(() => {
    void connect();
  }, [connect]);

  if (error) {
    return (
      <Center h="100%">
        <Alert color="red" title="세션 연결 실패">
          <Stack gap="sm">
            <Text size="sm">{error}</Text>
            <Button size="xs" variant="light" onClick={connect}>
              다시 시도
            </Button>
          </Stack>
        </Alert>
      </Center>
    );
  }

  if (!conn) {
    return (
      <Center h="100%">
        <Stack align="center" gap="xs">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            세션 연결 중…
          </Text>
        </Stack>
      </Center>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={conn.url}
      token={conn.token}
      connect
      audio={false}
      video={false}
      onDisconnected={onLeave}
      onError={(e) => setError(e.message)}
      style={{ height: "100%" }}
    >
      <Stage room={room} onLeave={onLeave} />
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
}

type Ping = { id: number; u: number; v: number; cssX: number; cssY: number };

function Stage({ room, onLeave }: { room: string; onLeave: () => void }) {
  const state = useConnectionState();
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const lkRoom = useRoomContext();
  const [micOn, setMicOn] = useState(false);
  const [pings, setPings] = useState<Ping[]>([]);
  const [mode, setMode] = useState<"ping" | "memo">("ping");
  const [pendingMemo, setPendingMemo] = useState<{ u: number; v: number } | null>(null);
  const [memoText, setMemoText] = useState("");
  const stageRef = useRef<HTMLDivElement>(null);

  const tracks = useTracks([Track.Source.ScreenShare, Track.Source.Camera], {
    onlySubscribed: true,
  });
  const fieldTrack = tracks.find((t) => !t.participant.isLocal);
  const connected = state === ConnectionState.Connected;

  const toggleMic = async () => {
    const next = !micOn;
    try {
      await localParticipant.setMicrophoneEnabled(next);
      setMicOn(next);
    } catch {
      /* mic needs a secure context */
    }
  };

  /// Click on the live video → normalized (u,v) within the VIDEO CONTENT
  /// (accounting for object-contain letterboxing) → sent to the field device
  /// over the data channel; the AR app shows a marker at the same spot.
  const annotate = async (e: React.MouseEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    const video = stage?.querySelector("video");
    if (!stage || !video || !video.videoWidth) return;
    const box = stage.getBoundingClientRect();
    const scale = Math.min(box.width / video.videoWidth, box.height / video.videoHeight);
    const cw = video.videoWidth * scale;
    const ch = video.videoHeight * scale;
    const ox = (box.width - cw) / 2;
    const oy = (box.height - ch) / 2;
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    if (x < ox || x > ox + cw || y < oy || y > oy + ch) return; // letterbox area
    const u = (x - ox) / cw;
    const v = (y - oy) / ch;

    if (mode === "memo") {
      // Ask for the memo text; sent on confirm.
      setPendingMemo({ u, v });
      return;
    }

    const ping: Ping = { id: Date.now(), u, v, cssX: x, cssY: y };
    setPings((p) => [...p.slice(-4), ping]);
    setTimeout(() => setPings((p) => p.filter((q) => q.id !== ping.id)), 4000);
    await send({ type: "ping", u, v, from: "office" });
  };

  const send = async (payload: Record<string, unknown>) => {
    try {
      await lkRoom.localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify(payload)),
        { reliable: true, topic: "annotation" }
      );
    } catch {
      /* not connected yet */
    }
  };

  const sendMemo = async () => {
    if (!pendingMemo) return;
    await send({ type: "memo", u: pendingMemo.u, v: pendingMemo.v, text: memoText.trim() });
    setPendingMemo(null);
    setMemoText("");
  };

  return (
    <Group align="stretch" gap="md" h="100%" wrap="nowrap">
      {/* Stage — letterboxed to the phone's native aspect ratio. Click to
          drop a marker on the field device's AR screen. */}
      <Box
        ref={stageRef}
        onClick={annotate}
        style={{
          flex: 1,
          minWidth: 0,
          background: "#0d1526",
          borderRadius: "var(--mantine-radius-md)",
          position: "relative",
          overflow: "hidden",
          cursor: fieldTrack ? "crosshair" : "default",
        }}
      >
        {fieldTrack ? (
          <VideoTrack
            trackRef={fieldTrack}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        ) : (
          <Center h="100%">
            <Stack align="center" gap={6}>
              <Loader size="sm" color="gray" />
              <Text size="sm" c="gray.4">
                현장 기기의 화면 공유를 기다리는 중…
              </Text>
              <Text size="xs" c="gray.6">
                AR 화면 상단의 공유 버튼을 눌러 시작합니다
              </Text>
            </Stack>
          </Center>
        )}
        <Group gap={8} style={{ position: "absolute", top: 12, left: 12 }}>
          <Badge color={connected ? "teal" : "yellow"} variant="filled" size="sm">
            {connected ? "LIVE" : "연결 중"}
          </Badge>
          <Badge color="gray" variant="light" size="sm">
            {room}
          </Badge>
          {fieldTrack && (
            <Badge color="orange" variant="light" size="sm">
              화면 클릭 = 현장에 마커
            </Badge>
          )}
        </Group>
        {pings.map((p) => (
          <div
            key={p.id}
            style={{
              position: "absolute",
              left: p.cssX - 14,
              top: p.cssY - 14,
              width: 28,
              height: 28,
              borderRadius: "50%",
              border: "3px solid #ff8b3d",
              boxShadow: "0 0 12px #ff8b3d",
              pointerEvents: "none",
              animation: "lh-ping 1.2s ease-out infinite",
            }}
          />
        ))}
        <style>{`@keyframes lh-ping { 0% { transform: scale(0.6); opacity: 1; } 100% { transform: scale(1.6); opacity: 0.2; } }`}</style>
      </Box>

      {/* Session panel */}
      <Paper withBorder w={280} p="md" radius="md">
        <Stack gap="sm" h="100%">
          <Text fw={700} size="sm">
            세션 정보
          </Text>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              상태
            </Text>
            <Badge size="sm" color={connected ? "teal" : "yellow"} variant="light">
              {connected ? "연결됨" : String(state)}
            </Badge>
          </Group>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              참가자
            </Text>
            <Text size="sm">{participants.length}명</Text>
          </Group>
          <Divider />
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            참가자 목록
          </Text>
          <ScrollArea style={{ flex: 1 }}>
            <Stack gap={6}>
              {participants.map((p) => (
                <Group key={p.identity} gap={8}>
                  <Box
                    w={8}
                    h={8}
                    style={{
                      borderRadius: 4,
                      background: p.isLocal
                        ? "var(--mantine-color-brand-5)"
                        : "var(--mantine-color-teal-5)",
                    }}
                  />
                  <Text size="sm">
                    {p.name || p.identity}
                    {p.isLocal ? " (나)" : ""}
                  </Text>
                </Group>
              ))}
            </Stack>
          </ScrollArea>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            화면 클릭 동작
          </Text>
          <SegmentedControl
            fullWidth
            size="xs"
            value={mode}
            onChange={(v) => setMode(v as "ping" | "memo")}
            data={[
              { label: "포인터", value: "ping" },
              { label: "📌 메모", value: "memo" },
            ]}
          />
          <Button fullWidth size="xs" variant="default" onClick={() => send({ type: "clearMemos" })}>
            현장 메모 전체 지우기
          </Button>
          <Divider />
          <Button
            fullWidth
            color={micOn ? "red" : "brand"}
            variant={micOn ? "filled" : "light"}
            onClick={toggleMic}
          >
            {micOn ? "🔴 말하는 중 — 끄기" : "🎤 말하기"}
          </Button>
          <Button fullWidth variant="default" onClick={onLeave}>
            세션 나가기
          </Button>
        </Stack>
      </Paper>

      {/* Memo text input — sent to the field device as a world-locked AR pin */}
      <Modal
        opened={pendingMemo != null}
        onClose={() => {
          setPendingMemo(null);
          setMemoText("");
        }}
        title={
          <Text fw={700} size="sm">
            📌 현장 AR 메모
          </Text>
        }
        size="sm"
        centered
      >
        <Stack gap="sm">
          <Text size="xs" c="dimmed">
            클릭한 지점의 실제 표면에 3D 핀으로 고정됩니다
          </Text>
          <TextInput
            placeholder="예: 이 구간 피복 확인 필요"
            value={memoText}
            onChange={(e) => setMemoText(e.currentTarget.value)}
            maxLength={40}
            data-autofocus
            onKeyDown={(e) => {
              if (e.key === "Enter") void sendMemo();
            }}
          />
          <Group justify="flex-end" gap="xs">
            <Button
              variant="default"
              size="xs"
              onClick={() => {
                setPendingMemo(null);
                setMemoText("");
              }}
            >
              취소
            </Button>
            <Button size="xs" onClick={() => void sendMemo()}>
              현장으로 전송
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Group>
  );
}
