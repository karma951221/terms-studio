/**
 * 공용조항 본문 ↔ 문면 편집 트리 (순수) — 공용조항 화면이 문면 저작 에디터를 그대로 쓰게 하는 어댑터 (기능/공용조항 §4.3 · §6.2).
 *
 * 공용조항 본문 노드(`../clause/nodes`)는 문면 노드의 부분집합이다. 다른 점은 셋뿐이라, 편집하는 동안만 문면 트리로 싸서
 * 문면의 편집 명령(`applyEdit`) · 렌더러 · 메뉴를 그대로 쓰고, 저장할 때 공용조항 본문으로 되돌린다.
 *
 * | 공용조항 본문 | 편집 트리 |
 * |---|---|
 * | 본문 전체 | 문서 › 조 하나(`CLAUSE_ARTICLE_ID`) — 조는 사용처 소유라 화면에 그리지 않는 자리일 뿐이다 |
 * | 「문구」(inline) 본문 `Inline[]` | 그 조의 항 하나(`CLAUSE_LINE_ID`)의 문장 — 문장 한 줄 |
 * | 「항」(block) 본문 `Block[]` | 그 조의 자식(항 · 조건 블록) |
 * | `optionSlot` | `clauseInlineRef`(코드 `OPTION_REF_PREFIX + 옵션 코드`) — 옵션 자리 운반체. 공용조항 참조와 같은 「다른 곳의 문구가 들어오는 자리」라 문면 규칙(허용 자리 · 인라인 조건 안 허용)이 같다 |
 * | `articleRef` (늘 보통약관 대상) | `articleRef` + `scope: "general"` |
 *
 * 되돌릴 때 공용조항에 없는 것(조 · 관 · 표 · 박스 · 반복 · 구조 표기 · 진짜 공용조항 참조 · 호/목 자리의 조건 블록)이 있으면 거부한다 —
 * 에디터 메뉴가 애초에 싣지 않지만, 저장 직전의 마지막 관문이다. 노드 id 는 그대로 옮긴다(오류 좌표 · 「고칠 자리로」가 같은 id 를 쓴다).
 *
 * DB·React import 금지 (순수층).
 */
import type * as C from "../clause/nodes";
import type { ClauseBody, ClauseMode } from "../clause/types";
import { ok, reject, type Code, type Result } from "../types";
import type { ArticleNode, BlockNode, ClauseInlineRefNode, DocumentNode, InlineNode, ItemNode, ParagraphNode, SubitemNode } from "./nodes";

export const CLAUSE_DOCUMENT_ID = "clause-document";
export const CLAUSE_ARTICLE_ID = "clause-article";
/** 「문구」 본문을 담는 항 — 문장 한 줄. */
export const CLAUSE_LINE_ID = "clause-line";
/** 옵션 자리 운반체의 코드 접두 — 공용조항 코드(`C0001`)와 겹치지 않는다. */
export const OPTION_REF_PREFIX = "option:";

/** 옵션 자리 운반체인가 — 운반체면 그 옵션 코드. */
export function optionCodeOf(node: InlineNode): Code | undefined {
  return node.kind === "clauseInlineRef" && node.clauseCode.startsWith(OPTION_REF_PREFIX) ? node.clauseCode.slice(OPTION_REF_PREFIX.length) : undefined;
}

export function optionCarrier(id: string, optionCode: Code): ClauseInlineRefNode {
  return { id, kind: "clauseInlineRef", clauseCode: `${OPTION_REF_PREFIX}${optionCode}`, options: {} };
}

// ───────────────────────────── 본문 → 트리 ─────────────────────────────

function inlineToTree(node: C.Inline): InlineNode {
  switch (node.kind) {
    case "optionSlot":
      return optionCarrier(node.id, node.optionCode);
    case "articleRef":
      return { ...node, scope: "general" };
    case "inlineCond":
      return { ...node, branches: node.branches.map((br) => ({ ...br, children: br.children.map(inlineToTree) })) };
    default:
      return node;
  }
}

function subitemToTree(node: C.SubitemNode): SubitemNode {
  return { ...node, children: node.children.map(inlineToTree) };
}

function itemToTree(node: C.ItemNode): ItemNode {
  const { subitems, ...rest } = node;
  return { ...rest, children: node.children.map(inlineToTree), ...(subitems && subitems.length > 0 ? { subitems: subitems.map(subitemToTree) } : {}) };
}

function blockToTree(node: C.Block): BlockNode {
  if (node.kind === "condBlock") return { ...node, branches: node.branches.map((br) => ({ ...br, children: br.children.map(blockToTree) })) };
  const { items, ...rest } = node;
  return { ...rest, children: node.children.map(inlineToTree), ...(items && items.length > 0 ? { items: items.map(itemToTree) } : {}) };
}

/** 공용조항 본문을 편집 트리로 — 제목은 공용조항명(화면에는 그리지 않는다). */
export function clauseBodyToTree(mode: ClauseMode, body: ClauseBody, title = ""): DocumentNode {
  const children: BlockNode[] =
    mode === "inline"
      ? [{ id: CLAUSE_LINE_ID, kind: "paragraph", children: (body as C.Inline[]).map(inlineToTree) } satisfies ParagraphNode]
      : (body as C.Block[]).map(blockToTree);
  const article: ArticleNode = { id: CLAUSE_ARTICLE_ID, kind: "article", title: "", children };
  return { id: CLAUSE_DOCUMENT_ID, kind: "document", title, children: [article] };
}

// ───────────────────────────── 트리 → 본문 ─────────────────────────────

class NotClause extends Error {}

const WHAT: Record<string, string> = {
  article: "조",
  section: "관",
  table: "표",
  box: "박스",
  forBlock: "반복 블록",
  inlineFor: "문장 안 반복",
  structKey: "구조 표기",
  clauseInlineRef: "공용조항 참조",
  clauseBlockRef: "공용조항 참조",
  condBlock: "조건 블록",
};

function refuse(kind: string, where: string): never {
  const what = WHAT[kind] ?? kind;
  const why = kind === "clauseInlineRef" || kind === "clauseBlockRef" ? " (중첩 금지)" : kind === "article" || kind === "section" ? " (조는 사용처 소유)" : "";
  throw new NotClause(`공용조항 ${where}에는 ${what}을(를) 둘 수 없습니다${why}`);
}

function inlineFromTree(node: InlineNode): C.Inline {
  switch (node.kind) {
    case "text":
    case "slot":
    case "appendixRef":
      return node;
    case "articleRef": {
      const { scope, ...rest } = node;
      if (scope !== "general") throw new NotClause("공용조항의 조 참조는 보통약관의 조 · 항 · 호 · 목만 가리킵니다");
      return rest;
    }
    case "clauseInlineRef": {
      const code = optionCodeOf(node);
      if (code === undefined) return refuse(node.kind, "문장 안");
      return { id: node.id, kind: "optionSlot", optionCode: code };
    }
    case "inlineCond":
      return { ...node, branches: node.branches.map((br) => ({ ...br, children: br.children.map(inlineFromTree) })) };
    default:
      return refuse(node.kind, "문장 안");
  }
}

function subitemFromTree(node: NonNullable<ItemNode["subitems"]>[number]): C.SubitemNode {
  if (node.kind !== "subitem") return refuse(node.kind, "목 자리");
  return { ...node, children: node.children.map(inlineFromTree) };
}

function itemFromTree(node: NonNullable<ParagraphNode["items"]>[number]): C.ItemNode {
  if (node.kind !== "item") return refuse(node.kind, "호 자리");
  const { subitems, ...rest } = node;
  return { ...rest, children: node.children.map(inlineFromTree), ...(subitems && subitems.length > 0 ? { subitems: subitems.map(subitemFromTree) } : {}) };
}

function blockFromTree(node: BlockNode): C.Block {
  if (node.kind === "condBlock") return { ...node, branches: node.branches.map((br) => ({ ...br, children: br.children.map(blockFromTree) })) };
  if (node.kind !== "paragraph") return refuse(node.kind, "본문");
  const { items, ...rest } = node;
  return { ...rest, children: node.children.map(inlineFromTree), ...(items && items.length > 0 ? { items: items.map(itemFromTree) } : {}) };
}

/** 편집 트리를 공용조항 본문으로 — 공용조항에 없는 노드가 있으면 거부(그 사유 한 줄). */
export function treeToClauseBody(mode: ClauseMode, tree: DocumentNode): Result<ClauseBody> {
  try {
    const [article, ...rest] = tree.children;
    if (!article) return ok([]);
    if (article.kind !== "article") return refuse(article.kind, "본문");
    if (rest.length > 0) return refuse(rest[0]!.kind, "본문");
    if (mode === "block") return ok(article.children.map(blockFromTree));
    const [line, ...more] = article.children;
    if (!line) return ok([]);
    if (line.kind !== "paragraph" || more.length > 0 || (line.items?.length ?? 0) > 0) throw new NotClause("「문구」 공용조항은 문장 한 줄입니다 — 항 · 호 · 목을 둘 수 없습니다");
    return ok(line.children.map(inlineFromTree));
  } catch (error) {
    if (error instanceof NotClause) return reject({ reason: "invalid", issues: [{ kind: "structure", message: error.message, at: {} }] });
    throw error;
  }
}
