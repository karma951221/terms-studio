/**
 * 알파Plus 납입면제 재모델링 (개발 도구 — 제품 기능 아님). 근거: 최종 결정 10 · 11 · 13 · 16 · 22 · 23,
 * ADR-0077 템플릿 스케치, 기능/함수조항 §3.7 「역할 함수조항」, QA/실물재현/알파플러스_모델명세 §6.
 *
 * 원문의 제27조의1 · 의2 · 의3 · 제22조(무효) · 제30조(부활)를 **변환된 보통약관 트리에서** 역할 함수조항 여섯과 반복 템플릿으로 바꾼다.
 * 문장은 원문 노드를 그대로 옮긴다(참조 · 별표 슬롯 · 박스 참조 포함) — 새로 짓는 글은 원문에 없는 두 칸뿐이다:
 * 「암·무면책」 호(암보장개시일 없는 암 호)와 무효 문구의 암보장개시일 항(인수기준 알려진 차이).
 *
 * - 템플릿은 사유 값으로 분기하지 않는다(결정 10) — 제27조의1 ① = [납입면제종마다] 항 › [현재 종의 사유마다] ⟨납입면제 호(사유 ← 현재 사유)⟩,
 *   제27조의3 = [사유 합집합 ∩ 정의조대상마다] ⟨정의(사유 ← 현재 사유)⟩, 나머지 자리는 ⟨역할(종들 ← 적용 납입면제종)⟩ 한 줄.
 * - 세 조는 「납입면제 있음」(D0002) 조 자리 IF 로 감싼다(결정 16).
 * - 반복으로 생긴 호를 가리키는 참조(「제1항 제1호」 · 「제10호, 제11호」)는 값 한정 참조다(결정 13) — 사유 = 해당 값들.
 *
 * 조 참조 대상은 변환 중간 모양(노드 id 를 `articleId` 자리에)이다 — convert.ts `codeTargets` · `codeClauseTargets` 가 P코드로 바꾼다.
 */
import type { Block, Inline, ItemNode as ClauseItem, ParagraphNode as ClauseParagraph } from "../../src/domain/clause/nodes";
import type { Binding, ParamDef } from "../../src/domain/clause/params";
import type { LocalDef } from "../../src/domain/clause/locals";
import type { ArticleNode, ArticleRefNode, BlockNode, ClauseBlockRefNode, DocumentNode, ForBlockNode, InlineNode, ItemNode, ParagraphNode, SectionNode } from "../../src/domain/document/nodes";
import type { Code, Id, RefRestrict } from "../../src/domain/types";

import type { ClauseRecord } from "./clauses";
import { allArticles, reId } from "./clauses";
import { withClauseCodes } from "../../src/domain/clause/pcode";

/** 역할 함수조항이 읽는 보통약관 한 벌 — 트리와 원문 조 번호. */
export interface WaiverSource {
  tree: DocumentNode;
  numberOf: Map<Id, string>;
}

/** 「납입면제 있음」 — 상품 레벨 구분자(적용 종이 있는가, discriminators.json). 세 조를 조 자리 IF 로 감싼다 (결정 16). */
export const WAIVER_PRESENT = "D0002";

/**
 * 「해약환급금 지급형 있음」 — 상품 레벨 구분자 `any(D0003)`(D0003 = 형의 무저해지 유형이 해약환급금지급형, discriminators.json).
 * 알파Plus 제27조의1 ④ 「1형(해약환급금 지급형)의 경우 … 적립보험료 납입을 중지합니다」를 항 자리 IF 로 감싼다 (최종 결정 24 「상품 범위 조건」).
 */
export const SURRENDER_PAYING = "D0004";

/** 부활 문구의 기준일 옵션 — 알파Plus 「계약일」 · 메리츠 「최초계약일」. */
const REVIVE_OPTION = "O01";
const REVIVE_VALUE = { 계약일: "V01", 최초계약일: "V02" } as const;
const REVIVE_TEXT = (word: string) => `부활(효력회복)시 부활(효력회복)일을 ${word}로 하여 암보장개시일을 적용합니다.`;

/** E0001 납입면제사유 값 코드 (enums.json — 열거형 순서). */
export const REASON = {
  cancerWaiting: "V01",
  cancerNoWaiting: "V02",
  diseases: ["V03", "V04", "V05", "V06", "V07", "V08", "V09", "V10"],
  disability: ["V11", "V12", "V13"],
  injuryDisability: ["V11", "V12"],
  burn: "V14",
} as const;

/** 적용 납입면제종 — 세목 waiver 선택지 중 적용여부 = 예 (반복 원천 · 인자 원천 연결이 같은 거름을 쓴다). */
const APPLIED = { form: "waiver", filter: "waiver.applies = true" } as const;
const APPLIED_BINDING: Binding = { kind: "source", source: { ...APPLIED } };

const REASON_PARAM: ParamDef = { name: "사유", type: { kind: "enum", enumCode: "E0001" } };
const PLANS_PARAM: ParamDef = { name: "종들", type: { kind: "planOptions", form: "waiver" } };

/** 종들 → 사유 묶음 → 판정 (내부 변수, 결정 2 · 22). 암보장개시일 문장은 면책여부(F02) = 예인 사유가 있을 때만 (ADR-0078 「면책 여부」). */
const REASONS_LOCAL: LocalDef = { name: "사유들", expr: "arg.종들.합치기(waiver.reasons)" };
const WAITING_LOCAL: LocalDef = { name: "면책있음", expr: "not var.사유들.거르기(F02 = true).비었음" };
const DISABILITY_LOCAL: LocalDef = { name: "장해있음", expr: `var.사유들.있음(${REASON.disability.map((v) => `'${v}'`).join(", ")})` };
const DISABILITY_BURN_LOCAL: LocalDef = { name: "장해화상", expr: `var.사유들.있음(${[...REASON.disability, REASON.burn].map((v) => `'${v}'`).join(", ")})` };
const INJURY_BURN_LOCAL: LocalDef = { name: "상해관련", expr: `var.사유들.있음(${[...REASON.injuryDisability, REASON.burn].map((v) => `'${v}'`).join(", ")})` };
const INJURY_LOCAL: LocalDef = { name: "상해장해", expr: `var.사유들.있음(${REASON.injuryDisability.map((v) => `'${v}'`).join(", ")})` };

export interface WaiverClause {
  key: string;
  record: ClauseRecord;
}

function articleOf(src: WaiverSource, number: string): ArticleNode {
  const a = [...allArticles(src.tree)].find((x) => src.numberOf.get(x.id) === number);
  if (!a) throw new Error(`납입면제 재모델링: 조 ${number} 없음`);
  return a;
}

function paragraphs(a: ArticleNode): ParagraphNode[] {
  return a.children.filter((c): c is ParagraphNode => c.kind === "paragraph");
}

/** 조의 항 · 호 · 목 id → 노드 (참조 대상 판정용). */
function structIds(a: ArticleNode): Set<Id> {
  const out = new Set<Id>([a.id]);
  for (const p of paragraphs(a)) {
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
 * 원문 조 참조 → 역할 함수조항 조 참조. `inside` 를 가리키면 「이 함수조항」, 나머지는 보통약관 참조(변환 중간 모양 = 노드 id).
 * `remap` 은 사라지는 원문 노드(제27조의1 의 호)를 반복 템플릿 노드 + 값 한정으로 옮긴다 — 같은 한정으로 모인 대상은 하나로 합친다.
 */
type Remapped = { articleId: Id; innerCode?: Code; restrict?: RefRestrict };
type Remap = (id: Id, ref: ArticleRefNode) => Remapped | undefined;

/** 값 한정 둘을 합친다 — 같은 대상(조 · 안쪽 코드)이면 해당 값들의 합(열거형 순서 = 코드 순). */
function mergeTarget(targets: Remapped[], next: Remapped): void {
  const same = targets.find((x) => x.articleId === next.articleId && x.innerCode === next.innerCode && !!x.restrict === !!next.restrict);
  if (!same) {
    targets.push(next);
    return;
  }
  const values = (r: RefRestrict | undefined) => (r && "values" in r ? r.values : []);
  if (same.restrict) same.restrict = { values: [...new Set([...values(same.restrict), ...values(next.restrict)])].sort() };
}

function clauseInline(n: InlineNode, inside: ReadonlySet<Id>, remap: Remap): Inline {
  switch (n.kind) {
    case "articleRef": {
      const own = n.targets.filter((t) => inside.has(t.articleId));
      if (own.length === n.targets.length) return { id: n.id, kind: "articleRef", targets: n.targets.map((t) => ({ articleId: t.articleId })), connector: n.connector, scope: "clause" };
      if (own.length > 0) throw new Error(`납입면제 재모델링: 조 참조 ${n.id} 가 함수조항 안팎을 함께 가리킨다`);
      const targets: Remapped[] = [];
      for (const t of n.targets) mergeTarget(targets, remap(t.articleId, n) ?? { articleId: t.articleId });
      // 반복 · 값 한정 대상은 하나여도 연결어가 있어야 한다(P3 인계) — 원문의 연결어(변환기 기본 「및」 · 「또는」)를 그대로 둔다
      return { id: n.id, kind: "articleRef", targets, connector: n.connector ?? "및" };
    }
    case "text":
    case "slot":
    case "appendixRef":
      return { ...n };
    default:
      throw new Error(`납입면제 재모델링: 역할 함수조항에 올 수 없는 노드 ${n.kind} (${n.id})`);
  }
}

function clauseInlines(list: readonly InlineNode[], inside: ReadonlySet<Id>, remap: Remap): Inline[] {
  return structuredClone(list).map((n) => clauseInline(n as InlineNode, inside, remap));
}

function clauseItem(it: ItemNode, inside: ReadonlySet<Id>, remap: Remap): ClauseItem {
  const subitems = (it.subitems ?? []).map((u) => {
    if (u.kind !== "subitem") throw new Error(`납입면제 재모델링: 목 목록에 ${u.kind}`);
    return { id: u.id, kind: "subitem" as const, children: clauseInlines(u.children, inside, remap) };
  });
  return { id: it.id, kind: "item", children: clauseInlines(it.children, inside, remap), ...(subitems.length ? { subitems } : {}) };
}

/** 원문 조의 블록(항 · 박스 참조) → 함수조항 블록. */
function clauseBlock(b: BlockNode, inside: ReadonlySet<Id>, remap: Remap): Block {
  if (b.kind === "boxRef") return { id: b.id, kind: "boxRef", boxCode: b.boxCode };
  if (b.kind !== "paragraph") throw new Error(`납입면제 재모델링: 함수조항 본문에 올 수 없는 블록 ${b.kind} (${b.id})`);
  const items = (b.items ?? []).map((it) => {
    if (it.kind === "boxRef") return { id: it.id, kind: "boxRef" as const, boxCode: it.boxCode };
    if (it.kind !== "item") throw new Error(`납입면제 재모델링: 호 목록에 ${it.kind} (${b.id})`);
    return clauseItem(it, inside, remap);
  });
  const p: ClauseParagraph = { id: b.id, kind: "paragraph", children: clauseInlines(b.children, inside, remap), ...(items.length ? { items } : {}) };
  return p;
}

/** 원문 조 블록 `ids` 순서대로 (항 id · 박스 참조 id). */
function takeBlocks(a: ArticleNode, ids: readonly Id[]): BlockNode[] {
  return ids.map((id) => {
    const b = a.children.find((c) => c.id === id);
    if (!b) throw new Error(`납입면제 재모델링: ${a.id} 에 블록 ${id} 없음`);
    return b;
  });
}

/** 원문 항 k 부터 다음 항 앞까지의 블록 id (뒤따르는 박스 참조 포함). */
function paragraphRun(a: ArticleNode, from: number, to = from): Id[] {
  const ps = paragraphs(a);
  const start = a.children.indexOf(ps[from - 1]);
  const end = to < ps.length ? a.children.indexOf(ps[to]) : a.children.length;
  if (start < 0) throw new Error(`납입면제 재모델링: ${a.id} 제${from}항 없음`);
  return a.children.slice(start, end).map((c) => c.id);
}

/** 글 한 줄 문장. */
const text = (id: Id, value: string): Inline => ({ id, kind: "text", text: value });

function record(key: string, label: string, mode: ClauseRecord["mode"], description: string, body: Block[] | ClauseItem[] | unknown[], params: ParamDef[], locals: LocalDef[] = [], options: ClauseRecord["options"] = []): WaiverClause {
  // 노드 id 를 결정적으로 다시 매긴다 — 「이 함수조항」 참조 대상도 따라간다 (clauses.ts reId)
  const rebased = reId(body as unknown[], `c-${key}`);
  return {
    key,
    record: { code: "", label, mode, description, body: rebased as ClauseRecord["body"], options, params, ...(locals.length ? { locals } : {}) },
  };
}

/** 값별 분기 칸 — 값 코드 여러 개(열거형 순서), 빈 목록이면 「문구 없음」. */
function switchCase(id: Id, values: readonly Code[], children: unknown[]): { id: Id; values: Code[]; empty?: true; children: unknown[] } {
  return { id, values: [...values], ...(children.length === 0 ? { empty: true as const } : {}), children };
}

/** 같은 블록의 사본 — id 에 접미를 붙여 한 함수조항 안에서 유일하게. */
function copyWithSuffix<T>(node: T, suffix: string): T {
  const copy = structuredClone(node);
  const visit = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(visit);
    if (!n || typeof n !== "object") return;
    const o = n as Record<string, unknown>;
    if (typeof o.id === "string") o.id = `${o.id}${suffix}`;
    // 「이 함수조항」 참조 대상도 같은 접미 — 사본 안의 항을 가리킨다
    if (o.kind === "articleRef" && o.scope === "clause") o.targets = (o.targets as { articleId?: Id }[]).map((t) => ({ ...t, articleId: `${t.articleId}${suffix}` }));
    Object.values(o).forEach(visit);
  };
  visit(copy);
  return copy;
}

/**
 * 알파Plus 보통약관의 납입면제 자리를 역할 함수조항 · 반복 템플릿으로 바꾸고, 역할 함수조항 여섯을 돌려준다(적재 순서).
 * `meritz` 는 중증화상및부식 정의 칸의 원문(메리츠 제30조) — 알파Plus 에는 그 사유가 없지만 값마다 칸이 있어야 한다(결정 5).
 */
export function applyAlphaWaiver(alpha: WaiverSource, meritz: WaiverSource): WaiverClause[] {
  const a22 = articleOf(alpha, "22");
  const a27 = articleOf(alpha, "27의1");
  const a27d = articleOf(alpha, "27의2");
  const a27x = articleOf(alpha, "27의3");
  const a30 = articleOf(alpha, "30");
  const m30 = articleOf(meritz, "30");

  // ── 제27조의1 반복 템플릿의 노드 id — 역할 함수조항의 값 한정 참조가 가리킨다
  const p1 = paragraphs(a27)[0];
  const outerId = `${a27.id}-for-plans`;
  const innerId = `${a27.id}-for-reasons`;
  const itemRefId = `${a27.id}-p1-k`;
  const items = (p1.items ?? []).filter((it): it is ItemNode => it.kind === "item");
  if (items.length !== 11) throw new Error(`납입면제 재모델링: 제27조의1 ① 호가 11개가 아니다(${items.length})`);
  const cancerItem = items[0].id;
  const disabilityItems = new Set([items[9].id, items[10].id]);
  const remap: Remap = (id) => {
    if (id === cancerItem) return { articleId: itemRefId, restrict: { values: [REASON.cancerWaiting] } };
    if (disabilityItems.has(id)) return { articleId: itemRefId, restrict: { values: [...REASON.disability] } };
    if (id.startsWith(`${a27.id}-p1-i`)) throw new Error(`납입면제 재모델링: 제27조의1 ① 호 ${id} 를 가리키는 참조를 옮길 곳이 없다`);
    return undefined;
  };

  // ── ① 납입면제 호(사유) — 호 유형, switch 값마다 칸 · 원문 글 그대로(조사 · 암 호 차이). 상해및질병80% 는 호 둘
  const noInside = new Set<Id>();
  const item = (it: ItemNode) => clauseItem(it, noInside, remap);
  const itemCases = [
    switchCase("k-cancer", [REASON.cancerWaiting], [item(items[0])]),
    switchCase("k-cancer-nowait", [REASON.cancerNoWaiting], [{ id: "i-cancer-nowait", kind: "item", children: [text("t-cancer-nowait", "피보험자가「암(유사암제외)」으로 진단확정되었을 경우")] }]),
    ...REASON.diseases.map((v, i) => switchCase(`k-${v}`, [v], [item(items[1 + i])])),
    switchCase("k-disability", [REASON.disability[0]], [item(items[9]), item(items[10])]),
    switchCase("k-injury", [REASON.disability[1]], [copyWithSuffix(item(items[9]), "-injury")]),
    switchCase("k-illness", [REASON.disability[2]], [copyWithSuffix(item(items[10]), "-illness")]),
    // 중증화상및부식 — 메리츠 원문 제29조 ② 제6호의 글(알파Plus 에는 없는 사유)
    switchCase("k-burn", [REASON.burn], [{ id: "i-burn", kind: "item", children: [text("t-burn", "피보험자가 「중증화상및부식」으로 진단확정되었을 경우")] }]),
  ];
  const itemClause = record(
    "waiver-item",
    "납입면제 호",
    "item",
    "납입면제 조 ① 의 사유 호 — 사유(E0001) 값마다 칸, 원문 글 그대로. 상해및질병80%이상후유장해는 호 둘(상해 · 질병). 템플릿의 [현재 종의 사유마다] 반복 안에서 사유 ← 현재 원소",
    [{ id: "sw", kind: "switchBlock", on: "arg.사유", cases: itemCases }],
    [REASON_PARAM],
  );

  // ── ② 정의(사유) — 항 유형, switch 값마다 정의 · 진단확정 항. 장해는 「문구 없음」, 암 칸 안에 박스(정적 마스터)
  const x = a27x;
  const xInside = structIds(x);
  const blocks = (ids: readonly Id[], src: ArticleNode = x, inside: ReadonlySet<Id> = xInside) => takeBlocks(src, ids).map((b) => clauseBlock(b, inside, remap));
  const m30Blocks = paragraphRun(m30, 9, 10);
  const definitionCases = [
    switchCase("k-cancer", [REASON.cancerWaiting, REASON.cancerNoWaiting], blocks(paragraphRun(x, 1, 4))),
    switchCase("k-V03", ["V03"], blocks(paragraphRun(x, 5, 6))),
    switchCase("k-V04", ["V04"], blocks(paragraphRun(x, 7, 8))),
    switchCase("k-V05", ["V05"], blocks(paragraphRun(x, 9))),
    switchCase("k-V06", ["V06"], blocks(paragraphRun(x, 10))),
    switchCase("k-V07", ["V07"], blocks(paragraphRun(x, 11, 12))),
    switchCase("k-V08", ["V08"], blocks(paragraphRun(x, 13, 14))),
    switchCase("k-V09", ["V09"], blocks(paragraphRun(x, 15, 17))),
    switchCase("k-V10", ["V10"], blocks(paragraphRun(x, 18, 19))),
    switchCase("k-disability", [...REASON.disability], []),
    // 중증화상및부식 — 메리츠 원문 제30조 ⑨ ⑩ (알파Plus 에는 없는 사유)
    switchCase("k-burn", [REASON.burn], blocks(m30Blocks, m30, structIds(m30))),
  ];
  const definitionClause = record(
    "waiver-definition",
    "정의 및 진단확정(알파Plus)",
    "block",
    "「…의 정의 및 진단확정」 조의 본문 — 사유 값마다 정의 · 진단확정 항(암 칸 안에 【용어풀이】 박스 둘). 장해 값은 문구 없음(정의조대상 = 아니오). 템플릿의 [사유 합집합 ∩ 정의조대상마다] 반복 안에서 사유 ← 현재 원소",
    [{ id: "sw", kind: "switchBlock", on: "arg.사유", cases: definitionCases }],
    [REASON_PARAM],
  );

  // ── ③ 면제 부가항(종들) — 암보장개시일 항 + 【그림】 박스, 면책 사유가 있을 때만
  const addendumBlocks = takeBlocks(a27, paragraphRun(a27, 2)).map((b) => clauseBlock(b, noInside, remap));
  const addendumClause = record(
    "waiver-addendum",
    "면제 부가항(알파Plus)",
    "block",
    "납입면제 조 ② — 적용 종들의 사유에 면책(암보장개시일이 있는) 사유가 있으면 「제1항 제1호의 암보장개시일이라 함은 …」 항과 【그림】 박스. 「제1항 제1호」는 값 한정 참조(사유 = 암·면책)",
    [{ id: "c", kind: "condBlock", branches: [{ id: "c-if", when: "var.면책있음", children: addendumBlocks }] }],
    [PLANS_PARAM],
    [REASONS_LOCAL, WAITING_LOCAL],
  );

  // ── ④ 세부규정(종들) — 면책 ①~③ · 장해 ④~⑥ · ⑦ 제3자 합의 고정 · 장해 ⑧~⑪ · 상해장해 ⑫
  const dInside = structIds(a27d);
  const d = (from: number, to = from) => takeBlocks(a27d, paragraphRun(a27d, from, to)).map((b) => clauseBlock(b, dInside, remap));
  const iff = (id: string, when: string, children: Block[]) => ({ id, kind: "condBlock", branches: [{ id: `${id}-if`, when, children }] });
  const detailClause = record(
    "waiver-detail",
    "납입면제 세부규정(알파Plus)",
    "block",
    "납입면제에 관한 세부규정 조의 본문 — 면책 사유 → ①~③(재발 · 5년 · 부활 청약일), 장해 → ④~⑥ · ⑧~⑪, ⑦ 제3자 합의는 늘, 상해 관련 장해 → ⑫. 「제27조의1 제1항 제1호」 · 「제10호, 제11호」는 값 한정 참조",
    [iff("c1", "var.면책있음", d(1, 3)), iff("c2", "var.장해있음", d(4, 6)), ...d(7), iff("c3", "var.장해있음", d(8, 11)), iff("c4", "var.상해장해", d(12))],
    [PLANS_PARAM],
    [REASONS_LOCAL, WAITING_LOCAL, DISABILITY_LOCAL, INJURY_LOCAL],
  );

  // ── ⑤ 무효 문구(종들) — 원문에 없는 암보장개시일 항(인수기준 알려진 차이). 글은 무효조항 실무 템플릿(CP000007 면책有)을 빌렸다
  const p22 = paragraphs(a22)[0];
  const voidClause = record(
    "waiver-void",
    "무효 문구(알파Plus)",
    "block",
    "계약의 무효 조 — 적용 종들의 사유에 면책 사유가 있으면 암보장개시일 전일 이전 진단확정 시 무효 항. 알파Plus 원문 제22조에는 없다(원문 누락 — QA/인수기준 알려진 차이)",
    [
      {
        id: "c",
        kind: "condBlock",
        branches: [
          {
            id: "c-if",
            when: "var.면책있음",
            children: [voidParagraph(p22.id)],
          },
        ],
      },
    ],
    [PLANS_PARAM],
    [REASONS_LOCAL, WAITING_LOCAL],
  );

  // ── ⑥ 부활 문구(종들) — 제30조 ④ 「…암보장개시일을 적용합니다」, 면책 사유가 있을 때만. 항 하나라 유형 = 항(문구면 빈 ④ 가 남는다).
  // 메리츠 제35조 ④ 와 낱말 하나(계약일 ↔ 최초계약일)만 달라 옵션으로 두 상품이 함께 쓴다 — 사용처(보통약관 템플릿)가 고른다 (결정 3)
  const reviveId = paragraphRun(a30, 4);
  const [reviveSource] = takeBlocks(a30, reviveId);
  if (reviveId.length !== 1 || reviveSource.kind !== "paragraph" || JSON.stringify(reviveSource.children) !== JSON.stringify([{ ...reviveSource.children[0], text: REVIVE_TEXT("계약일") }])) throw new Error("납입면제 재모델링: 제30조 ④ 가 부활 문구가 아니다");
  const reviveClause = record(
    "waiver-revive",
    "부활 문구",
    "block",
    "부활(효력회복) 조 — 적용 종들의 사유에 면책 사유가 있으면 「부활(효력회복)시 부활(효력회복)일을 〔기준일〕로 하여 암보장개시일을 적용합니다」. 기준일은 옵션(알파Plus 계약일 · 메리츠 최초계약일)",
    [{ id: "c", kind: "condBlock", branches: [{ id: "c-if", when: "var.면책있음", children: [{ id: reviveSource.id, kind: "paragraph", children: [text("t1", "부활(효력회복)시 부활(효력회복)일을 "), { id: "o", kind: "optionSlot", optionCode: REVIVE_OPTION }, text("t2", "로 하여 암보장개시일을 적용합니다.")] }] }] }],
    [PLANS_PARAM],
    [REASONS_LOCAL, WAITING_LOCAL],
    [{ code: REVIVE_OPTION, label: "기준일", order: 0, values: (["계약일", "최초계약일"] as const).map((word, i) => ({ code: REVIVE_VALUE[word], label: word, order: i, body: [text(`c-waiver-revive-o1v${i + 1}-x1`, word)] })) }] as unknown as ClauseRecord["options"],
  );

  // ── 템플릿 — 사유 값으로 분기하지 않는다(결정 10)
  const ref = (id: Id, key: string, bindings: Record<string, Binding>): ClauseBlockRefNode => ({ id, kind: "clauseBlockRef", clauseCode: `@${key}`, options: {}, bindings });

  // 제27조의1 — ① [납입면제종마다] 항 › [현재 종의 사유마다] 호, ② 부가항, ③ ④ ⑤ 원문 그대로
  const inner: ForBlockNode = { id: innerId, kind: "forBlock", source: { kind: "listOfCurrent", loop: outerId, field: "reasons" }, children: [ref(itemRefId, "waiver-item", { 사유: { kind: "current", loop: innerId } })] };
  const lead = p1.children[0];
  if (lead?.kind !== "text" || !lead.text.startsWith("회사는 피보험자가 2종(보험료 납입면제형) 가입시 ")) throw new Error("납입면제 재모델링: 제27조의1 ① 첫 문장이 원문과 다르다");
  const repeated: ParagraphNode = {
    id: p1.id,
    kind: "paragraph",
    children: [
      { id: `${p1.id}-x1`, kind: "text", text: "회사는 피보험자가 " },
      { id: `${p1.id}-x2`, kind: "slot", ref: "builtin.plan.number" },
      { id: `${p1.id}-x3`, kind: "text", text: "종(" },
      { id: `${p1.id}-x4`, kind: "slot", ref: "builtin.plan.name" },
      { id: `${p1.id}-x5`, kind: "text", text: `)${lead.text.slice("회사는 피보험자가 2종(보험료 납입면제형)".length)}` },
      ...p1.children.slice(1),
    ],
    items: [inner],
  };
  const outer: ForBlockNode = { id: outerId, kind: "forBlock", source: { kind: "planOptions", ...APPLIED }, children: [repeated] };
  const addendumRef = ref(`${a27.id}-p2-k`, "waiver-addendum", { 종들: APPLIED_BINDING });
  const [, , p3, p4, p5] = paragraphs(a27);
  const rest = a27.children.slice(a27.children.indexOf(p3));
  a27.children = [outer, addendumRef, ...rest];
  // ④ 1형 적립 중지 — 해약환급금 지급형이 있을 때만 (결정 24). ⑤ 「제1항부터 제4항까지」는 대상 넷인 참조 하나로
  if (!paragraphs(a27).includes(p4) || !JSON.stringify(p4.children).includes("1형(해약환급금 지급형)의 경우")) throw new Error("납입면제 재모델링: 제27조의1 ④ 가 1형 적립 중지가 아니다");
  wrapBlock(a27, p4.id, SURRENDER_PAYING, `${p4.id}-if`);
  mergeRanges(p5, [p1.id, addendumRef.id, p3.id, p4.id, p5.id]);

  // 제27조의2 — 조 본문 = 세부규정 한 줄
  a27d.children = [ref(`${a27d.id}-p1-k`, "waiver-detail", { 종들: APPLIED_BINDING })];

  // 제27조의3 — [사유 합집합 ∩ 정의조대상마다] ⟨정의(사유 ← 현재 사유)⟩. 제목은 고정 글(나열 슬롯 미구현 — 인수기준 알려진 차이)
  const unionId = `${x.id}-for-reasons`;
  x.children = [
    { id: unionId, kind: "forBlock", source: { kind: "union", ...APPLIED, field: "reasons", where: { field: "F03", value: true } }, children: [ref(`${x.id}-p1-k`, "waiver-definition", { 사유: { kind: "current", loop: unionId } })] },
  ];

  // 제22조 — 원문 두 항 뒤에 무효 문구(③), 제30조 — ④ 를 부활 문구로
  a22.children = [...a22.children, ref(`${a22.id}-p3-k`, "waiver-void", { 종들: APPLIED_BINDING })];
  const at30 = a30.children.findIndex((c) => c.id === reviveId[0]);
  a30.children.splice(at30, reviveId.length, { ...ref(`${a30.id}-p4-k`, "waiver-revive", { 종들: APPLIED_BINDING }), options: { [REVIVE_OPTION]: REVIVE_VALUE["계약일"] } });

  // 세 조를 「납입면제 있음」 조 자리 IF 로 감싼다(결정 16) — 관 안의 잇닿은 세 조
  wrapArticles(alpha.tree, [a27.id, a27d.id, x.id], `${a27.id}-if-waiver`);

  return [itemClause, definitionClause, addendumClause, detailClause, voidClause, reviveClause];
}

/**
 * 메리츠 보통약관의 납입면제 자리(제29조 · 제30조 · 제31조 · 제22조 무효 · 제35조 부활)를 같은 모양으로 바꾸고, 메리츠 전용 역할 함수조항을 돌려준다.
 * `shared` 는 알파Plus 가 만든 역할 함수조항 — 호(C0022)와 부활 문구는 글이 같아 함께 쓰고, 정의의 알파Plus 전용 사유 칸(말기폐질환 …)은 옮겨 온다.
 *
 * 메리츠 원문은 종마다 항이 따로다 — ① 2종(보험료 납입면제 1형) · ② 3종(보험료 납입면제 2형). [납입면제종마다] 항 하나가 그 둘을 낸다(결정 11).
 * 그래서 「제1항 또는 제2항」은 반복 항 하나를 가리키는 참조(연결어 또는), 「제1항 제1호 및 제2항 제1호」는 값 한정(암·면책) 참조 하나다.
 */
export function applyMeritzWaiver(meritz: WaiverSource, shared: readonly WaiverClause[]): WaiverClause[] {
  const a2 = articleOf(meritz, "2");
  const a22 = articleOf(meritz, "22");
  const a29 = articleOf(meritz, "29");
  const a30 = articleOf(meritz, "30");
  const a31 = articleOf(meritz, "31");
  const a35 = articleOf(meritz, "35");
  const sharedOf = (key: string) => {
    const c = shared.find((x) => x.key === key);
    if (!c) throw new Error(`납입면제 재모델링: 공유 역할 함수조항 ${key} 없음`);
    return c;
  };

  // ── 제29조 반복 템플릿의 노드 id
  const [p1, p2, , p4, p5, p6, p7] = paragraphs(a29);
  if (!p7) throw new Error("납입면제 재모델링: 메리츠 제29조 항이 일곱이 아니다");
  const outerId = `${a29.id}-for-plans`;
  const innerId = `${a29.id}-for-reasons`;
  const itemRefId = `${a29.id}-p1-k`;
  const itemsOf = (p: ParagraphNode) => (p.items ?? []).filter((it): it is ItemNode => it.kind === "item");
  const i1 = itemsOf(p1);
  const i2 = itemsOf(p2);
  if (i1.length !== 5 || i2.length !== 6) throw new Error(`납입면제 재모델링: 메리츠 제29조 ① ② 호가 5 · 6 개가 아니다(${i1.length} · ${i2.length})`);
  // 원문 호 → 사유 (두 항이 같은 순서 — 원문 호 목록 그대로, 세목 사유와 같다)
  const reasonOfItem = new Map<Id, Code[]>([
    [i1[0].id, [REASON.cancerWaiting]],
    [i2[0].id, [REASON.cancerWaiting]],
    [i1[1].id, ["V03"]],
    [i2[1].id, ["V03"]],
    [i1[2].id, ["V04"]],
    [i2[2].id, ["V04"]],
    [i1[3].id, [...REASON.disability]],
    [i1[4].id, [...REASON.disability]],
    [i2[3].id, [...REASON.disability]],
    [i2[4].id, [...REASON.disability]],
    [i2[5].id, [REASON.burn]],
  ]);
  // 「제1항 제4호 또는 제2항 제4호 및 제6호의 상해관련」(제31조 ⑫) — 장해 값이 낸 호 둘 중 상해 호만: 호 함수조항 안 첫 자리(칸마다 같은 코드 — ADR-0072 결정 4)
  // 를 안쪽 코드로, 상해 장해를 내는 값(상해및질병80% · 상해80%)과 중증화상및부식으로 한정한다
  const itemClause = sharedOf("waiver-item");
  const firstItemCode = (() => {
    const body = withClauseCodes(itemClause.record.body);
    const sw = (body as unknown as { cases: { values: Code[]; children: { code?: Code }[] }[] }[])[0];
    const code = sw.cases.find((c) => c.values.includes(REASON.disability[0]))?.children[0]?.code;
    if (!code) throw new Error("납입면제 재모델링: 납입면제 호의 상해 장해 호 코드가 없다");
    return code;
  })();
  const injuryRef = (ref: ArticleRefNode) => ref.targets.map((t) => t.articleId).join() === [i1[3].id, i2[3].id, i2[5].id].join();
  const remap: Remap = (id, ref) => {
    if (id === p2.id) return { articleId: p1.id };
    const values = reasonOfItem.get(id);
    if (!values) return undefined;
    if (injuryRef(ref)) return { articleId: itemRefId, innerCode: firstItemCode, restrict: { values: id === i2[5].id ? [REASON.burn] : [...REASON.injuryDisability] } };
    return { articleId: itemRefId, restrict: { values } };
  };
  const noInside = new Set<Id>();

  // ── 정의 및 진단확정(메리츠) — 사유 값마다 칸. 메리츠 원문 제30조(암 ①~④ · 뇌졸중 ⑤⑥ · 급성심근경색증 ⑦⑧ · 중증화상및부식 ⑨⑩),
  // 메리츠에 없는 질병 여섯 칸은 알파Plus 원문 칸을 옮긴다(값마다 정확히 한 칸 — 결정 5, 지어낸 글보다 실물 글), 장해는 문구 없음
  const xInside = structIds(a30);
  const m = (from: number, to = from) => takeBlocks(a30, paragraphRun(a30, from, to)).map((b) => clauseBlock(b, xInside, remap));
  const alphaDefinition = find(sharedOf("waiver-definition").record.body, (x) => x.kind === "switchBlock") as { cases: { values: Code[]; children: unknown[] }[] } | undefined;
  const alphaCase = (v: Code) => {
    const c = alphaDefinition?.cases.find((k) => k.values.length === 1 && k.values[0] === v);
    if (!c) throw new Error(`납입면제 재모델링: 알파Plus 정의 칸 ${v} 없음`);
    return copyWithSuffix(c.children, `-${v}`);
  };
  const definitionClause = record(
    "waiver-definition-meritz",
    "정의 및 진단확정(메리츠)",
    "block",
    "「…의 정의 및 진단확정」 조의 본문(메리츠 — 「이 계약에 있어」) — 사유 값마다 정의 · 진단확정 항(암 칸 안에 【용어풀이】 박스 둘). 메리츠 원문에 없는 질병 여섯은 알파Plus 원문 칸. 장해 값은 문구 없음. 템플릿의 [사유 합집합 ∩ 정의조대상마다] 반복 안에서 사유 ← 현재 원소",
    [
      {
        id: "sw",
        kind: "switchBlock",
        on: "arg.사유",
        cases: [
          switchCase("k-cancer", [REASON.cancerWaiting, REASON.cancerNoWaiting], m(1, 4)),
          switchCase("k-V03", ["V03"], m(5, 6)),
          switchCase("k-V04", ["V04"], m(7, 8)),
          ...["V05", "V06", "V07", "V08", "V09", "V10"].map((v) => switchCase(`k-${v}`, [v], alphaCase(v))),
          switchCase("k-disability", [...REASON.disability], []),
          switchCase("k-burn", [REASON.burn], m(9, 10)),
        ],
      },
    ],
    [REASON_PARAM],
  );

  // ── 면제 부가항(메리츠) — ③ 「제1항 제1호 및 제2항 제1호의 암보장개시일이라 함은 최초계약일부터 …」 + 【그림】 박스, 면책 사유가 있을 때만
  const addendumClause = record(
    "waiver-addendum-meritz",
    "면제 부가항(메리츠)",
    "block",
    "납입면제 조 ③(메리츠) — 적용 종들의 사유에 면책 사유가 있으면 「제1항 제1호 및 제2항 제1호의 암보장개시일이라 함은 최초계약일부터 …」 항과 【그림】 박스. 「제1항 제1호 및 제2항 제1호」는 값 한정 참조(사유 = 암·면책) 하나 — 종마다 항이 펼쳐진 만큼 찍힌다",
    [{ id: "c", kind: "condBlock", branches: [{ id: "c-if", when: "var.면책있음", children: takeBlocks(a29, paragraphRun(a29, 3)).map((b) => clauseBlock(b, noInside, remap)) }] }],
    [PLANS_PARAM],
    [REASONS_LOCAL, WAITING_LOCAL],
  );

  // 원문 변환이 두 겹 연결어의 뒷 덩어리(「또는 제2항 제4호 및 제5호」 등)를 글로 남겼다 — 앞 참조의 대상으로 거둔다(연결어 = 바깥 연결어 또는, 결정 14)
  const [, , , d4, , , , , , , d11, d12] = paragraphs(a31);
  absorbPlain(d4, [i1[3].id, i1[4].id], " 또는 제2항 제4호 및 제5호", [i2[3].id, i2[4].id]);
  absorbPlain(d11, [i1[3].id, i1[4].id], " 또는 제2항 제4호부터 제6호까지", [i2[3].id, i2[4].id, i2[5].id]);
  absorbPlain(d12, [i1[3].id, i2[3].id], " 및 제6호", [i2[5].id]);

  // ── 납입면제 세부규정(메리츠) — 면책 ①~③ · 장해 ④~⑥ · ⑦ 제3자 합의 고정 · 장해 ⑧~⑩ · 장해 또는 중증화상 ⑪ · 상해 장해 또는 중증화상 ⑫
  const dInside = structIds(a31);
  const d = (from: number, to = from) => takeBlocks(a31, paragraphRun(a31, from, to)).map((b) => clauseBlock(b, dInside, remap));
  const iff = (id: string, when: string, children: Block[]) => ({ id, kind: "condBlock", branches: [{ id: `${id}-if`, when, children }] });
  const detailClause = record(
    "waiver-detail-meritz",
    "납입면제 세부규정(메리츠)",
    "block",
    "납입면제에 관한 세부규정 조의 본문(메리츠) — 면책 사유 → ①~③, 장해 → ④~⑥ · ⑧~⑩, ⑦ 제3자 합의는 늘, 장해 또는 중증화상및부식 → ⑪ 고의 · 전쟁 제외, 상해 장해 또는 중증화상및부식 → ⑫ 위험 활동 제외. 「제29조 제1항 제1호 또는 제2항 제1호」 등은 값 한정 참조 — 원문의 두 겹 연결어는 연결어 한 칸으로(인수기준 알려진 차이)",
    [iff("c1", "var.면책있음", d(1, 3)), iff("c2", "var.장해있음", d(4, 6)), ...d(7), iff("c3", "var.장해있음", d(8, 10)), iff("c4", "var.장해화상", d(11)), iff("c5", "var.상해관련", d(12))],
    [PLANS_PARAM],
    [REASONS_LOCAL, WAITING_LOCAL, DISABILITY_LOCAL, INJURY_LOCAL, DISABILITY_BURN_LOCAL, INJURY_BURN_LOCAL],
  );

  // ── 무효 문구(메리츠) — 알파Plus 무효 문구와 글이 같지만 「제1항」이 제 보통약관의 계약의 무효 조를 가리킨다(보통약관 참조는 템플릿마다 조가 다르다)
  const voidClause = record(
    "waiver-void-meritz",
    "무효 문구(메리츠)",
    "block",
    "계약의 무효 조(메리츠) — 적용 종들의 사유에 면책 사유가 있으면 암보장개시일 전일 이전 진단확정 시 무효 항. 메리츠 원문 제22조에는 없다(원문 누락 — QA/인수기준 알려진 차이). 글은 무효 문구(알파Plus)와 같다",
    [{ id: "c", kind: "condBlock", branches: [{ id: "c-if", when: "var.면책있음", children: [voidParagraph(paragraphs(a22)[0].id)] }] }],
    [PLANS_PARAM],
    [REASONS_LOCAL, WAITING_LOCAL],
  );

  // ── 템플릿
  const ref = (id: Id, key: string, bindings: Record<string, Binding>): ClauseBlockRefNode => ({ id, kind: "clauseBlockRef", clauseCode: `@${key}`, options: {}, bindings });
  const inner: ForBlockNode = { id: innerId, kind: "forBlock", source: { kind: "listOfCurrent", loop: outerId, field: "reasons" }, children: [ref(itemRefId, itemClause.key, { 사유: { kind: "current", loop: innerId } })] };
  const lead = p1.children[0];
  const LEAD = "회사는 2종(보험료 납입면제 1형)을 가입한 피보험자가 ";
  if (p1.children.length !== 1 || lead?.kind !== "text" || !lead.text.startsWith(LEAD)) throw new Error("납입면제 재모델링: 메리츠 제29조 ① 첫 문장이 원문과 다르다");
  const repeated: ParagraphNode = {
    id: p1.id,
    kind: "paragraph",
    children: [
      { id: `${p1.id}-x1`, kind: "text", text: "회사는 " },
      { id: `${p1.id}-x2`, kind: "slot", ref: "builtin.plan.number" },
      { id: `${p1.id}-x3`, kind: "text", text: "종(" },
      { id: `${p1.id}-x4`, kind: "slot", ref: "builtin.plan.name" },
      { id: `${p1.id}-x5`, kind: "text", text: `)을 가입한 피보험자가 ${lead.text.slice(LEAD.length)}` },
    ],
    items: [inner],
  };
  const outer: ForBlockNode = { id: outerId, kind: "forBlock", source: { kind: "planOptions", ...APPLIED }, children: [repeated] };
  const addendumRef = ref(`${a29.id}-p3-k`, addendumClause.key, { 종들: APPLIED_BINDING });
  a29.children = [outer, addendumRef, ...a29.children.slice(a29.children.indexOf(p4))];
  // ④ ⑤ 「제1항 또는 제2항」 = 반복 항 하나(연결어 또는), ⑥ ⑦ 「제1항부터 제4항까지」 = 대상 셋(반복 항 · 부가항 · ④)인 참조 하나
  for (const p of [p4, p5, p6, p7]) remapTemplateRefs(p, (id) => (id === p2.id ? p1.id : id));
  for (const p of [p6, p7]) mergeRanges(p, [p1.id, addendumRef.id, p4.id, p5.id, p6.id, p7.id]);

  // 제31조 — 조 본문 = 세부규정 한 줄, 제30조 — [사유 합집합 ∩ 정의조대상마다] ⟨정의(메리츠)⟩ (제목은 고정 글)
  a31.children = [ref(`${a31.id}-p1-k`, detailClause.key, { 종들: APPLIED_BINDING })];
  const unionId = `${a30.id}-for-reasons`;
  a30.children = [{ id: unionId, kind: "forBlock", source: { kind: "union", ...APPLIED, field: "reasons", where: { field: "F03", value: true } }, children: [ref(`${a30.id}-p1-k`, definitionClause.key, { 사유: { kind: "current", loop: unionId } })] }];

  // 제22조 — 원문 두 항 뒤에 무효 문구(③), 제35조 ④ — 부활 문구(기준일 = 최초계약일). ④ 뒤 【부활(효력회복)】 박스는 조의 것이라 템플릿에 남는다
  a22.children = [...a22.children, ref(`${a22.id}-p3-k`, voidClause.key, { 종들: APPLIED_BINDING })];
  const r4 = paragraphs(a35)[3];
  if (!r4 || JSON.stringify(r4.children.map((c) => (c.kind === "text" ? c.text : c.kind))) !== JSON.stringify([REVIVE_TEXT("최초계약일")])) throw new Error("납입면제 재모델링: 메리츠 제35조 ④ 가 부활 문구가 아니다");
  a35.children.splice(a35.children.indexOf(r4), 1, { ...ref(`${a35.id}-p4-k`, "waiver-revive", { 종들: APPLIED_BINDING }), options: { [REVIVE_OPTION]: REVIVE_VALUE["최초계약일"] } });

  // 제2조 표의 종별 행(2종 · 3종)의 「제29조 제1항」 · 「제2항」은 종 하나를 가리킨다 — 종 한정 참조는 다음 기획이라 글로 굳힌다(원문 표기 그대로).
  // 「제29조 제4항」 · 「제29조 및 제31조」는 참조로 둔다
  freezeRefs(a2, new Map([
    [p1.id, "제29조(보험료의 납입면제) 제1항"],
    [p2.id, "제29조(보험료의 납입면제) 제2항"],
  ]));

  // 세 조를 「납입면제 있음」 조 자리 IF 로 감싼다(결정 16)
  wrapArticles(meritz.tree, [a29.id, a30.id, a31.id], `${a29.id}-if-waiver`);

  return [definitionClause, addendumClause, detailClause, voidClause];
}

/**
 * 납입면제 조를 가리키는 문장을 「납입면제 있음」 조건으로 감싼다 (W1 열린 문제 2 — 납입면제 없는 상품이면 세 조가 빠져 참조가 사라진 조를 가리킨다).
 * - 문장 안 덩어리(제6조 「또는 [제27조의1]에서 정한 보험료 납입면제 사유의 발생을 알게된 경우」 · 준용규정 「또한, 1종 … [제29조 및 제31조]은 제외합니다.」)
 *   는 문장 안 조건 하나(`guardSpan`).
 * - 제2조 표의 종 행(「1종(보험료 납입면제 미적용형)」 · 「2종 …」)은 정의 칸 전체 — 표 행 조건은 없고 종마다 행 반복은 다음 기획이라
 *   납입면제 없는 상품은 종 이름 행이 빈 정의로 남는다(인수기준 알려진 한계).
 * - 준용규정(알파Plus) 함수조항의 「…은 제외하며, 보통약관 1종 … [제27조의1 및 제27조의2]도 제외합니다.」는 문장 앞뒤가 이어져
 *   가지를 하나 더 둔다(`guardAlphaApplication`). 갱신형 가지의 나열(제9조 · 제10조 · 제27조의1 · 제27조의2 · 제38조)은 일부만 빠지면
 *   남은 대상으로 찍혀 오류가 아니라 그대로 둔다 (기능/문면 §3.5).
 * `waiver(id)` = 그 보통약관 납입면제 조(또는 그 안 노드)의 변환 중간 id 인가.
 */
export function guardWaiverMentions(tree: DocumentNode, waiver: (id: Id) => boolean, where: string): number {
  let count = 0;
  const mentions = (list: readonly unknown[]) => JSON.stringify(list).match(/"articleId":"([^"]+)"/g)?.some((m) => waiver(m.slice('"articleId":"'.length, -1))) ?? false;
  const visit = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(visit);
    if (!n || typeof n !== "object") return;
    const o = n as { id?: Id; kind?: string; children?: InlineNode[]; rows?: { header?: boolean; cells: InlineNode[][] }[] };
    // 납입면제 조 자신(서로 가리킨다)은 함께 빠지므로 감싸지 않는다
    if (o.kind === "article" && o.id && waiver(o.id)) return;
    if (o.kind === "table" && o.rows) {
      for (const row of o.rows) {
        if (row.header) continue;
        row.cells = row.cells.map((cell, c) => {
          if (!mentions(cell)) return cell;
          count++;
          const id = `${cell[0]?.id ?? `${where}-c${c}`}-if-waiver`;
          return [{ id, kind: "inlineCond", branches: [{ id: `${id}-b`, when: WAIVER_PRESENT, children: cell }] } as InlineNode];
        });
      }
      return;
    }
    if ((o.kind === "paragraph" || o.kind === "item") && o.children && mentions(o.children)) {
      const refAt = o.children.findIndex((c) => c.kind === "articleRef" && c.targets.some((t) => waiver(t.articleId)));
      const before = o.children[refAt - 1];
      const marker = before?.kind === "text" && before.text.endsWith(" 또는 ") ? " 또는 " : before?.kind === "text" && before.text.includes(" 또한, ") ? " 또한, " : undefined;
      const end = marker === " 또는 " ? "에서 정한 보험료 납입면제 사유의 발생을 알게된 경우" : "은 제외합니다.";
      if (!marker || !guardSpan(o as { children: InlineNode[] }, refAt, marker, end, WAIVER_PRESENT)) throw new Error(`납입면제 재모델링: ${where} 의 납입면제 조 참조 ${o.children[refAt]?.id} 를 감쌀 문장을 모른다`);
      count++;
    }
    for (const key of ["children", "items", "subitems", "branches"]) {
      const v = (o as Record<string, unknown>)[key];
      if (Array.isArray(v)) v.forEach(visit);
    }
  };
  visit(tree.children);
  return count;
}

/** 문장 안 덩어리 — 참조(`refAt`) 앞 글의 `marker` 부터 뒤 글의 `end` 까지를 문장 안 조건 하나로 감싼다. */
function guardSpan(p: { children: InlineNode[] }, refAt: number, marker: string, end: string, when: string): boolean {
  const xs = p.children;
  const before = xs[refAt - 1];
  const after = xs[refAt + 1];
  if (before?.kind !== "text" || after?.kind !== "text") return false;
  const cut = before.text.lastIndexOf(marker);
  const stop = after.text.indexOf(end);
  if (cut < 0 || stop < 0) return false;
  const id = `${xs[refAt].id}-if-waiver`;
  const head: InlineNode = { ...before, text: before.text.slice(0, cut) };
  const inner: InlineNode[] = [{ id: `${before.id}-w`, kind: "text", text: before.text.slice(cut) }, xs[refAt], { id: `${after.id}-w`, kind: "text", text: after.text.slice(0, stop + end.length) }];
  const tail: InlineNode = { ...after, text: after.text.slice(stop + end.length) };
  const cond = { id, kind: "inlineCond", branches: [{ id: `${id}-b`, when, children: inner }] } as InlineNode;
  p.children = [...xs.slice(0, refAt - 1), ...(head.kind === "text" && head.text ? [head] : []), cond, ...(tail.kind === "text" && tail.text ? [tail] : []), ...xs.slice(refAt + 2)];
  return true;
}

/**
 * 준용규정(알파Plus) — 비갱신 가지 「[제9조 · 제10조 · 제38조]은 제외하며, 보통약관 1종(…)으로 가입한 경우 [제27조의1 및 제27조의2]도 제외합니다.」를
 * 「납입면제 있음」이면 그대로, 아니면 「[제9조 · 제10조 · 제38조]은 제외합니다.」 가지로 나눈다(문장 안 IF / ELIF / ELSE).
 */
export function guardAlphaApplication(clause: ClauseRecord, waiver: (id: Id) => boolean): void {
  const cond = find(clause.body, (x) => x.kind === "inlineCond") as { branches: { id: Id; when?: string; children: Inline[] }[] } | undefined;
  const last = cond?.branches.at(-1);
  const refs = last?.children.filter((c) => c.kind === "articleRef") ?? [];
  const tail = refs.at(-1);
  if (!cond || !last || last.when !== undefined || refs.length !== 2 || !tail || tail.kind !== "articleRef" || !tail.targets.every((t) => waiver(t.articleId ?? ""))) {
    throw new Error(`납입면제 재모델링: ${clause.label} 의 비갱신 가지가 원문 모양이 아니다`);
  }
  const [head] = last.children;
  cond.branches = [
    ...cond.branches.slice(0, -1),
    { ...last, when: WAIVER_PRESENT },
    { id: `${last.id}-else`, children: [copyWithSuffix(head, "-else"), { id: `${last.id}-else-t`, kind: "text", text: "은 제외합니다." }] },
  ];
}

/** 항 안의 참조(대상 `before`) 뒤 글이 `plain` 으로 시작하면 그 글을 떼고 대상 `more` 를 더한다 — 연결어는 「또는」. */
function absorbPlain(p: ParagraphNode | undefined, before: readonly Id[], plain: string, more: readonly Id[]): void {
  const xs = p?.children ?? [];
  const at = xs.findIndex((n) => n.kind === "articleRef" && n.targets.map((t) => t.articleId).join() === before.join());
  const ref = xs[at] as ArticleRefNode | undefined;
  const next = xs[at + 1];
  if (!ref || next?.kind !== "text" || !next.text.startsWith(plain)) throw new Error(`납입면제 재모델링: ${p?.id} 에 「${plain}」 앞 참조가 없다`);
  ref.targets = [...before, ...more].map((articleId) => ({ articleId }));
  ref.connector = "또는";
  next.text = next.text.slice(plain.length);
}

/** 템플릿(보통약관 트리) 조 참조의 대상 id 를 옮긴다 — 같은 대상으로 모이면 하나로. */
function remapTemplateRefs(p: { children: InlineNode[] }, move: (id: Id) => Id): void {
  for (const n of p.children) {
    if (n.kind !== "articleRef") continue;
    const ids = [...new Set(n.targets.map((t) => move(t.articleId)))];
    n.targets = ids.map((articleId) => ({ articleId }));
  }
}

/** 조 안(표 셀 포함)의 참조 중 대상 하나가 `words` 에 있는 것을 그 글로 바꾼다. */
function freezeRefs(a: ArticleNode, words: ReadonlyMap<Id, string>): void {
  let hits = 0;
  const visit = (n: unknown): void => {
    if (Array.isArray(n)) {
      n.forEach((x, i) => {
        const o = x as InlineNode;
        if (o?.kind === "articleRef" && o.targets.length === 1 && words.has(o.targets[0].articleId)) {
          n[i] = { id: o.id, kind: "text", text: words.get(o.targets[0].articleId)! };
          hits++;
        } else visit(x);
      });
      return;
    }
    if (n && typeof n === "object") Object.values(n).forEach(visit);
  };
  visit(a);
  if (hits !== words.size) throw new Error(`납입면제 재모델링: ${a.id} 에서 굳힐 참조가 ${words.size} 개가 아니다(${hits})`);
}

/** 무효 문구 항 — 「회사는 [제1항]에서 정한 사항 이외에도 …」. `first` = 그 보통약관 계약의 무효 조 ① (변환 중간 모양 — 노드 id). */
function voidParagraph(first: Id) {
  return {
    id: "p",
    kind: "paragraph",
    children: [
      text("t1", "회사는 "),
      { id: "r", kind: "articleRef", targets: [{ articleId: first }], connector: "및" },
      text(
        "t2",
        "에서 정한 사항 이외에도 피보험자가 계약일부터 암보장개시일의 전일 이전에「암(유사암제외)」으로 진단확정되는 경우에는 계약을 무효로 하며 이미 납입한 보험료를 돌려드립니다. 다만, 회사의 고의 또는 과실로 계약이 무효로 된 경우와 회사가 승낙 전에 무효임을 알았거나 알 수 있었음에도 보험료를 반환하지 않은 경우에는 보험료를 납입한 날의 다음날부터 반환일까지의 기간에 대하여 회사는 보험계약대출이율을 연단위 복리로 계산한 금액을 더하여 돌려 드립니다.",
      ),
    ],
  };
}

/** 트리에서 조건에 맞는 첫 노드. */
function find(n: unknown, pred: (x: { kind?: string }) => boolean): unknown {
  if (Array.isArray(n)) {
    for (const x of n) {
      const hit = find(x, pred);
      if (hit) return hit;
    }
    return undefined;
  }
  if (!n || typeof n !== "object") return undefined;
  if (pred(n as { kind?: string })) return n;
  for (const v of Object.values(n)) {
    const hit = find(v, pred);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * 「[참조 A]부터 [참조 B]까지」(원문 변환은 참조 둘 + 글) → 대상 여럿인 참조 하나. `order` = 조의 항 자리(원문 항 순서 — 반복 · 함수조항 참조 · 조건 안 항)
 * 에서 A 부터 B 까지. 번호는 조립이 계산하므로 반복이 여러 항을 내거나 조건이 한 항을 빼도 「제1항부터 제N항까지」 · 「제1항 및 제2항」으로 따라온다 —
 * 참조 둘이면 끝 대상이 빠질 때 오류가 되고, 반복이 항 둘을 내면 「제1항 및 제2항부터」가 된다.
 */
function mergeRanges(p: { children: InlineNode[] }, order: readonly Id[]): void {
  const out: InlineNode[] = [];
  const xs = p.children;
  for (let i = 0; i < xs.length; i++) {
    const a = xs[i];
    const mid = xs[i + 1];
    const b = xs[i + 2];
    const tail = xs[i + 3];
    const one = (n: InlineNode | undefined): n is ArticleRefNode => n?.kind === "articleRef" && n.scope === "self" && n.targets.length === 1;
    if (one(a) && mid?.kind === "text" && mid.text === "부터 " && one(b) && tail?.kind === "text" && tail.text.startsWith("까지")) {
      const from = order.indexOf(a.targets[0].articleId);
      const to = order.indexOf(b.targets[0].articleId);
      if (from < 0 || to <= from) throw new Error(`납입면제 재모델링: 범위 참조 ${a.id} 의 끝을 항 자리에서 찾지 못했다`);
      out.push({ ...a, targets: order.slice(from, to + 1).map((articleId) => ({ articleId })), connector: a.connector ?? "및" });
      out.push({ ...tail, text: tail.text.slice("까지".length) });
      i += 3;
      continue;
    }
    out.push(a);
  }
  p.children = out;
}

/** 블록 하나를 조건 블록(가지 하나)으로 감싼다. */
function wrapBlock(a: ArticleNode, target: Id, when: string, id: Id): void {
  const at = a.children.findIndex((c) => c.id === target);
  if (at < 0) throw new Error(`납입면제 재모델링: ${a.id} 에 ${target} 없음`);
  a.children.splice(at, 1, { id, kind: "condBlock", branches: [{ id: `${id}-b`, when, children: [a.children[at]] }] } as BlockNode);
}

/** 잇닿은 조들을 조 자리 IF 하나로 감싼다. */
function wrapArticles(tree: DocumentNode, ids: readonly Id[], id: Id): void {
  const visit = (owner: { children: unknown[] }): boolean => {
    const at = owner.children.findIndex((c) => (c as { id?: Id }).id === ids[0]);
    if (at >= 0) {
      const run = owner.children.slice(at, at + ids.length) as ArticleNode[];
      if (run.map((a) => a.id).join() !== ids.join()) throw new Error("납입면제 재모델링: 감쌀 조들이 잇닿아 있지 않다");
      owner.children.splice(at, ids.length, { id, kind: "condBlock", branches: [{ id: `${id}-b`, when: WAIVER_PRESENT, children: run }] });
      return true;
    }
    return owner.children.some((c) => (c as { kind?: string }).kind === "section" && visit(c as SectionNode));
  };
  if (!visit(tree)) throw new Error("납입면제 재모델링: 감쌀 조를 찾지 못했다");
}

/** 템플릿이 가리키는 역할 함수조항 자리표 `@key` → 코드. 코드는 적재 순서로 매긴 뒤에 푼다. */
export function resolveWaiverCodes(tree: DocumentNode, codeOf: (key: string) => Code | undefined): void {
  const visit = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(visit);
    if (!n || typeof n !== "object") return;
    const o = n as Record<string, unknown>;
    if (o.kind === "clauseBlockRef" && typeof o.clauseCode === "string" && o.clauseCode.startsWith("@")) {
      const code = codeOf(o.clauseCode.slice(1));
      if (!code) throw new Error(`납입면제 재모델링: 역할 함수조항 ${o.clauseCode} 코드 없음`);
      o.clauseCode = code;
    }
    Object.values(o).forEach(visit);
  };
  visit(tree);
}

