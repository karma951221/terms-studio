/**
 * 빈 조 빼기 — 펼친 뒤 본문(항 · 표 · 박스 · 글머리 목록)이 0개인 조를 조째 뺀다 (결정 15 · 기능/조립산출 §3.1).
 *
 * - **번호 매기기 전**, 기본계약 대치(`replaceGeneralWithBase`) · 생략 판정(`judgeOmission`) **뒤**에 돈다 —
 *   대치될 보통약관 조는 대치 전에 비워 두므로(booklet `emptyReplaced`) 그 전에 빼면 대치 자리가 사라진다.
 * - 빠진 조를 가리키던 참조 · 조연결은 따로 손대지 않는다 — 번호가 없으니 render 가 기존 규칙(`articleGone`)으로 잡는다.
 * - 오류 노드만 남은 조는 본문이 있는 것으로 본다 — 오류를 가리지 않는다.
 * - **템플릿에서 본문 없이 쓴 조(`authoredEmpty`)는 빼지 않는다** — 「펼친 뒤」 비는 조(조건 · 함수조항이 모두 「문구 없음」)만 뺀다.
 *   본문 없이 쓴 조는 기본계약 대치 자리(제목만 남긴 보통약관 조 — 기본계약이 없으면 대치되지 않은 채 남는다)이거나 쓰는 중인 조다.
 *   그 자리를 빼면 기본계약 없음(`noBaseContract`) 위에 조연결 · 참조의 사라짐 오류가 덧쌓이고 번호가 흔들린다.
 * - 편집기는 빈 조를 그대로 허용한다 (문서 저장 검사와 무관).
 */
import type { BlockNode, DocumentNode } from "../document/nodes";
import type { Id } from "../types";
import type { RArticle, RSection, SInline, SubstitutedDoc } from "./types";

export function dropEmptyArticles(doc: SubstitutedDoc, authoredEmpty: ReadonlySet<Id> = new Set()): { doc: SubstitutedDoc; dropped: Id[] } {
  const dropped: Id[] = [];
  const keep = (a: RArticle<SInline>): boolean => {
    if (a.children.length > 0 || authoredEmpty.has(a.id)) return true;
    dropped.push(a.id);
    return false;
  };
  const children = doc.children.flatMap((c): SubstitutedDoc["children"] => {
    if (c.kind === "article") return keep(c) ? [c] : [];
    if (c.kind === "section") {
      const inner = c.children.filter((a) => a.kind !== "article" || keep(a));
      return [inner.length === c.children.length ? c : ({ ...c, children: inner } satisfies RSection<SInline>)];
    }
    return [c];
  });
  return dropped.length === 0 ? { doc, dropped } : { doc: { ...doc, children }, dropped };
}

/** 템플릿에서 본문 없이 쓴 조 — 최상위 · 관 · 조건 블록 가지 어디든 (`dropEmptyArticles` 가 남긴다). */
export function authoredEmptyArticleIds(doc: DocumentNode): Set<Id> {
  const out = new Set<Id>();
  const walk = (nodes: readonly BlockNode[]): void => {
    for (const n of nodes) {
      if (n.kind === "article") {
        if (n.children.length === 0) out.add(n.id);
      } else if (n.kind === "section") walk(n.children);
      else if (n.kind === "condBlock") for (const b of n.branches) walk(b.children);
    }
  };
  walk(doc.children);
  return out;
}
