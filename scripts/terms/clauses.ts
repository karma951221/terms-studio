/**
 * 공용조항 오버레이 — 원문에서 여러 문서가 되풀이하는 **조 · 여러 항 단위**를 공용조항으로 따고, 사용처 자리를 참조로 바꾼다
 * (개발 도구 — 제품 기능 아님). 근거: 기능/공용조항 §3.1 · §3.5 · §6.2 「공용조항 = 되풀이되는 조 · 여러 항 단위」.
 *
 * - 공용조항 본문은 원문 한 자리에서 딴다(`from` — 조건 오버레이가 얹힌 뒤, 잇닿은 항 N 개). 평문(`text`, `{O01}` = 옵션 자리)도 된다.
 *   참조 평문(「보통약관 제N조(…)」 · 【별표N(…)】)은 참조 슬롯이 된다.
 *   원문 자리의 자기 조 참조는 둘로 나뉜다 (§3.5): 딴 항 안을 가리키면 「이 공용조항」(`scope: "clause"`),
 *   밖을 가리키면 「사용처」 위치(`scope: "host"`, `"2.1.3"` — `hostPaths`, 조립의 `hostLocator` 와 같은 셈).
 * - 낱말만 다른 자리는 옵션이다 — 원문 자리의 글에서 그 낱말(`within` 문맥 안의 `text`)을 옵션 자리로 바꾼다(`placeOptions`).
 * - 사용처 자리 바꾸기는 **원자열 대조**다 — 글자 하나 · 참조 노드 하나를 원자로 보고, 공용조항이 고른 옵션으로 펼친 원자열이
 *   사용처 항 안에 그대로 있어야 바꾼다(제 항 · 사용처 위치 참조는 사용처 노드로 옮겨 대조). 못 찾으면 보고하고 건드리지 않는다.
 *   - 「항」(block)   : 잇닿은 항 N 개를 `clauseBlockRef` 하나로. 항의 가능한 렌더(조건 가지별)가 전부 공용조항의 렌더 안에 있어야 한다.
 *   - 「문구」(inline) : 항 안의 첫 등장 구간을 `clauseInlineRef` 하나로 (제품 기능 — 실물 데이터는 쓰지 않는다, 2026-09-28).
 * - 노드 id 는 결정적이다: 공용조항 본문 `c<번호>-…` · 사용처 참조 `<항 id>-k<순번>` (block 은 `<항 id>-k`).
 */
import type { ArticleRefNode as ClauseArticleRef, Block, BoxNode, Inline, ParagraphNode as ClauseParagraph } from "../../src/domain/clause/nodes";
import { hostLocator } from "../../src/domain/assembly/resolve";
import type { ArticleNode, DocumentNode, InlineNode, ParagraphNode } from "../../src/domain/document/nodes";
import type { Id } from "../../src/domain/types";

import type { ClauseSpec, ClauseUse } from "./config";

/** 조립 JSON(`clauses.json`) 한 건 — 로더가 code · description 을 떼고 서비스에 넘긴다. */
export interface ClauseRecord {
  code: string;
  label: string;
  mode: "inline" | "block" | "box";
  description: string;
  body: Inline[] | Block[] | BoxNode[];
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
    out.push(...convert(part, newId).map((n) => toClauseInline(n)));
  }
  return out;
}

/** 원문 자리의 자기 조 참조(`scope: "self"`) → 공용조항 조 참조 (제 항 또는 사용처 위치). 없으면 자기 참조를 거부한다. */
export type Localize = (n: Extract<InlineNode, { kind: "articleRef" }>) => ClauseArticleRef;

/**
 * 문면 인라인 → 공용조항 인라인. 보통약관 조 참조는 scope 를 뗀다. 자기 조 참조는 `localize` 가 제 항 · 사용처 위치로 바꾼다 —
 * 없으면(평문 공용조항) 오류 (기능/공용조항 §3.5).
 */
export function toClauseInline(n: InlineNode, localize?: Localize): Inline {
  switch (n.kind) {
    case "articleRef": {
      if (n.scope === "general") return { id: n.id, kind: "articleRef", targets: n.targets.map((t) => ({ ...t })), connector: n.connector };
      if (!localize) throw new Error(`평문 공용조항의 조 참조는 보통약관 마스터만 — 사용처 자신을 가리킨다: ${n.targets.map((t) => t.nodeId).join(",")}`);
      return localize(n);
    }
    case "inlineCond":
      return { id: n.id, kind: "inlineCond", branches: n.branches.map((b) => ({ id: b.id, ...(b.when !== undefined ? { when: b.when } : {}), children: b.children.map((c) => toClauseInline(c, localize)) })) };
    case "text":
    case "slot":
    case "appendixRef":
      return { ...n };
    default:
      throw new Error(`공용조항 본문에 올 수 없는 노드: ${n.kind}`);
  }
}

/** 공용조항 본문의 노드 id 를 결정적으로 다시 매긴다 (`<prefix>-n<순번>`). 「이 공용조항」 조 참조의 대상도 따라간다. */
export function reId<T>(nodes: T, prefix: string): T {
  let seq = 0;
  const renamed = new Map<string, string>();
  const refs: ClauseArticleRef[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (typeof n.id === "string") {
      const next = `${prefix}-n${++seq}`;
      renamed.set(n.id, next);
      n.id = next;
    }
    if (n.kind === "articleRef" && n.scope === "clause") refs.push(n as unknown as ClauseArticleRef);
    for (const key of ["children", "items", "subitems", "branches"]) {
      const list = n[key];
      if (Array.isArray(list)) for (const c of list) visit(c);
    }
  };
  for (const n of nodes as unknown[]) visit(n);
  for (const r of refs) r.targets = r.targets.map((t) => ({ nodeId: renamed.get(t.nodeId) ?? t.nodeId }));
  return nodes;
}

// ───────────────────────────── 원문 자리에서 딴 본문 ─────────────────────────────

/**
 * 문서의 조 · 항 · 호 · 목 id → 사용처 위치 경로(`"2.1.3"`). 조립의 `hostLocator` 와 같은 셈 —
 * 관은 투명, 조건 블록은 모든 가지를 차례로, 공용조항 블록이 펼칠 항은 세지 않는다.
 */
export function hostPaths(tree: DocumentNode): Map<Id, string> {
  const out = new Map<Id, string>();
  const flat = (list: readonly unknown[], want: string): { id: Id; [k: string]: unknown }[] =>
    (list as { kind: string; id: Id; branches?: { children: unknown[] }[]; children?: unknown[] }[]).flatMap((n) => {
      if (n.kind === want) return [n];
      if (n.kind === "condBlock") return (n.branches ?? []).flatMap((b) => flat(b.children, want));
      if (n.kind === "section" && want === "article") return flat(n.children ?? [], want);
      return [];
    });
  flat(tree.children, "article").forEach((a, ai) => {
    out.set(a.id, `${ai + 1}`);
    flat((a.children as unknown[]) ?? [], "paragraph").forEach((p, pi) => {
      out.set(p.id, `${ai + 1}.${pi + 1}`);
      flat((p.items as unknown[]) ?? [], "item").forEach((it, ii) => {
        out.set(it.id, `${ai + 1}.${pi + 1}.${ii + 1}`);
        flat((it.subitems as unknown[]) ?? [], "subitem").forEach((u, ui) => out.set(u.id, `${ai + 1}.${pi + 1}.${ii + 1}.${ui + 1}`));
      });
    });
  });
  return out;
}

/** 항 목록의 항 · 호 · 목 id. */
function structIdsOf(paragraphs: readonly ParagraphNode[]): Set<Id> {
  const out = new Set<Id>();
  for (const p of paragraphs) {
    out.add(p.id);
    for (const it of p.items ?? []) {
      if (it.kind !== "item") continue;
      out.add(it.id);
      for (const u of it.subitems ?? []) if (u.kind === "subitem") out.add(u.id);
    }
  }
  return out;
}

/**
 * 원문 자리의 잇닿은 항들 → 공용조항 항 목록 (호 · 목 포함). 자기 조 참조는 딴 항 안이면 「이 공용조항」, 밖이면 「사용처」 위치.
 * 한 참조가 둘을 섞으면 오류. 호 목록에 표 · 박스가 있으면 공용조항 본문이 될 수 없다.
 */
export function clauseFromSource(tree: DocumentNode, taken: readonly ParagraphNode[], code: string): Block[] {
  const inside = structIdsOf(taken);
  const paths = hostPaths(tree);
  const localize: Localize = (n) => {
    const own = n.targets.filter((t) => inside.has(t.nodeId));
    if (own.length === n.targets.length) return { id: n.id, kind: "articleRef", targets: n.targets.map((t) => ({ ...t })), connector: n.connector, scope: "clause" };
    if (own.length > 0) throw new Error(`${code}: 조 참조 하나가 딴 항 안팎을 함께 가리킨다 — ${n.targets.map((t) => t.nodeId).join(",")}`);
    const targets = n.targets.map((t) => {
      const path = paths.get(t.nodeId);
      if (!path) throw new Error(`${code}: 사용처 위치를 모르는 조 참조 대상 ${t.nodeId}`);
      return { nodeId: path };
    });
    return { id: n.id, kind: "articleRef", targets, connector: n.connector, scope: "host" };
  };
  const inl = (list: InlineNode[]) => structuredClone(list).map((c) => toClauseInline(c, localize));
  return taken.map((p): Block => {
    const items = (p.items ?? []).map((it) => {
      if (it.kind !== "item") throw new Error(`${code}: 호 목록에 ${it.kind} 이 있는 항은 공용조항 본문이 될 수 없다`);
      const subitems = (it.subitems ?? []).map((u) => {
        if (u.kind !== "subitem") throw new Error(`${code}: 목 목록에 ${u.kind} 이 있다`);
        return { id: u.id, kind: "subitem" as const, children: inl(u.children) };
      });
      return { id: it.id, kind: "item" as const, children: inl(it.children), ...(subitems.length ? { subitems } : {}) };
    });
    return { id: p.id, kind: "paragraph", children: inl(p.children), ...(items.length ? { items } : {}) };
  });
}

/** 옵션 자리 놓기 — `within` 문맥(기본 = `text`)이 나오는 **모든** 자리에서 그 안의 `text` 를 옵션 자리로. */
export interface OptionPlacement {
  option: string;
  text: string;
  within?: string;
}

/**
 * 원문에서 딴 본문의 글에 옵션 자리를 놓는다 (문장 · 호 · 목, 조건 가지 안 포함). 자리마다 최소 한 번은 나와야 한다.
 * 놓은 순서대로 찾는다 — 먼저 놓은 옵션 자리는 다음 문맥 찾기에서 글이 아니다.
 */
export function placeOptions(body: Block[], placements: readonly OptionPlacement[], code: string): void {
  let seq = 0;
  for (const place of placements) {
    const within = place.within ?? place.text;
    const at = within.indexOf(place.text);
    if (at < 0) throw new Error(`${code}: 옵션 ${place.option} 의 문맥 「${within}」에 「${place.text}」가 없다`);
    let found = 0;
    const visit = (list: Inline[]): Inline[] =>
      list.flatMap((n): Inline[] => {
        if (n.kind === "inlineCond") return [{ ...n, branches: n.branches.map((b) => ({ ...b, children: visit(b.children) })) }];
        if (n.kind !== "text") return [n];
        const out: Inline[] = [];
        let rest = n.text;
        let k = 0;
        for (let i = rest.indexOf(within); i >= 0; i = rest.indexOf(within)) {
          found += 1;
          const before = rest.slice(0, i + at);
          if (before) out.push({ id: `${n.id}o${++k}`, kind: "text", text: before });
          out.push({ id: `${code}-o${++seq}`, kind: "optionSlot", optionCode: place.option });
          rest = rest.slice(i + at + place.text.length);
        }
        if (k === 0 && out.length === 0) return [n];
        if (rest) out.push({ id: `${n.id}o${++k}`, kind: "text", text: rest });
        return out;
      });
    const block = (b: Block): Block => {
      if (b.kind === "condBlock") return { ...b, branches: b.branches.map((br) => ({ ...br, children: br.children.map(block) })) };
      // 실물 공용조항 본문에는 글머리 목록이 없다 — 옵션 자리 찾기는 항 · 호 · 목만
      if (b.kind === "bulletList" || b.kind === "boxRef") return b;
      return {
        ...b,
        children: visit(b.children),
        ...(b.items ? { items: b.items.map((it) => (it.kind === "bulletList" || it.kind === "boxRef" ? it : { ...it, children: visit(it.children), ...(it.subitems ? { subitems: it.subitems.map((u) => ({ ...u, children: visit(u.children) })) } : {}) })) } : {}),
      };
    };
    body.splice(0, body.length, ...body.map(block));
    if (found === 0) throw new Error(`${code}: 옵션 ${place.option} 자리 「${within}」를 원문 자리에서 찾지 못했다`);
  }
}

/** 옵션 선택 → 선택지 본문 조회. */
function bodiesOf(clause: ClauseRecord, selection: Record<string, string>): OptionBodies {
  return (code) => {
    const option = clause.options.find((o) => o.code === code);
    const value = option?.values.find((v) => v.code === selection[code]);
    if (!value) throw new Error(`${clause.code} 옵션 ${code} 선택 없음`);
    return value.body;
  };
}

/** 「문구」 공용조항 한 건의 본문을 고른 옵션으로 펼친 가능한 렌더(인라인 원자열). */
export function clauseRenderings(clause: ClauseRecord, selection: Record<string, string>): string[][] {
  if (clause.mode !== "inline") throw new Error(`${clause.code}: 「항」 공용조항은 clauseParagraphs 로 본다`);
  return renderings(clause.body as Inline[], bodiesOf(clause, selection));
}

/** 「항」 공용조항 본문의 항 목록 — 조건 블록은 오버레이가 다루지 않는다(실물 쓰임새에 없다). */
function clauseParagraphs(clause: ClauseRecord): ClauseParagraph[] {
  const blocks = clause.body as Block[];
  if (blocks.some((b) => b.kind !== "paragraph")) throw new Error(`${clause.code}: 항 공용조항 오버레이는 조건 블록 없는 항 목록만 다룬다`);
  return blocks as ClauseParagraph[];
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

/** 인라인 목록의 렌더가 모두 허용 렌더 안에 있는가 — 없으면 처음 어긋난 렌더. */
function missingRendering(mine: readonly AnyInline[], allowed: readonly AnyInline[], bodies: OptionBodies): string | undefined {
  const ok = new Set(renderings(allowed, bodies).map(keyOf));
  const miss = renderings(mine).find((r) => !ok.has(keyOf(r)));
  return miss ? miss.join("").slice(0, 60) : undefined;
}

/**
 * 「항」 공용조항 — 본문의 항 N 개를 사용처의 **잇닿은** 항 N 개(첫 항 = `use.paragraph`)와 대조해 통째로 참조 하나로 바꾼다.
 * 항마다 문장 · 호 · 목의 가능한 렌더가 모두 공용조항 렌더 안에 있어야 하고, 호 목록에 표 · 박스가 끼면 바꾸지 않는다(공용조항 본문에 둘 수 없다).
 */
/**
 * 공용조항 항 목록의 제 항 · 사용처 위치 조 참조를 사용처 노드 id 로 옮긴 사본 — 사용처 항과 원자열로 대조하려고.
 * 제 항은 같은 자리(k 번째 항 · i 번째 호 · j 번째 목)의 사용처 노드로, 사용처 위치는 `host` 로 푼다(조립과 같은 셈).
 */
export function localizeClause(theirs: readonly ClauseParagraph[], mine: readonly ParagraphNode[], host: (path: string) => Id | undefined): ClauseParagraph[] {
  const map = new Map<Id, Id>();
  theirs.forEach((c, k) => {
    const m = mine[k];
    if (!m) return;
    map.set(c.id, m.id);
    const mItems = (m.items ?? []).filter((x) => x.kind === "item");
    (c.items ?? []).filter((x) => x.kind === "item").forEach((it, i) => {
      const mi = mItems[i];
      if (!mi || mi.kind !== "item" || it.kind !== "item") return;
      map.set(it.id, mi.id);
      const mSubs = (mi.subitems ?? []).filter((x) => x.kind === "subitem");
      (it.subitems ?? []).forEach((u, j) => {
        if (mSubs[j]) map.set(u.id, mSubs[j].id);
      });
    });
  });
  const copy = structuredClone(theirs) as ClauseParagraph[];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (n.kind === "articleRef" && (n.scope === "clause" || n.scope === "host")) {
      const r = n as unknown as ClauseArticleRef;
      r.targets = r.targets.map((t) => ({ nodeId: (r.scope === "clause" ? map.get(t.nodeId) : host(t.nodeId)) ?? `?${t.nodeId}` }));
    }
    for (const key of ["children", "items", "subitems", "branches"]) {
      const list = n[key];
      if (Array.isArray(list)) for (const c of list) visit(c);
    }
  };
  copy.forEach(visit);
  return copy;
}

function applyBlockUse(
  use: ClauseUse,
  clause: ClauseRecord,
  article: ArticleNode,
  first: ParagraphNode,
  selection: Record<string, string>,
  label: string,
  report: string[],
  doc: DocumentNode | undefined,
): boolean {
  const where = `${label} 공용조항 ${clause.code}: 조 ${use.article} 제${use.paragraph}항`;
  const bodies = bodiesOf(clause, selection);
  const at = article.children.indexOf(first);
  const count = clauseParagraphs(clause).length;
  const mine = article.children.slice(at, at + count);
  if (mine.length !== count || mine.some((c) => c.kind !== "paragraph")) {
    report.push(`${where}부터 잇닿은 항 ${count}개가 없음`);
    return false;
  }
  const theirs = localizeClause(clauseParagraphs(clause), mine as ParagraphNode[], doc ? hostLocator(doc) : () => undefined);
  for (const [k, node] of mine.entries()) {
    const p = node as ParagraphNode;
    const c = theirs[k];
    const miss = missingRendering(p.children, c.children, bodies);
    if (miss !== undefined) {
      report.push(`${where}(+${k})이 공용조항 렌더와 다름 — ${miss}…`);
      return false;
    }
    const items = p.items ?? [];
    const citems = c.items ?? [];
    if (items.some((it) => it.kind !== "item") || items.length !== citems.length) {
      report.push(`${where}(+${k}) 호 목록이 다름 (표 · 박스가 끼었거나 개수가 다르다)`);
      return false;
    }
    for (const [i, it] of items.entries()) {
      const cit = citems[i];
      if (it.kind !== "item" || cit.kind !== "item") return false;
      const subs = it.subitems ?? [];
      const csubs = cit.subitems ?? [];
      const bad =
        missingRendering(it.children, cit.children, bodies) ??
        (subs.length !== csubs.length || subs.some((u) => u.kind !== "subitem") ? "목 목록" : undefined) ??
        subs.map((u, j) => (u.kind === "subitem" ? missingRendering(u.children, csubs[j].children, bodies) : "목")).find((m) => m !== undefined);
      if (bad !== undefined) {
        report.push(`${where}(+${k}) 제${i + 1}호가 다름 — ${bad}…`);
        return false;
      }
    }
  }
  article.children.splice(at, theirs.length, { id: `${first.id}-k`, kind: "clauseBlockRef", clauseCode: clause.code, options: { ...selection } });
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
  /** 사용처 문서 — 공용조항의 사용처 위치 참조를 대조할 때 푼다. */
  doc?: DocumentNode,
): boolean {
  const article = articleOf(use.article);
  const paragraph = article && paragraphOf(article, use.paragraph);
  if (!article || !paragraph) {
    report.push(`${label} 공용조항 ${clause.code}: 조 ${use.article} 제${use.paragraph}항 없음`);
    return false;
  }
  const selection = use.options ?? {};
  if (clause.mode === "block") return applyBlockUse(use, clause, article, paragraph, selection, label, report, doc);
  const alternatives = clauseRenderings(clause, selection);
  if (alternatives.length !== 1) throw new Error(`${clause.code}: 조건 있는 「문구」 공용조항은 자리 대조를 하지 않는다`);
  // 호 자리(`use.item`)면 그 호의 문장에서 찾는다
  const item = use.item === undefined ? undefined : paragraph.items?.filter((n) => n.kind === "item")[use.item - 1];
  if (use.item !== undefined && (!item || item.kind !== "item")) {
    report.push(`${label} 공용조항 ${clause.code}: 조 ${use.article} 제${use.paragraph}항 제${use.item}호 없음`);
    return false;
  }
  const owner: { id: Id; children: InlineNode[] } = item && item.kind === "item" ? item : paragraph;
  const seq = owner.children.filter((c) => c.kind === "clauseInlineRef").length + 1;
  const ref: InlineNode = { id: `${owner.id}-k${seq}`, kind: "clauseInlineRef", clauseCode: clause.code, options: { ...selection } };
  if (!replaceInlineRun(owner, alternatives[0], ref)) {
    report.push(`${label} 공용조항 ${clause.code}: 조 ${use.article} 제${use.paragraph}항${use.item ? ` 제${use.item}호` : ""}에서 문구를 찾지 못함 — ${alternatives[0].join("").slice(0, 40)}…`);
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
