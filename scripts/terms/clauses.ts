/**
 * 공용조항 오버레이 — 원문에서 여러 담보약관이 되풀이하는 문구를 공용조항으로 따고, 사용처 자리를 참조로 바꾼다
 * (개발 도구 — 제품 기능 아님). 근거: docs/QA/실물재현/알파플러스_모델명세.md §3 · 기능/공용조항 §3.1 · §3.5.
 *
 * - 공용조항 본문은 평문(`text`, `{O01}` = 옵션 자리)에서 만들거나, 원문 한 자리에서 딴다(`from` — 조건 오버레이가 얹힌 뒤).
 *   참조 평문(「보통약관 제N조(…)」 · 【별표N(…)】)은 참조 슬롯이 된다. 공용조항의 조 참조는 보통약관 마스터만 가리킨다(§3.5).
 * - 사용처 자리 바꾸기는 **원자열 대조**다 — 글자 하나 · 참조 노드 하나를 원자로 보고, 공용조항이 고른 옵션으로 펼친 원자열이
 *   사용처 항 안에 그대로 있어야 바꾼다. 못 찾으면 보고하고 건드리지 않는다 (원문과 다른 문장을 조용히 만들지 않는다).
 *   - 「문구」(inline) : 항 안의 첫 등장 구간을 `clauseInlineRef` 하나로. 앞뒤 텍스트는 쪼개 남긴다.
 *   - 「항」(block)   : 항 전체를 `clauseBlockRef` 로. 항의 가능한 렌더(조건 가지별)가 전부 공용조항의 렌더 안에 있어야 한다.
 * - 노드 id 는 결정적이다: 공용조항 본문 `c<번호>-…` · 사용처 참조 `<항 id>-k<순번>` (block 은 `<항 id>-k`).
 */
import type { Block, Inline, ParagraphNode as ClauseParagraph } from "../../src/domain/clause/nodes";
import type { ArticleNode, DocumentNode, InlineNode, ParagraphNode } from "../../src/domain/document/nodes";
import type { Id } from "../../src/domain/types";

import type { ClauseSpec, ClauseUse } from "./config";

/** 조립 JSON(`clauses.json`) 한 건 — 로더가 code · description 을 떼고 서비스에 넘긴다. */
export interface ClauseRecord {
  code: string;
  label: string;
  mode: "inline" | "block";
  description: string;
  body: Inline[] | Block[];
  options: { code: string; label: string; order: number; values: { code: string; label: string; order: number; body: Inline[] }[] }[];
}

const pad2 = (n: number) => String(n).padStart(2, "0");
export const optionCode = (i: number) => `O${pad2(i + 1)}`;
export const valueCode = (i: number) => `V${pad2(i + 1)}`;

// ───────────────────────────── 원자열 ─────────────────────────────

type AnyInline = InlineNode | Inline;

/** 참조 · 슬롯 노드의 원자 키 — 같은 대상이면 같은 키. */
function tokenOf(n: AnyInline): string {
  switch (n.kind) {
    case "articleRef":
      return `〔조:${n.targets.map((t) => t.nodeId).join(",")}:${n.connector}〕`;
    case "appendixRef":
      return `〔별표:${n.appendixCode}〕`;
    case "slot":
      return `〔값:${n.ref}〕`;
    case "clauseInlineRef":
      return `〔공용:${n.clauseCode}〕`;
    default:
      return `〔${n.kind}〕`;
  }
}

/** 옵션 선택지 본문 조회 — (옵션 코드, 선택지 코드) → 인라인. */
type OptionBodies = (optionCode: string) => Inline[];

/**
 * 인라인 목록의 가능한 렌더 원자열 전부 — 조건은 가지마다 갈라진다(가지 없음 = 빈 렌더 포함),
 * 옵션 자리는 고른 선택지 본문으로 펼친다.
 */
export function renderings(list: readonly AnyInline[], options?: OptionBodies): string[][] {
  let out: string[][] = [[]];
  for (const n of list) {
    let alts: string[][];
    if (n.kind === "text") alts = [[...n.text]];
    else if (n.kind === "inlineCond") {
      alts = n.branches.flatMap((b) => renderings(b.children as AnyInline[], options));
      if (n.branches.every((b) => b.when !== undefined)) alts.push([]);
    } else if (n.kind === "optionSlot") {
      if (!options) throw new Error(`옵션 자리 ${n.optionCode} 를 펼칠 선택이 없다`);
      alts = renderings(options(n.optionCode));
    } else alts = [[tokenOf(n)]];
    out = out.flatMap((prefix) => alts.map((alt) => [...prefix, ...alt]));
  }
  return out;
}

const keyOf = (atoms: readonly string[]) => atoms.join("\u0001");

// ───────────────────────────── 공용조항 본문 ─────────────────────────────

/** 평문 → 인라인 (참조 변환은 호출자가 준다). `{O01}` 은 옵션 자리. */
export function inlineBody(text: string, idPrefix: string, convert: (text: string, newId: () => Id) => InlineNode[]): Inline[] {
  let seq = 0;
  const newId = () => `${idPrefix}-x${++seq}`;
  const out: Inline[] = [];
  const parts = text.split(/(\{O\d{2}\})/);
  for (const part of parts) {
    if (part === "") continue;
    const m = /^\{(O\d{2})\}$/.exec(part);
    if (m) {
      out.push({ id: newId(), kind: "optionSlot", optionCode: m[1] });
      continue;
    }
    out.push(...convert(part, newId).map(toClauseInline));
  }
  return out;
}

/** 문면 인라인 → 공용조항 인라인. 조 참조는 보통약관 대상만 (기능/공용조항 §3.5) — scope 를 떼고, self 면 오류. */
export function toClauseInline(n: InlineNode): Inline {
  switch (n.kind) {
    case "articleRef": {
      if (n.scope !== "general") throw new Error(`공용조항 안의 조 참조는 보통약관 마스터만 — 사용처 자신을 가리킨다: ${n.targets.map((t) => t.nodeId).join(",")}`);
      return { id: n.id, kind: "articleRef", targets: n.targets.map((t) => ({ ...t })), connector: n.connector };
    }
    case "inlineCond":
      return { id: n.id, kind: "inlineCond", branches: n.branches.map((b) => ({ id: b.id, ...(b.when !== undefined ? { when: b.when } : {}), children: b.children.map(toClauseInline) })) };
    case "text":
    case "slot":
    case "appendixRef":
      return { ...n };
    default:
      throw new Error(`공용조항 본문에 올 수 없는 노드: ${n.kind}`);
  }
}

/** 공용조항 본문의 노드 id 를 결정적으로 다시 매긴다 (`<prefix>-n<순번>`). */
export function reId<T>(nodes: T, prefix: string): T {
  let seq = 0;
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (typeof n.id === "string") n.id = `${prefix}-n${++seq}`;
    for (const key of ["children", "items", "subitems", "branches"]) {
      const list = n[key];
      if (Array.isArray(list)) for (const c of list) visit(c);
    }
  };
  for (const n of nodes as unknown[]) visit(n);
  return nodes;
}

/** 공용조항 한 건의 본문을 고른 옵션으로 펼친 가능한 렌더 — inline 은 인라인 원자열, block 은 항 하나의 원자열. */
export function clauseRenderings(clause: ClauseRecord, selection: Record<string, string>): string[][] {
  const bodies: OptionBodies = (code) => {
    const option = clause.options.find((o) => o.code === code);
    const value = option?.values.find((v) => v.code === selection[code]);
    if (!value) throw new Error(`${clause.code} 옵션 ${code} 선택 없음`);
    return value.body;
  };
  if (clause.mode === "inline") return renderings(clause.body as Inline[], bodies);
  const paragraphs = (clause.body as Block[]).filter((b): b is ClauseParagraph => b.kind === "paragraph");
  if (paragraphs.length !== 1 || paragraphs[0].items?.length) throw new Error(`${clause.code}: 항 공용조항 오버레이는 호 없는 항 하나만 다룬다`);
  return renderings(paragraphs[0].children, bodies);
}

// ───────────────────────────── 사용처 자리 바꾸기 ─────────────────────────────

/** 조를 원문 번호로 찾아 항(`<조 id>-p<k>`)을 돌려준다. */
function paragraphOf(article: ArticleNode, paragraph: number): ParagraphNode | undefined {
  const id = `${article.id}-p${paragraph}`;
  return article.children.find((c): c is ParagraphNode => c.kind === "paragraph" && c.id === id);
}

/**
 * 「문구」 공용조항 — 항 본문에서 공용조항 렌더(원자열)의 첫 등장을 참조 하나로 바꾼다.
 * 조건 노드를 가로지르는 구간은 찾지 않는다 (조건 밖 자리만 — 실물 쓰임새가 그렇다).
 */
export function replaceInlineRun(owner: { id: Id; children: InlineNode[] }, atoms: readonly string[], ref: InlineNode): boolean {
  // 항 본문을 원자로 펼친다 — [원자 키, 원 노드 번호, 텍스트 안 위치]
  const flat: { key: string; node: number; offset: number }[] = [];
  owner.children.forEach((n, i) => {
    if (n.kind === "text") [...n.text].forEach((ch, k) => flat.push({ key: ch, node: i, offset: k }));
    else flat.push({ key: n.kind === "inlineCond" ? "\u0000" : tokenOf(n), node: i, offset: 0 });
  });
  const keys = flat.map((f) => f.key);
  let at = -1;
  outer: for (let i = 0; i + atoms.length <= keys.length; i++) {
    for (let j = 0; j < atoms.length; j++) if (keys[i + j] !== atoms[j]) continue outer;
    at = i;
    break;
  }
  if (at < 0) return false;
  const first = flat[at];
  const last = flat[at + atoms.length - 1];
  const out: InlineNode[] = [];
  owner.children.forEach((n, i) => {
    if (i < first.node || i > last.node) {
      out.push(n);
      return;
    }
    if (n.kind === "text") {
      const chars = [...n.text];
      if (i === first.node && first.offset > 0) out.push({ id: n.id, kind: "text", text: chars.slice(0, first.offset).join("") });
      if (i === first.node) out.push(ref);
      if (i === last.node && last.offset + 1 < chars.length) out.push({ id: `${n.id}r`, kind: "text", text: chars.slice(last.offset + 1).join("") });
      return;
    }
    if (i === first.node) out.push(ref);
  });
  owner.children.splice(0, owner.children.length, ...out);
  return true;
}

/**
 * 사용처 자리 하나를 공용조항 참조로 바꾼다. 성공하면 true, 못 찾으면 보고하고 false.
 * `articleOf` 는 원문 조 번호 → 조.
 */
export function applyClauseUse(
  use: ClauseUse,
  clause: ClauseRecord,
  articleOf: (number: string) => ArticleNode | undefined,
  label: string,
  report: string[],
): boolean {
  const article = articleOf(use.article);
  const paragraph = article && paragraphOf(article, use.paragraph);
  if (!article || !paragraph) {
    report.push(`${label} 공용조항 ${clause.code}: 조 ${use.article} 제${use.paragraph}항 없음`);
    return false;
  }
  const selection = use.options ?? {};
  const alternatives = clauseRenderings(clause, selection);
  if (clause.mode === "block") {
    if (paragraph.items?.length) {
      report.push(`${label} 공용조항 ${clause.code}: 조 ${use.article} 제${use.paragraph}항에 호가 있어 항 공용조항으로 바꿀 수 없음`);
      return false;
    }
    const allowed = new Set(alternatives.map(keyOf));
    const mine = renderings(paragraph.children);
    const missing = mine.filter((r) => !allowed.has(keyOf(r)));
    if (missing.length > 0) {
      report.push(`${label} 공용조항 ${clause.code}: 조 ${use.article} 제${use.paragraph}항이 공용조항 렌더와 다름 — ${missing[0].join("").slice(0, 60)}…`);
      return false;
    }
    const at = article.children.indexOf(paragraph);
    article.children.splice(at, 1, { id: `${paragraph.id}-k`, kind: "clauseBlockRef", clauseCode: clause.code, options: { ...selection } });
    return true;
  }
  if (alternatives.length !== 1) throw new Error(`${clause.code}: 조건 있는 「문구」 공용조항은 자리 대조를 하지 않는다`);
  const seq = paragraph.children.filter((c) => c.kind === "clauseInlineRef").length + 1;
  const ref: InlineNode = { id: `${paragraph.id}-k${seq}`, kind: "clauseInlineRef", clauseCode: clause.code, options: { ...selection } };
  if (!replaceInlineRun(paragraph, alternatives[0], ref)) {
    report.push(`${label} 공용조항 ${clause.code}: 조 ${use.article} 제${use.paragraph}항에서 문구를 찾지 못함 — ${alternatives[0].join("").slice(0, 40)}…`);
    return false;
  }
  return true;
}

/** 문서의 조 — 관 안 · 조 조건 블록 안까지 (원문 번호 색인용). */
export function* allArticles(tree: DocumentNode): Generator<ArticleNode> {
  const walk = function* (list: readonly unknown[]): Generator<ArticleNode> {
    for (const c of list as { kind: string; children?: unknown[]; branches?: { children: unknown[] }[] }[]) {
      if (c.kind === "article") yield c as unknown as ArticleNode;
      else if (c.kind === "section" && c.children) yield* walk(c.children);
      else if (c.kind === "condBlock" && c.branches) for (const b of c.branches) yield* walk(b.children);
    }
  };
  yield* walk(tree.children);
}

export type { ClauseSpec };
