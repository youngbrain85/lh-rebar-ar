// rebars.json 검증 — spec §4. 라이다 앱 디버깅을 위해 오류를 필드별 한국어 메시지로.
import { z } from "zod";
import type { RebarsFile } from "./types";

const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

const schema = z.object({
  version: z.literal(1),
  unit: z.literal("m"),
  rebars: z
    .array(
      z.object({
        id: z.string().min(1),
        centerline: z.array(vec3).min(2, "centerline은 2점 이상"),
        radius: z.number().finite().gt(0).lt(0.1, "radius는 0–0.1m 범위"),
      }),
    )
    .min(1, "rebars가 비어 있음"),
});

export function parseRebarsJson(
  text: string,
): { ok: true; data: RebarsFile } | { ok: false; errors: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["JSON 파싱 실패"] };
  }
  const r = schema.safeParse(json);
  if (!r.success) {
    return {
      ok: false,
      errors: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }
  const ids = new Set<string>();
  for (const rb of r.data.rebars) {
    if (ids.has(rb.id)) return { ok: false, errors: [`중복 id: ${rb.id}`] };
    ids.add(rb.id);
  }
  return { ok: true, data: r.data as RebarsFile };
}
