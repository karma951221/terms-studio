import { attributeKinds } from "@/db/schema";
import { getServices } from "@/lib/services";

/** R11 목록 감사 컬럼 — 도메인 모델에 섞지 않고 화면 조회에서만 붙인다. */
export async function attributeAudits(): Promise<Map<string, { updatedAt: Date; updatedBy: string | null }>> {
  const rows = await getServices().db.select({ code: attributeKinds.code, updatedAt: attributeKinds.updatedAt, updatedBy: attributeKinds.updatedBy }).from(attributeKinds);
  return new Map(rows.map((row) => [row.code, { updatedAt: row.updatedAt, updatedBy: row.updatedBy }]));
}
