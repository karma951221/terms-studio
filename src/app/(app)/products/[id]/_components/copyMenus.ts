/**
 * 조 편집 패널(상품 보통약관 탭 편집 · ADR-0079)의 툴바 · 오른쪽 클릭 목록 — 문면 저작 목록(`placeMenu`)을 그대로 짓고,
 * **조 밖을 바꾸는 항목**을 잠근다(사유 tooltip). 순수 — React 없음 (`copyMenus.test.ts`).
 *
 * 조 사본은 템플릿 조 하나의 제목 · 본문만 갈아 끼운다 — 조 · 관 넣기, 조 자체의 이동 · 복제 · 삭제 · 조건으로 감싸기, 조연결은 없다.
 * 목록이 놓치는 것은 편집기의 안전망(`articleOnlyChange`)이 거부한다.
 */
import type { MenuItem, MenuSections, Place } from "@/app/(app)/documents/[id]/_components/menus";
import type { Id } from "@/domain/types";

export const COPY_REFUSAL = "조 사본은 그 조의 제목 · 본문만 고친다 — 조 · 관을 넣거나 옮기거나 지우는 일은 보통약관 템플릿에서 한다.";

/** 조 · 관을 새로 세우는 항목 — 어느 자리에서든 잠근다. */
const STRUCTURE = new Set(["아래에 조 추가", "이 관에 조 추가", "조 추가", "이 가지에 조 추가", "아래에 관 추가", "관 추가", "조연결…"]);
/** 그 자리 노드 자체를 옮기고 · 베끼고 · 지우는 항목 — 자리가 조(제목) · 관 · 문서면 조 밖을 바꾼다. */
const ARRANGE = new Set(["위로", "아래로", "복제", "삭제", "조건으로 감싸기"]);
const OUTER: ReadonlySet<Place["kind"]> = new Set(["article", "articleTitle", "sectionTitle", "document"]);

export function copyScopeMenu(sections: MenuSections, place: Place, articleId: Id): MenuSections {
  const refuse = (item: MenuItem): boolean => STRUCTURE.has(item.label) || item.wrapTarget === articleId || (OUTER.has(place.kind) && ARRANGE.has(item.label));
  return sections.map((section) => section.map((item) => (refuse(item) ? { ...item, refusal: COPY_REFUSAL } : item)));
}
