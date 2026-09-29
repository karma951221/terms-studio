/**
 * 번호 계산 — 번호는 저장하지 않는 계산값이다 (ADR-0012 · 기능/문면 §3.2).
 *
 * `numberTree` 는 조건 해소 없이 **현재 트리** 순서대로 조·항·호·목 번호를 매긴다 (편집기 표시용 · 전체 뷰).
 * 사전평가 결과(`branchStates`)를 주면 `notTaken` 가지를 빼고 센다 — 톤다운된 조가 빠져 이후 번호가 당겨져 보인다
 * (사전평가 S1). 미결·오류 가지는 뺄 수 없으므로 그대로 센다. 조립은 조건 해소 뒤 C2 가 다시 계산한다.
 *
 * ⚠ 표기 규칙은 **임시**다 — 조·별표 참조 슬롯의 렌더 표기(「제3조(보험금의 지급사유)」·「【별표13(화상 분류표)】」)는
 *   2026-09-07 확정분: 관 「제N관」 · 항이 하나뿐인 조는 마커 없음(빈 label) · 별표 번호는 책자 등장 순(ADR-0063).
 *   공용조항 block 참조는 항 1개로 센다 — 실제 항 수는 인라인화 뒤 조립이 안다.
 */

import { CONNECTOR_PLACEHOLDER, type Code, type Id, type ReferenceConnector } from "../types";
import type { ArticleNode, BlockNode, DocumentNode, Node, RefTarget } from "./nodes";
import { refKey } from "./pcode";

export type NumberKind = "section" | "article" | "paragraph" | "item" | "subitem";

export interface NodeNumber {
  kind: NumberKind;
  /** 1부터. */
  n: number;
  label: string;
}

export type BranchState = "taken" | "notTaken" | "undetermined" | "error";

export interface NumberingOptions {
  /** 가지 id → 사전평가 상태. `notTaken` 가지는 번호 계산에서 뺀다. */
  branchStates?: ReadonlyMap<Id, BranchState>;
}

// ───────────────────────────── 표기 (임시 규칙) ─────────────────────────────

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
const HANGUL = ["가", "나", "다", "라", "마", "바", "사", "아", "자", "차", "카", "타", "파", "하"];

export function sectionLabel(n: number): string {
  return `제${n}관`;
}

export function articleLabel(n: number): string {
  return `제${n}조`;
}

/** 원문자 ①…⑳, 그 너머는 (N). */
export function paragraphLabel(n: number): string {
  return n >= 1 && n <= 20 ? CIRCLED[n - 1] : `(${n})`;
}

export function itemLabel(n: number): string {
  return `${n}.`;
}

/** 가.나.다.…하. (14), 그 너머는 (N). */
export function subitemLabel(n: number): string {
  return n >= 1 && n <= HANGUL.length ? `${HANGUL[n - 1]}.` : `(${n})`;
}

/** 조 참조 슬롯 표기 — 「제N조(조 명)」. */
export function articleRefLabel(n: number, title: string): string {
  // 제목 없는 조(공용조항 에디터의 「사용처」 위치 후보)는 번호만
  return title === "" ? articleLabel(n) : `${articleLabel(n)}(${title})`;
}

export interface ReferencePart {
  id: Id;
  n: number;
  /** P코드 — 항 · 호 · 목 (ADR-0072). 참조 대상으로 저장할 때 쓴다. */
  code?: Code;
}

/** 참조 대상의 계산 번호와 상위 구조. `kind` 아래 단계까지만 값이 있다. */
export interface ReferenceTarget {
  kind: NumberKind;
  /** 조를 품은 관 — 표기에는 쓰지 않고, 대상 고르기 트리의 묶음 머리로만 쓴다. */
  section?: ReferencePart & { title: string };
  article: ReferencePart & { title: string };
  paragraph?: ReferencePart;
  item?: ReferencePart;
  subitem?: ReferencePart;
}

/** 목 참조 표기 — 「가목」…「하목」 (법령 인용 꼴), 그 너머는 「제N목」. */
export function subitemRefLabel(n: number): string {
  return n >= 1 && n <= HANGUL.length ? `${HANGUL[n - 1]}목` : `제${n}목`;
}

/** 첫 대상은 전체 경로, 다음 대상은 직전 대상과 같은 상위 경로를 생략한 실물 표기를 만든다. */
export function referenceTargetLabel(target: ReferenceTarget, previous?: ReferenceTarget): string {
  const parts: string[] = [];
  const sameArticle = previous?.article.id === target.article.id;
  const sameParagraph = sameArticle && previous?.paragraph?.id === target.paragraph?.id;
  const sameItem = sameParagraph && previous?.item?.id === target.item?.id;
  if (target.kind === "article" || !sameArticle) parts.push(articleRefLabel(target.article.n, target.article.title));
  if (target.paragraph && (target.kind === "paragraph" || !sameParagraph)) parts.push(`제${target.paragraph.n}항`);
  if (target.item && (target.kind === "item" || !sameItem)) parts.push(`제${target.item.n}호`);
  if (target.subitem) parts.push(subitemRefLabel(target.subitem.n));
  return parts.join(" ");
}

/** 두 대상이 같은 상위(조 · 항 · 호) 아래 같은 종류인가 — 연속 구간의 전제. */
function sameParentAndKind(a: ReferenceTarget, b: ReferenceTarget): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "article":
      return true;
    case "paragraph":
      return a.article.id === b.article.id;
    case "item":
      return a.article.id === b.article.id && a.paragraph?.id === b.paragraph?.id;
    case "subitem":
      return a.article.id === b.article.id && a.paragraph?.id === b.paragraph?.id && a.item?.id === b.item?.id;
    default:
      return false;
  }
}

function ownNumber(t: ReferenceTarget): number {
  switch (t.kind) {
    case "article":
      return t.article.n;
    case "paragraph":
      return t.paragraph?.n ?? 0;
    case "item":
      return t.item?.n ?? 0;
    case "subitem":
      return t.subitem?.n ?? 0;
    default:
      return 0;
  }
}

/** 연속 구간이 되려면 몇 개가 잇달아야 하나 — 둘은 「A 및 B」, 셋부터 「A부터 C까지」 (기능/문면 §3.5). */
export const RANGE_MIN = 3;

/**
 * 다중 참조 덩어리의 표기 (기능/문면 §3.5).
 *
 * - `targets` 는 **살아남은 대상**을 작성 순서대로 (분기로 사라진 대상은 호출부가 이미 뺐다). 번호는 계산값.
 * - 인접한 대상이 같은 상위 · 같은 종류이고 번호가 직전 +1 이면 한 **구간**. 구간이 `RANGE_MIN` 이상이면 「A부터 B까지」,
 *   그보다 짧으면 대상 하나씩 낱개 세그먼트.
 * - 세그먼트를 쉼표로 잇고 마지막 앞에만 연결어. 각 대상의 상위 경로 생략은 `referenceTargetLabel` 규칙 그대로
 *   (첫 대상은 `source` = 슬롯이 놓인 자리, 다음은 직전 대상 기준). 구간 끝은 구간 시작 기준이라 자기 단계만 남는다.
 */
export function referenceChunkLabel(targets: readonly ReferenceTarget[], connector: ReferenceConnector | undefined, source?: ReferenceTarget): string {
  const runs: ReferenceTarget[][] = [];
  for (const target of targets) {
    const run = runs.at(-1);
    const last = run?.at(-1);
    if (run && last && sameParentAndKind(last, target) && ownNumber(target) === ownNumber(last) + 1) run.push(target);
    else runs.push([target]);
  }
  const segments: string[] = [];
  let previous = source;
  for (const run of runs) {
    if (run.length >= RANGE_MIN) {
      const first = run[0];
      const last = run[run.length - 1];
      segments.push(`${referenceTargetLabel(first, previous)}부터 ${referenceTargetLabel(last, first)}까지`);
      previous = last;
      continue;
    }
    for (const target of run) {
      segments.push(referenceTargetLabel(target, previous));
      previous = target;
    }
  }
  if (segments.length <= 1) return segments[0] ?? "";
  return `${segments.slice(0, -1).join(", ")} ${connector ?? CONNECTOR_PLACEHOLDER} ${segments.at(-1)}`;
}

/** 편집기용: 현재 계산 번호를 붙여 문서 안의 조·항·호·목을 참조 대상 id로 색인한다. 문서 순서(전위)대로. */
export function referenceTargetIndex(doc: DocumentNode, numbers: ReadonlyMap<Id, NodeNumber>): Map<Id, ReferenceTarget> {
  const out = new Map<Id, ReferenceTarget>();
  type Section = ReferenceTarget["section"];
  const visit = (node: Node, parent: ReferenceTarget | undefined, section: Section): void => {
    if (node.kind === "condBlock") {
      for (const branch of node.branches) for (const child of branch.children) visit(child, parent, section);
      return;
    }
    const number = numbers.get(node.id);
    if (node.kind === "section") {
      const here = number ? { id: node.id, n: number.n, title: node.title } : section;
      for (const child of node.children) visit(child, parent, here);
      return;
    }
    if (node.kind === "article" && number) {
      const target: ReferenceTarget = { kind: "article", ...(section ? { section } : {}), article: { id: node.id, n: number.n, title: node.title } };
      out.set(node.id, target);
      for (const child of node.children) visit(child, target, section);
      return;
    }
    const up = parent?.section ? { section: parent.section } : {};
    const code = (node as { code?: Code }).code;
    const part = (n: number): ReferencePart => ({ id: node.id, n, ...(code !== undefined ? { code } : {}) });
    if (node.kind === "paragraph" && number && parent) {
      const target: ReferenceTarget = { kind: "paragraph", ...up, article: parent.article, paragraph: part(number.n) };
      out.set(node.id, target);
      for (const item of node.items ?? []) visit(item, target, section);
      return;
    }
    if (node.kind === "item" && number && parent?.paragraph) {
      const target: ReferenceTarget = { kind: "item", ...up, article: parent.article, paragraph: parent.paragraph, item: part(number.n) };
      out.set(node.id, target);
      for (const subitem of node.subitems ?? []) visit(subitem, target, section);
      return;
    }
    if (node.kind === "subitem" && number && parent?.paragraph && parent.item) {
      out.set(node.id, { kind: "subitem", ...up, article: parent.article, paragraph: parent.paragraph, item: parent.item, subitem: part(number.n) });
    }
  };
  for (const node of doc.children) visit(node, undefined, undefined);
  return out;
}

/**
 * 편집기 색인의 대상 → 저장할 참조 대상 (ADR-0072 결정 3) — 조면 `{ articleId }`, 항 · 호 · 목이면 `{ articleId, code }`.
 * 코드가 없는 자리(함수조항 에디터의 「사용처」 위치 줄 `host:2.1` 등 — 번호만 있는 줄)는 그 줄 id 를 조 자리에 싣는다.
 */
export function refTargetOf(t: ReferenceTarget): RefTarget {
  if (t.kind === "article" || t.kind === "section") return { articleId: t.article.id };
  const part = t.subitem ?? t.item ?? t.paragraph;
  return part?.code !== undefined ? { articleId: t.article.id, code: part.code } : { articleId: part?.id ?? t.article.id };
}

/**
 * 참조 대상 → 편집기 색인의 노드 id · 대상 (문서 순 첫 노드 — 같은 코드의 분기 짝 중 앞의 것). 편집기 전체 뷰는 분기를 풀지 않아
 * 짝 중 첫 노드의 번호로 보인다.
 */
export function referenceKeyIndex(index: ReadonlyMap<Id, ReferenceTarget>): ReadonlyMap<string, { id: Id; target: ReferenceTarget }> {
  const cached = keyIndexCache.get(index);
  if (cached) return cached;
  const out = new Map<string, { id: Id; target: ReferenceTarget }>();
  for (const [id, target] of index) {
    const key = refKey(refTargetOf(target));
    if (!out.has(key)) out.set(key, { id, target });
  }
  keyIndexCache.set(index, out);
  return out;
}

const keyIndexCache = new WeakMap<ReadonlyMap<Id, ReferenceTarget>, Map<string, { id: Id; target: ReferenceTarget }>>();

/** 대상 고르기 트리의 한 줄 — 조 › 항 › 호 › 목. `label` 은 자기 단계 표기만(「제10조(…)」·「제1항」·「제2호」·「가목」). */
export interface ReferenceOutlineNode {
  id: Id;
  target: ReferenceTarget;
  label: string;
  children: ReferenceOutlineNode[];
}

/** 관 묶음 — 관 밖 조는 `section` 없는 묶음에 선다. 문서 순서대로, 관이 바뀔 때마다 새 묶음. */
export interface ReferenceOutlineGroup {
  section?: ReferencePart & { title: string };
  label?: string;
  rows: ReferenceOutlineNode[];
}

function parentIdOf(t: ReferenceTarget): Id | undefined {
  switch (t.kind) {
    case "paragraph":
      return t.article.id;
    case "item":
      return t.paragraph?.id;
    case "subitem":
      return t.item?.id;
    default:
      return undefined;
  }
}

/** `referenceTargetIndex` 의 평평한 색인 → 관 › 조 › 항 › 호 › 목 트리 (조 참조 팝업의 대상 고르기). 상위가 색인에 없는 대상은 버린다. */
export function referenceOutline(index: ReadonlyMap<Id, ReferenceTarget>): ReferenceOutlineGroup[] {
  const groups: ReferenceOutlineGroup[] = [];
  const nodes = new Map<Id, ReferenceOutlineNode>();
  for (const [id, target] of index) {
    const parentId = parentIdOf(target);
    const parent = parentId === undefined ? undefined : nodes.get(parentId);
    const label = parent ? referenceTargetLabel(target, parent.target) : referenceTargetLabel(target);
    const node: ReferenceOutlineNode = { id, target, label, children: [] };
    if (target.kind === "article") {
      let group = groups.at(-1);
      if (!group || group.section?.id !== target.section?.id) {
        group = target.section ? { section: target.section, label: `${sectionLabel(target.section.n)} ${target.section.title}`, rows: [] } : { rows: [] };
        groups.push(group);
      }
      group.rows.push(node);
    } else if (parent) {
      parent.children.push(node);
    } else continue;
    nodes.set(id, node);
  }
  return groups;
}

/** 고른 대상들의 조상 id — 기존 참조를 고칠 때 이 줄들을 펴 둔다. */
export function referenceAncestorIds(index: ReadonlyMap<Id, ReferenceTarget>, ids: Iterable<Id>): Set<Id> {
  const out = new Set<Id>();
  for (const id of ids) {
    const t = index.get(id);
    if (!t) continue;
    if (t.kind !== "article") out.add(t.article.id);
    if ((t.kind === "item" || t.kind === "subitem") && t.paragraph) out.add(t.paragraph.id);
    if (t.kind === "subitem" && t.item) out.add(t.item.id);
  }
  return out;
}

/** 별표 참조 슬롯 표기 — 「【별표N(이름)】」. 번호는 책자 등장 순이다 (ADR-0063 · 조립이 계산). */
export function appendixRefLabel(n: number, name: string): string {
  return `【별표${n}(${name})】`;
}

const LABELS: Record<NumberKind, (n: number) => string> = {
  section: sectionLabel,
  article: articleLabel,
  paragraph: paragraphLabel,
  item: itemLabel,
  subitem: subitemLabel,
};

// ───────────────────────────── 계산 ─────────────────────────────

class Counter {
  private n = 0;
  private last: Id | undefined;
  constructor(
    private readonly kind: NumberKind,
    private readonly out: Map<Id, NodeNumber>,
  ) {}
  next(id: Id): void {
    this.n += 1;
    this.last = id;
    this.out.set(id, { kind: this.kind, n: this.n, label: LABELS[this.kind](this.n) });
  }
  get count(): number {
    return this.n;
  }
  /** 항이 하나뿐인 조는 마커를 찍지 않는다 (실물: 단항 조는 전부 번호 없는 본문 — 기능/문면 §3.2). */
  hideIfSingle(): void {
    if (this.n === 1 && this.last !== undefined) {
      const only = this.out.get(this.last);
      if (only) this.out.set(this.last, { ...only, label: "" });
    }
  }
}

/** 노드 id → 번호. 번호가 붙는 종류(조·항·호·목·공용조항 block 참조)만 들어 있다. */
export function numberTree(doc: DocumentNode, opts: NumberingOptions = {}): Map<Id, NodeNumber> {
  const out = new Map<Id, NodeNumber>();
  const skip = (branchId: Id) => opts.branchStates?.get(branchId) === "notTaken";

  /** 같은 자리의 형제 목록을 조건 블록·반복 블록을 투명하게 펼쳐 순회한다. */
  const each = (list: readonly Node[], fn: (node: Node) => void): void => {
    for (const node of list) {
      if (node.kind === "condBlock") {
        for (const br of node.branches) if (!skip(br.id)) each(br.children, fn);
      } else if (node.kind === "forBlock") {
        each(node.children, fn);
      } else {
        fn(node);
      }
    }
  };

  const article = (a: ArticleNode): void => {
    const paragraphs = new Counter("paragraph", out);
    each(a.children, (n) => {
      if (n.kind === "paragraph") {
        paragraphs.next(n.id);
        const items = new Counter("item", out);
        each(n.items ?? [], (it) => {
          if (it.kind === "clauseBlockRef") return items.next(it.id); // 임시 — 「호」 함수조항을 호 1개로 센다(펼친 수는 조립에서)
          if (it.kind !== "item") return;
          items.next(it.id);
          const subitems = new Counter("subitem", out);
          each(it.subitems ?? [], (s) => {
            if (s.kind === "subitem" || s.kind === "clauseBlockRef") subitems.next(s.id);
          });
        });
      } else if (n.kind === "clauseBlockRef") {
        paragraphs.next(n.id); // 임시 — 항 1개로 센다
      }
    });
    paragraphs.hideIfSingle();
  };

  const articles = new Counter("article", out);
  const sections = new Counter("section", out);
  const top = (list: readonly Node[]): void =>
    each(list, (n) => {
      if (n.kind === "section") {
        sections.next(n.id);
        top(n.children);
      } else if (n.kind === "article") {
        articles.next(n.id);
        article(n);
      }
    });
  top(doc.children as BlockNode[]);
  return out;
}
