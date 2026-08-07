// 철근 계층 사이드카 JSON 검증 — spec §5.1.
// BriconLab 쪽 디버깅을 위해 오류를 필드별 한국어 메시지로 돌려준다
// (rebarsSchema.ts 와 같은 형태).
import { z } from "zod";

const schema = z.object({
  version: z.literal(1),
  ar_id: z.string().min(1),
  /** 대상 USDZ 의 ar-list 상 upload_at — 빌드 대조용 (§5.1 R7) */
  model_upload_at: z.string().optional(),
  /** 그 USDZ 안의 철근 prim 총수 — 빌드 대조용 */
  prim_count: z.number().int().nonnegative().optional(),
  structure: z.string().min(1, "structure(트리 루트 이름)가 비어 있음"),
  rebars: z
    .array(
      z.object({
        prim: z.string().min(1, "prim(USDZ prim 경로)이 비어 있음"),
        label: z.string().optional(),
        path: z.array(z.string().min(1)).min(1, "path는 1단계 이상"),
        no: z.number().int().positive().optional(),
      }),
    )
    .min(1, "rebars가 비어 있음"),
});

export type RebarMetaFile = z.infer<typeof schema>;

export function parseRebarMeta(
  json: unknown,
): { ok: true; data: RebarMetaFile } | { ok: false; errors: string[] } {
  const r = schema.safeParse(json);
  if (!r.success) {
    return {
      ok: false,
      errors: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }
  return { ok: true, data: r.data };
}

/**
 * 사이드카가 이 모델을 대상으로 만들어진 것인지 확인한다.
 *
 * 모델을 다시 내보내면서 **배근만 바뀌고 prim 이름은 그대로**인 경우가 가장 흔한데,
 * 그때 계층 정보가 예전 것이면 조인은 100% 성공하고 라벨만 엉뚱한 철근에 붙는다 —
 * 오류도 경고도 나지 않는다. 대조 필드가 없으면(구버전 사이드카) 통과시킨다.
 */
export function matchesModel(
  meta: RebarMetaFile,
  model: { uploadAt?: string | null; primCount?: number },
): { ok: true } | { ok: false; reason: string } {
  if (meta.model_upload_at && model.uploadAt && meta.model_upload_at !== model.uploadAt) {
    return {
      ok: false,
      reason: `계층 정보가 다른 모델 빌드를 가리킵니다 (계층 ${meta.model_upload_at} ≠ 모델 ${model.uploadAt})`,
    };
  }
  if (meta.prim_count != null && model.primCount != null && meta.prim_count !== model.primCount) {
    return {
      ok: false,
      reason: `철근 개수가 맞지 않습니다 (계층 ${meta.prim_count}개 ≠ 모델 ${model.primCount}개)`,
    };
  }
  return { ok: true };
}
