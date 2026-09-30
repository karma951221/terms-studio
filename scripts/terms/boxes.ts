/**
 * 원문 박스 → 정적 마스터 박스 (개발 도구 — 제품 기능 아님). 근거: 기능/박스 §3.1 · 최종 결정 9 (박스는 함수조항 유형이 아니다).
 *
 * 원문의 박스(【용어풀이】 · 【보험금 지급예시】 · 민법 인용 …)는 모두 박스 마스터 레코드가 되고, 그 자리는 박스 참조(`boxRef`)가 된다.
 *
 * - 같은 박스(제목 · 줄이 글자까지 같다)는 하나로 합친다.
 * - 낱말만 다른 박스도 **따로** 만든다 — 박스에는 옵션이 없다(정적 마스터 = 코드 · 이름 · 제목 · 줄). 각 자리는 제 글의 박스를 놓는다.
 *   낱말만 다른 무리(제목 · 줄 수가 같고, 줄마다 공통 앞뒤를 떼고 남는 구간이 짧다 — `MAX_REGION` 자 · 다른 줄 `MAX_LINES` 이하)는
 *   이름에만 쓴다: 무리 이름 뒤에 그 박스의 (첫) 다른 낱말(박스 이름은 유일해야 한다).
 * - 이름은 「【제목】」(제목 없는 박스는 「박스 — 첫 줄 앞머리」). 겹치면 상품 이름, 그래도 겹치면 첫 줄 앞머리 · 순번을 붙인다.
 */
import type { BoxNode, DocumentNode, Node } from "../../src/domain/document/nodes";
import type { Id } from "../../src/domain/types";

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

/** 박스 마스터 레코드 — 시드 `boxes.json` 한 줄. 코드는 적재 순서로 변환기가 매긴다(채번 대조용). */
export interface BoxRecord {
  code: string;
  name: string;
  title: string;
  lines: string[];
}

/** 박스 한 건의 계획 — 레코드와 그것을 놓을 원문 자리들. */
export interface BoxPlan {
  key: string;
  record: BoxRecord;
  sites: BoxSite[];
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
 * 원문 박스 자리 전부 → 박스 마스터 계획. 같은 박스(글자까지 같다)는 하나, 낱말만 다른 박스도 **따로**(옵션 없음) —
 * 낱말만 다른 무리는 이름을 짓는 데만 쓴다: 무리 이름 뒤에 그 박스의 다른 낱말(「【계약 전 알릴 의무】 — 청약서에서」).
 * 순서는 첫 등장 순(문서 순서 그대로, 한 무리의 박스는 붙여서) — 코드는 변환기가 적재 순서대로 매긴다.
 */
export function planBoxes(sites: readonly BoxSite[]): BoxPlan[] {
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
  // 2. 낱말만 다른 박스끼리 — 첫 등장이 무리의 씨앗 (이름 짓기용)
  const clusters: { label: string; variants: { box: BoxNode; sites: BoxSite[] }[] }[] = [];
  for (const d of distinct) {
    const home = clusters.find((c) => mergeable([...c.variants.map((v) => v.box), d.box]));
    if (home) home.variants.push(d);
    else clusters.push({ label: "", variants: [d] });
  }
  // 3. 무리 이름 — 「【제목】」(제목 없으면 「박스 — 첫 줄 앞머리」). 겹치면 상품, 그래도 겹치면 첫 줄 앞머리
  for (const c of clusters) {
    const first = c.variants[0].box;
    c.label = first.title ? `【${first.title}】` : `박스 — ${snippet(first.lines[0] ?? "")}`;
  }
  const PRODUCT: Record<string, string> = { alpha: "알파Plus", meritz: "메리츠" };
  const dedupe = (pick: (c: (typeof clusters)[number]) => string) => {
    const groups = new Map<string, (typeof clusters)[number][]>();
    for (const c of clusters) groups.set(c.label, [...(groups.get(c.label) ?? []), c]);
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const next = group.map(pick);
      if (new Set(next).size === next.length) group.forEach((c, i) => (c.label = next[i]));
    }
  };
  dedupe((c) => {
    const products = [...new Set(c.variants.flatMap((v) => v.sites.map((s) => s.product)))];
    return products.length === 1 ? `${c.label}(${PRODUCT[products[0]] ?? products[0]})` : c.label;
  });
  dedupe((c) => `${c.label} ${snippet(c.variants[0].box.lines[0] ?? "", 16)}`);
  // 4. 무리 → 박스 하나씩. 여러 박스인 무리는 이름에 다른 낱말(줄마다의 다른 구간)을 붙인다
  const plans = clusters.flatMap((c, ci) =>
    c.variants.map((v, vi): BoxPlan => {
      let name = c.label;
      if (c.variants.length > 1) {
        // 첫 번째로 다른 줄의 다른 구간 — 그 무리 안에서 박스를 가른다(겹치면 아래 순번)
        const li = v.box.lines.findIndex((_, i) => new Set(c.variants.map((x) => x.box.lines[i])).size > 1);
        const d = diffRegion([...new Set(c.variants.map((x) => x.box.lines[li]))])!;
        const text = [...v.box.lines[li]];
        name = `${c.label} — ${snippet(text.slice(d.prefix, text.length - d.suffixes[0]).join(""), 12) || "(없음)"}`;
      }
      return { key: `box-${ci + 1}-${vi + 1}`, record: { code: "", name, title: v.box.title, lines: [...v.box.lines] }, sites: v.sites };
    }),
  );
  // 5. 그래도 겹치면 순번
  const seen = new Map<string, number>();
  for (const p of plans) {
    const n = (seen.get(p.record.name) ?? 0) + 1;
    seen.set(p.record.name, n);
    if (n > 1) p.record.name = `${p.record.name} ${n}`;
  }
  return plans;
}

/** 원문 박스 자리 하나를 박스 참조로 바꾼다 — 같은 목록 자리, id 는 `<박스 id>-k`. */
export function replaceBox(site: BoxSite, code: string): void {
  const at = site.list.indexOf(site.node);
  if (at < 0) throw new Error(`박스 ${site.node.id} 자리를 잃었다`);
  site.list.splice(at, 1, { id: `${site.node.id}-k` as Id, kind: "boxRef", boxCode: code } as Node);
}
