/**
 * 납입면제 재모델링 (개발 도구 — 제품 기능 아님). 근거: 최종 결정 10 · 11 · 13 · 16 · 22 · 23, ADR-0077 템플릿 스케치,
 * ADR-0086(사유별 호 · 정의 함수조항), 기능/함수조항 §3.7 「역할 함수조항」, QA/실물재현/알파플러스_모델명세 §6 · 메리츠_모델명세 §6.
 *
 * 원문의 납입면제 조 · 세부규정 · 정의 조 · 계약의 무효 · 부활 조를 **변환된 보통약관 트리에서** 사유별 · 역할 함수조항과 반복 템플릿으로 바꾼다.
 * 문장은 원문 노드를 그대로 옮긴다(참조 · 별표 슬롯 · 박스 참조 포함) — 새로 짓는 글은 원문에 없는 두 자리뿐이다:
 * 「암·무면책」 호(암보장개시일 없는 암 호)와 무효 문구의 암보장개시일 항(인수기준 알려진 차이).
 *
 * - 호 · 정의는 사유 값마다 함수조항 하나다(ADR-0086 결정 1) — 인자 종들 + 내부 변수 「해당」으로 본문 전체를 감싸 스스로 켜진다.
 *   정의 글이 상품군마다 다르면 상품군마다(꼬리표 「(알파Plus)」 · 「(통합간편)」), 같으면 함께 쓴다(결정 3).
 * - 템플릿은 사유 값으로 분기하지 않는다(결정 10) — 납입면제 조 ① = [납입면제종마다] 항 › 사유별 호 함수조항을 열거형 순서로(종들 ← 현재 종),
 *   정의 조 = 사유별 정의 함수조항을 열거형 순서로(프리셋 ‘적용 종’), 나머지 자리는 ⟨역할(프리셋 ‘적용 종’)⟩ 한 줄.
 * - 세 조는 「납입면제 있음」(D0002) 조 자리 IF 로 감싼다(결정 16).
 * - 원문 호를 가리키던 참조(「제1항 제1호」 · 「제10호, 제11호」)는 그 사유의 호 함수조항 참조를 가리킨다 — 종마다 펼친 것 전부(값 한정 없음).
 *
 * 사유 · 정의 묶음 · 상품군은 표(`ITEM_REASONS` · `DEFINITIONS` · `LINE`)로 두고, 상품마다 다른 것(원문 조 번호 · 호 · 항 자리)만 상품 함수에 있다.
 * 조 참조 대상은 변환 중간 모양(노드 id 를 `articleId` 자리에)이다 — convert.ts `codeTargets` · `codeClauseTargets` 가 P코드로 바꾼다.
 */
import type { Block, Inline, ItemNode as ClauseItem, ParagraphNode as ClauseParagraph } from "../../src/domain/clause/nodes";
import type { Binding, ParamDef } from "../../src/domain/clause/params";
import type { LocalDef } from "../../src/domain/clause/locals";
import type { PresetDef } from "../../src/domain/clause/presets";
import type { ArticleNode, ArticleRefNode, BlockNode, ClauseBlockRefNode, CondBlockNode, DocumentNode, ForBlockNode, InlineNode, ItemNode, ParagraphNode, SectionNode } from "../../src/domain/document/nodes";
import { foldTitle } from "../../src/domain/document/title";
import type { Code, Id } from "../../src/domain/types";

import type { ClauseRecord } from "./clauses";
import { allArticles, reId } from "./clauses";
import { withClauseCodes } from "../../src/domain/clause/pcode";
import { basisWord, RENEWAL_PARAM } from "./renewal";

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

/** 부활 문구 원문 — 알파Plus 「계약일」 · 통합간편 「최초계약일」(갱신형 상품). */
const REVIVE_TEXT = (word: string) => `부활(효력회복)시 부활(효력회복)일을 ${word}로 하여 암보장개시일을 적용합니다.`;

/** E0001 납입면제사유 값 코드 (enums.json — 열거형 순서). V12 · V13 은 쓰는 상품이 없어 지웠다 (ADR-0086 결정 5). */
export const REASON = {
  cancerWaiting: "V01",
  cancerNoWaiting: "V02",
  diseases: ["V03", "V04", "V05", "V06", "V07", "V08", "V09", "V10"],
  /** 상해및질병80%이상후유장해 — 호 둘(상해 · 질병)을 내는 한 세트. */
  disability: "V11",
  burn: "V14",
} as const;

/**
 * 사유별 호 함수조항의 사유 — 열거형 순서(= 템플릿 호 목록에 늘어놓는 순서 · 원문 호 순서)와 함수조항 이름에 쓰는 값 이름(E0001 값 이름) (ADR-0086 결정 1).
 * 사유를 더하면 여기 한 줄과 그 호 본문(상품 변환 함수)을 더한다 — 템플릿 · 다른 함수조항은 그대로다.
 */
export const ITEM_REASONS: readonly { code: Code; label: string }[] = [
  { code: "V01", label: "암(유사암제외)·면책" },
  { code: "V02", label: "암(유사암제외)·무면책" },
  { code: "V03", label: "뇌졸중" },
  { code: "V04", label: "급성심근경색증" },
  { code: "V05", label: "말기폐질환" },
  { code: "V06", label: "말기간경화" },
  { code: "V07", label: "말기신부전증" },
  { code: "V08", label: "양성뇌종양" },
  { code: "V09", label: "중대한재생불량성빈혈" },
  { code: "V10", label: "만성당뇨합병증" },
  { code: "V11", label: "상해및질병80%이상후유장해" },
  { code: "V14", label: "중증화상및부식" },
];

/** 정의 함수조항 묶음 하나 — `values` 가 하나라도 있으면 켜진다. `perLine` = 정의 글이 상품군마다 달라 상품군마다 함수조항 (ADR-0086 결정 3). */
export interface DefinitionSpec {
  key: string;
  values: readonly Code[];
  label: string;
  perLine: boolean;
}

/**
 * 사유별 정의 함수조항 — 정의 문구가 있는 사유마다 하나(열거형 순서 = 정의 조에 늘어놓는 순서). 암은 면책 · 무면책이 같은 정의라 함께,
 * 장해(V11)는 정의 문구가 없다. 실물: 암 · 뇌졸중 · 급성심근경색증은 상품군마다 글이 달라 상품군마다, 나머지는 두 상품군이 함께 쓴다.
 */
export const DEFINITIONS: readonly DefinitionSpec[] = [
  { key: "cancer", values: [REASON.cancerWaiting, REASON.cancerNoWaiting], label: "암(유사암제외)", perLine: true },
  { key: "V03", values: ["V03"], label: "뇌졸중", perLine: true },
  { key: "V04", values: ["V04"], label: "급성심근경색증", perLine: true },
  ...(["V05", "V06", "V07", "V08", "V09", "V10", "V14"] as const).map((v) => ({ key: v, values: [v], label: ITEM_REASONS.find((r) => r.code === v)!.label, perLine: false })),
];

/** 상품군 꼬리표 — 함수조항 이름 끝 「(…)」 (ADR-0086 결정 7 — 두 상품 모두 메리츠화재, 갈리는 것은 상품군). */
export const LINE = { alpha: "알파Plus", meritz: "통합간편" } as const;
type Line = (typeof LINE)[keyof typeof LINE];

/** 적용 납입면제종 — 세목 waiver 선택지 중 적용여부 = 예 (반복 원천 · 인자 원천 연결이 같은 거름을 쓴다). */
const APPLIED = { form: "waiver", filter: "waiver.applies = true" } as const;
const APPLIED_BINDING: Binding = { kind: "source", source: { ...APPLIED } };

/**
 * 납입면제 프리셋 (ADR-0084) — 종들을 받는 정의 · 역할 함수조항은 사용처마다 「적용 납입면제종」 한 조합이라 프리셋 하나. 사용처는 프리셋을 참조한다.
 * 사유별 호는 「반복의 현재 원소」(현재 종)뿐이라 프리셋에 담을 값이 없다. 부활 문구의 기준일은 데이터(인자 갱신의 기본 연결)가 가른다(ADR-0086 결정 6).
 */
const APPLIED_PRESETS: PresetDef[] = [{ code: "S01", name: "적용 종", bindings: { 종들: APPLIED_BINDING } }];

function withPresets(clause: WaiverClause, presets: PresetDef[]): WaiverClause {
  return { ...clause, record: { ...clause.record, presets: structuredClone(presets) } };
}

/** 프리셋을 쓰는 함수조항 참조 — 옵션 · 연결은 프리셋 값이라 비운다. */
const presetRef = (id: Id, key: string, preset: Code): ClauseBlockRefNode => ({ id, kind: "clauseBlockRef", clauseCode: `@${key}`, options: {}, preset });

const PLANS_PARAM: ParamDef = { name: "종들", type: { kind: "planOptions", form: "waiver" } };

/** 종들 → 사유 묶음 → 판정 (내부 변수, 결정 2 · 22). 암보장개시일 문장은 면책여부(F02) = 예인 사유가 있을 때만 (ADR-0078 「면책 여부」). */
const REASONS_LOCAL: LocalDef = { name: "사유들", expr: "arg.종들.합치기(waiver.reasons)" };
const has = (values: readonly Code[]) => `var.사유들.있음(${values.map((v) => `'${v}'`).join(", ")})`;
const WAITING_LOCAL: LocalDef = { name: "면책있음", expr: "not var.사유들.거르기(F02 = true).비었음" };
const DISABILITY_LOCAL: LocalDef = { name: "장해있음", expr: has([REASON.disability]) };
const DISABILITY_BURN_LOCAL: LocalDef = { name: "장해화상", expr: has([REASON.disability, REASON.burn]) };
const INJURY_BURN_LOCAL: LocalDef = { name: "상해관련", expr: has([REASON.disability, REASON.burn]) };
const INJURY_LOCAL: LocalDef = { name: "상해장해", expr: has([REASON.disability]) };

/** 사유별 함수조항의 「해당」 — 넘겨받은 종(들)의 사유에 그 값이 있는가. 함수조항이 스스로 켜진다 — 템플릿은 늘어놓기만 (ADR-0086 결정 2). */
const reasonLocals = (values: readonly Code[]): LocalDef[] => [REASONS_LOCAL, { name: "해당", expr: has(values) }];
const onlyIfReason = (children: unknown[]) => [{ id: "c", kind: "condBlock", branches: [{ id: "c-if", when: "var.해당", children }] }];

export interface WaiverClause {
  key: string;
  record: ClauseRecord;
}

/** 사유별 호 함수조항 key · 템플릿 참조 노드 id. */
const itemKey = (v: Code) => `waiver-item-${v}`;
const itemRefId = (articleId: Id, v: Code) => `${articleId}-p1-k-${v}`;
/** 사유별 정의 함수조항 key — 상품군마다면 꼬리표까지. */
const definitionKey = (d: DefinitionSpec, line: Line) => (d.perLine ? `waiver-definition-${d.key}-${line}` : `waiver-definition-${d.key}`);

/** 사유별 호 함수조항 — 유형 「호」, 인자 종들, 본문 전체가 IF 해당. */
function itemClause(v: Code, body: unknown[]): WaiverClause {
  const label = ITEM_REASONS.find((r) => r.code === v)?.label;
  if (!label) throw new Error(`납입면제 재모델링: 호 사유 ${v} 가 ITEM_REASONS 에 없다`);
  return record(
    itemKey(v),
    `납입면제 호 — ${label}`,
    "item",
    `납입면제 조 ① 의 사유 호 — ${label}(${v}). 넘겨받은 종의 사유에 이 값이 있을 때만 호를 낸다(원문 글 그대로). 템플릿의 [납입면제종마다] 항의 호 목록에 사유별로 늘어놓고 종들 ← 현재 종`,
    onlyIfReason(body),
    [PLANS_PARAM],
    reasonLocals([v]),
  );
}

/** 사유별 정의 함수조항 — 유형 「항」, 인자 종들 · 프리셋 ‘적용 종’, 본문 전체가 IF 해당. */
function definitionClause(d: DefinitionSpec, line: Line, body: Block[]): WaiverClause {
  const label = `${d.label} 정의 및 진단확정${d.perLine ? `(${line})` : ""}`;
  return withPresets(
    record(
      definitionKey(d, line),
      label,
      "block",
      `「…의 정의 및 진단확정」 조의 ${d.label} 정의 · 진단확정 항 — 적용 종들의 사유에 ${d.values.join(" · ")} 가 있을 때만. ${d.perLine ? `${line} 상품군의 글` : "두 상품군이 같은 글"}. 템플릿은 사유별 정의를 열거형 순서로 늘어놓고 프리셋 ‘적용 종’으로 넣는다`,
      onlyIfReason(body),
      [PLANS_PARAM],
      reasonLocals(d.values),
    ),
    APPLIED_PRESETS,
  );
}

/** [납입면제종마다] 항의 호 목록 — 사유별 호 함수조항을 열거형 순서로, 종들 ← 반복의 현재 종 (ADR-0086 결정 2). */
function itemRefs(articleId: Id, outerId: Id): ClauseBlockRefNode[] {
  return ITEM_REASONS.map((r) => ({ id: itemRefId(articleId, r.code), kind: "clauseBlockRef", clauseCode: `@${itemKey(r.code)}`, options: {}, bindings: { 종들: { kind: "current", loop: outerId } } }));
}

/** 정의 조 본문 — 사유별 정의 함수조항을 열거형 순서로, 프리셋 ‘적용 종’. 제목은 일반 고정 제목(`definitionTitle`, ADR-0088 결정 7). */
function definitionRefs(articleId: Id, line: Line): ClauseBlockRefNode[] {
  return DEFINITIONS.map((d) => presetRef(`${articleId}-p1-k-${d.key}`, definitionKey(d, line), "S01"));
}

/** 정의 조 제목 — 사유를 나열하지 않는 일반 고정 제목 (ADR-0088 결정 7, 2026-10-17). 원문(사유 나열)과의 문구 차이는 허용 차이(`src/db/seed/knownDifferences.ts`). */
export const DEFINITION_TITLE = "보험료 납입면제 사유의 정의 및 진단확정";

/**
 * 정의 조 제목 — 일반 고정 제목 [글 하나]. 제목과 본문이 같은 사유 목록을 각자 반복하면 원천이 두 벌이 되므로 제목은 나열하지 않는다(ADR-0088 결정 7).
 * 원문 제목은 그 상품의 사유 나열(원문 순서 = 열거형 순서)이어야 한다 — 다르면 던진다(원문 · 열거형이 어긋난 것, 허용 차이 목록도 그 원문 제목을 쓴다).
 */
function definitionTitle(a: ArticleNode, labels: readonly string[]): InlineNode[] {
  const original = foldTitle(a.title);
  const expected = `${labels.join(", ")}의 정의 및 진단확정`;
  if (original !== expected) throw new Error(`납입면제 재모델링: 정의 조 제목 「${original}」이 사유 나열 「${expected}」과 다르다`);
  return [{ id: `${a.id}.title`, kind: "text", text: DEFINITION_TITLE }];
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
 * `remap` 은 사라지는 원문 노드(납입면제 조 ① 의 호)를 그 사유의 호 함수조항 참조(템플릿 노드)로 옮긴다 — 종마다 반복 안이라 펼친 것 전부가 대상이고
 * 값 한정이 필요 없다(ADR-0086 결정 2). 같은 대상(· 안쪽 코드)으로 모인 원문 대상은 하나로 합친다.
 */
type Remapped = { articleId: Id; innerCode?: Code };
type Remap = (id: Id, ref: ArticleRefNode) => Remapped | undefined;

function mergeTarget(targets: Remapped[], next: Remapped): void {
  if (!targets.some((x) => x.articleId === next.articleId && x.innerCode === next.innerCode)) targets.push(next);
}

function clauseInline(n: InlineNode, inside: ReadonlySet<Id>, remap: Remap): Inline {
  switch (n.kind) {
    case "articleRef": {
      const own = n.targets.filter((t) => inside.has(t.articleId));
      if (own.length === n.targets.length) return { id: n.id, kind: "articleRef", targets: n.targets.map((t) => ({ articleId: t.articleId })), connector: n.connector, scope: "clause" };
      if (own.length > 0) throw new Error(`납입면제 재모델링: 조 참조 ${n.id} 가 함수조항 안팎을 함께 가리킨다`);
      const targets: Remapped[] = [];
      for (const t of n.targets) mergeTarget(targets, remap(t.articleId, n) ?? { articleId: t.articleId });
      // 반복 · 함수조항 참조 대상은 하나여도 연결어가 있어야 한다(P3 인계) — 원문의 연결어(변환기 기본 「및」 · 「또는」)를 그대로 둔다
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
 * 알파Plus 보통약관의 납입면제 자리를 사유별 · 역할 함수조항과 반복 템플릿으로 바꾸고, 함수조항을 돌려준다(적재 순서 —
 * 사유별 호 12 → 정의(알파Plus 상품군 · 두 상품군 공통) → 부가항 · 세부규정 · 무효 · 부활 문구).
 * `meritz` 는 중증화상및부식의 원문(통합간편 제29조 ② 제6호 · 제30조 ⑨ ⑩) — 알파Plus 에는 그 사유가 없지만 두 상품군이 함께 쓰는 호 · 정의라 여기서 만든다.
 */
export function applyAlphaWaiver(alpha: WaiverSource, meritz: WaiverSource): WaiverClause[] {
  const a22 = articleOf(alpha, "22");
  const a27 = articleOf(alpha, "27의1");
  const a27d = articleOf(alpha, "27의2");
  const a27x = articleOf(alpha, "27의3");
  const a30 = articleOf(alpha, "30");
  const m30 = articleOf(meritz, "30");

  // ── 제27조의1 반복 템플릿의 노드 id — 세부규정 · 부가항의 호 참조가 가리킨다
  const p1 = paragraphs(a27)[0];
  const outerId = `${a27.id}-for-plans`;
  const items = (p1.items ?? []).filter((it): it is ItemNode => it.kind === "item");
  if (items.length !== 11) throw new Error(`납입면제 재모델링: 제27조의1 ① 호가 11개가 아니다(${items.length})`);
  const cancerItem = items[0].id;
  const disabilityItems = new Set([items[9].id, items[10].id]);
  // 원문 호를 가리키던 참조 → 그 사유의 호 함수조항 참조(종마다 반복 안 — 펼친 것 전부, 값 한정이 필요 없다)
  const remap: Remap = (id) => {
    if (id === cancerItem) return { articleId: itemRefId(a27.id, REASON.cancerWaiting) };
    if (disabilityItems.has(id)) return { articleId: itemRefId(a27.id, REASON.disability) };
    if (id.startsWith(`${a27.id}-p1-i`)) throw new Error(`납입면제 재모델링: 제27조의1 ① 호 ${id} 를 가리키는 참조를 옮길 곳이 없다`);
    return undefined;
  };

  // ── ① 사유별 호 — 원문 글 그대로(조사 · 암 호 차이). 상해및질병80% 는 호 둘. 새로 짓는 글은 암·무면책 호(암보장개시일 없는 암 호)뿐
  const noInside = new Set<Id>();
  const item = (it: ItemNode) => clauseItem(it, noInside, remap);
  const itemBodies: Record<Code, unknown[]> = {
    [REASON.cancerWaiting]: [item(items[0])],
    [REASON.cancerNoWaiting]: [{ id: "i-cancer-nowait", kind: "item", children: [text("t-cancer-nowait", "피보험자가「암(유사암제외)」으로 진단확정되었을 경우")] }],
    ...Object.fromEntries(REASON.diseases.map((v, i) => [v, [item(items[1 + i])]])),
    [REASON.disability]: [item(items[9]), item(items[10])],
    // 중증화상및부식 — 통합간편 원문 제29조 ② 제6호의 글(알파Plus 에는 없는 사유)
    [REASON.burn]: [{ id: "i-burn", kind: "item", children: [text("t-burn", "피보험자가 「중증화상및부식」으로 진단확정되었을 경우")] }],
  };
  const itemClauses = ITEM_REASONS.map((r) => itemClause(r.code, itemBodies[r.code]));

  // ── ② 사유별 정의 — 정의 · 진단확정 항(암은 【용어풀이】 박스 둘을 품는다). 알파Plus 상품군 몫 + 두 상품군 공통(중증화상및부식은 통합간편 원문)
  const x = a27x;
  const xInside = structIds(x);
  const blocks = (ids: readonly Id[], src: ArticleNode = x, inside: ReadonlySet<Id> = xInside) => takeBlocks(src, ids).map((b) => clauseBlock(b, inside, remap));
  const definitionBodies: Record<string, Block[]> = {
    cancer: blocks(paragraphRun(x, 1, 4)),
    V03: blocks(paragraphRun(x, 5, 6)),
    V04: blocks(paragraphRun(x, 7, 8)),
    V05: blocks(paragraphRun(x, 9)),
    V06: blocks(paragraphRun(x, 10)),
    V07: blocks(paragraphRun(x, 11, 12)),
    V08: blocks(paragraphRun(x, 13, 14)),
    V09: blocks(paragraphRun(x, 15, 17)),
    V10: blocks(paragraphRun(x, 18, 19)),
    V14: blocks(paragraphRun(m30, 9, 10), m30, structIds(m30)),
  };
  const definitionClauses = DEFINITIONS.map((d) => definitionClause(d, LINE.alpha, definitionBodies[d.key]));

  // ── ③ 면제 부가항(종들) — 암보장개시일 항 + 【그림】 박스, 면책 사유가 있을 때만
  const addendumBlocks = takeBlocks(a27, paragraphRun(a27, 2)).map((b) => clauseBlock(b, noInside, remap));
  const addendumClause = record(
    "waiver-addendum",
    "면제 부가항(알파Plus)",
    "block",
    "납입면제 조 ② — 적용 종들의 사유에 면책(암보장개시일이 있는) 사유가 있으면 「제1항 제1호의 암보장개시일이라 함은 …」 항과 【그림】 박스. 「제1항 제1호」는 암·면책 호 함수조항 참조",
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
    "납입면제에 관한 세부규정 조의 본문 — 면책 사유 → ①~③(재발 · 5년 · 부활 청약일), 장해 → ④~⑥ · ⑧~⑪, ⑦ 제3자 합의는 늘, 상해 관련 장해 → ⑫. 「제27조의1 제1항 제1호」 · 「제10호, 제11호」는 그 사유의 호 함수조항 참조",
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
    [{ id: "c", kind: "condBlock", branches: [{ id: "c-if", when: "var.면책있음", children: [voidParagraph(p22.id)] }] }],
    [PLANS_PARAM],
    [REASONS_LOCAL, WAITING_LOCAL],
  );

  // ── ⑥ 부활 문구(종들) — 제30조 ④ 「…암보장개시일을 적용합니다」, 면책 사유가 있을 때만. 항 하나라 유형 = 항(문구면 빈 ④ 가 남는다).
  // 통합간편 제35조 ④ 와 낱말 하나(계약일 ↔ 최초계약일)만 달라 두 상품이 함께 쓴다 — 그 낱말은 상품 속성(갱신형여부)이 정해 인자 갱신 + 문장 안 조건이다.
  // 함수조항 안에는 「기준일 문구」 함수조항을 끼울 수 없다(중첩 금지 — ADR-0086 결정 6)
  const reviveId = paragraphRun(a30, 4);
  const [reviveSource] = takeBlocks(a30, reviveId);
  if (reviveId.length !== 1 || reviveSource.kind !== "paragraph" || JSON.stringify(reviveSource.children) !== JSON.stringify([{ ...reviveSource.children[0], text: REVIVE_TEXT("계약일") }])) throw new Error("납입면제 재모델링: 제30조 ④ 가 부활 문구가 아니다");
  const reviveClause = record(
    "waiver-revive",
    "부활 문구",
    "block",
    "부활(효력회복) 조 — 적용 종들의 사유에 면책 사유가 있으면 「부활(효력회복)시 부활(효력회복)일을 〔기준일〕로 하여 암보장개시일을 적용합니다」. 기준일은 인자 갱신(기본 연결 = 갱신형 상품) — 연만기(갱신형) 상품은 최초계약일, 세만기는 계약일",
    [{ id: "c", kind: "condBlock", branches: [{ id: "c-if", when: "var.면책있음", children: [{ id: reviveSource.id, kind: "paragraph", children: [text("t1", "부활(효력회복)시 부활(효력회복)일을 "), basisWord("o"), text("t2", "로 하여 암보장개시일을 적용합니다.")] }] }] }],
    [PLANS_PARAM, RENEWAL_PARAM],
    [REASONS_LOCAL, WAITING_LOCAL],
  );

  // ── 템플릿 — 사유 값으로 분기하지 않는다(결정 10). 사유별 함수조항을 늘어놓기만 하고, 켜고 끄기는 함수조항 안의 「해당」이 한다(ADR-0086 결정 2)
  // 제27조의1 — ① [납입면제종마다] 항 › 사유별 호, ② 부가항, ③ ④ ⑤ 원문 그대로
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
    items: itemRefs(a27.id, outerId),
  };
  const outer: ForBlockNode = { id: outerId, kind: "forBlock", source: { kind: "planOptions", ...APPLIED }, children: [repeated] };
  const addendumRef = presetRef(`${a27.id}-p2-k`, "waiver-addendum", "S01");
  const [, , p3, p4, p5] = paragraphs(a27);
  const rest = a27.children.slice(a27.children.indexOf(p3));
  a27.children = [outer, addendumRef, ...rest];
  // ④ 1형 적립 중지 — 해약환급금 지급형이 있을 때만 (결정 24). ⑤ 「제1항부터 제4항까지」는 대상 넷인 참조 하나로
  if (!paragraphs(a27).includes(p4) || !JSON.stringify(p4.children).includes("1형(해약환급금 지급형)의 경우")) throw new Error("납입면제 재모델링: 제27조의1 ④ 가 1형 적립 중지가 아니다");
  wrapBlock(a27, p4.id, SURRENDER_PAYING, `${p4.id}-if`);
  mergeRanges(p5, [p1.id, addendumRef.id, p3.id, p4.id, p5.id]);

  // 제27조의2 — 조 본문 = 세부규정 한 줄
  a27d.children = [presetRef(`${a27d.id}-p1-k`, "waiver-detail", "S01")];

  // 제27조의3 — 사유별 정의를 열거형 순서로, 제목은 일반 고정 제목 (ADR-0088 결정 7)
  x.children = definitionRefs(x.id, LINE.alpha);
  x.title = definitionTitle(x, ["암(유사암제외)", "뇌졸중", "급성심근경색증", "말기폐질환", "말기간경화", "말기신부전증", "양성뇌종양", "중대한재생불량성빈혈", "만성당뇨합병증"]);

  // 제22조 — 원문 두 항 뒤에 무효 문구(③), 제30조 — ④ 를 부활 문구로
  a22.children = [...a22.children, presetRef(`${a22.id}-p3-k`, "waiver-void", "S01")];
  const at30 = a30.children.findIndex((c) => c.id === reviveId[0]);
  a30.children.splice(at30, reviveId.length, presetRef(`${a30.id}-p4-k`, "waiver-revive", "S01"));

  // 세 조를 「납입면제 있음」 조 자리 IF 로 감싼다(결정 16) — 관 안의 잇닿은 세 조
  wrapArticles(alpha.tree, [a27.id, a27d.id, x.id], `${a27.id}-if-waiver`);

  return [...itemClauses, ...definitionClauses, ...[addendumClause, detailClause, voidClause, reviveClause].map((c) => withPresets(c, APPLIED_PRESETS))];
}

/**
 * 통합간편 보통약관의 납입면제 자리(제29조 · 제30조 · 제31조 · 제22조 무효 · 제35조 부활)를 같은 모양으로 바꾸고, 통합간편 상품군 몫의 함수조항을 돌려준다
 * (정의 — 상품군마다 글이 다른 셋 · 부가항 · 세부규정 · 무효). `shared` 는 알파Plus 가 만든 함수조항 — 사유별 호 · 두 상품군 공통 정의 · 부활 문구는 함께 쓴다.
 *
 * 통합간편 원문은 종마다 항이 따로다 — ① 2종(보험료 납입면제 1형) · ② 3종(보험료 납입면제 2형). [납입면제종마다] 항 하나가 그 둘을 낸다(결정 11).
 * 그래서 「제1항 또는 제2항」은 반복 항 하나를 가리키는 참조(연결어 또는), 「제1항 제1호 및 제2항 제1호」는 암·면책 호 함수조항 참조 하나다(종마다 펼친 것 전부).
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
    if (!c) throw new Error(`납입면제 재모델링: 공유 함수조항 ${key} 없음`);
    return c;
  };

  // ── 제29조 반복 템플릿의 노드 id
  const [p1, p2, , p4, p5, p6, p7] = paragraphs(a29);
  if (!p7) throw new Error("납입면제 재모델링: 통합간편 제29조 항이 일곱이 아니다");
  const outerId = `${a29.id}-for-plans`;
  const itemsOf = (p: ParagraphNode) => (p.items ?? []).filter((it): it is ItemNode => it.kind === "item");
  const i1 = itemsOf(p1);
  const i2 = itemsOf(p2);
  if (i1.length !== 5 || i2.length !== 6) throw new Error(`납입면제 재모델링: 통합간편 제29조 ① ② 호가 5 · 6 개가 아니다(${i1.length} · ${i2.length})`);
  // 원문 호 → 사유 (두 항이 같은 순서 — 원문 호 목록 그대로, 세목 사유와 같다). 장해(V11)는 호 둘(상해 · 질병)
  const reasonOfItem = new Map<Id, Code>([
    [i1[0].id, REASON.cancerWaiting],
    [i2[0].id, REASON.cancerWaiting],
    [i1[1].id, "V03"],
    [i2[1].id, "V03"],
    [i1[2].id, "V04"],
    [i2[2].id, "V04"],
    [i1[3].id, REASON.disability],
    [i1[4].id, REASON.disability],
    [i2[3].id, REASON.disability],
    [i2[4].id, REASON.disability],
    [i2[5].id, REASON.burn],
  ]);
  // 「제1항 제4호 또는 제2항 제4호 및 제6호의 상해관련」(제31조 ⑫) — 장해 호 함수조항이 낸 호 둘 중 상해 호만: 그 함수조항 안 첫 호의 코드를 안쪽 코드로 건다
  const firstItemCode = (find(withClauseCodes(sharedOf(itemKey(REASON.disability)).record.body), (x) => x.kind === "item") as { code?: Code } | undefined)?.code;
  if (!firstItemCode) throw new Error("납입면제 재모델링: 장해 호 함수조항의 상해 호 코드가 없다");
  const injuryRef = (ref: ArticleRefNode) => ref.targets.map((t) => t.articleId).join() === [i1[3].id, i2[3].id, i2[5].id].join();
  const remap: Remap = (id, ref) => {
    if (id === p2.id) return { articleId: p1.id };
    const v = reasonOfItem.get(id);
    if (!v) return undefined;
    return { articleId: itemRefId(a29.id, v), ...(v === REASON.disability && injuryRef(ref) ? { innerCode: firstItemCode } : {}) };
  };
  const noInside = new Set<Id>();

  // ── 정의 — 통합간편 상품군 몫(암 ①~④ · 뇌졸중 ⑤⑥ · 급성심근경색증 ⑦⑧, 「이 계약에 있어」). 나머지(중증화상및부식 ⑨⑩ 포함)는 두 상품군 공통 함수조항
  const xInside = structIds(a30);
  const m = (from: number, to = from) => takeBlocks(a30, paragraphRun(a30, from, to)).map((b) => clauseBlock(b, xInside, remap));
  const definitionBodies: Record<string, Block[]> = { cancer: m(1, 4), V03: m(5, 6), V04: m(7, 8) };
  const definitionClauses = DEFINITIONS.filter((d) => d.perLine).map((d) => definitionClause(d, LINE.meritz, definitionBodies[d.key]));
  for (const d of DEFINITIONS.filter((x) => !x.perLine)) sharedOf(definitionKey(d, LINE.meritz));

  // ── 면제 부가항(통합간편) — ③ 「제1항 제1호 및 제2항 제1호의 암보장개시일이라 함은 최초계약일부터 …」 + 【그림】 박스, 면책 사유가 있을 때만
  const addendumClause = record(
    "waiver-addendum-meritz",
    "면제 부가항(통합간편)",
    "block",
    "납입면제 조 ③(통합간편) — 적용 종들의 사유에 면책 사유가 있으면 「제1항 제1호 및 제2항 제1호의 암보장개시일이라 함은 최초계약일부터 …」 항과 【그림】 박스. 「제1항 제1호 및 제2항 제1호」는 암·면책 호 함수조항 참조 하나 — 종마다 항이 펼쳐진 만큼 찍힌다",
    [{ id: "c", kind: "condBlock", branches: [{ id: "c-if", when: "var.면책있음", children: takeBlocks(a29, paragraphRun(a29, 3)).map((b) => clauseBlock(b, noInside, remap)) }] }],
    [PLANS_PARAM],
    [REASONS_LOCAL, WAITING_LOCAL],
  );

  // 원문 변환이 두 겹 연결어의 뒷 덩어리(「또는 제2항 제4호 및 제5호」 등)를 글로 남겼다 — 앞 참조의 대상으로 거둔다(연결어 = 바깥 연결어 또는, 결정 14)
  const [, , , d4, , , , , , , d11, d12] = paragraphs(a31);
  absorbPlain(d4, [i1[3].id, i1[4].id], " 또는 제2항 제4호 및 제5호", [i2[3].id, i2[4].id]);
  absorbPlain(d11, [i1[3].id, i1[4].id], " 또는 제2항 제4호부터 제6호까지", [i2[3].id, i2[4].id, i2[5].id]);
  absorbPlain(d12, [i1[3].id, i2[3].id], " 및 제6호", [i2[5].id]);

  // ── 납입면제 세부규정(통합간편) — 면책 ①~③ · 장해 ④~⑥ · ⑦ 제3자 합의 고정 · 장해 ⑧~⑩ · 장해 또는 중증화상 ⑪ · 상해 장해 또는 중증화상 ⑫
  const dInside = structIds(a31);
  const d = (from: number, to = from) => takeBlocks(a31, paragraphRun(a31, from, to)).map((b) => clauseBlock(b, dInside, remap));
  const iff = (id: string, when: string, children: Block[]) => ({ id, kind: "condBlock", branches: [{ id: `${id}-if`, when, children }] });
  const detailClause = record(
    "waiver-detail-meritz",
    "납입면제 세부규정(통합간편)",
    "block",
    "납입면제에 관한 세부규정 조의 본문(통합간편) — 면책 사유 → ①~③, 장해 → ④~⑥ · ⑧~⑩, ⑦ 제3자 합의는 늘, 장해 또는 중증화상및부식 → ⑪ 고의 · 전쟁 제외, 상해 장해 또는 중증화상및부식 → ⑫ 위험 활동 제외. 「제29조 제1항 제1호 또는 제2항 제1호」 등은 그 사유의 호 함수조항 참조(⑫ 상해관련은 장해 호 함수조항의 첫 호) — 원문의 두 겹 연결어는 연결어 한 칸으로(인수기준 알려진 차이)",
    [iff("c1", "var.면책있음", d(1, 3)), iff("c2", "var.장해있음", d(4, 6)), ...d(7), iff("c3", "var.장해있음", d(8, 10)), iff("c4", "var.장해화상", d(11)), iff("c5", "var.상해관련", d(12))],
    [PLANS_PARAM],
    [REASONS_LOCAL, WAITING_LOCAL, DISABILITY_LOCAL, INJURY_LOCAL, DISABILITY_BURN_LOCAL, INJURY_BURN_LOCAL],
  );

  // ── 무효 문구(통합간편) — 알파Plus 무효 문구와 글이 같지만 「제1항」이 제 보통약관의 계약의 무효 조를 가리킨다(보통약관 참조는 템플릿마다 조가 다르다)
  const voidClause = record(
    "waiver-void-meritz",
    "무효 문구(통합간편)",
    "block",
    "계약의 무효 조(통합간편) — 적용 종들의 사유에 면책 사유가 있으면 암보장개시일 전일 이전 진단확정 시 무효 항. 통합간편 원문 제22조에는 없다(원문 누락 — QA/인수기준 알려진 차이). 글은 무효 문구(알파Plus)와 같다",
    [{ id: "c", kind: "condBlock", branches: [{ id: "c-if", when: "var.면책있음", children: [voidParagraph(paragraphs(a22)[0].id)] }] }],
    [PLANS_PARAM],
    [REASONS_LOCAL, WAITING_LOCAL],
  );

  // ── 템플릿
  const lead = p1.children[0];
  const LEAD = "회사는 2종(보험료 납입면제 1형)을 가입한 피보험자가 ";
  if (p1.children.length !== 1 || lead?.kind !== "text" || !lead.text.startsWith(LEAD)) throw new Error("납입면제 재모델링: 통합간편 제29조 ① 첫 문장이 원문과 다르다");
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
    items: itemRefs(a29.id, outerId),
  };
  const outer: ForBlockNode = { id: outerId, kind: "forBlock", source: { kind: "planOptions", ...APPLIED }, children: [repeated] };
  const addendumRef = presetRef(`${a29.id}-p3-k`, addendumClause.key, "S01");
  a29.children = [outer, addendumRef, ...a29.children.slice(a29.children.indexOf(p4))];
  // ④ ⑤ 「제1항 또는 제2항」 = 반복 항 하나(연결어 또는), ⑥ ⑦ 「제1항부터 제4항까지」 = 대상 셋(반복 항 · 부가항 · ④)인 참조 하나
  for (const p of [p4, p5, p6, p7]) remapTemplateRefs(p, (id) => (id === p2.id ? p1.id : id));
  for (const p of [p6, p7]) mergeRanges(p, [p1.id, addendumRef.id, p4.id, p5.id, p6.id, p7.id]);

  // 제31조 — 조 본문 = 세부규정 한 줄, 제30조 — 사유별 정의를 열거형 순서로, 제목은 일반 고정 제목 (ADR-0088 결정 7)
  a31.children = [presetRef(`${a31.id}-p1-k`, detailClause.key, "S01")];
  a30.children = definitionRefs(a30.id, LINE.meritz);
  a30.title = definitionTitle(a30, ["암(유사암제외)", "뇌졸중", "급성심근경색증", "중증화상및부식"]);

  // 제22조 — 원문 두 항 뒤에 무효 문구(③), 제35조 ④ — 부활 문구(기준일은 갱신형 상품이라 최초계약일). ④ 뒤 【부활(효력회복)】 박스는 조의 것이라 템플릿에 남는다
  a22.children = [...a22.children, presetRef(`${a22.id}-p3-k`, voidClause.key, "S01")];
  const r4 = paragraphs(a35)[3];
  if (!r4 || JSON.stringify(r4.children.map((c) => (c.kind === "text" ? c.text : c.kind))) !== JSON.stringify([REVIVE_TEXT("최초계약일")])) throw new Error("납입면제 재모델링: 통합간편 제35조 ④ 가 부활 문구가 아니다");
  a35.children.splice(a35.children.indexOf(r4), 1, presetRef(`${a35.id}-p4-k`, "waiver-revive", "S01"));

  // 제2조 표의 종별 행(2종 · 3종)의 「제29조 제1항」 · 「제2항」은 종 하나를 가리킨다 — 종 한정 참조는 다음 기획이라 글로 굳힌다(원문 표기 그대로).
  // 「제29조 제4항」 · 「제29조 및 제31조」는 참조로 둔다
  freezeRefs(a2, new Map([
    [p1.id, "제29조(보험료의 납입면제) 제1항"],
    [p2.id, "제29조(보험료의 납입면제) 제2항"],
  ]));

  // 세 조를 「납입면제 있음」 조 자리 IF 로 감싼다(결정 16)
  wrapArticles(meritz.tree, [a29.id, a30.id, a31.id], `${a29.id}-if-waiver`);

  return [...definitionClauses, withPresets(addendumClause, APPLIED_PRESETS), withPresets(detailClause, APPLIED_PRESETS), withPresets(voidClause, APPLIED_PRESETS)];
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
/** 가리키는 문장의 조건 — 화면 조건 줄(좌변 · 연산자 · 값)로 풀리는 모양(맨 구분자는 줄이 되지 않는다 — 화면 E2E 가 머리 줄로 친다). */
const WAIVER_PRESENT_ROW = `${WAIVER_PRESENT} = true`;

export function guardWaiverMentions(tree: DocumentNode, waiver: (id: Id) => boolean, where: string): number {
  let count = 0;
  const mentions = (list: readonly unknown[]) => JSON.stringify(list).match(/"articleId":"([^"]+)"/g)?.some((m) => waiver(m.slice('"articleId":"'.length, -1))) ?? false;
  const visit = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(visit);
    if (!n || typeof n !== "object") return;
    const o = n as { id?: Id; kind?: string; children?: InlineNode[]; rows?: { header?: boolean; cells: InlineNode[][] }[]; branches?: { when?: string }[] };
    // 이미 「납입면제 있음」으로 감싼 호 · 항(`guardWaiverBlocks`)은 함께 빠진다
    if (o.kind === "condBlock" && o.branches?.[0]?.when === WAIVER_PRESENT_ROW) return;
    // 납입면제 조 자신(서로 가리킨다)은 함께 빠지므로 감싸지 않는다
    if (o.kind === "article" && o.id && waiver(o.id)) return;
    if (o.kind === "table" && o.rows) {
      for (const row of o.rows) {
        if (row.header) continue;
        row.cells = row.cells.map((cell, c) => {
          if (!mentions(cell)) return cell;
          count++;
          const id = `${cell[0]?.id ?? `${where}-c${c}`}-if-waiver`;
          return [{ id, kind: "inlineCond", branches: [{ id: `${id}-b`, when: WAIVER_PRESENT_ROW, children: cell }] } as InlineNode];
        });
      }
      return;
    }
    if ((o.kind === "paragraph" || o.kind === "item") && o.children && mentions(o.children)) {
      const refAt = o.children.findIndex((c) => c.kind === "articleRef" && c.targets.some((t) => waiver(t.articleId)));
      const before = o.children[refAt - 1];
      const marker = before?.kind === "text" && before.text.endsWith(" 또는 ") ? " 또는 " : before?.kind === "text" && before.text.includes(" 또한, ") ? " 또한, " : undefined;
      const end = marker === " 또는 " ? "에서 정한 보험료 납입면제 사유의 발생을 알게된 경우" : "은 제외합니다.";
      if (!marker || !guardSpan(o as { children: InlineNode[] }, refAt, marker, end, WAIVER_PRESENT_ROW)) {
        // 자동 탑재 특약의 준용규정이 문면에 남은 자리 — 「…은 제외하며, … [납입면제 두 조]도 제외합니다.」(`guardExcludeSentence`).
        // 갱신형 나열처럼 납입면제 조가 다른 조와 한 참조에 섞이면 일부만 빠져 남은 대상으로 찍히므로 감싸지 않는다(기능/문면 §3.5)
        const ref = o.children[refAt] as ArticleRefNode;
        if (guardExcludeSentence(o as { children: InlineNode[] }, refAt)) count++;
        else if (ref.targets.every((t) => waiver(t.articleId))) throw new Error(`납입면제 재모델링: ${where} 의 납입면제 조 참조 ${o.children[refAt]?.id} 를 감쌀 문장을 모른다`);
      } else count++;
    }
    for (const key of ["children", "items", "subitems", "branches"]) {
      const v = (o as Record<string, unknown>)[key];
      if (Array.isArray(v)) v.forEach(visit);
    }
  };
  visit(tree.children);
  return count;
}

/**
 * 문장 안 조건으로 감쌀 수 없는 납입면제 조 참조(납입면제 조만 가리키는 참조 — 특약 자체의 납입면제 조가 보통약관 제27조의3 정의를 가리키는 호 등)가 든
 * 호 · 항을 통째로 「납입면제 있음」 조 자리 · 호 자리 IF 로 감싼다 — 납입면제 없는 상품이면 그 호 · 항이 빠진다.
 * 특약 자체의 납입면제 조 · 소제목 자리는 `guardOwnWaiver` 가 먼저 통째로 감싸 여기서는 건너뛴다(`skip` — 2026-10-14, 「다음 중 어느 하나」 뒤가 비던 한계를 지웠다).
 * 자동 탑재 특약만 쓴다(`guardWaiverMentions` 앞). 준용규정 꼴(「…은 제외하며, …도 제외합니다」 · 「또한, …」 · 「또는 …」)과 다른 조와 섞인 나열은 건드리지 않는다. 감싼 수를 돌려준다.
 */
export function guardWaiverBlocks(tree: DocumentNode, waiver: (id: Id) => boolean, skip: (id: Id) => boolean = () => false): number {
  let count = 0;
  const onlyWaiver = (xs: readonly InlineNode[]) => {
    const at = xs.findIndex((c) => c.kind === "articleRef" && c.targets.length > 0 && c.targets.every((t) => waiver(t.articleId)));
    if (at < 0) return false;
    const before = xs[at - 1];
    const text = before?.kind === "text" ? before.text : "";
    return !(text.endsWith(" 또는 ") || text.includes(" 또한, ") || text.includes("제외하며, "));
  };
  const wrap = (node: ParagraphNode | ItemNode): CondBlockNode => {
    count++;
    const id = `${node.id}-if-waiver`;
    return { id, kind: "condBlock", branches: [{ id: `${id}-b`, when: WAIVER_PRESENT_ROW, children: [node as BlockNode] }] } as CondBlockNode;
  };
  for (const a of allArticles(tree)) {
    // 특약 자체의 납입면제 조(`guardOwnWaiver` 가 조째 감쌌다)는 함께 빠진다
    if (waiver(a.id) || skip(a.id)) continue;
    a.children = a.children.map((c) => {
      if (c.kind !== "paragraph") return c;
      c.items = c.items?.map((it) => (it.kind === "item" && onlyWaiver(it.children) ? (wrap(it) as unknown as typeof it) : it));
      return onlyWaiver(c.children) ? (wrap(c) as unknown as typeof c) : c;
    });
  }
  return count;
}

/** 특약 자체의 납입면제 조 제목 — 2대질환 주요치료비 · 비급여 암 주요치료비 등(원문 「보험료의 납입면제」 · 「납입면제에 관한 세부규정」). */
const OWN_WAIVER_TITLES = new Set(["보험료의 납입면제", "납입면제에 관한 세부규정"]);

/**
 * 특약 자체의 납입면제(자동 탑재 특약) — 납입면제 없는 상품(종 축 1종만)이면 통째로 빠진다(2026-10-14).
 * - 조째: 제목이 「보험료의 납입면제」 · 「납입면제에 관한 세부규정」인 조를 조 자리 IF 「납입면제 있음」으로.
 * - 통합형 특약: 세부보장 안 「N.(보험료의 납입면제)」 · 「N.(납입면제에 관한 세부규정)」 소제목 자리(변환기가 표시한 머리 박스 · 항 — `marked`,
 *   박스 참조 · 함수조항 참조가 된 자리는 원래 노드 id + 「-k」)를 잇닿은 블록째 조 안 IF 로.
 * 감싼 자리 안 노드(변환 중간 id)인지 가리는 술어를 돌려준다 — 그 자리를 가리키는 다른 문장을 고칠 때(`guardWaiverMentions`) 쓴다.
 */
export function guardOwnWaiver(tree: DocumentNode, marked: ReadonlySet<Id>): (id: Id) => boolean {
  const roots: Id[] = [];
  const cond = (id: Id, children: unknown[]) => ({ id, kind: "condBlock", branches: [{ id: `${id}-b`, when: WAIVER_PRESENT_ROW, children }] });
  const base = (id: Id) => id.replace(/-k$/, "");
  const visit = (list: unknown[]): void => {
    list.forEach((c, i) => {
      const o = c as { id: Id; kind: string; title?: InlineNode[]; children?: unknown[]; branches?: { children: unknown[] }[] };
      if (o.kind === "section") return visit(o.children ?? []);
      if (o.kind === "condBlock") return o.branches?.forEach((b) => visit(b.children));
      if (o.kind !== "article") return;
      if (OWN_WAIVER_TITLES.has(foldTitle(o.title ?? []))) {
        roots.push(o.id);
        list[i] = cond(`${o.id}-if-own-waiver`, [o]);
        return;
      }
      const a = o as unknown as ArticleNode;
      const out: unknown[] = [];
      for (let k = 0; k < a.children.length; k++) {
        if (!marked.has(base(a.children[k].id))) {
          out.push(a.children[k]);
          continue;
        }
        const run: BlockNode[] = [];
        while (k < a.children.length && marked.has(base(a.children[k].id))) run.push(a.children[k++]);
        k--;
        roots.push(...run.map((b) => base(b.id)));
        out.push(cond(`${run[0].id}-if-own-waiver`, run));
      }
      a.children = out as BlockNode[];
    });
  };
  visit(tree.children);
  return (id) => roots.some((r) => id === r || id.startsWith(`${r}-`));
}

/**
 * 「… [조 참조]은 제외하며, 보통약관 1종(…)으로 가입한 경우 보통약관 [제27조의1 및 제27조의2]도 제외합니다.」 — 납입면제 조만 가리키는 참조(`refAt`)를 둘러싼
 * 「은 제외하며, …도 제외합니다.」를 「납입면제 있음」이면 그대로, 아니면 「은 제외합니다.」로 가른다(문장 안 IF / ELSE — 준용규정(알파Plus 질병)과 같은 모양).
 * 자동 탑재 특약의 준용규정(문면에 남은 것 · 변환기가 찾은 함수조항)이 쓴다. 모양이 아니면 건드리지 않고 false.
 */
export function guardExcludeSentence(p: { children: (InlineNode | Inline)[] }, refAt: number): boolean {
  const END = "도 제외합니다.";
  const xs = p.children;
  const before = xs[refAt - 1];
  const after = xs[refAt + 1];
  if (before?.kind !== "text" || after?.kind !== "text" || !after.text.startsWith(END)) return false;
  // 「…은 제외합니다. 또한, 1종 … [두 조]도 제외합니다.」 — 앞 문장이 끝나 있으면 뒤 문장만 IF(ELSE 없음)
  const also = before.text.lastIndexOf(" 또한, ");
  // 「…[조 참조] 제외하며, …」처럼 「은」이 빠진 원문도 있다 — ELSE 는 원문 조사를 따른다(「 제외합니다.」)
  const mark = before.text.lastIndexOf("제외하며, ");
  const cut = also >= 0 ? also : mark < 1 || before.text[mark - 1] !== " " ? -1 : before.text[mark - 2] === "은" ? mark - 2 : mark - 1;
  if (cut < 0) return false;
  const otherwise = also >= 0 ? "" : `${before.text.slice(cut, mark)}제외합니다.`;
  const id = `${xs[refAt].id}-if-waiver`;
  const cond = {
    id,
    kind: "inlineCond",
    branches: [
      { id: `${id}-b`, when: WAIVER_PRESENT_ROW, children: [{ id: `${before.id}-w`, kind: "text", text: before.text.slice(cut) }, xs[refAt], { id: `${after.id}-w`, kind: "text", text: END }] },
      ...(also >= 0 ? [] : [{ id: `${id}-else`, children: [{ id: `${id}-else-t`, kind: "text", text: otherwise }] }]),
    ],
  };
  const head = before.text.slice(0, cut);
  const tail = after.text.slice(END.length);
  p.children = [...xs.slice(0, refAt - 1), ...(head ? [{ ...before, text: head }] : []), cond as InlineNode, ...(tail ? [{ ...after, text: tail }] : []), ...xs.slice(refAt + 2)] as typeof p.children;
  return true;
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
    { ...last, when: WAIVER_PRESENT_ROW },
    { id: `${last.id}-else`, children: [copyWithSuffix(head, "-else"), { id: `${last.id}-else-t`, kind: "text", text: "은 제외합니다." }] },
  ];
}

/**
 * 준용규정(알파Plus 질병) — 갱신 가지가 없는 한 문장 「… [제5조 · 제9조 · 제10조 · 제38조]은 제외하며, 보통약관 1종(…)으로 가입한 경우 [제27조의1 및 제27조의2]도 제외합니다.」의
 * 첫 참조 뒤를 문장 안 조건으로 나눈다 — 「납입면제 있음」이면 그대로, 아니면 「은 제외합니다.」 (준용규정(알파Plus) 비갱신 가지와 같은 모양).
 */
export function guardDiseaseApplication(clause: ClauseRecord, waiver: (id: Id) => boolean): void {
  const p = clause.body[0] as ClauseParagraph | undefined;
  const xs = p?.children ?? [];
  const refs = xs.map((c, i) => [c, i] as const).filter(([c]) => c.kind === "articleRef");
  const [first, tail] = refs;
  const isWaiverRef = (n: Inline) => n.kind === "articleRef" && n.targets.every((t) => waiver(t.articleId ?? ""));
  if (!p || clause.body.length !== 1 || refs.length !== 2 || isWaiverRef(first[0]) || !isWaiverRef(tail[0]) || xs.some((c) => c.kind === "inlineCond")) {
    throw new Error(`납입면제 재모델링: ${clause.label} 이 「…은 제외하며, 1종 … 도 제외합니다」 한 문장이 아니다`);
  }
  const at = first[1] + 1;
  const id = `${p.id}-if-waiver`;
  const cond = {
    id,
    kind: "inlineCond",
    branches: [
      { id: `${id}-b`, when: WAIVER_PRESENT_ROW, children: xs.slice(at) },
      { id: `${id}-else`, children: [{ id: `${id}-else-t`, kind: "text", text: "은 제외합니다." }] },
    ],
  } as unknown as Inline;
  p.children = [...xs.slice(0, at), cond];
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

/** 문면이 가리키는 함수조항 자리표 `@key` → 코드(납입면제 템플릿 · 문구 함수조항 오버레이). 코드는 적재 순서로 매긴 뒤에 푼다. */
export function resolveWaiverCodes(tree: DocumentNode, codeOf: (key: string) => Code | undefined): void {
  const visit = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(visit);
    if (!n || typeof n !== "object") return;
    const o = n as Record<string, unknown>;
    if ((o.kind === "clauseBlockRef" || o.kind === "clauseInlineRef") && typeof o.clauseCode === "string" && o.clauseCode.startsWith("@")) {
      const code = codeOf(o.clauseCode.slice(1));
      if (!code) throw new Error(`납입면제 재모델링: 역할 함수조항 ${o.clauseCode} 코드 없음`);
      o.clauseCode = code;
    }
    Object.values(o).forEach(visit);
  };
  visit(tree);
}

