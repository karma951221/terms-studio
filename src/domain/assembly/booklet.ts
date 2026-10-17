/**
 * 조립 진입점 — 단계별 순수 변환을 이어 붙여 책자(Booklet)를 만든다. 매번 재계산, 저장 없음 (기능/조립산출 §3).
 *
 *   buildContexts → resolveDocument → substituteSlots → replaceGeneralWithBase → ensureApplicationArticle
 *   → judgeOmission → dropEmptyArticles → numberDocument → placeSpecials → collectAppendices → renderDocument
 *
 * 절 형태(주계약 기본계약 2+ · 독립특약 — `planForm`, ADR-0021 결정 1 · ADR-0082):
 *   블록(그룹 순)마다 resolve → substitute → 블록 빈 조 빼기(블록 수 · 연결 수는 이 뒤에 센다) → 제1절 판정(planFirstSection — 연결 k/N · 함수조항 동일 가드 · 준용하기 옵션)
 *   → 제1절: 위임 · 오르는 조 비우기 → resolve → substitute → 위임 문구 · 블록에서 오른 항 → dropEmptyArticles → numberDocument
 *   → 블록: 판정대로 조 생략 · 분리(treatBlock) → ensureApplicationArticle → numberDocument (특약 조 판정을 타지 않는다) → (주계약이면 특약) → collectAppendices → renderDocument
 *
 * - 부분 조립: 오류는 마커로 심고 끝까지 간다. `issues` 는 책자 등장 순 (D-P6-12). error가 있으면 `complete=false`, warning만 있으면 완성본이다.
 * - 특약 그룹 (ADR-0090) — 상품담보마다 그 담보가 이 상품의 사용자 그룹에 들었으면 그 그룹, 아니면 담보분류의 기본 그룹.
 *   그룹 순서 = 상품의 그룹 목록(`effectiveGroups`), 제목 = 사용자 그룹 이름 · 담보분류 값의 「그룹 제목」(비면 notEntered + 제목 자리 오류 마커).
 *   담보분류 미입력(notEntered) · 지운 값(brokenRef 「없는 값」)인 담보의 상품담보는 그룹들 뒤 제목 없는 자리. 그룹 안은 담보코드 → 담보속성.
 * - 문면 없는 담보의 탑재분은 오류가 아니라 `undocumented` (D-P6-9).
 * - 특약 문서 제목 = 상품담보명 + 「 특별약관」 (임시 규칙 — 실물 조사 후 확정).
 * - `assembleSpecial` = 상품담보 미리보기 (기능/상품 §4 「상품담보 값」): 담보약관 하나를 그 상품담보 문맥으로, 보통약관과 함께.
 */

import type { OptionSelection } from "../clause/types";
import type { ArticleNode, BlockNode, DocumentNode, SectionNode } from "../document/nodes";
import { refKey, withCodes } from "../document/pcode";
import { foldTitle } from "../document/title";
import type { CompletenessFilter } from "../coverage/values";
import { CONTRACT_KIND_PATH, GROUP_TITLES_PATH, isStandaloneContract, showsGroupTitles } from "../master";
import { baseContractCoordinate, baseContractCountIssue } from "../product/completeness";
import { enumCoordinate } from "../catalog/fields";
import { COVERAGE_CATEGORY_ENUM, categoryGroupTitle } from "../coverage/category";
import { effectiveGroups, groupedCoverageIds, groupKey, sortInGroup } from "../product/groups";
import type { ClauseOptionOverride, ProductCoverage } from "../product/types";
import { type Coordinate, type Id, type Issue, ok, reject, type Result } from "../types";
import { buildContexts, generalCoordinate, generalDocumentOf, specialCoordinate, type AssemblyContext, type AssemblyContexts } from "./context";
import { ensureApplicationArticle } from "./application";
import { blockHeads } from "./blockHeads";
import { authoredEmptyArticleIds, dropEmptyArticles } from "./emptyArticle";
import { baseKey, replaceGeneralWithBase } from "./base";
import { judgeOmission } from "./omission";
import { collectAppendices, locateIssues, numberDocument, renderDocument } from "./render";
import { resolveDocument } from "./resolve";
import { firstSectionRecords, planFirstSection, raisedArticles, treatBlock, type SectionBlock, type SectionEnv, type SectionPlan } from "./firstSection";
import { blockCoordinate, fillDelegation, FIRST_SECTION_COORDINATE, type FormPlan, type JoinOption, planForm, withDelegation } from "./section";
import { substituteSlots } from "./substitute";
import type { AssemblyCoverage, AssemblyInput, Booklet, FirstSectionRecord, BookletAppendix, BookletForm, MasterBundle, NumberedDoc, OmissionRecord, ProductInput, RArticle, RenderedDoc, RenderedGroup, SInline, SpecialPreview, SubstitutedDoc, UndocumentedCoverage } from "./types";
import { articlesOf, mapArticles } from "./walk";

/**
 * 대치되는 보통약관 조의 항·호·목 → 같은 자리(순번)의 기본계약 항·호·목 별칭.
 * 마스터 본문이 다른 조에서 「제4조(…) 제4항」처럼 대치될 조의 항을 가리킬 수 있다 (실물 제8조) — 대치 뒤 그 id 는
 * 사라지므로 순번으로 기본계약 쪽 id 에 잇는다.
 *
 * **구조가 같음을 증명한 경우에만 잇는다** (2026-09-08 리뷰 3): 양쪽 모두 항·호·목만으로 이뤄져 있고 개수가 같아야 한다.
 * 마스터에 조건 블록·함수조항 참조·표가 있거나 개수가 다르면 어느 항이 어느 항인지 알 수 없으므로 별칭을 만들지 않는다 —
 * 그 참조는 `articleGone` 오류로 드러난다 (조용한 오연결보다 낫다).
 */
/**
 * 대치된 보통약관 조의 항 · 호 · 목 → 기본계약 조의 같은 자리 — 참조 열쇠(`refKey`) 짝 (ADR-0072). 대치된 조는 보통약관 조 id 에
 * 기본계약 본문을 담고 그 열쇠는 `기본계약조:코드`(base.ts `baseKey`)다. 코드 없는 자리는 짝이 없다.
 */
function positionAliases(master: ArticleNode, base: RArticle<SInline>): [string, string][] {
  const keys = (pairs: [{ code?: string }, { key?: string }][]): [string, string][] =>
    pairs.flatMap(([m, b]): [string, string][] => (m.code !== undefined && b.key !== undefined ? [[refKey({ articleId: master.id, code: m.code }), refKey({ articleId: master.id, code: baseKey(base.id, b.key) })]] : []));
  return keys(positionPairs(master, base));
}

function positionPairs(master: ArticleNode, base: RArticle<SInline>): [{ code?: string }, { key?: string }][] {
  // 마스터에 동적 노드(조건 블록 · 함수조항 참조 · 반복)가 있으면 항이 몇 개로 펼쳐질지 알 수 없다 — 별칭을 만들지 않는다.
  // 박스 참조(boxRef)는 항을 펼치지 않는다 — 정적 박스와 같다 (기능/박스 §3.2). 동적표 참조는 담보마다 다른 표를 펼친다 — 동적이다 (기능/동적표 §3.6)
  const dynamicNode = (c: { kind: string }) => c.kind === "condBlock" || c.kind === "forBlock" || c.kind === "clauseBlockRef" || c.kind === "dynTableRef";
  const masterParagraphs = master.children.filter((c) => c.kind === "paragraph");
  if (master.children.some((c) => dynamicNode(c))) return [];
  // 정적 표·박스는 대응에 영향을 주지 않는다. 오류 마커가 있으면 신뢰할 수 없다.
  const baseParagraphs = base.children.filter((c) => c.kind === "paragraph");
  if (base.children.some((c) => c.kind === "error")) return [];
  if (masterParagraphs.length !== baseParagraphs.length) return [];

  const out: [{ code?: string }, { key?: string }][] = [];
  for (const [i, mp] of masterParagraphs.entries()) {
    const bp = baseParagraphs[i];
    if ((mp.items ?? []).some((c) => dynamicNode(c))) return [];
    if ((bp.items ?? []).some((c) => c.kind === "error")) return [];
    const masterItems = (mp.items ?? []).filter((c) => c.kind === "item");
    const baseItems = (bp.items ?? []).filter((c) => c.kind === "item");
    if (masterItems.length !== baseItems.length) return [];
    out.push([mp, bp]);
    for (const [j, mi] of masterItems.entries()) {
      const bi = baseItems[j];
      if ((mi.subitems ?? []).some((c) => dynamicNode(c))) return [];
      if ((bi.subitems ?? []).some((c) => c.kind === "error")) return [];
      const masterSubitems = (mi.subitems ?? []).filter((c) => c.kind === "subitem");
      const baseSubitems = (bi.subitems ?? []).filter((c) => c.kind === "subitem");
      if (masterSubitems.length !== baseSubitems.length) return [];
      out.push([mi, bi]);
      for (const [k, mu] of masterSubitems.entries()) out.push([mu, baseSubitems[k]]);
    }
  }
  return out;
}

/**
 * 조 자리(문서 · 관 · 조건 블록 가지)를 투명하게 돌며 조를 모은다.
 * 관은 기능/문면 §3.2, 조건 블록은 문면 편집기 목차(`articlesOf`) · 상품 화면 목차(`articlesIn`)와 같은 규칙이다 —
 * 세 곳이 어긋나면 목차엔 뜨는데 조립은 못 보는 조가 생긴다 (2026-09-15 리뷰).
 */
function collectArticles(nodes: readonly BlockNode[], out: ArticleNode[]): ArticleNode[] {
  for (const n of nodes) {
    if (n.kind === "article") out.push(n);
    else if (n.kind === "section") collectArticles(n.children, out);
    else if (n.kind === "condBlock") for (const branch of n.branches) collectArticles(branch.children, out);
  }
  return out;
}

function masterArticles(doc: DocumentNode): Map<Id, ArticleNode> {
  return new Map(collectArticles(doc.children, []).map((a) => [a.id, a]));
}

// ───────────────────────────── 공통 ─────────────────────────────

/** 특약 문서 제목 — 임시 규칙. */
export function specialTitle(productCoverageName: string): string {
  return `${productCoverageName} 특별약관`;
}

function overrideMap(overrides: readonly ClauseOptionOverride[]): Map<Id, OptionSelection> {
  return new Map(overrides.map((o) => [o.nodeId, o.options]));
}

interface Shared {
  clauses: Map<string, AssemblyInput["clauses"][number]>;
  boxes: Map<string, NonNullable<AssemblyInput["boxes"]>[number]>;
  dynTables: Map<string, NonNullable<AssemblyInput["dynTables"]>[number]>;
  catalog: Map<string, AssemblyInput["catalog"][number]>;
  enums: Map<string, AssemblyInput["enums"][number]>;
  master?: AssemblyInput["master"];
}

function shared(input: AssemblyInput): Shared {
  return {
    clauses: new Map(input.clauses.map((c) => [c.code, c])),
    boxes: new Map((input.boxes ?? []).map((x) => [x.code, x])),
    dynTables: new Map((input.dynTables ?? []).map((t) => [t.code, t])),
    catalog: new Map(input.catalog.map((d) => [d.code, d])),
    enums: new Map(input.enums.map((e) => [e.code, e])),
    master: input.master,
  };
}

interface Built {
  numbered: NumberedDoc;
  issues: Issue[];
  omitted: OmissionRecord[];
  /** 보통약관: 대치된 기본계약 조 · 그 항 · 호 · 목 열쇠 → 보통약관 쪽 열쇠 (렌더의 자기 참조 해소, ADR-0072). */
  aliases?: ReadonlyMap<string, string>;
  /** 상품이 노출을 끈 보통약관 조 id → 조 명 (기능/상품 §3.6). 참조·조연결이 가리키면 오류를 낸다. */
  hidden?: ReadonlyMap<Id, string>;
  /** 보통약관: 기본계약 조로 대치된 보통약관 조 id → 기본계약 상품담보 이름 (저작 화면 미리보기의 「대치」 표시). */
  replaced?: ReadonlyMap<Id, string>;
}

interface Prepared {
  doc: SubstitutedDoc;
  issues: Issue[];
}

function omissionAliases(records: readonly OmissionRecord[]): ReadonlyMap<string, string> {
  return new Map(records.filter((record) => record.disposition === "omitted").map((record) => [record.articleId, record.linkedArticleId]));
}

function prepare(
  doc: DocumentNode,
  ctx: AssemblyContext,
  s: Shared,
  opts: { coordinate: ReturnType<typeof specialCoordinate>; overrides?: readonly ClauseOptionOverride[]; source: Coordinate; valueSource: Coordinate; title?: string },
): Prepared {
  const resolved = resolveDocument({ ...doc, ...(opts.title !== undefined ? { title: opts.title } : {}) }, ctx, { clauses: s.clauses, boxes: s.boxes, dynTables: s.dynTables, overrides: overrideMap(opts.overrides ?? []), coordinate: opts.coordinate, enums: s.enums, ...(s.master ? { master: s.master } : {}) });
  const substituted = substituteSlots(resolved.doc, ctx, { catalog: s.catalog, enums: s.enums, master: s.master });
  const issues = [...resolved.issues, ...substituted.issues].map((issue): Issue => {
    if (issue.source) return issue;
    if (issue.kind === "notEntered" || issue.kind === "notAttached") {
      return { ...issue, source: { ...opts.valueSource, nodeKind: "value", refPath: issue.at.refPath } };
    }
    const nodeKind = issue.kind === "unusedAttribute" || issue.kind === "syntax" || issue.kind === "typeMismatch"
      ? "condition"
      : issue.kind === "optionInvalid" || issue.kind === "optionUnselected"
        ? "option"
        : issue.kind === "articleGone" || issue.kind === "articleHidden"
          ? "articleRef"
          : undefined;
    return { ...issue, source: { ...opts.source, articleId: issue.at.articleId, articleTitle: issue.at.articleTitle, nodePath: issue.at.nodePath, ...(nodeKind ? { nodeKind } : {}), refPath: issue.at.refPath } };
  });
  return { doc: substituted.doc, issues };
}

function prepareCoordinates(input: AssemblyInput, doc: DocumentNode, coverage?: AssemblyCoverage): { source: Coordinate; valueSource: Coordinate } {
  return {
    // 담보약관의 원천은 담보 마스터 — ownerId 는 담보 id (`Coordinate` 주석), 문서 화면으로 가는 id 는 documentId 에 싣는다.
    source: coverage
      ? { document: "coverageMaster", ownerId: coverage.snapshot.coverageId, documentId: doc.id, ownerName: coverage.snapshot.coverageName }
      : { document: "general", ownerId: doc.id, ownerName: doc.title },
    valueSource: {
      document: "product",
      ownerId: input.product.id,
      ownerName: input.product.name,
      ...(coverage ? { subjectName: coverage.snapshot.name, nodePath: [coverage.snapshot.id] } : {}),
    },
  };
}

/** 조 자리에서 숨긴 조를 뺀다 — 관 · 조건 블록 가지 안까지 (구조는 그대로 둔다). */
function withoutHidden(nodes: readonly BlockNode[], hidden: ReadonlySet<Id>): BlockNode[] {
  return nodes.flatMap((n): BlockNode[] => {
    if (n.kind === "article") return hidden.has(n.id) ? [] : [n];
    if (n.kind === "section") return [{ ...n, children: withoutHidden(n.children, hidden) as SectionNode["children"] }];
    if (n.kind === "condBlock") return [{ ...n, branches: n.branches.map((branch) => ({ ...branch, children: withoutHidden(branch.children, hidden) })) }];
    return [n];
  });
}

function hideArticles(doc: DocumentNode, hidden: ReadonlySet<Id>): DocumentNode {
  return { ...doc, children: withoutHidden(doc.children, hidden) as DocumentNode["children"] };
}

/**
 * 조 자리의 그 조들을 본문 없이 둔다 — 대치될 조 · 위임될 조의 마스터 본문은 실행 경로가 아니다. 먼저 비운 뒤 해소해야 사라질 슬롯의 오류 · 조회 흔적이 남지 않는다.
 * 조 자리는 문서 · 관 · 조건 블록 가지 어디에나 있다 — 숨김 필터(withoutHidden)와 **같은 순회**로 비운다
 * (조건 블록 안의 조만 최상위·관 자식 검사에서 빠져 오류가 남던 자리 — 코덱스 리뷰 2026-09-15 Important-4).
 */
function emptyArticles(doc: DocumentNode, ids: ReadonlySet<Id>): DocumentNode {
  const walk = (nodes: readonly BlockNode[]): BlockNode[] =>
    nodes.map((n): BlockNode => {
      if (n.kind === "article") return ids.has(n.id) ? { ...n, children: [] } : n;
      if (n.kind === "section") return { ...n, children: walk(n.children) as SectionNode["children"] };
      if (n.kind === "condBlock") return { ...n, branches: n.branches.map((branch) => ({ ...branch, children: walk(branch.children) })) };
      return n;
    });
  return { ...doc, children: walk(doc.children) as DocumentNode["children"] };
}

/** 이 상품의 보통약관 최종 트리 — 템플릿 + 조 사본(코드 채움) · 노출 끔을 뺀 것과 뺀 조의 명. 템플릿이 없으면 undefined. */
function generalTree(input: AssemblyInput): { master: DocumentNode; tree: DocumentNode; hidden?: ReadonlyMap<Id, string> } | undefined {
  const stored = generalDocumentOf(input);
  if (!stored) return undefined;
  // 대치 별칭(positionAliases)이 조립과 같은 P코드를 보도록 코드 없는 옛 트리는 여기서 채운다 (resolveDocument 와 같은 결정적 채번)
  const master = withCodes(stored);
  // 노출 끔 (기능/상품 §3.6) — **번호 계산 전에** 마스터에서 뺀다. 번호 순연은 numberDocument 의 귀결이다.
  // 뺀 조의 명은 남겨 둔다: 이 조를 가리키던 참조·조연결이 `articleHidden` 오류 메시지에 쓴다.
  const hiddenTitles = new Map<Id, string>();
  for (const [id, a] of masterArticles(master)) if (input.product.hiddenArticleIds.has(id)) hiddenTitles.set(id, foldTitle(a.title));
  if (hiddenTitles.size === 0) return { master, tree: master };
  return { master, tree: hideArticles(master, input.product.hiddenArticleIds), hidden: hiddenTitles };
}

/** 대치 형태의 보통약관 — 기본계약 하나가 조연결한 조를 그 기본계약 조로 대치한다 (ADR-0021 결정 3). 기본계약이 없으면 템플릿 그대로. */
function buildGeneral(input: AssemblyInput, contexts: AssemblyContexts, s: Shared): Built | undefined {
  const general = generalTree(input);
  if (!general) return undefined;
  const { master, tree: g, hidden } = general;
  if (input.product.baseContractIds.length === 1) {
    const base = input.coverages.find((coverage) => coverage.snapshot.id === input.product.baseContractIds[0]);
    const doc = base && input.specialDocuments.get(base.snapshot.coverageId);
    const ctx = base && contexts.specials.get(base.snapshot.id);
    if (base && doc && ctx) {
      const prepared = prepare(doc, ctx, s, { coordinate: specialCoordinate(base), ...prepareCoordinates(input, doc, base) });
      // 기본계약 문면의 빈 조(작성위치 = 대치로 빈 출력이 된 준용규정 · 특약 전용 조)를 **먼저** 뺀다 — 그 뒤 대치가 조연결 경고를 검사하므로
      // 의도대로 빠진 조에 「조연결 없는 기본계약 조」가 서지 않는다. 본문 없이 쓴 조는 남아 지금처럼 경고 (ADR-0089 결정 5)
      const basePrepared = { ...prepared, doc: dropEmptyArticles(prepared.doc, authoredEmptyArticleIds(doc)).doc };
      const replacedArticleIds = new Set(articlesOf(basePrepared.doc).flatMap((node) => (node.linkedArticleId ? [node.linkedArticleId] : [])));
      // 대치될 보통약관 본문은 실행 경로가 아니다 — 비운 뒤 해소한다
      const generalSource = emptyArticles(g, replacedArticleIds);
      const generalPrepared = prepare(generalSource, contexts.general, s, { coordinate: generalCoordinate(input.product, master), overrides: input.product.overrides, ...prepareCoordinates(input, g) });
      const replaced = replaceGeneralWithBase(generalPrepared.doc, basePrepared.doc, { productCoverageId: base.snapshot.id, productCoverageName: base.snapshot.name }, hidden);
      const originals = masterArticles(g);
      for (const baseArticle of articlesOf(basePrepared.doc)) {
        const original = baseArticle.linkedArticleId ? originals.get(baseArticle.linkedArticleId) : undefined;
        if (original) for (const [from, to] of positionAliases(original, baseArticle)) replaced.aliases.set(from, to);
      }
      const replacementIssues = replaced.issues.map((issue) => ({ ...issue, source: { document: "coverageMaster" as const, ownerId: base.snapshot.coverageId, documentId: doc.id, ownerName: base.snapshot.coverageName, articleId: issue.at.articleId, articleTitle: issue.at.articleTitle, nodePath: issue.at.articleId ? [doc.id, issue.at.articleId] : undefined } }));
      const replacedIds = new Map([...replacedArticleIds].filter((id) => originals.has(id)).map((id) => [id, base.snapshot.name] as const));
      return { numbered: numberDocument(dropEmptyArticles(replaced.doc, authoredEmptyArticleIds(g)).doc), issues: [...generalPrepared.issues, ...basePrepared.issues, ...replacementIssues], omitted: [], aliases: replaced.aliases, ...(hidden ? { hidden } : {}), replaced: replacedIds };
    }
  }
  const prepared = prepare(g, contexts.general, s, { coordinate: generalCoordinate(input.product, master), overrides: input.product.overrides, ...prepareCoordinates(input, g) });
  return { numbered: numberDocument(dropEmptyArticles(prepared.doc, authoredEmptyArticleIds(g)).doc), issues: prepared.issues, omitted: [], ...(hidden ? { hidden } : {}) };
}

/**
 * 절 형태의 제1절 일반조항 — 최종 트리(템플릿 + 쓰이는 사본 · 노출 끔)에 제1절 판정을 얹는다 (ADR-0082 결정 1 · 5 · 6 · ADR-0021 결정 2).
 * 위임 · 공통 · 공통항 분리 · 전체항 합침 조는 마스터 본문을 비운 뒤 해소하고(실행 경로가 아니다) — 위임은 위임 문구 한 항, 나머지는 블록에서 오른 항을 싣는다.
 * 마스터 · 특칙 조는 마스터 그대로다. 조 제목은 템플릿 조 제목(조립산출 §3.9).
 */
function buildFirstSection(input: AssemblyInput, contexts: AssemblyContexts, s: Shared, plan: SectionPlan, raised: ReadonlyMap<Id, RArticle<SInline>["children"]>): Built | undefined {
  const general = generalTree(input);
  if (!general) return undefined;
  const { master, tree: g, hidden } = general;
  const present = masterArticles(g);
  const delegated = new Set([...plan.verdicts].filter(([id, v]) => v.kind === "delegate" && present.has(id)).map(([id]) => id));
  const lifted = new Set([...raised.keys()].filter((id) => present.has(id)));
  const prepared = prepare(emptyArticles(g, new Set([...delegated, ...lifted])), contexts.general, s, { coordinate: generalCoordinate(input.product, master), overrides: input.product.overrides, ...prepareCoordinates(input, g) });
  const judged = mapArticles(withDelegation(prepared.doc, delegated), (a): RArticle<SInline> => (lifted.has(a.id) ? { ...a, children: raised.get(a.id)! } : a));
  const numbered = numberDocument(dropEmptyArticles(judged, authoredEmptyArticleIds(g)).doc);
  return { numbered: fillDelegation(numbered, delegated), issues: [...prepared.issues, ...plan.firstIssues], omitted: [], ...(hidden ? { hidden } : {}) };
}

/**
 * 제1절 판정의 문맥 — 최종 트리에 있는 템플릿 조(조건 해소 · 노출 끔 뒤 — 본문은 비우고 해소해 오류 · 조회 흔적을 남기지 않는다) ·
 * 조 명 · 준용하기 옵션(템플릿 원본 — 사본의 속성은 읽지 않는다) · 대응 보통약관 검사.
 */
function sectionEnv(input: AssemblyInput, contexts: AssemblyContexts, s: Shared): SectionEnv & { order: Id[] } {
  const general = generalTree(input);
  const coordinate = generalCoordinate(input.product, general?.master);
  const titles = new Map<Id, string>();
  const order: Id[] = [];
  for (const [id, a] of general ? masterArticles(general.master) : []) {
    titles.set(id, foldTitle(a.title));
    order.push(id);
  }
  const template = input.product.generalDocumentId === undefined ? undefined : input.generalDocuments.get(input.product.generalDocumentId);
  const options = new Map<Id, JoinOption>([...(template ? masterArticles(template) : [])].flatMap(([id, a]) => (a.joinMode ? [[id, a.joinMode] as [Id, JoinOption]] : [])));
  let present = new Set<Id>();
  if (general) {
    const skeleton = emptyArticles(general.tree, new Set(titles.keys()));
    present = new Set(articlesOf(prepare(skeleton, contexts.general, s, { coordinate, overrides: input.product.overrides, ...prepareCoordinates(input, general.tree) }).doc).map((a) => a.id));
  }
  return {
    present,
    ...(general?.hidden ? { hidden: general.hidden } : {}),
    titles,
    options,
    order,
    wrongGeneral: (c) => {
      const g = input.coverageGenerals?.get(c.snapshot.coverageId);
      return g !== undefined && g !== input.product.generalDocumentId;
    },
    generalAt: coordinate,
  };
}

function buildSpecial(input: AssemblyInput, contexts: AssemblyContexts, s: Shared, c: AssemblyCoverage, general: Built | undefined): Built | undefined {
  const doc = input.specialDocuments.get(c.snapshot.coverageId);
  const ctx = contexts.specials.get(c.snapshot.id);
  if (!doc || !ctx) return undefined;
  const prepared = prepare(doc, ctx, s, {
    coordinate: specialCoordinate(c),
    ...prepareCoordinates(input, doc, c),
    title: specialTitle(c.snapshot.name),
  });
  const withApplication = ensureApplicationArticle(prepared.doc);
  const judged = judgeOmission(withApplication, general?.numbered.doc, { productCoverageId: c.snapshot.id, productCoverageName: c.snapshot.name }, general?.hidden);
  return { numbered: numberDocument(dropEmptyArticles(judged.doc, authoredEmptyArticleIds(doc)).doc), issues: [...prepared.issues, ...judged.issues], omitted: judged.records };
}

// ───────────────────────────── 9. 특약 배치 · 블록 순서 ─────────────────────────────

/** 담보분류를 정할 수 없는 상품담보(미입력 · 지운 값)를 모은 자리의 id — 책자에서 제목 없이 그룹들 뒤에 선다. */
export const UNGROUPED_ID = "ungrouped";

/** 그룹으로 묶은 상품담보 — `Placement` 의 그룹 부분. */
export interface Grouped {
  /**
   * 상품 그룹 목록 순 → 그룹 안 자동 정렬 순. 상품담보가 없는 그룹은 없다. 담보분류를 정할 수 없는 상품담보는 마지막 한 자리(`title` 없음 · id `ungrouped`).
   * `titleIssue` — 기본 그룹의 「그룹 제목」이 비었다(제목 자리 오류 마커).
   */
  groups: { id: Id; title?: string; titleIssue?: Issue; members: AssemblyCoverage[] }[];
  /** 상품담보 id → 그 담보의 담보분류를 정할 수 없다는 오류 (미입력 notEntered · 지운 값 brokenRef, ADR-0090 결정 9). */
  groupIssues: ReadonlyMap<Id, Issue>;
}

export interface Placement extends Grouped {
  undocumented: UndocumentedCoverage[];
  baseContracts: Booklet["baseContracts"];
}

/**
 * 상품담보를 이 상품의 그룹 순서로 묶는다 (ADR-0090 결정 4 · 5 · 6 · 7) — 특약 배치와 절 형태의 블록 순서가 같은 함수다:
 * **블록 순서 = 그룹 순서 → 그룹 안 자동 순서**(담보코드 → 담보속성). 이 상품의 기본 그룹은 그룹을 읽는 담보(`groupedCoverageIds` —
 * 특약 담보 + 기본계약 2+ 의 기본계약 담보)의 담보분류다. 상품담보가 없는 그룹은 없다.
 */
export function orderInGroups(input: AssemblyInput, documented: readonly AssemblyCoverage[]): Grouped {
  const baseIds = new Set(input.product.baseContractIds);
  // 그룹 안 1차 키 = 담보코드 (ADR-0090 결정 6). 코드가 없는 담보(픽스처)는 코드 있는 것 뒤에 담보명 순
  const codeOf = (id: Id) => input.coverageCodes?.get(id);
  const nameOf = new Map(documented.map((c) => [c.snapshot.coverageId, c.snapshot.coverageName]));
  const ordered = [...new Set(documented.map((c) => c.snapshot.coverageId))].sort((a, b) => {
    const ca = codeOf(a);
    const cb = codeOf(b);
    if (ca !== undefined && cb !== undefined) return ca.localeCompare(cb);
    if (ca !== undefined || cb !== undefined) return ca !== undefined ? -1 : 1;
    return (nameOf.get(a) ?? "").localeCompare(nameOf.get(b) ?? "");
  });
  const coverageOrder = (id: Id) => ordered.indexOf(id);
  const byId = new Map(documented.map((c) => [c.snapshot.id, c]));
  const sorted = (members: readonly AssemblyCoverage[]) => sortInGroup(members.map((c) => c.snapshot as ProductCoverage), input.attributeKinds, coverageOrder).map((m) => byId.get(m.id)!);

  const categoryEnum = input.enums.find((e) => e.code === COVERAGE_CATEGORY_ENUM);
  const categoryOrder = (categoryEnum?.values ?? []).map((v) => v.code);
  const setting = input.product.groups;
  const userGroups = new Set((setting?.groups ?? []).flatMap((g) => (g.kind === "user" ? [g.id] : [])));
  const userGroupOf = new Map((setting?.memberships ?? []).filter((m) => userGroups.has(m.groupId)).map((m) => [m.coverageId, m.groupId]));
  const groupIssues = new Map<Id, Issue>();
  const groupOf = (c: AssemblyCoverage): string => {
    const user = userGroupOf.get(c.snapshot.coverageId);
    if (user !== undefined) return user; // 사용자 그룹에 든 담보는 담보분류를 읽지 않는다
    const code = input.coverageCategories?.get(c.snapshot.coverageId);
    const source: Coordinate = { document: "coverageMaster", ownerId: c.snapshot.coverageId, ownerName: c.snapshot.coverageName, refPath: "category" };
    if (code === undefined) {
      groupIssues.set(c.snapshot.id, { kind: "notEntered", message: `담보분류가 입력되지 않았습니다 · 담보 「${c.snapshot.coverageName}」`, at: specialCoordinate(c), source });
      return UNGROUPED_ID;
    }
    if (categoryOrder.includes(code)) return groupKey({ kind: "category", code });
    groupIssues.set(c.snapshot.id, {
      kind: "brokenRef",
      message: `없는 값 ${code} — 담보분류(${COVERAGE_CATEGORY_ENUM})에서 지워진 값입니다 · 담보 「${c.snapshot.coverageName}」의 담보분류`,
      at: specialCoordinate(c),
      source,
    });
    return UNGROUPED_ID;
  };
  const membersOf = new Map<string, AssemblyCoverage[]>();
  for (const c of documented) {
    const key = groupOf(c);
    membersOf.set(key, [...(membersOf.get(key) ?? []), c]);
  }
  // 이 상품의 기본 그룹 = 그룹을 읽는 담보들의 담보분류 (기능/상품 §3.7 — 상품담보 탭 「특약 그룹」 섹션 · 저장과 같은 기준)
  const grouped = groupedCoverageIds(input.coverages.map((c) => ({ coverageId: c.snapshot.coverageId, base: baseIds.has(c.snapshot.id) })));
  const present = new Set(grouped.flatMap((id) => input.coverageCategories?.get(id) ?? []));
  const productAt: Coordinate = { document: "product", ownerId: input.product.id, ownerName: input.product.name };
  const groups: Grouped["groups"] = effectiveGroups(setting?.groups ?? [], present, categoryOrder)
    .filter((g) => membersOf.has(groupKey(g)))
    .map((g) => {
      const key = groupKey(g);
      const members = sorted(membersOf.get(key)!);
      if (g.kind === "user") return { id: key, title: g.name, members };
      const title = categoryGroupTitle(categoryEnum, g.code);
      if (title !== undefined) return { id: key, title, members };
      const label = categoryEnum?.values.find((v) => v.code === g.code)?.label ?? g.code;
      const titleIssue: Issue = { kind: "notEntered", message: `그룹 제목이 비었습니다 — 담보분류 「${label}」의 「그룹 제목」`, at: productAt, source: enumCoordinate(categoryEnum!, g.code) };
      return { id: key, titleIssue, members };
    });
  const ungrouped = membersOf.get(UNGROUPED_ID);
  if (ungrouped) groups.push({ id: UNGROUPED_ID, members: sorted(ungrouped) });
  return { groups, groupIssues };
}

/** 특약 배치 — 기본계약이 아닌 상품담보. 독립특약은 탑재 상품담보가 모두 블록이라 특약이 없다 (ADR-0082 · 기능/조립산출 §3.8). */
export function placeSpecials(input: AssemblyInput, form: FormPlan = planForm(input)): Placement {
  const baseIds = new Set(input.product.baseContractIds);
  const baseContracts = input.coverages
    .filter((c) => baseIds.has(c.snapshot.id))
    .map((c) => ({ productCoverageId: c.snapshot.id, name: c.snapshot.name, coverageId: c.snapshot.coverageId }));
  const standalone = form.form === "sectioned" && form.standalone;
  const specials = standalone ? [] : input.coverages.filter((c) => !baseIds.has(c.snapshot.id));
  // 문면 없는 탑재분 — 독립특약은 블록 후보 전부에서
  const pool = standalone ? input.coverages : specials;
  const undocumented = pool
    .filter((c) => !input.specialDocuments.has(c.snapshot.coverageId))
    .map((c) => ({ productCoverageId: c.snapshot.id, name: c.snapshot.name, coverageId: c.snapshot.coverageId }));
  return { ...orderInGroups(input, specials.filter((c) => input.specialDocuments.has(c.snapshot.coverageId))), undocumented, baseContracts };
}

/** 블록 순서 = 그룹 순서 → 그룹 안 자동 순서 (ADR-0090 결정 7). 블록 후보 중 문면이 있는 것. */
function placeBlocks(input: AssemblyInput, candidates: ReadonlySet<Id>): Grouped {
  const pool = input.coverages.filter((c) => candidates.has(c.snapshot.id));
  return orderInGroups(input, pool.filter((c) => input.specialDocuments.has(c.snapshot.coverageId)));
}

// ───────────────────────────── 절 형태 — 제2절 블록 ─────────────────────────────

interface PreparedBlock {
  c: AssemblyCoverage;
  title: string;
  doc: SubstitutedDoc;
  issues: Issue[];
}

/**
 * 블록 하나 — 블록 문맥(작성위치 = 블록)으로 해소하고 블록 빈 조를 뺀다. 조가 하나도 안 남으면 블록이 아니다(ADR-0082 결정 2).
 * 블록 조는 특약 조 판정(ADR-0020)을 타지 않는다 — 제1절 판정 결과(결정 6)만 블록 조를 생략 · 분리한다(`treatBlock`).
 */
function prepareBlock(input: AssemblyInput, contexts: AssemblyContexts, s: Shared, c: AssemblyCoverage, standalone: boolean): PreparedBlock | undefined {
  const doc = input.specialDocuments.get(c.snapshot.coverageId);
  const ctx = contexts.specials.get(c.snapshot.id);
  if (!doc || !ctx) return undefined;
  // 블록 제목 — 독립특약 「{상품담보명} 특별약관」, 주계약 기본계약 2+ 는 상품담보명 (기능/조립산출 §3.8)
  const title = standalone ? specialTitle(c.snapshot.name) : c.snapshot.name;
  const prepared = prepare(doc, ctx, s, { coordinate: specialCoordinate(c), ...prepareCoordinates(input, doc, c), title });
  const dropped = dropEmptyArticles(prepared.doc, authoredEmptyArticleIds(doc)).doc;
  const articles = articlesOf(dropped);
  if (articles.length === 0) return undefined;
  return { c, title, doc: dropped, issues: prepared.issues };
}

interface SectionedBuild {
  general: Built | undefined;
  /**
   * 블록 그룹 — `head` = 그룹 머리(켤 때 「Ⅰ.」), 블록 `head` = 블록 머리(「Ⅰ-1.」 · 「1.」 — 켤 때 제목 없는 자리의 블록은 없다).
   * 블록 `aliases` = 블록에 남은 조가 제1절로 오른 조 · 항을 가리킬 때의 렌더 별칭(C4).
   */
  groups: { id: Id; title?: string; titleIssue?: Issue; head?: string; blocks: { prepared: PreparedBlock; numbered: NumberedDoc; head?: string; aliases: ReadonlyMap<string, string> }[] }[];
  /** 제1절 판정 기록 (ADR-0082 결정 11). */
  firstSection: FirstSectionRecord[];
  groupIssues: ReadonlyMap<Id, Issue>;
  /** 상품 자리의 오류 — 독립특약 블록 0 이면 `noBlock`. */
  productIssues: Issue[];
}

/**
 * 절 형태 — 블록(그룹 순)을 해소해 세고, 블록의 조연결로 제1절을 판정해(ADR-0082 — `planFirstSection`) 제1절을 만들고 블록 조를 처리한다.
 * 블록 번호 머리는 「그룹 제목 표시」 옵션이 정한다 — 끔 「1.」 · 켬 「Ⅰ-1.」(`blockHeads` — 제목 줄이 서는 그룹만 센다, ADR-0090 결정 8).
 * 끄면 그룹 제목을 찍지 않는다(제목 · 빈 제목 오류 없음).
 */
function buildSectioned(input: AssemblyInput, contexts: AssemblyContexts, s: Shared, form: Extract<FormPlan, { form: "sectioned" }>): SectionedBuild {
  const placed = placeBlocks(input, form.candidates);
  const prepared = placed.groups
    .map((g) => ({ ...g, blocks: g.members.flatMap((c) => prepareBlock(input, contexts, s, c, form.standalone) ?? []) }))
    .filter((g) => g.blocks.length > 0);
  // 복합 블록 판별은 후속 기획(조립산출 §5) — 지금은 늘 아니다
  const sectionBlocks: SectionBlock[] = prepared.flatMap((g) => g.blocks.map((b) => ({ c: b.c, doc: b.doc, composite: false })));
  const env = sectionEnv(input, contexts, s);
  const plan = planFirstSection(sectionBlocks, env);
  const general = buildFirstSection(input, contexts, s, plan, raisedArticles(plan, sectionBlocks));
  const sectionBlockOf = new Map(sectionBlocks.map((b) => [b.c.snapshot.id, b]));
  const showTitles = showsGroupTitles(input.product.values.get(GROUP_TITLES_PATH));
  const heads = blockHeads(prepared.map((g) => ({ id: g.id, titled: g.id !== UNGROUPED_ID, members: g.blocks.map((b) => b.c.snapshot.id) })), showTitles);
  const productIssues: Issue[] = [];
  if (form.standalone && prepared.length === 0) {
    const at = baseContractCoordinate(input.product);
    productIssues.push({ kind: "noBlock", severity: "error", message: "블록이 없습니다 — 독립특약 상품은 문면이 있는 담보를 하나 이상 탑재해야 합니다", at, source: at });
  }
  return {
    general,
    groups: prepared.map((g) => {
      const head = heads.groups.get(g.id);
      return {
        id: g.id,
        // 그룹 제목을 찍지 않으면(끔) 제목도, 빈 제목 오류도 없다
        ...(showTitles && g.title !== undefined ? { title: g.title } : {}),
        ...(showTitles && g.titleIssue ? { titleIssue: g.titleIssue } : {}),
        ...(head !== undefined ? { head } : {}),
        blocks: g.blocks.map((b) => {
          const blockHead = heads.blocks.get(b.c.snapshot.id);
          const treated = treatBlock(sectionBlockOf.get(b.c.snapshot.id)!, plan, general?.numbered);
          const issues = [...b.issues, ...(plan.blockIssues.get(b.c.snapshot.id) ?? [])];
          return { prepared: { ...b, issues }, numbered: numberDocument(ensureApplicationArticle(treated.doc)), aliases: treated.aliases, ...(blockHead !== undefined ? { head: blockHead } : {}) };
        }),
      };
    }),
    groupIssues: placed.groupIssues,
    productIssues,
    firstSection: firstSectionRecords(plan, sectionBlocks, general?.numbered, env.titles, env.order),
  };
}

/** 그 절 이름공간 안의 오류 — 조 번호가 블록마다 재시작해도 자리가 갈린다 (기능/조립산출 §3.4). */
function inSection(issues: readonly Issue[], section: NonNullable<Coordinate["section"]>): Issue[] {
  return issues.map((issue) => ({ ...issue, at: { ...issue.at, section } }));
}

/** 렌더한 보통약관(대치 형태) · 제1절(절 형태)과 그 오류. */
function renderGeneral(input: AssemblyInput, general: Built, appendices: readonly BookletAppendix[], sectioned: boolean): { doc: RenderedDoc; issues: Issue[] } {
  const r = renderDocument(general.numbered, { document: "general", ownerId: generalCoordinate(input.product, generalDocumentOf(input)).ownerId!, appendices, aliases: general.aliases, ...(general.hidden ? { hiddenArticles: general.hidden } : {}) });
  const issues = [...locateIssues(general.issues, general.numbered), ...r.issues];
  return { doc: r.doc, issues: sectioned ? inSection(issues, FIRST_SECTION_COORDINATE) : issues };
}

/** 블록 하나의 렌더 — 문서 제목 = 블록 제목, `head` = 블록 머리. 블록 안 오류는 「제2절 {블록 머리}」 이름공간. */
function renderBlock(block: SectionedBuild["groups"][number]["blocks"][number], general: Built | undefined, appendices: readonly BookletAppendix[], groupIssue: Issue | undefined): { doc: RenderedDoc; issues: Issue[] } {
  const { prepared, numbered, head, aliases } = block;
  const r = renderDocument(numbered, { document: "special", ownerId: prepared.c.snapshot.id, general: general?.numbered, aliases, appendices, ...(general?.hidden ? { hiddenArticles: general.hidden } : {}) });
  const issues = inSection([...(groupIssue ? [groupIssue] : []), ...locateIssues(prepared.issues, numbered), ...r.issues], blockCoordinate(head));
  return { doc: head === undefined ? r.doc : { ...r.doc, head }, issues };
}

/** 특약 하나의 렌더 — 보통약관(제1절) 조 참조 · 생략 별칭과 함께. */
function renderSpecial(c: AssemblyCoverage, b: Built, general: Built | undefined, appendices: readonly BookletAppendix[]): { doc: RenderedDoc; issues: Issue[] } {
  const r = renderDocument(b.numbered, { document: "special", ownerId: c.snapshot.id, general: general?.numbered, aliases: omissionAliases(b.omitted), ...(general?.aliases ? { generalAliases: general.aliases } : {}), appendices, ...(general?.hidden ? { hiddenArticles: general.hidden } : {}) });
  return { doc: r.doc, issues: [...locateIssues(b.issues, b.numbered), ...r.issues] };
}

const completeOf = (issues: readonly Issue[]) => !issues.some((item) => (item.severity ?? "error") === "error");

// ───────────────────────────── 조립 ─────────────────────────────

/**
 * 조립 서명은 `assemble(master, product)` — 공유 마스터는 실행당 1회 적재해 여러 상품에 재사용한다 (ADR-0034 결정 2).
 * 결정적이다 (결정 4): 전역 상태 · 모듈 캐시 · 시각 · 난수 없음 — 같은 두 재료면 같은 `Booklet`.
 *
 * 형태 (ADR-0021 결정 1 · `planForm`): 대치 형태는 보통약관 → 특약 그룹 → 별표, 절 형태는 제1절 일반조항 → 제2절 보장조항 블록 →
 * (주계약 기본계약 2+ 면 특약 그룹) → 별표 (기능/조립산출 §3.8).
 */
export function assemble(master: MasterBundle, product: ProductInput): Booklet {
  const input: AssemblyInput = { ...master, ...product };
  const s = shared(input);
  const contexts = buildContexts(input);
  const form = planForm(input);
  const issues: Issue[] = [];
  const omitted: OmissionRecord[] = [];

  // 기본계약 수 — 서비스 checkBaseContract 와 같은 판정·문구 (도메인 한 곳 · 기능/상품 §3.5 — 주계약 0 은 noBaseContract).
  // 독립특약은 0 이 정상 (기능/상품 §3.1 · 2026-10-01)
  const standalone = isStandaloneContract(input.product.values.get(CONTRACT_KIND_PATH));
  const baseCountIssue = baseContractCountIssue(input.product.baseContractIds.length, input.product, standalone);
  if (baseCountIssue) issues.push(baseCountIssue);

  // 선택지는 있는데 유효 조합이 0건 — 집계 범위가 비어 세목 조건(any → false · all → true)이 결정된 값으로 평가되고
  // 조건부 조문이 오류 없이 빠진다. 축이 원래 없는 상품(선택지 0)은 정상이라 구분한다 (코덱스 리뷰 2026-09-14 Important-3).
  if (input.product.planOptions.length === 0 && input.product.planOptionCount > 0) {
    const at = { document: "product" as const, ownerId: input.product.id, ownerName: input.product.name };
    issues.push({ kind: "noPlan", severity: "error", message: `세목 선택지 ${input.product.planOptionCount}개가 있는데 유효 조합이 없습니다 — 세목 집계 범위가 비어 조건부 조문이 빠집니다`, at, source: at });
  }

  const { general, sectioned } = generalFor(input, contexts, s, form);
  if (sectioned) issues.push(...sectioned.productIssues);
  if (!general) {
    issues.push({ kind: "brokenRef", message: "보통약관 템플릿이 선택되지 않았습니다", at: { document: "product", ownerId: input.product.id, ownerName: input.product.name } });
  }

  const placement = placeSpecials(input, form);
  const builtGroups = placement.groups.map((g) => ({
    ...g,
    docs: g.members.flatMap((c) => {
      const b = buildSpecial(input, contexts, s, c, general);
      return b ? [{ c, b }] : [];
    }),
  }));

  // 8. 별표 — 등장 순 자동 수집 (ADR-0063): 보통약관(제1절) → (제2절 블록) → 그룹 순 → 그룹 안 순
  const blockDocs = (sectioned?.groups ?? []).flatMap((g) => g.blocks.map((b) => b.numbered));
  const appendices = collectAppendices([...(general ? [general.numbered] : []), ...blockDocs, ...builtGroups.flatMap((g) => g.docs.map(({ b }) => b.numbered))], input.appendices);

  // 7. 참조 해소 + 렌더 (책자 순으로 issues 를 모은다)
  let renderedGeneral: RenderedDoc | undefined;
  if (general) {
    const r = renderGeneral(input, general, appendices, sectioned !== undefined);
    renderedGeneral = r.doc;
    issues.push(...r.issues);
  }
  // 절 형태의 제2절 — 블록 그룹(특약 그룹과 같은 모양 `RenderedGroup` · 그룹 머리 `head` · 블록 문서 `head`)
  const blocks: RenderedGroup[] | undefined = sectioned?.groups.map((g) => {
    // 그룹 제목 자리의 오류가 그 그룹 블록들보다 먼저 — 책자 등장 순 (D-P6-12)
    if (g.titleIssue) issues.push(g.titleIssue);
    return {
      id: g.id,
      ...(g.head !== undefined ? { head: g.head } : {}),
      ...(g.title !== undefined ? { title: g.title } : {}),
      ...(g.titleIssue ? { titleError: { kind: "error" as const, id: `block-group-title-${g.id}`, issue: g.titleIssue } } : {}),
      docs: g.blocks.map((b) => {
        const r = renderBlock(b, general, appendices, sectioned.groupIssues.get(b.prepared.c.snapshot.id));
        issues.push(...r.issues);
        return r.doc;
      }),
    };
  });
  // 특약 그룹 — 주계약의 특약(대치 형태 · 기본계약 2+). 그룹 제목 표시 옵션과 무관하다 (ADR-0090 결정 8). 독립특약은 특약이 없다(블록)
  const specials: RenderedGroup[] = builtGroups.map((g) => {
    // 그룹 제목 자리의 오류가 그 그룹 문서들보다 먼저 — 책자 등장 순 (D-P6-12)
    if (g.titleIssue) issues.push(g.titleIssue);
    return {
      id: g.id,
      ...(g.title !== undefined ? { title: g.title } : {}),
      ...(g.titleIssue ? { titleError: { kind: "error" as const, id: `group-title-${g.id}`, issue: g.titleIssue } } : {}),
      docs: g.docs.map(({ c, b }) => {
        const groupIssue = placement.groupIssues.get(c.snapshot.id);
        if (groupIssue) issues.push(groupIssue);
        const r = renderSpecial(c, b, general, appendices);
        issues.push(...r.issues);
        omitted.push(...b.omitted);
        return r.doc;
      }),
    };
  });

  // 책자 제목 — 독립특약은 상품명, 그 밖은 템플릿 제목 (기능/조립산출 §3.8)
  const title = form.form === "sectioned" && form.standalone ? input.product.name : (renderedGeneral?.title ?? input.product.name);
  return {
    form: form.form,
    title,
    general: renderedGeneral,
    ...(blocks ? { blocks } : {}),
    specials,
    appendices,
    issues,
    complete: completeOf(issues),
    omitted,
    undocumented: placement.undocumented,
    baseContracts: placement.baseContracts,
    trace: contexts.traces,
    ...(sectioned ? { firstSection: sectioned.firstSection } : {}),
  };
}

/** 저장된 산출본의 형태 — `form` 이 없는 옛 산출본은 대치 형태다 (기능/조립산출 §3.8 「산출물 모양」). */
export function bookletForm(booklet: Pick<Booklet, "form">): BookletForm {
  return booklet.form ?? "single";
}

/** 그 상품의 보통약관(대치 형태) · 제1절(절 형태 — 상품 전체 판정) — 미리보기 진입점들이 같은 것을 본다. */
function generalFor(input: AssemblyInput, contexts: AssemblyContexts, s: Shared, form: FormPlan): { general: Built | undefined; sectioned?: SectionedBuild } {
  if (form.form === "single") return { general: buildGeneral(input, contexts, s) };
  const sectioned = buildSectioned(input, contexts, s, form);
  return { general: sectioned.general, sectioned };
}

/**
 * 상품담보 미리보기 — 배치와 무관하게 그 담보약관 하나를 조립한다.
 * 절 형태의 블록이면 그 블록(블록 문맥 · 특약 조 판정 없음)이고, 제1절은 상품 전체 판정이다 — 한 블록으로 다시 판정하지 않는다 (기능/조립산출 §4).
 */
export function assembleSpecial(master: MasterBundle, product: ProductInput, productCoverageId: Id): Result<SpecialPreview> {
  const input: AssemblyInput = { ...master, ...product };
  const c = input.coverages.find((x) => x.snapshot.id === productCoverageId);
  if (!c) return reject({ reason: "notFound", what: `상품담보 ${productCoverageId}` });
  if (!input.specialDocuments.has(c.snapshot.coverageId)) return reject({ reason: "notFound", what: `담보 ${c.snapshot.coverageName} 의 담보약관 문서` });

  const s = shared(input);
  const contexts = buildContexts(input);
  const form = planForm(input);
  const { general, sectioned } = generalFor(input, contexts, s, form);
  const trace = contexts.traces.filter((t) => t.productCoverageId === productCoverageId || input.product.baseContractIds.includes(t.productCoverageId));
  const block = sectioned?.groups.flatMap((g) => g.blocks).find((b) => b.prepared.c.snapshot.id === productCoverageId);
  if (form.form === "sectioned" && form.candidates.has(productCoverageId) && !block) return reject({ reason: "notFound", what: `상품담보 ${c.snapshot.name} 의 블록 — 조건으로 조가 모두 빠졌다` });
  const special = block ? undefined : buildSpecial(input, contexts, s, c, general)!;

  // 미리보기는 보통약관 + 이 담보약관 하나만 훑는다 — 책자 전체에서는 앞 그룹의 별표가 먼저 등장해 번호가 다를 수 있다 (ADR-0063).
  const appendices = collectAppendices([...(general ? [general.numbered] : []), block ? block.numbered : special!.numbered], input.appendices);
  const issues: Issue[] = [];
  let renderedGeneral: RenderedDoc | undefined;
  if (general) {
    const r = renderGeneral(input, general, appendices, sectioned !== undefined);
    renderedGeneral = r.doc;
    issues.push(...r.issues);
  }
  const rendered = block ? { ...renderBlock(block, general, appendices, sectioned!.groupIssues.get(productCoverageId)), omitted: [] } : { ...renderSpecial(c, special!, general, appendices), omitted: special!.omitted };
  issues.push(...rendered.issues);
  return ok({ doc: rendered.doc, general: renderedGeneral, appendices, issues, complete: completeOf(issues), omitted: rendered.omitted, trace });
}

/** 보통약관 미리보기 — 그 상품의 보통약관 한 벌만 조립한다 (문면 저작 화면 미리보기, 기능/문면 §3.9). 템플릿을 고르지 않았으면 undefined. 절 형태면 제1절. */
export interface GeneralPreview {
  doc: RenderedDoc;
  issues: Issue[];
  /** 기본계약 조로 대치된 보통약관 조 id → 기본계약 상품담보 이름. */
  replaced: ReadonlyMap<Id, string>;
}

export function assembleGeneral(master: MasterBundle, product: ProductInput): GeneralPreview | undefined {
  const input: AssemblyInput = { ...master, ...product };
  const s = shared(input);
  const contexts = buildContexts(input);
  const { general, sectioned } = generalFor(input, contexts, s, planForm(input));
  if (!general) return undefined;
  // 별표는 보통약관이 책자 맨 앞이라 이 한 벌만 훑어도 책자와 번호가 같다 (ADR-0063)
  const appendices = collectAppendices([general.numbered], input.appendices);
  const r = renderGeneral(input, general, appendices, sectioned !== undefined);
  return { doc: r.doc, issues: r.issues, replaced: general.replaced ?? new Map() };
}

// ───────────────────────────── 실행 기반 완결성 필터 ─────────────────────────────

/**
 * 담보 마스터 완결성(부착 기반 전체)을 「이 책자의 실행이 실제로 읽은 자리」로 좁힌다 (기능/조립산출 §3 「오류 — 실행 경로 · 부분 조립」 · ADR-0016).
 * 상품담보 스냅샷 노드는 마스터 노드 id 로 대응시킨다. 어떤 탑재분도 읽지 않은 자리는 이 상품의 미입력이 아니다.
 */
export function executionBasedFilter(booklet: Booklet): CompletenessFilter {
  return (items, tree) => {
    const read = new Set<string>();
    for (const t of booklet.trace) {
      if (t.coverageId !== tree.id) continue;
      for (const r of t.reads) read.add(`${r.masterId}|${r.path}`);
    }
    return items.filter((m) => read.has(`${m.owner.id}|${m.path}`));
  };
}
