/**
 * 공용조항 에디터 화면(`/clauses/new` · `/clauses/<code>`)이 서버에서 한 번 읽어 넘기는 재료 (서버 전용).
 *
 * 문면 저작 화면(`/documents/<id>`)과 같은 재료를 같은 방법으로 만든다 — 조건 팝업 문맥 · 값 슬롯 후보 · 별표 · 보통약관(조 참조 후보).
 * 공용조항은 평가 문맥을 갖지 않으므로(늦은 바인딩, 기능/공용조항 §3.3) 담보 트리 없는 문맥이다(보통약관 문면과 같다).
 */
import { buildConditionContext } from "@/app/(app)/documents/[id]/_components/condition/conditionContext";
import type { ConditionContext } from "@/app/(app)/documents/[id]/_components/condition/types";
import { discriminatorResultType } from "@/domain/catalog";
import type { Appendix, DocumentNode } from "@/domain/document";
import type { Id } from "@/domain/types";
import { getServices } from "@/lib/services";

export interface ClauseEditorData {
  appendices: Appendix[];
  condition: ConditionContext;
  slotCandidates: { path: string; label: string }[];
  /** 보통약관 템플릿 — 조 참조 대상(조 · 항 · 호 · 목)의 후보와 번호. MVP 는 한 벌 (기능/공용조항 §5). */
  generals: { id: Id; title: string; tree: DocumentNode }[];
}

export async function loadClauseEditorData(): Promise<ClauseEditorData> {
  const services = getServices();
  const [appendices, discriminators, enums, generalSummaries] = await Promise.all([
    services.document.listAppendices(),
    services.catalog.list(),
    services.catalog.listEnums(),
    services.document.list("general"),
  ]);
  // 값 슬롯은 구분자만 찍고, 결과 타입이 string · enum 인 것만 (기능/문면 §3.4 · 기능/공용조항 §3.3)
  const catalog = new Map(discriminators.map((d) => [d.code, d]));
  const slotCandidates = discriminators.flatMap((def) => {
    const type = discriminatorResultType(def, undefined, catalog);
    return type && (type.kind === "string" || type.kind === "enum") ? [{ path: def.code, label: def.label }] : [];
  });
  const generals: ClauseEditorData["generals"] = [];
  for (const summary of generalSummaries) {
    const doc = await services.document.get(summary.id);
    if (doc && doc.kind === "general") generals.push({ id: doc.id, title: doc.title, tree: doc.tree });
  }
  return { appendices, condition: buildConditionContext({ discriminators, enums }), slotCandidates, generals };
}
