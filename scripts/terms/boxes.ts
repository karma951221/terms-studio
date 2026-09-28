/**
 * 박스 → 「박스」 공용조항 (개발 도구 — 제품 기능 아님). 근거: 기능/공용조항 §3.1 · §6.2 「박스 = 공용조항 유형」 (2026-09-28).
 *
 * 박스(【용어풀이】 · 【보험금 지급예시】 · 민법 인용 …)는 툴바로 직접 넣지 않고 「박스」 공용조항으로만 넣는다 —
 * 그래서 원문의 박스는 **한 곳에서만 쓰여도** 모두 공용조항이 된다(「되풀이되는 조 · 여러 항」 규칙의 예외).
 *
 * - 같은 박스(제목 · 줄이 글자까지 같다)는 하나로 합친다.
 * - 제목 · 줄 수가 같고 **낱말만** 다르면 하나로 합치고 다른 자리를 옵션으로 둔다 — 줄마다 공통 앞뒤를 떼고 남는 구간(낱말 경계로 넓힘)이
 *   짧고(≤ `MAX_REGION` 자) 다른 줄이 `MAX_LINES` 이하일 때. 띄어쓰기만 다르면 합치지 않는다(고를 이유가 없는 선택지 — 기능/공용조항 §6.2).
 * - 이름은 「【제목】」(제목 없는 박스는 「박스 — 첫 줄 앞머리」). 겹치면 상품 이름, 그래도 겹치면 첫 줄 앞머리를 붙인다.
 * - 노드 id 는 결정적이다: 공용조항 본문 `<prefix>-b` · 줄 `<prefix>-l<k>` · 사용처 참조 `<박스 id>-k`.
 */
import type { BoxLineNode, BoxNode as ClauseBoxNode, Inline } from "../../src/domain/clause/nodes";
import type { BoxNode, DocumentNode, Node } from "../../src/domain/document/nodes";
import type { Id } from "../../src/domain/types";

import { optionCode, valueCode, type ClauseRecord } from "./clauses";

/** 다른 구간 하나의 최대 길이(자) · 한 박스에서 다른 줄의 최대 수 — 넘으면 낱말 차이가 아니라 다른 박스다. */
const MAX_REGION = 30;
const MAX_LINES = 3;

/** 원문 박스 하나 — 어느 문서의 어느 목록 자리에 있나. */
export interface BoxSite {
  doc: string;
  product: string;
  general: boolean;
  list: Node[];
  node: BoxNode;
}

/** 박스 공용조항 한 건의 계획 — 본문 · 옵션 · 쓰임(자리마다 고른 선택지). */
export interface BoxPlan {
  key: string;
  title: string;
  label: string;
  record: Omit<ClauseRecord, "code">;
  uses: { site: BoxSite; selection: Record<string, string> }[];
}

/** 문서의 박스 자리 전부 — 조 직속 · 항의 목록 자리 · 조건 가지 안, 문서 순. */
export function boxSites(tree: DocumentNode, meta: Omit<BoxSite, "list" | "node">): BoxSite[] {
  const out: BoxSite[] = [];
  const visit = (list: Node[]) => {
    for (const n of list) {
      if (n.kind === "box") {
        out.push({ ...meta, list, node: n });
        continue;
      }
      const any = n as { children?: Node[]; items?: Node[]; subitems?: Node[]; branches?: { children: Node[] }[] };
      for (const key of ["children", "items", "subitems"] as const) if (Array.isArray(any[key]) && n.kind !== "table") visit(any[key]!);
      if (n.kind === "condBlock") for (const b of any.branches ?? []) visit(b.children);
    }
  };
  visit(tree.children as Node[]);
  return out;
}

const isSpace = (c: string) => /\s/.test(c);

/** 여러 글의 공통 앞 · 뒤를 떼고 남는 구간 — 낱말 경계로 넓힌다. 모두 같으면 undefined. */
export function diffRegion(texts: readonly string[]): { prefix: number; suffixes: number[]; regions: string[] } | undefined {
  if (texts.every((t) => t === texts[0])) return undefined;
  const chars = texts.map((t) => [...t]);
  const min = Math.min(...chars.map((c) => c.length));
  let prefix = 0;
  while (prefix < min && chars.every((c) => c[prefix] === chars[0][prefix])) prefix++;
  let suffix = 0;
  while (suffix < min - prefix && chars.every((c) => c[c.length - 1 - suffix] === chars[0][chars[0].length - 1 - suffix])) suffix++;
  // 낱말 경계로 — 앞은 공백 뒤까지 물리고, 뒤는 공백 앞까지 물린다(구간이 낱말 가운데서 끊기지 않게)
  while (prefix > 0 && !isSpace(chars[0][prefix - 1])) prefix--;
  while (suffix > 0 && !isSpace(chars[0][chars[0].length - suffix])) suffix--;
  const regions = chars.map((c) => c.slice(prefix, c.length - suffix).join(""));
  // 빈 구간(낱말을 더하거나 뺀 자리)이면 앞 낱말 하나를 더 품는다
  if (regions.some((r) => r.trim() === "") && prefix > 0) {
    let p = prefix - 1;
    while (p > 0 && isSpace(chars[0][p - 1])) p--;
    while (p > 0 && !isSpace(chars[0][p - 1])) p--;
    return { prefix: p, suffixes: chars.map(() => suffix), regions: chars.map((c) => c.slice(p, c.length - suffix).join("")) };
  }
  return { prefix, suffixes: chars.map(() => suffix), regions };
}

/** 박스 무리(같은 제목 · 같은 줄 수)를 낱말 옵션 하나로 합칠 수 있나 — 다른 줄마다 짧은 구간 하나, 띄어쓰기만 다르지 않다. */
function mergeable(boxes: readonly BoxNode[]): boolean {
  const lines = boxes[0].lines.length;
  if (boxes.some((b) => b.lines.length !== lines || b.title !== boxes[0].title)) return false;
  let differing = 0;
  for (let i = 0; i < lines; i++) {
    const texts = [...new Set(boxes.map((b) => b.lines[i]))];
    if (texts.length === 1) continue;
    differing += 1;
    const d = diffRegion(texts);
    if (!d) continue;
    if (d.regions.some((r) => [...r].length > MAX_REGION || r.trim() === "")) return false;
    if (new Set(d.regions.map((r) => r.replace(/\s/g, ""))).size !== d.regions.length) return false;
  }
  return differing > 0 && differing <= MAX_LINES;
}

const snippet = (text: string, n = 14) => {
  const t = text.replace(/\s+/g, " ").trim();
  return [...t].length > n ? `${[...t].slice(0, n).join("")}…` : t;
};

/**
 * 원문 박스 자리 전부 → 박스 공용조항 계획. 같은 박스는 하나, 낱말만 다른 박스는 옵션으로 하나.
 * 순서는 첫 등장 순(문서 순서 그대로) — 코드는 변환기가 적재 순서대로 매긴다.
 */
export function planBoxClauses(sites: readonly BoxSite[]): BoxPlan[] {
  const key = (b: BoxNode) => `${b.title}\u0001${b.lines.join("\u0002")}`;
  // 1. 글자까지 같은 박스끼리
  const distinct: { box: BoxNode; sites: BoxSite[] }[] = [];
  const byKey = new Map<string, { box: BoxNode; sites: BoxSite[] }>();
  for (const s of sites) {
    const k = key(s.node);
    const hit = byKey.get(k);
    if (hit) hit.sites.push(s);
    else {
      const entry = { box: s.node, sites: [s] };
      byKey.set(k, entry);
      distinct.push(entry);
    }
  }
  // 2. 낱말만 다른 박스끼리 — 첫 등장이 무리의 씨앗
  const clusters: { variants: { box: BoxNode; sites: BoxSite[] }[] }[] = [];
  for (const d of distinct) {
    const home = clusters.find((c) => mergeable([...c.variants.map((v) => v.box), d.box]));
    if (home) home.variants.push(d);
    else clusters.push({ variants: [d] });
  }
  // 3. 본문 · 옵션 · 쓰임
  const plans = clusters.map((c, ci): BoxPlan => {
    const first = c.variants[0].box;
    const prefix = `b${ci + 1}`;
    const options: ClauseRecord["options"] = [];
    const selections = c.variants.map(() => ({}) as Record<string, string>);
    const lines: BoxLineNode[] = first.lines.map((text, li) => {
      const id = `${prefix}-l${li + 1}`;
      const texts = c.variants.map((v) => v.box.lines[li]);
      const d = diffRegion([...new Set(texts)]);
      if (!d) return { id, kind: "line", children: [{ id: `${id}-1`, kind: "text", text }] };
      const oc = optionCode(options.length);
      const regions = [...new Set(texts.map((t) => [...t].slice(d.prefix, [...t].length - d.suffixes[0]).join("")))];
      options.push({
        code: oc,
        label: `${li + 1}째 줄`,
        order: options.length,
        values: regions.map((r, vi) => ({ code: valueCode(vi), label: snippet(r, 12) || "(없음)", order: vi, body: [{ id: `${prefix}-o${options.length}v${vi + 1}`, kind: "text", text: r }] })),
      });
      c.variants.forEach((v, vi) => {
        const r = [...v.box.lines[li]].slice(d.prefix, [...v.box.lines[li]].length - d.suffixes[0]).join("");
        selections[vi][oc] = valueCode(regions.indexOf(r));
      });
      const chars = [...text];
      const children: Inline[] = [];
      const before = chars.slice(0, d.prefix).join("");
      const after = chars.slice(chars.length - d.suffixes[0]).join("");
      if (before) children.push({ id: `${id}-1`, kind: "text", text: before });
      children.push({ id: `${id}-2`, kind: "optionSlot", optionCode: oc });
      if (d.suffixes[0] > 0 && after) children.push({ id: `${id}-3`, kind: "text", text: after });
      return { id, kind: "line", children };
    });
    const body: ClauseBoxNode = { id: `${prefix}-b`, kind: "box", title: first.title, lines };
    const allSites = c.variants.flatMap((v) => v.sites);
    const docs = [...new Set(allSites.map((s) => s.doc))];
    return {
      key: `box-${ci + 1}`,
      title: first.title,
      label: first.title ? `【${first.title}】` : `박스 — ${snippet(first.lines[0] ?? "")}`,
      record: {
        label: "",
        mode: "box",
        description: `박스 「${first.title || snippet(first.lines[0] ?? "")}」 — ${docs.length}개 문서 ${allSites.length}자리${options.length ? ` · 낱말 옵션 ${options.length}` : ""}`,
        body: [body],
        options,
      },
      uses: c.variants.flatMap((v, vi) => v.sites.map((site) => ({ site, selection: selections[vi] }))),
    };
  });
  // 4. 이름 — 겹치면 상품, 그래도 겹치면 첫 줄 앞머리, 그래도 겹치면 순번
  const PRODUCT: Record<string, string> = { alpha: "알파Plus", meritz: "메리츠" };
  const dedupe = (pick: (p: BoxPlan) => string) => {
    const groups = new Map<string, BoxPlan[]>();
    for (const p of plans) groups.set(p.label, [...(groups.get(p.label) ?? []), p]);
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const next = group.map(pick);
      if (new Set(next).size === next.length) group.forEach((p, i) => (p.label = next[i]));
    }
  };
  dedupe((p) => {
    const products = [...new Set(p.uses.map((u) => u.site.product))];
    return products.length === 1 ? `${p.label}(${PRODUCT[products[0]] ?? products[0]})` : p.label;
  });
  dedupe((p) => `${p.label} ${snippet(boxLineText(p.record.body[0] as ClauseBoxNode), 16)}`);
  const seen = new Map<string, number>();
  for (const p of plans) {
    const n = (seen.get(p.label) ?? 0) + 1;
    seen.set(p.label, n);
    if (n > 1) p.label = `${p.label} ${n}`;
  }
  for (const p of plans) p.record.label = p.label;
  return plans;
}

/** 박스 첫 줄의 글 (옵션 자리는 빼고). */
function boxLineText(b: ClauseBoxNode): string {
  return (b.lines[0]?.children ?? []).map((n) => (n.kind === "text" ? n.text : "")).join("");
}

/** 원문 박스 자리 하나를 박스 공용조항 참조로 바꾼다 — 같은 목록 자리, id 는 `<박스 id>-k`. */
export function replaceBox(site: BoxSite, code: string, selection: Record<string, string>): void {
  const at = site.list.indexOf(site.node);
  if (at < 0) throw new Error(`박스 ${site.node.id} 자리를 잃었다`);
  site.list.splice(at, 1, { id: `${site.node.id}-k` as Id, kind: "clauseBlockRef", clauseCode: code, options: { ...selection } } as Node);
}
