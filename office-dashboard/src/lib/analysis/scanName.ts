// 스캔 표시 이름 — 서버(API 응답의 name)와 대시보드가 같은 규칙을 쓰도록 한 곳에 둔다.
// 형식: "<이름> · YYYY-MM-DD HH:mm" (이름이 없으면 "스캔 YYYY-MM-DD HH:mm")

export interface ScanMetaLike {
  scan_id?: string;
  label?: string | null;
  captured_at?: string | null;
  uploaded_at?: string | null;
}

/** ISO8601 → "YYYY-MM-DD HH:mm" (형식이 아니면 빈 문자열) */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso.trim());
  return m ? `${m[1]} ${m[2]}` : "";
}

export function scanDisplayName(meta: ScanMetaLike): string {
  const name = (meta.label ?? "").trim();
  const when = formatWhen(meta.captured_at) || formatWhen(meta.uploaded_at);
  if (name && when) return `${name} · ${when}`;
  if (name) return name;
  if (when) return `스캔 ${when}`;
  return `스캔 ${(meta.scan_id ?? "").slice(0, 8)}`;
}
