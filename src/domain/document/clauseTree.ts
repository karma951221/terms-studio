/**
 * 함수조항 본문 ↔ 문면 편집 트리 (순수) — 함수조항 화면이 문면 저작 에디터를 그대로 쓰게 하는 어댑터 (기능/함수조항 §4.3 · §6.2).
 *
 * 함수조항 본문 노드(`../clause/nodes`)는 문면 노드의 부분집합이다. 다른 점은 셋뿐이라, 편집하는 동안만 문면 트리로 싸서
 * 문면의 편집 명령(`applyEdit`) · 렌더러 · 메뉴를 그대로 쓰고, 저장할 때 함수조항 본문으로 되돌린다.
 *
 * | 함수조항 본문 | 편집 트리 |
 * |---|---|
 * | 본문 전체 | 문서 › 조 하나(`CLAUSE_ARTICLE_ID`) — 조는 사용처 소유라 화면에 그리지 않는 자리일 뿐이다 |
 * | 「문구」(inline) 본문 `Inline[]` | 그 조의 항 하나(`CLAUSE_LINE_ID`)의 문장 — 문장 한 줄 |
 * | 「항」(block) 본문 `Block[]` | 그 조의 자식(항 · 조건 블록) |
 * | `optionSlot` | `clauseInlineRef`(코드 `OPTION_REF_PREFIX + 옵션 코드`) — 옵션 자리 운반체. 함수조항 참조와 같은 「다른 곳의 문구가 들어오는 자리」라 문면 규칙(허용 자리 · 인라인 조건 안 허용)이 같다 |
 * | `articleRef` 보통약관 대상(범위 없음) | `articleRef` + `scope: "general"` |
 * | `articleRef` 제 항 · 호 · 목(`scope: "clause"`) | `articleRef` + `scope: "self"` — 편집 트리의 항 id 가 곧 본문 노드 id |
 * | `switchBlock` · `inlineSwitch`(값별 분기) | `condBlock` · `inlineCond` + `switchOn`(대상 식) — 가지 = 칸(`values` · `empty`, `when` 없음). 조건 가지와 같은 투명 · 자리 · 중첩 규칙을 물려받는다(document/nodes.ts `SwitchCaseMark`) |
 * | `articleRef` 사용처 위치(`scope: "host"`, `"2.1.3"`) | `articleRef` + `scope: "general"` + 대상 `host:2.1.3`(`HOST_TARGET_PREFIX`) — 에디터의 「사용처」 후보 줄 id. 이 문서 밖 대상이라 보통약관 참조처럼 후보 집합(`generalRefs`)으로 검사한다 |
 *
 * 되돌릴 때 함수조항에 없는 것(조 · 관 · 표 · 박스 · 반복 · 구조 표기 · 진짜 함수조항 참조 · 호/목 자리의 조건 블록)이 있으면 거부한다 —
 * 에디터 메뉴가 애초에 싣지 않지만, 저장 직전의 마지막 관문이다. 노드 id 는 그대로 옮긴다(오류 좌표 · 「고칠 자리로」가 같은 id 를 쓴다).
 *
 * DB·React import 금지 (순수층).
 */
import type * as C from "../clause/nodes";
import type { Clause, ClauseBody, ClauseMode } from "../clause/types";
import { CONNECTOR_PLACEHOLDER, ok, reject, type Code, type Result } from "../types";
import type { ArticleNode, BlockNode, BulletListNode, ClauseBlockRefNode, ClauseInlineRefNode, DocumentNode, InlineNode, ItemNode, ParagraphNode, SubitemNode } from "./nodes";
import { numberTree, paragraphLabel, subitemRefLabel, type NodeNumber, type NumberKind, type ReferenceTarget } from "./numbering";

export const CLAUSE_DOCUMENT_ID = "clause-document";
export const CLAUSE_ARTICLE_ID = "clause-article";
/** 「문구」 본문을 담는 항 — 문장 한 줄. */
export const CLAUSE_LINE_ID = "clause-line";
/** 「호」 · 「목」 본문을 담는 항 — 문장 없이 호 목록만 쓰는 자리(화면에는 그 항의 호 목록만 그린다). */
export const CLAUSE_HOST_PARAGRAPH_ID = "clause-host-paragraph";
/** 「목」 본문을 담는 호 — 문장 없이 목 목록만 쓰는 자리. */
export const CLAUSE_HOST_ITEM_ID = "clause-host-item";
/** 옵션 자리 운반체의 코드 접두 — 함수조항 코드(`C0001`)와 겹치지 않는다. */
export const OPTION_REF_PREFIX = "option:";

/** 옵션 자리 운반체인가 — 운반체면 그 옵션 코드. */
export function optionCodeOf(node: InlineNode): Code | undefined {
  return node.kind === "clauseInlineRef" && node.clauseCode.startsWith(OPTION_REF_PREFIX) ? node.clauseCode.slice(OPTION_REF_PREFIX.length) : undefined;
}

/** 사용처 위치 대상의 편집 트리 id 접두 — 「사용처」 후보 줄(`host:1` · `host:2.1.3`)과 같다. */
export const HOST_TARGET_PREFIX = "host:";

export function optionCarrier(id: string, optionCode: Code): ClauseInlineRefNode {
  return { id, kind: "clauseInlineRef", clauseCode: `${OPTION_REF_PREFIX}${optionCode}`, options: {} };
}

// ───────────────────────────── 본문 → 트리 ─────────────────────────────

/** 값별 분기 칸 → 운반 가지 (값 · 「문구 없음」 · 본문). */
function caseToBranch<C, T>(k: C.SwitchCase<C>, child: (c: C) => T): { id: string; values: Code[]; empty?: true; children: T[] } {
  return { id: k.id, values: [...(k.values ?? [])], ...(k.empty ? { empty: true as const } : {}), children: (k.children ?? []).map(child) };
}

/** 운반 가지 → 값별 분기 칸. */
function branchToCase<T, C>(br: { id: string; values?: Code[]; empty?: true; children: readonly T[] }, child: (t: T) => C): C.SwitchCase<C> {
  return { id: br.id, values: [...(br.values ?? [])], ...(br.empty ? { empty: true as const } : {}), children: br.children.map(child) };
}

function inlineToTree(node: C.Inline): InlineNode {
  switch (node.kind) {
    case "optionSlot":
      return optionCarrier(node.id, node.optionCode);
    case "articleRef": {
      const { scope, targets, ...rest } = node;
      if (scope === "host") return { ...rest, targets: targets.map((t) => ({ articleId: `${HOST_TARGET_PREFIX}${t.host ?? ""}` })), scope: "general" };
      if (scope === "clause") return { ...rest, targets: targets.map((t) => ({ articleId: CLAUSE_ARTICLE_ID, ...(t.code !== undefined ? { code: t.code } : {}) })), scope: "self" };
      return { ...rest, targets: targets.map((t) => ({ articleId: t.articleId ?? "", ...(t.code !== undefined ? { code: t.code } : {}), ...(t.innerCode !== undefined ? { innerCode: t.innerCode } : {}), ...(t.restrict !== undefined ? { restrict: structuredClone(t.restrict) } : {}) })), scope: "general" };
    }
    case "inlineCond":
      return { ...node, branches: node.branches.map((br) => ({ ...br, children: br.children.map(inlineToTree) })) };
    case "inlineSwitch":
      return { id: node.id, kind: "inlineCond", switchOn: node.on, branches: node.cases.map((k) => caseToBranch(k, inlineToTree)) };
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

function bulletsToTree(node: C.BulletListNode): BulletListNode {
  return { ...node, children: node.children.map((b) => ({ ...b, children: b.children.map(inlineToTree) })) };
}

function blockToTree(node: C.Block): BlockNode {
  if (node.kind === "switchBlock") return { id: node.id, kind: "condBlock", switchOn: node.on, branches: node.cases.map((k) => caseToBranch(k, blockToTree)) };
  if (node.kind === "condBlock") return { ...node, branches: node.branches.map((br) => ({ ...br, children: br.children.map(blockToTree) })) };
  if (node.kind === "bulletList") return bulletsToTree(node);
  if (node.kind === "boxRef") return node;
  const { items, ...rest } = node;
  return { ...rest, children: node.children.map(inlineToTree), ...(items && items.length > 0 ? { items: items.map((it) => (it.kind === "bulletList" ? bulletsToTree(it) : it.kind === "boxRef" ? it : itemToTree(it))) } : {}) };
}

function itemBodyToTree(node: C.ItemBodyNode): NonNullable<ParagraphNode["items"]>[number] {
  if (node.kind === "switchBlock") return { id: node.id, kind: "condBlock", switchOn: node.on, branches: node.cases.map((k) => caseToBranch(k, itemBodyToTree) as { id: string; children: BlockNode[] }) };
  if (node.kind === "condBlock") return { ...node, branches: node.branches.map((br) => ({ ...br, children: br.children.map(itemBodyToTree) as BlockNode[] })) };
  if (node.kind === "bulletList") return bulletsToTree(node);
  if (node.kind === "boxRef") return node;
  return itemToTree(node);
}

function subitemBodyToTree(node: C.SubitemBodyNode): NonNullable<ItemNode["subitems"]>[number] {
  if (node.kind === "switchBlock") return { id: node.id, kind: "condBlock", switchOn: node.on, branches: node.cases.map((k) => caseToBranch(k, subitemBodyToTree) as { id: string; children: BlockNode[] }) };
  if (node.kind === "condBlock") return { ...node, branches: node.branches.map((br) => ({ ...br, children: br.children.map(subitemBodyToTree) as BlockNode[] })) };
  return subitemToTree(node);
}

/** 본문 → 조 자식 — 유형마다 자리가 다르다(문구 = 항 한 줄의 문장 · 항 = 조 자식 · 호 = 자리 항의 호 목록 · 목 = 자리 호의 목 목록). */
function articleChildrenOf(mode: ClauseMode, body: ClauseBody): BlockNode[] {
  switch (mode) {
    case "inline":
      return [{ id: CLAUSE_LINE_ID, kind: "paragraph", children: (body as C.Inline[]).map(inlineToTree) } satisfies ParagraphNode];
    case "block":
      return (body as C.Block[]).map(blockToTree);
    case "item":
      return [{ id: CLAUSE_HOST_PARAGRAPH_ID, kind: "paragraph", children: [], items: (body as C.ItemBodyNode[]).map(itemBodyToTree) } satisfies ParagraphNode];
    case "subitem":
      return [
        {
          id: CLAUSE_HOST_PARAGRAPH_ID,
          kind: "paragraph",
          children: [],
          items: [{ id: CLAUSE_HOST_ITEM_ID, kind: "item", children: [], subitems: (body as C.SubitemBodyNode[]).map(subitemBodyToTree) }],
        } satisfies ParagraphNode,
      ];
  }
}

/** 함수조항 본문을 편집 트리로 — 제목은 함수조항명(화면에는 그리지 않는다). */
export function clauseBodyToTree(mode: ClauseMode, body: ClauseBody, title = ""): DocumentNode {
  const children = articleChildrenOf(mode, body);
  const article: ArticleNode = { id: CLAUSE_ARTICLE_ID, kind: "article", title: "", children };
  return { id: CLAUSE_DOCUMENT_ID, kind: "document", title, children: [article] };
}

// ───────────────────────────── 사용처 자리의 번호 ─────────────────────────────

/** 유형마다 맨 위 단계 — 사용처에서 그 단계의 번호를 잇는다. 문구 유형은 번호 단계가 없다. */
const TOP_KIND: Partial<Record<ClauseMode, NumberKind>> = { block: "paragraph", item: "item", subitem: "subitem" };

/**
 * 함수조항이 사용처 자리에서 차지하는 수 — 맨 위 단계(항 · 호 · 목)의 수 (2026-10-03 사용자 QA).
 * 모델 번호(`numberTree`)와 같은 셈이라 조건 가지 · 값별 분기 칸은 전부 센다. 빈 본문 · 문구 유형은 1(자리 하나).
 */
export function clauseSpanOf(clause: Pick<Clause, "mode" | "body">): number {
  const kind = TOP_KIND[clause.mode];
  if (!kind) return 1;
  let n = 0;
  for (const num of numberTree(clauseBodyToTree(clause.mode, clause.body)).values()) if (num.kind === kind) n += 1;
  return Math.max(1, n);
}

/** `numberTree` 의 `clauseSpan` — 코드로 함수조항을 찾아 센다. 모르는 함수조항은 undefined(1개로 센다). */
export function clauseSpanBy(clauseOf: (code: Code) => Pick<Clause, "mode" | "body"> | undefined): (ref: ClauseBlockRefNode) => number | undefined {
  const cache = new Map<Code, number | undefined>();
  return (ref) => {
    if (!cache.has(ref.clauseCode)) {
      const clause = clauseOf(ref.clauseCode);
      cache.set(ref.clauseCode, clause ? clauseSpanOf(clause) : undefined);
    }
    return cache.get(ref.clauseCode);
  };
}

/**
 * 함수조항 모델(편집 트리)의 번호 — 사용처 자리 번호 `at` 부터 맨 위 항을 잇는다 (② 자리의 2항 함수조항 → ②③).
 * 자리가 단항(빈 label)이면 항 번호를 찍지 않는다. `at` 이 없으면 모델 혼자 센 번호 그대로.
 * 호 · 목은 목록(CSS 카운터)이 번호를 그리므로 시작 번호는 호출부가 `at.n` 으로 맞춘다.
 */
export function clauseModelNumbers(tree: DocumentNode, at?: Pick<NodeNumber, "n" | "label">): Map<string, NodeNumber> {
  const numbers = numberTree(tree);
  if (!at) return numbers;
  for (const [id, num] of numbers) {
    if (num.kind !== "paragraph" || id === CLAUSE_HOST_PARAGRAPH_ID || id === CLAUSE_LINE_ID) continue;
    const n = at.n + num.n - 1;
    numbers.set(id, { ...num, n, label: at.label === "" ? "" : paragraphLabel(n) });
  }
  return numbers;
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
  clauseInlineRef: "함수조항 참조",
  clauseBlockRef: "함수조항 참조",
  condBlock: "조건 블록",
};

function refuse(kind: string, where: string): never {
  const what = WHAT[kind] ?? kind;
  const why = kind === "clauseInlineRef" || kind === "clauseBlockRef" ? " (중첩 금지)" : kind === "article" || kind === "section" ? " (조는 사용처 소유)" : "";
  throw new NotClause(`함수조항 ${where}에는 ${what}을(를) 둘 수 없습니다${why}`);
}

function inlineFromTree(node: InlineNode): C.Inline {
  switch (node.kind) {
    case "text":
    case "slot":
    case "appendixRef":
      return node;
    case "articleRef": {
      const { scope, targets, ...rest } = node;
      if (scope === "self") {
        // 제 항 · 호 · 목 — 코드만 남긴다(편집 트리의 조는 자리일 뿐). 조 자체를 가리킬 수는 없다
        if (targets.some((t) => t.code === undefined)) throw new NotClause("「이 함수조항」 참조는 제 항 · 호 · 목만 가리킨다 — 조는 사용처 소유다");
        return { ...rest, targets: targets.map((t) => ({ code: t.code })), scope: "clause" };
      }
      // 보통약관 조 또는 사용처 위치 — 한 참조가 둘을 섞지 않는다
      const host = targets.filter((t) => t.articleId.startsWith(HOST_TARGET_PREFIX));
      if (host.length === 0) return { ...rest, targets: targets.map((t) => ({ ...t })) };
      if (host.length !== targets.length) throw new NotClause("조 참조 하나에 보통약관 조와 사용처 위치를 섞을 수 없습니다");
      return { ...rest, targets: host.map((t) => ({ host: t.articleId.slice(HOST_TARGET_PREFIX.length) })), scope: "host" };
    }
    case "clauseInlineRef": {
      const code = optionCodeOf(node);
      if (code === undefined) return refuse(node.kind, "문장 안");
      return { id: node.id, kind: "optionSlot", optionCode: code };
    }
    case "inlineCond":
      if (node.switchOn !== undefined) return { id: node.id, kind: "inlineSwitch", on: node.switchOn, cases: node.branches.map((br) => branchToCase(br, inlineFromTree)) };
      return { ...node, branches: node.branches.map((br) => ({ ...br, children: br.children.map(inlineFromTree) })) };
    default:
      return refuse(node.kind, "문장 안");
  }
}

function subitemFromTree(node: NonNullable<ItemNode["subitems"]>[number]): C.SubitemNode {
  if (node.kind !== "subitem") return refuse(node.kind, "목 자리");
  return { ...node, children: node.children.map(inlineFromTree) };
}

function bulletsFromTree(node: BulletListNode): C.BulletListNode {
  return {
    ...node,
    children: node.children.map((b) => {
      if (b.kind !== "bullet") return refuse(b.kind, "글머리 목록");
      return { ...b, children: b.children.map(inlineFromTree) };
    }),
  };
}

function itemFromTree(node: NonNullable<ParagraphNode["items"]>[number]): C.ItemNode | C.BulletListNode | C.BoxRefNode {
  if (node.kind === "bulletList") return bulletsFromTree(node);
  if (node.kind === "boxRef") return node;
  if (node.kind !== "item") return refuse(node.kind, "호 자리");
  const { subitems, ...rest } = node;
  return { ...rest, children: node.children.map(inlineFromTree), ...(subitems && subitems.length > 0 ? { subitems: subitems.map(subitemFromTree) } : {}) };
}

function blockFromTree(node: BlockNode): C.Block {
  if (node.kind === "condBlock" && node.switchOn !== undefined) return { id: node.id, kind: "switchBlock", on: node.switchOn, cases: node.branches.map((br) => branchToCase(br, blockFromTree)) };
  if (node.kind === "condBlock") return { ...node, branches: node.branches.map((br) => ({ ...br, children: br.children.map(blockFromTree) })) };
  if (node.kind === "bulletList") return bulletsFromTree(node);
  if (node.kind === "boxRef") return node;
  if (node.kind !== "paragraph") return refuse(node.kind, "본문");
  const { items, ...rest } = node;
  return { ...rest, children: node.children.map(inlineFromTree), ...(items && items.length > 0 ? { items: items.map(itemFromTree) } : {}) };
}

function itemBodyFromTree(node: NonNullable<ParagraphNode["items"]>[number]): C.ItemBodyNode {
  if (node.kind === "condBlock" && node.switchOn !== undefined)
    return { id: node.id, kind: "switchBlock", on: node.switchOn, cases: node.branches.map((br) => branchToCase(br as { id: string; values?: Code[]; empty?: true; children: NonNullable<ParagraphNode["items"]> }, itemBodyFromTree)) };
  if (node.kind === "condBlock") return { ...node, branches: node.branches.map((br) => ({ ...br, children: (br.children as NonNullable<ParagraphNode["items"]>).map(itemBodyFromTree) })) };
  return itemFromTree(node);
}

function subitemBodyFromTree(node: NonNullable<ItemNode["subitems"]>[number]): C.SubitemBodyNode {
  if (node.kind === "condBlock" && node.switchOn !== undefined)
    return { id: node.id, kind: "switchBlock", on: node.switchOn, cases: node.branches.map((br) => branchToCase(br as { id: string; values?: Code[]; empty?: true; children: NonNullable<ItemNode["subitems"]> }, subitemBodyFromTree)) };
  if (node.kind === "condBlock") return { ...node, branches: node.branches.map((br) => ({ ...br, children: (br.children as NonNullable<ItemNode["subitems"]>).map(subitemBodyFromTree) })) };
  return subitemFromTree(node);
}

/** 「호」 · 「목」 본문의 자리 항 — 조에 그 항 하나뿐이고 문장이 없어야 한다. 없으면(빈 본문) undefined. */
function hostParagraph(children: readonly BlockNode[], what: string): ParagraphNode | undefined {
  const [host, ...more] = children;
  if (!host) return undefined;
  if (host.kind !== "paragraph" || more.length > 0 || host.children.length > 0) throw new NotClause(`「${what}」 함수조항은 ${what} 목록입니다 — 항 · 문장을 둘 수 없습니다`);
  return host;
}

/** 편집 트리를 함수조항 본문으로 — 함수조항에 없는 노드가 있으면 거부(그 사유 한 줄). */
export function treeToClauseBody(mode: ClauseMode, tree: DocumentNode): Result<ClauseBody> {
  try {
    const [article, ...rest] = tree.children;
    if (!article) return ok([]);
    if (article.kind !== "article") return refuse(article.kind, "본문");
    if (rest.length > 0) return refuse(rest[0]!.kind, "본문");
    if (mode === "block") return ok(article.children.map(blockFromTree));
    if (mode === "item") return ok((hostParagraph(article.children, "호")?.items ?? []).map(itemBodyFromTree));
    if (mode === "subitem") {
      const host = hostParagraph(article.children, "목");
      const [item, ...more] = host?.items ?? [];
      if (!item) return ok([]);
      if (item.kind !== "item" || more.length > 0 || item.children.length > 0) throw new NotClause("「목」 함수조항은 목 목록입니다 — 호 · 문장을 둘 수 없습니다");
      return ok((item.subitems ?? []).map(subitemBodyFromTree));
    }
    const [line, ...more] = article.children;
    if (!line) return ok([]);
    if (line.kind !== "paragraph" || more.length > 0 || (line.items?.length ?? 0) > 0) throw new NotClause("「문구」 함수조항은 문장 한 줄입니다 — 항 · 호 · 목을 둘 수 없습니다");
    return ok(line.children.map(inlineFromTree));
  } catch (error) {
    if (error instanceof NotClause) return reject({ reason: "invalid", issues: [{ kind: "structure", message: error.message, at: {} }] });
    throw error;
  }
}

// ───────────────────────────── 제 항 · 사용처 조 참조 표기 ─────────────────────────────

/** 위치 순번 → 「제1항 제2호 가목」 (첫 단계가 조면 「제2조 제1항 …」). 0 은 자리만 있는 단계(호 · 목 유형의 자리 항 · 호)라 적지 않는다. */
function positionText(parts: readonly number[], fromArticle: boolean): string {
  const units = fromArticle ? ["조", "항", "호"] : ["항", "호"];
  return parts
    .map((n, i) => (n === 0 ? undefined : i < units.length ? `제${n}${units[i]}` : subitemRefLabel(n)))
    .filter((t) => t !== undefined)
    .join(" ");
}

/**
 * 편집 트리(함수조항 본문을 싼 트리)의 항 · 호 · 목 → 본문 안 순번 `[항, 호?, 목?]`. 조건 블록 안도 차례로 센다.
 * 노드 id 와 P코드(`P0100` — 노드 id 와 겹치지 않는 꼴) 둘 다로 찾는다 — 「이 함수조항」 참조는 코드를 저장한다. 같은 코드의 분기 짝은 첫 노드.
 */
export function clausePositions(tree: DocumentNode): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const put = (node: { id: string; code?: Code }, at: number[]) => {
    out.set(node.id, at);
    if (node.code !== undefined && !out.has(node.code)) out.set(node.code, at);
  };
  const article = tree.children[0];
  if (!article || article.kind !== "article") return out;
  let p = 0;
  const block = (n: BlockNode) => {
    if (n.kind === "condBlock") {
      for (const br of n.branches) for (const c of br.children) block(c as BlockNode);
      return;
    }
    if (n.kind !== "paragraph") return;
    // 호 · 목 유형의 자리 항 · 호는 번호 단계가 아니다 — 0 으로 두어 「제2호」 · 「나목」만 적는다
    const pp = n.id === CLAUSE_HOST_PARAGRAPH_ID ? 0 : ++p;
    if (pp > 0) put(n, [pp]);
    let i = 0;
    const items = (list: readonly NonNullable<ParagraphNode["items"]>[number][]) => {
      for (const it of list) {
        if (it.kind === "condBlock") {
          for (const br of it.branches) items(br.children as NonNullable<ParagraphNode["items"]>);
          continue;
        }
        if (it.kind !== "item") continue;
        const ii = it.id === CLAUSE_HOST_ITEM_ID ? 0 : ++i;
        if (ii > 0) put(it, [pp, ii]);
        let u = 0;
        const subitems = (sl: readonly NonNullable<ItemNode["subitems"]>[number][]) => {
          for (const s of sl) {
            if (s.kind === "condBlock") for (const br of s.branches) subitems(br.children as NonNullable<ItemNode["subitems"]>);
            else if (s.kind === "subitem") put(s, [pp, ii, ++u]);
          }
        };
        subitems(it.subitems ?? []);
      }
    };
    items(n.items ?? []);
  };
  for (const c of article.children) block(c);
  return out;
}

/**
 * 함수조항의 제 항 · 사용처 조 참조 표기 (기능/함수조항 §3.5) — 「이 함수조항 제1항」 · 「사용처 제2조 제1항 제3호」.
 * 번호는 본문 안 순번이다(사용처에서는 펼친 자리의 계산 번호로 찍힌다). 편집 트리 노드를 받는다 — 보통약관 참조면 undefined.
 */
export function clauseScopedRefLabel(node: InlineNode, positions: ReadonlyMap<string, number[]>): string | undefined {
  if (node.kind !== "articleRef") return undefined;
  const host = node.scope === "general" && node.targets.length > 0 && node.targets.every((t) => t.articleId.startsWith(HOST_TARGET_PREFIX));
  if (node.scope !== "self" && !host) return undefined;
  const labels = node.targets.map((t) => {
    if (host) return positionText(t.articleId.slice(HOST_TARGET_PREFIX.length).split(".").map(Number), true);
    const at = t.code !== undefined ? positions.get(t.code) : undefined;
    return at ? positionText(at, false) : "없는 항(연결 끊김)";
  });
  const joined = labels.length <= 1 ? (labels[0] ?? "") : `${labels.slice(0, -1).join(", ")} ${node.connector ?? CONNECTOR_PLACEHOLDER} ${labels.at(-1)}`;
  return `${host ? "사용처" : "이 함수조항"} ${joined}`;
}

/** 함수조항 본문 노드 → 편집 트리 노드 (모델 표시가 `clauseScopedRefLabel` 을 쓰게). */
export function clauseInlineToTree(node: C.Inline): InlineNode {
  return inlineToTree(node);
}

/**
 * 「사용처」 후보 — 사용처 문서의 위치(조 · 항 · 호 순번) 줄 목록. 함수조항 에디터의 조 참조 고르기 트리가 쓴다 (기능/함수조항 §3.5).
 * 사용처는 여럿이라 실제 조 제목은 모른다 — 줄은 번호만(「제1조」 · 「제1항」 · 「제3호」).
 */
export function hostTargetIndex(articles = 20, paragraphs = 10, items = 10): Map<string, ReferenceTarget> {
  const out = new Map<string, ReferenceTarget>();
  for (let a = 1; a <= articles; a++) {
    const article = { id: `${HOST_TARGET_PREFIX}${a}`, n: a, title: "" };
    out.set(article.id, { kind: "article", article });
    for (let p = 1; p <= paragraphs; p++) {
      const paragraph = { id: `${article.id}.${p}`, n: p };
      out.set(paragraph.id, { kind: "paragraph", article, paragraph });
      for (let i = 1; i <= items; i++) {
        const item = { id: `${paragraph.id}.${i}`, n: i };
        out.set(item.id, { kind: "item", article, paragraph, item });
      }
    }
  }
  return out;
}

