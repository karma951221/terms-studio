/**
 * 항 단위 자동 판정 (ADR-0020 → 기능/조립산출 §3.5 로 좁힘). 조연결된 담보 조와 보통약관 조를 항 단위로 **위치 대조**해
 * 생략 / 준용 / 통째로 가른다. 조 명과 노드 id는 비교하지 않는다.
 *
 * - 생략: 항 수가 같고 i 번째 항끼리 리터럴 일치.
 * - 준용: 보통약관의 모든 항이 담보 조 안에 같은 상대 순서로 정확히 한 번씩 나타나고 담보 조에 항이 더 있다
 *   → 제1항 = 준용 문장, 그 뒤에 보통약관에 없는 항만 원래 순서대로.
 * - 통째: 그 외 전부. **미합의 사례**(같은 항 두 번 · 항 순서 변경 · 항 참조 슬롯 · 조 참조 슬롯 / 표)는 리터럴로
 *   맞아떨어져도 통째로 두고 `omissionUndecided` warning 하나(표 순서의 첫 사유)를 낸다 — 자동으로 지우는 범위는 좁게.
 *
 * 비교 직렬화: 구조(항·호·목) + 텍스트 + 참조 대상(조 id · 별표 코드). 노드 id 는 비교하지 않는다 —
 * 같은 함수조항을 두 문서가 참조하면 id 접두(`${참조노드id}/…`)만 다르고 내용은 같기 때문.
 * 오류 마커가 있는 조는 절대 같다고 보지 않는다 (마커 id 로 직렬화 → 문서마다 다르다).
 * 띄어쓰기 하나도 다르면 다르다 — 정규화·유사도 없음.
 */

import { refKey } from "../document/pcode";
import type { Id, Issue } from "../types";
import type { ErrorNode, OmissionPair, OmissionPairKind, OmissionRecord, RArticle, RBulletList, RItem, RParagraph, RStatic, RSubitem, SInline, SubstitutedDoc } from "./types";
import { articlesOf, mapArticles } from "./walk";

// ───────────────────────────── 직렬화 ─────────────────────────────

type Compared = RParagraph<SInline> | RStatic<SInline> | ErrorNode;

/**
 * 직렬화기 — `refInsensitive` 면 참조 슬롯을 대상·scope 없이 자리 표시(`a(?)`)로만 적는다.
 * 리터럴 대조는 참조 대상까지 본다(정본). 참조 무시 대조는 기능/조립산출 §3.5 미합의 셋째·넷째 줄(참조를 품은 항)의 **문**이다 —
 * 담보의 자기 참조(`s-1`)와 보통약관의 자기 참조(`g-1`)는 글이 같아도 id 가 달라 리터럴로는 절대 안 맞으므로,
 * 참조를 빼고 같으면 「참조를 품은 항」 으로 잡아 경고를 낸다.
 */
function serializer(refInsensitive: boolean) {
  const inline = (n: SInline): string => {
    switch (n.kind) {
      case "text":
        return `t(${n.text})`;
      case "articleRef":
        return refInsensitive ? "a(?)" : `a(${n.scope}:${n.targets.map((target) => refKey(target)).join(",")}:${n.connector})`;
      case "appendixRef":
        return `x(${n.appendixCode})`;
      case "error":
        return `e(${n.id})`;
    }
  };
  const inlines = (list: readonly SInline[]) => list.map(inline).join("");
  const err = (n: ErrorNode) => `e(${n.id})`;
  const subitem = (n: RSubitem<SInline> | RBulletList<SInline> | ErrorNode) => (n.kind === "error" ? err(n) : n.kind === "bulletList" ? stat(n) : `목[${inlines(n.children)}]`);
  /**
   * 정적 표·박스 · 글머리 목록 — 항과 같은 한 단위로 비교한다 (기능/문면 §3.2).
   * 표는 **열 수·너비까지** 포함한다 — 같은 글자라도 서식이 다르면 다른 조다 (2026-09-08 리뷰 6). 글머리 목록은 항목 문장 순서대로.
   */
  function stat(n: RStatic<SInline>): string {
    if (n.kind === "table") return `표[${n.title ?? ""}|${n.columns.map((c) => c.width ?? "-").join("·")}|${n.rows.map((r) => `${r.header ? "h" : ""}${r.cells.map(inlines).join("¦")}`).join("‖")}]`;
    if (n.kind === "bulletList") return `글머리[${n.items.map((b) => inlines(b.children)).join("‖")}]`;
    return `박스[${n.title}|${n.lines.map(inlines).join("‖")}]`;
  }
  const item = (n: RItem<SInline> | RStatic<SInline> | ErrorNode) => (n.kind === "error" ? err(n) : n.kind !== "item" ? stat(n) : `호[${inlines(n.children)}${(n.subitems ?? []).map(subitem).join("")}]`);
  const paragraph = (n: Compared) => (n.kind === "error" ? err(n) : n.kind !== "paragraph" ? stat(n) : `항[${inlines(n.children)}${(n.items ?? []).map(item).join("")}]`);
  return paragraph;
}

/** 리터럴 직렬화 (정본) · 참조 무시 직렬화 (미합의 셋째·넷째 줄의 문). */
const paragraph = serializer(false);
const paragraphLoose = serializer(true);

/** 조의 본문 직렬화 — 조 명 제외. */
export function articleBody(a: RArticle<SInline>): string {
  return a.children.map(paragraph).join("");
}

// ───────────────────────────── 판정 ─────────────────────────────

export interface OmissionOwner {
  productCoverageId: Id;
  productCoverageName: string;
}

export interface OmissionOutcome {
  doc: SubstitutedDoc;
  records: OmissionRecord[];
  /** 준용 대상이 상품에서 노출 끔이라 준용할 수 없는 자리 (기능/상품 §3.6) · 자동 판정 보류 경고 (기능/조립산출 §3.5). */
  issues: Issue[];
}

/** 미합의 사유 문구 — 기능/조립산출 §3.5 표 그대로. 검사 순서 = 표 순서. */
export const UNDECIDED_REASON = {
  duplicate: "같은 항이 반복돼 자동 판정하지 않았습니다",
  reordered: "항 순서가 달라 자동 판정하지 않았습니다",
  paragraphRef: "항 참조를 품은 항이라 생략하면 참조가 끊깁니다",
  refOrTable: "참조 · 표를 품은 항은 자동 판정하지 않았습니다",
} as const;

/** 비교 대상 항 하나 — 노드 · 원본 배열 자리(`keep` 용) · 표시 서수(pairs) · 리터럴 직렬화 · 참조 무시 직렬화. */
interface ComparedParagraph {
  node: Compared;
  /** `children` 인덱스 — 준용의 `keep` 이 원본 자리를 집는다. */
  index: number;
  /** 표시 서수 — 항이면 렌더 항 번호(`numberDocument` 와 같이 항만 센다 · 비교 제외 항도 렌더되니 센다), 표 · 박스 · 오류면 그 종류 안의 순번. */
  position: number;
  /** 항이 아니면 그 종류. */
  kind?: OmissionPairKind;
  body: string;
  loose: string;
}

/** 비교 대상 항 — 보통약관 쪽은 block 함수조항의 비교 제외 항을 뺀다 (ADR-0020 결정 2). 빈 조는 빈 항 하나로 본다. */
function comparedParagraphs(a: RArticle<SInline>, excludeMarked: boolean): ComparedParagraph[] {
  const out: ComparedParagraph[] = [];
  const counts = { paragraph: 0, table: 0, box: 0, bulletList: 0, error: 0 };
  a.children.forEach((node, index) => {
    const position = ++counts[node.kind];
    if (node.kind === "paragraph" && excludeMarked && node.excludeFromComparison) return;
    out.push({ node, index, position, ...(node.kind === "paragraph" ? {} : { kind: node.kind }), body: paragraph(node), loose: paragraphLoose(node) });
  });
  if (out.length === 0) out.push({ node: { kind: "paragraph", id: `${a.id}::empty`, children: [] }, index: 0, position: 1, body: "항[]", loose: "항[]" });
  return out;
}

/** 대조 한 줄 — 양쪽의 표시 서수와 종류. */
function pairOf(s: ComparedParagraph | undefined, g: ComparedParagraph | undefined, matched: boolean): OmissionPair {
  return {
    special: s?.position ?? null,
    general: g?.position ?? null,
    matched,
    ...(s?.kind ? { specialKind: s.kind } : {}),
    ...(g?.kind ? { generalKind: g.kind } : {}),
  };
}

function containsErrors(a: RArticle<SInline>): boolean {
  return comparedParagraphs(a, false).some((p) => p.body.includes("e("));
}

/**
 * 비교에서 뺀 block 함수조항 참조 노드 id — 펼쳐진 항의 id 는 `${참조노드id}/${원노드id}` 라 첫 `/` 앞이 참조 노드다
 * (`expandClause`). 접두가 없으면(직접 쓴 항에 표시가 붙은 경우) 그 항 id 를 그대로 둔다.
 */
function excludedClauseNodeIds(a: RArticle<SInline>): Id[] {
  const out: Id[] = [];
  for (const p of a.children) {
    if (p.kind !== "paragraph" || !p.excludeFromComparison) continue;
    const slash = p.id.indexOf("/");
    const refId = slash > 0 ? p.id.slice(0, slash) : p.id;
    if (!out.includes(refId)) out.push(refId);
  }
  return out;
}

/** 두 문서의 살아남은 항 · 호 · 목 참조 열쇠(`조id#코드`) — 참조 슬롯의 대상이 항 이하인지(그리고 살아 있는지) 가르는 데 쓴다 (ADR-0072). */
function liveCodedKeys(docs: readonly (SubstitutedDoc | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const doc of docs) {
    if (!doc) continue;
    for (const a of articlesOf(doc)) {
      const add = (key: string | undefined) => {
        if (key !== undefined) out.add(refKey({ articleId: a.id, code: key }));
      };
      for (const p of a.children) {
        if (p.kind !== "paragraph") continue;
        add(p.key);
        for (const it of p.items ?? []) {
          if (it.kind !== "item") continue;
          add(it.key);
          for (const s of it.subitems ?? []) if (s.kind === "subitem") add(s.key);
        }
      }
    }
  }
  return out;
}

/** 항 안의 인라인을 전부 훑는다 — 항 본문 · 호 · 목 · 표 셀. */
function eachInline(list: readonly Compared[], fn: (n: SInline) => void, onTable: () => void): void {
  const inlinesOf = (nodes: readonly SInline[]) => nodes.forEach(fn);
  const staticOf = (n: RStatic<SInline> | RBulletList<SInline>) => {
    if (n.kind === "bulletList") {
      n.items.forEach((b) => inlinesOf(b.children));
      return;
    }
    if (n.kind !== "table") return;
    onTable();
    n.rows.forEach((r) => r.cells.forEach(inlinesOf));
  };
  for (const p of list) {
    if (p.kind === "error") continue;
    if (p.kind !== "paragraph") {
      staticOf(p);
      continue;
    }
    inlinesOf(p.children);
    for (const it of p.items ?? []) {
      if (it.kind === "error") continue;
      if (it.kind !== "item") {
        staticOf(it);
        continue;
      }
      inlinesOf(it.children);
      for (const s of it.subitems ?? []) {
        if (s.kind === "subitem") inlinesOf(s.children);
        else if (s.kind === "bulletList") staticOf(s);
      }
    }
  }
}

/** 지워질 항 안의 참조 슬롯·표 — 항 이하 참조(`paragraphRef`)가 하나라도 있으면 그것이 먼저다 (표 셋째 줄). */
function scanRefsAndTables(list: readonly Compared[], coded: ReadonlySet<string>): { paragraphRef: boolean; refOrTable: boolean } {
  let paragraphRef = false;
  let refOrTable = false;
  eachInline(
    list,
    (n) => {
      if (n.kind !== "articleRef") return;
      refOrTable = true;
      // 대상 노드를 못 찾으면(분기로 사라짐 등) 조 참조로 본다 — 넷째 문구로 흡수.
      if (n.targets.some((t) => t.code !== undefined && coded.has(refKey(t)))) paragraphRef = true;
    },
    () => {
      refOrTable = true;
    },
  );
  return { paragraphRef, refOrTable };
}

/** 남는 담보 항이 같은 조 안(조 자신 · 지워질 항 포함)을 가리키는가 — 준용하면 그 참조가 `articleGone` 으로 깨진다. */
function refersInsideArticle(list: readonly Compared[], articleId: Id): boolean {
  let found = false;
  eachInline(
    list,
    (n) => {
      if (n.kind === "articleRef" && n.targets.some((t) => t.articleId === articleId)) found = true;
    },
    () => {},
  );
  return found;
}

const hasDuplicate = (bodies: readonly string[]) => new Set(bodies).size !== bodies.length;
type Key = "body" | "loose";

/** 위치 대조 — i 번째끼리. 보통약관이 더 길면 남는 보통약관 항은 `special: null` 행으로 남긴다 (근거 표시). */
function positionalPairs(special: readonly ComparedParagraph[], general: readonly ComparedParagraph[], key: Key): { all: boolean; pairs: OmissionPair[] } {
  const pairs: OmissionPair[] = [];
  const n = Math.max(special.length, general.length);
  for (let i = 0; i < n; i++) {
    const s = special[i];
    const g = general[i];
    pairs.push(pairOf(s, g, s !== undefined && g !== undefined && s[key] === g[key]));
  }
  return { all: special.length === general.length && pairs.every((p) => p.matched), pairs };
}

/**
 * 순서 유지 대조 — 보통약관 항을 담보 조 안에서 앞에서부터 차례로 찾는다 (상대 순서 유지 · 한 번씩).
 * 전부 찾으면 준용 후보. 「정확히 한 번」은 앞선 중복 검사가 보장한다. 실패면 위치 대조 표를 돌려준다.
 */
function orderedPairs(special: readonly ComparedParagraph[], general: readonly ComparedParagraph[], key: Key): { all: boolean; pairs: OmissionPair[]; matchedSpecial: Set<number> } {
  const generalAt = new Map<number, ComparedParagraph>();
  let cursor = 0;
  for (const g of general) {
    const found = special.findIndex((s, i) => i >= cursor && s[key] === g[key]);
    if (found < 0) return { all: false, pairs: positionalPairs(special, general, key).pairs, matchedSpecial: new Set() };
    generalAt.set(found, g);
    cursor = found + 1;
  }
  return {
    all: true,
    pairs: special.map((s, i) => pairOf(s, generalAt.get(i), generalAt.has(i))),
    matchedSpecial: new Set(generalAt.keys()),
  };
}

/** 옛 순서 무관 매칭(ADR-0020)이라면 맞았을 것인가 — 보통약관 항 멀티셋이 담보 조에 다 들어 있다. */
function containsAllUnordered(special: readonly ComparedParagraph[], general: readonly ComparedParagraph[]): boolean {
  const used = new Set<number>();
  for (const g of general) {
    const found = special.findIndex((s, index) => !used.has(index) && s.body === g.body);
    if (found < 0) return false;
    used.add(found);
  }
  return true;
}

function topicParticle(title: string): "은" | "는" {
  const code = title.charCodeAt(title.length - 1);
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0 ? "은" : "는";
}

function applicationParagraph(article: RArticle<SInline>, linkedArticleId: Id, owner: OmissionOwner): RParagraph<SInline> {
  const id = `${article.id}::application`;
  const at = { document: "special" as const, ownerId: owner.productCoverageId, ownerName: owner.productCoverageName, articleId: article.id, articleTitle: article.title, nodePath: [id] };
  return {
    kind: "paragraph",
    id,
    children: [
      { kind: "text", id: `${id}::prefix`, text: `이 특별약관의 ${article.title}${topicParticle(article.title)} ` },
      { kind: "articleRef", id: `${id}::ref`, targets: [{ articleId: linkedArticleId }], connector: "및", scope: "general", at },
      { kind: "text", id: `${id}::suffix`, text: "를 준용합니다." },
    ],
  };
}

interface Verdict {
  disposition: OmissionRecord["disposition"];
  pairs: OmissionPair[];
  reason?: string;
  /** 준용에서 남기는 담보 항의 (a.children) 인덱스. */
  keep?: number[];
}

/**
 * 한 조의 판정.
 * 1. 리터럴로 맞아떨어지는 조(위치 대조 · 순서 유지 대조 · 옛 순서 무관 대조 중 하나) → 미합의 사례를 표 순서로 거르고,
 *    남으면 위치 대조(생략) → 순서 유지 대조(준용).
 * 2. 리터럴로는 안 맞지만 **참조를 빼고 보면** 맞는 조 → 셋째·넷째 줄(참조·표를 품은 항). 담보의 자기 참조와 보통약관의
 *    자기 참조는 id 가 달라 리터럴로는 절대 안 맞는다 — 이 문이 없으면 그 조는 경고 없는 통째가 된다.
 * 3. 둘 다 아니면 그냥 통째 — 경고 없음 (기능/조립산출 §3.5 「리터럴로는 맞아떨어져도 자동 처리하지 않고」 — 내용이 다른 조에
 *    참조 경고를 얹으면 고칠 수 없는 소음이다).
 *
 * 참조 슬롯 · 표는 **지워질 담보 항**(생략은 전부, 준용은 보통약관과 짝지은 항)에서 찾고, 준용에서 **남는 항**은 같은 조 안을
 * 가리키는 참조가 있는지 본다 — 지워질 항을 가리키면 렌더가 `articleGone` 오류를 내므로 (원문 유지가 ADR 의 뜻) 준용하지 않는다.
 * @param kinds 두 문서의 살아남은 항 · 호 · 목 참조 열쇠 (참조 슬롯 대상이 조인지 항·호·목인지).
 */
function judgeArticle(a: RArticle<SInline>, target: RArticle<SInline>, kinds: ReadonlySet<string>): Verdict {
  const special = comparedParagraphs(a, false);
  const general = comparedParagraphs(target, true);
  const positional = positionalPairs(special, general, "body");
  const ordered = orderedPairs(special, general, "body");
  const nodes = (list: readonly ComparedParagraph[]) => list.map((p) => p.node);
  const undecided = (reason: string, pairs: OmissionPair[] = positional.pairs): Verdict => ({ disposition: "full", pairs, reason });

  if (!positional.all && !ordered.all && !containsAllUnordered(special, general)) {
    // 참조 무시 대조 — 위치 또는 순서 유지로 맞으면 지워질 항에서 참조·표를 찾는다 (있어야만 이 길로 온 것이 설명된다).
    const loosePositional = positionalPairs(special, general, "loose");
    const looseOrdered = loosePositional.all ? undefined : orderedPairs(special, general, "loose");
    const looseHit = loosePositional.all ? loosePositional : looseOrdered?.all ? looseOrdered : undefined;
    if (looseHit) {
      const removed = loosePositional.all ? special : special.filter((_p, i) => looseOrdered!.matchedSpecial.has(i));
      const scanned = scanRefsAndTables(nodes(removed), kinds);
      if (scanned.paragraphRef) return undecided(UNDECIDED_REASON.paragraphRef, looseHit.pairs);
      if (scanned.refOrTable) return undecided(UNDECIDED_REASON.refOrTable, looseHit.pairs);
    }
    return { disposition: "full", pairs: positional.pairs };
  }

  // 1. 같은 항 두 번 — 어느 쪽이든.
  if (hasDuplicate(special.map((p) => p.body)) || hasDuplicate(general.map((p) => p.body))) return undecided(UNDECIDED_REASON.duplicate);
  // 2. 항 순서 변경 — 옛 순서 무관 매칭(ADR-0020)이라면 생략·준용이었을 텐데 위치·순서 대조가 실패.
  if (!positional.all && !ordered.all) return undecided(UNDECIDED_REASON.reordered);
  // 3·4. 지워질 항 안의 참조 슬롯 · 표 — 항 이하 참조가 하나라도 있으면 셋째 문구, 그 외 참조·표는 넷째 문구.
  const removed = positional.all ? special : special.filter((_p, i) => ordered.matchedSpecial.has(i));
  const scanned = scanRefsAndTables(nodes(removed), kinds);
  if (scanned.paragraphRef) return undecided(UNDECIDED_REASON.paragraphRef);
  if (scanned.refOrTable) return undecided(UNDECIDED_REASON.refOrTable);

  if (positional.all) return { disposition: "omitted", pairs: positional.pairs };
  // 준용 — 남는 항이 같은 조 안을 가리키면 준용하지 않는다 (지워질 항을 가리키는 참조는 깨진다).
  const kept = special.filter((_p, i) => !ordered.matchedSpecial.has(i));
  if (refersInsideArticle(nodes(kept), a.id)) return undecided(UNDECIDED_REASON.paragraphRef, ordered.pairs);
  return { disposition: "applied", pairs: ordered.pairs, keep: kept.map((p) => p.index) };
}

/**
 * @param hidden 상품이 노출을 끈 보통약관 조 id → 조 명 (기능/상품 §3.6). 준용 대상이 이 중에 있으면 오류를 내고 그 조는 `full` 로 둔다.
 */
export function judgeOmission(special: SubstitutedDoc, general: SubstitutedDoc | undefined, owner: OmissionOwner, hidden?: ReadonlyMap<Id, string>): OmissionOutcome {
  const generalArticles = new Map<Id, RArticle<SInline>>();
  if (general) for (const a of articlesOf(general)) generalArticles.set(a.id, a);
  const kinds = liveCodedKeys([special, general]);

  const records: OmissionRecord[] = [];
  const issues: Issue[] = [];
  const doc = mapArticles(special, (a): RArticle<SInline> | null => {
    if (a.linkedArticleId === undefined) return a;
    const target = generalArticles.get(a.linkedArticleId);
    const hiddenTitle = target ? undefined : hidden?.get(a.linkedArticleId);
    const at = { document: "special" as const, ownerId: owner.productCoverageId, ownerName: owner.productCoverageName, articleId: a.id, articleTitle: a.title };
    if (hiddenTitle !== undefined) {
      // 준용할 보통약관 조가 상품에서 노출 끔 — 판정은 통째(full)로 두고(문면은 남긴다) 오류로 드러낸다 (기능/상품 §3.6).
      issues.push({ kind: "articleHidden", severity: "error", message: `준용할 보통약관 조 「${hiddenTitle}」 은(는) 상품에서 노출을 껐습니다`, at });
    }
    let verdict: Verdict = { disposition: "full", pairs: [] };
    let output: RArticle<SInline> | null = a;
    if (target && !containsErrors(a) && !containsErrors(target)) {
      verdict = judgeArticle(a, target, kinds);
      if (verdict.disposition === "omitted") output = null;
      else if (verdict.disposition === "applied") output = { ...a, children: [applicationParagraph(a, a.linkedArticleId, owner), ...(verdict.keep ?? []).map((index) => a.children[index])] };
      if (verdict.reason !== undefined) {
        // 미합의 — 원문 유지는 틀린 문서가 아니므로 warning (complete 를 깨지 않는다). 좌표는 담보 조 (기능/조립산출 §3.5).
        issues.push({ kind: "omissionUndecided", severity: "warning", message: verdict.reason, at: { ...at, nodePath: [a.id] } });
      }
    }
    records.push({
      ...owner,
      articleId: a.id,
      articleTitle: a.title,
      linkedArticleId: a.linkedArticleId,
      disposition: verdict.disposition,
      pairs: verdict.pairs,
      excludedClauseNodeIds: target ? excludedClauseNodeIds(target) : [],
      ...(verdict.reason !== undefined ? { reason: verdict.reason } : {}),
    });
    return output;
  });
  return { doc, records, issues };
}
