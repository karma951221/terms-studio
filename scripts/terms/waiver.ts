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
type Remap = (id: Id) => { articleId: Id; restrict?: RefRestrict } | undefined;

function clauseInline(n: InlineNode, inside: ReadonlySet<Id>, remap: Remap): Inline {
  switch (n.kind) {
    case "articleRef": {
      const own = n.targets.filter((t) => inside.has(t.articleId));
      if (own.length === n.targets.length) return { id: n.id, kind: "articleRef", targets: n.targets.map((t) => ({ articleId: t.articleId })), connector: n.connector, scope: "clause" };
      if (own.length > 0) throw new Error(`납입면제 재모델링: 조 참조 ${n.id} 가 함수조항 안팎을 함께 가리킨다`);
      const targets: { articleId: Id; restrict?: RefRestrict }[] = [];
      for (const t of n.targets) {
        const next = remap(t.articleId) ?? { articleId: t.articleId };
        const same = targets.find((x) => x.articleId === next.articleId && JSON.stringify(x.restrict) === JSON.stringify(next.restrict));
        if (!same) targets.push(next);
      }
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

function record(key: string, label: string, mode: ClauseRecord["mode"], description: string, body: Block[] | ClauseItem[] | unknown[], params: ParamDef[], locals: LocalDef[] = []): WaiverClause {
  // 노드 id 를 결정적으로 다시 매긴다 — 「이 함수조항」 참조 대상도 따라간다 (clauses.ts reId)
  const rebased = reId(body as unknown[], `c-${key}`);
  return {
    key,
    record: { code: "", label, mode, description, body: rebased as ClauseRecord["body"], options: [], params, ...(locals.length ? { locals } : {}) },
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
            children: [
              {
                id: "p",
                kind: "paragraph",
                children: [
                  text("t1", "회사는 "),
                  { id: "r", kind: "articleRef", targets: [{ articleId: p22.id }], connector: "및" },
                  text(
                    "t2",
                    "에서 정한 사항 이외에도 피보험자가 계약일부터 암보장개시일의 전일 이전에「암(유사암제외)」으로 진단확정되는 경우에는 계약을 무효로 하며 이미 납입한 보험료를 돌려드립니다. 다만, 회사의 고의 또는 과실로 계약이 무효로 된 경우와 회사가 승낙 전에 무효임을 알았거나 알 수 있었음에도 보험료를 반환하지 않은 경우에는 보험료를 납입한 날의 다음날부터 반환일까지의 기간에 대하여 회사는 보험계약대출이율을 연단위 복리로 계산한 금액을 더하여 돌려 드립니다.",
                  ),
                ],
              },
            ],
          },
        ],
      },
    ],
    [PLANS_PARAM],
    [REASONS_LOCAL, WAITING_LOCAL],
  );

  // ── ⑥ 부활 문구(종들) — 제30조 ④ 「…암보장개시일을 적용합니다」, 면책 사유가 있을 때만. 항 하나라 유형 = 항(문구면 빈 ④ 가 남는다)
  const reviveId = paragraphRun(a30, 4);
  const reviveClause = record(
    "waiver-revive",
    "부활 문구(알파Plus)",
    "block",
    "부활(효력회복) 조 ④ — 적용 종들의 사유에 면책 사유가 있으면 「부활(효력회복)시 부활(효력회복)일을 계약일로 하여 암보장개시일을 적용합니다」",
    [{ id: "c", kind: "condBlock", branches: [{ id: "c-if", when: "var.면책있음", children: takeBlocks(a30, reviveId).map((b) => clauseBlock(b, noInside, remap)) }] }],
    [PLANS_PARAM],
    [REASONS_LOCAL, WAITING_LOCAL],
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
  a30.children.splice(at30, reviveId.length, ref(`${a30.id}-p4-k`, "waiver-revive", { 종들: APPLIED_BINDING }));

  // 세 조를 「납입면제 있음」 조 자리 IF 로 감싼다(결정 16) — 관 안의 잇닿은 세 조
  wrapArticles(alpha.tree, [a27.id, a27d.id, x.id], `${a27.id}-if-waiver`);

  return [itemClause, definitionClause, addendumClause, detailClause, voidClause, reviveClause];
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

