/**
 * 조립 진입점 — 단계별 순수 변환을 이어 붙여 책자(Booklet)를 만든다. 매번 재계산, 저장 없음 (기능/조립산출 §3).
 *
 *   buildContexts → resolveDocument → substituteSlots → replaceGeneralWithBase → ensureApplicationArticle
 *   → judgeOmission → dropEmptyArticles → numberDocument → placeSpecials → collectAppendices → renderDocument
 *
 * - 부분 조립: 오류는 마커로 심고 끝까지 간다. `issues` 는 책자 등장 순 (D-P6-12). error가 있으면 `complete=false`, warning만 있으면 완성본이다.
 * - 특약 그룹은 담보 마스터의 「특약 그룹」 열거값이다 (ADR-0080) — 그룹 순서 = 열거값 순서, 제목 = 값 이름. 그룹 없는 담보의 상품담보는
 *   그룹들 뒤에 제목 없이 찍힌다(오류 아님). 열거형에서 지워진 값이면 「없는 값」 brokenRef + 제목 없이.
 * - 문면 없는 담보의 탑재분은 오류가 아니라 `undocumented` (D-P6-9).
 * - 특약 문서 제목 = 상품담보명 + 「 특별약관」 (임시 규칙 — 실물 조사 후 확정).
 * - `assembleSpecial` = 상품담보 미리보기 (기능/상품 §4 「상품담보 값」): 담보약관 하나를 그 상품담보 문맥으로, 보통약관과 함께.
 */

import type { OptionSelection } from "../clause/types";
import type { ArticleNode, BlockNode, DocumentNode, SectionNode } from "../document/nodes";
import { refKey, withCodes } from "../document/pcode";
import type { CompletenessFilter } from "../coverage/values";
import { CONTRACT_KIND_PATH, isStandaloneContract } from "../master";
import { baseContractCountIssue } from "../product/completeness";
import { SPECIAL_GROUP_ENUM } from "../coverage/specialGroup";
import { sortInGroup } from "../product/groups";
import type { ClauseOptionOverride, ProductCoverage } from "../product/types";
import { type Coordinate, type Id, type Issue, ok, reject, type Result } from "../types";
import { buildContexts, generalCoordinate, generalDocumentOf, specialCoordinate, type AssemblyContext, type AssemblyContexts } from "./context";
import { ensureApplicationArticle } from "./application";
import { authoredEmptyArticleIds, dropEmptyArticles } from "./emptyArticle";
import { baseKey, replaceGeneralWithBase } from "./base";
import { judgeOmission } from "./omission";
import { collectAppendices, locateIssues, numberDocument, renderDocument } from "./render";
import { resolveDocument } from "./resolve";
import { substituteSlots } from "./substitute";
import type { AssemblyCoverage, AssemblyInput, Booklet, MasterBundle, NumberedDoc, OmissionRecord, ProductInput, RArticle, RenderedDoc, RenderedGroup, SInline, SpecialPreview, SubstitutedDoc, UndocumentedCoverage } from "./types";
import { articlesOf } from "./walk";

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
  // 박스 참조(boxRef)는 항을 펼치지 않는다 — 정적 박스와 같다 (기능/박스 §3.2)
  const dynamicNode = (c: { kind: string }) => c.kind === "condBlock" || c.kind === "forBlock" || c.kind === "clauseBlockRef";
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
  catalog: Map<string, AssemblyInput["catalog"][number]>;
  enums: Map<string, AssemblyInput["enums"][number]>;
  master?: AssemblyInput["master"];
}

function shared(input: AssemblyInput): Shared {
  return {
    clauses: new Map(input.clauses.map((c) => [c.code, c])),
    boxes: new Map((input.boxes ?? []).map((x) => [x.code, x])),
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
  const resolved = resolveDocument({ ...doc, ...(opts.title !== undefined ? { title: opts.title } : {}) }, ctx, { clauses: s.clauses, boxes: s.boxes, overrides: overrideMap(opts.overrides ?? []), coordinate: opts.coordinate, enums: s.enums, ...(s.master ? { master: s.master } : {}) });
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

function buildGeneral(input: AssemblyInput, contexts: AssemblyContexts, s: Shared): Built | undefined {
  const stored = generalDocumentOf(input);
  if (!stored) return undefined;
  // 대치 별칭(positionAliases)이 조립과 같은 P코드를 보도록 코드 없는 옛 트리는 여기서 채운다 (resolveDocument 와 같은 결정적 채번)
  const master = withCodes(stored);
  // 노출 끔 (기능/상품 §3.6) — **번호 계산 전에** 마스터에서 뺀다. 번호 순연은 numberDocument 의 귀결이다.
  // 뺀 조의 명은 남겨 둔다: 이 조를 가리키던 참조·조연결이 `articleHidden` 오류 메시지에 쓴다.
  const hiddenTitles = new Map<Id, string>();
  for (const [id, a] of masterArticles(master)) if (input.product.hiddenArticleIds.has(id)) hiddenTitles.set(id, a.title);
  const hidden = hiddenTitles.size > 0 ? hiddenTitles : undefined;
  const g = hidden ? hideArticles(master, input.product.hiddenArticleIds) : master;
  if (input.product.baseContractIds.length === 1) {
    const base = input.coverages.find((coverage) => coverage.snapshot.id === input.product.baseContractIds[0]);
    const doc = base && input.specialDocuments.get(base.snapshot.coverageId);
    const ctx = base && contexts.specials.get(base.snapshot.id);
    if (base && doc && ctx) {
      const basePrepared = prepare(doc, ctx, s, { coordinate: specialCoordinate(base), ...prepareCoordinates(input, doc, base) });
      const replacedArticleIds = new Set(articlesOf(basePrepared.doc).flatMap((node) => (node.linkedArticleId ? [node.linkedArticleId] : [])));
      // 대치될 보통약관 본문은 실행 경로가 아니다. 먼저 비운 뒤 해소해야 사라질 슬롯의 오류·조회 흔적이 남지 않는다.
      // 조 자리는 문서 · 관 · 조건 블록 가지 어디에나 있다 — 숨김 필터(withoutHidden)와 **같은 순회**로 비운다
      // (조건 블록 안의 조만 최상위·관 자식 검사에서 빠져 오류가 남던 자리 — 코덱스 리뷰 2026-09-15 Important-4).
      const emptyReplaced = (nodes: readonly BlockNode[]): BlockNode[] =>
        nodes.map((n): BlockNode => {
          if (n.kind === "article") return replacedArticleIds.has(n.id) ? { ...n, children: [] } : n;
          if (n.kind === "section") return { ...n, children: emptyReplaced(n.children) as SectionNode["children"] };
          if (n.kind === "condBlock") return { ...n, branches: n.branches.map((branch) => ({ ...branch, children: emptyReplaced(branch.children) })) };
          return n;
        });
      const generalSource: DocumentNode = { ...g, children: emptyReplaced(g.children) as DocumentNode["children"] };
      const generalPrepared = prepare(generalSource, contexts.general, s, { coordinate: generalCoordinate(input.product, master), overrides: input.product.overrides, ...prepareCoordinates(input, g) });
      const replaced = replaceGeneralWithBase(generalPrepared.doc, basePrepared.doc, { productCoverageId: base.snapshot.id, productCoverageName: base.snapshot.name }, hidden);
      const originals = masterArticles(g);
      for (const baseArticle of articlesOf(basePrepared.doc)) {
        const original = baseArticle.linkedArticleId ? originals.get(baseArticle.linkedArticleId) : undefined;
        if (original) for (const [from, to] of positionAliases(original, baseArticle)) replaced.aliases.set(from, to);
      }
      const replacementIssues = replaced.issues.map((issue) => ({ ...issue, source: { document: "coverageMaster" as const, ownerId: base.snapshot.coverageId, documentId: doc.id, ownerName: base.snapshot.coverageName, articleId: issue.at.articleId, articleTitle: issue.at.articleTitle, nodePath: issue.at.articleId ? [doc.id, issue.at.articleId] : undefined } }));
      return { numbered: numberDocument(dropEmptyArticles(replaced.doc, authoredEmptyArticleIds(g)).doc), issues: [...generalPrepared.issues, ...basePrepared.issues, ...replacementIssues], omitted: [], aliases: replaced.aliases, ...(hidden ? { hidden } : {}) };
    }
  }
  const prepared = prepare(g, contexts.general, s, { coordinate: generalCoordinate(input.product, master), overrides: input.product.overrides, ...prepareCoordinates(input, g) });
  return { numbered: numberDocument(dropEmptyArticles(prepared.doc, authoredEmptyArticleIds(g)).doc), issues: prepared.issues, omitted: [], ...(hidden ? { hidden } : {}) };
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

// ───────────────────────────── 9. 특약 배치 ─────────────────────────────

/** 그룹 없는 상품담보를 모은 자리의 id — 책자에서 제목 없이 그룹들 뒤에 선다. */
export const UNGROUPED_ID = "ungrouped";

export interface Placement {
  /**
   * 열거값 순 → 그룹 안 자동 정렬 순. 상품담보가 없는 그룹은 없다. 그룹 없는 상품담보는 마지막 한 자리(`title` 없음 · id `ungrouped`).
   */
  groups: { id: Id; title?: string; members: AssemblyCoverage[] }[];
  /** 상품담보 id → 그 담보의 그룹 값이 열거형에 없다는 오류 (ADR-0080 · 기능/열거형 §3.2 「없는 값」). */
  groupIssues: ReadonlyMap<Id, Issue>;
  undocumented: UndocumentedCoverage[];
  baseContracts: Booklet["baseContracts"];
}

export function placeSpecials(input: AssemblyInput): Placement {
  const baseIds = new Set(input.product.baseContractIds);
  const baseContracts = input.coverages
    .filter((c) => baseIds.has(c.snapshot.id))
    .map((c) => ({ productCoverageId: c.snapshot.id, name: c.snapshot.name, coverageId: c.snapshot.coverageId }));
  const specials = input.coverages.filter((c) => !baseIds.has(c.snapshot.id));
  const documented = specials.filter((c) => input.specialDocuments.has(c.snapshot.coverageId));
  const undocumented = specials
    .filter((c) => !input.specialDocuments.has(c.snapshot.coverageId))
    .map((c) => ({ productCoverageId: c.snapshot.id, name: c.snapshot.name, coverageId: c.snapshot.coverageId }));
  // 담보 순서 = 담보명 순 (B1 마스터 순서는 통합 때 어댑터로)
  const names = [...new Set(documented.map((c) => c.snapshot.coverageName))].sort((a, b) => a.localeCompare(b));
  const nameOf = new Map(documented.map((c) => [c.snapshot.coverageId, c.snapshot.coverageName]));
  const coverageOrder = (id: Id) => names.indexOf(nameOf.get(id) ?? "");
  const byId = new Map(documented.map((c) => [c.snapshot.id, c]));
  const sorted = (members: readonly AssemblyCoverage[]) => sortInGroup(members.map((c) => c.snapshot as ProductCoverage), input.attributeKinds, coverageOrder).map((m) => byId.get(m.id)!);

  // 그룹 = 담보의 「특약 그룹」 열거값 (ADR-0080). 값 순서가 책자 순서, 값 이름이 그룹 제목.
  const groupEnum = input.enums.find((e) => e.code === SPECIAL_GROUP_ENUM);
  const groupIssues = new Map<Id, Issue>();
  const groupOf = (c: AssemblyCoverage): Id | undefined => {
    const code = input.coverageGroups?.get(c.snapshot.coverageId);
    if (code === undefined) return undefined;
    if (groupEnum?.values.some((v) => v.code === code)) return code;
    groupIssues.set(c.snapshot.id, {
      kind: "brokenRef",
      message: `없는 값 ${code} — 특약 그룹(${SPECIAL_GROUP_ENUM})에서 지워진 값입니다 · 담보 「${c.snapshot.coverageName}」의 특약 그룹`,
      at: specialCoordinate(c),
    });
    return undefined;
  };
  const membersOf = new Map<Id, AssemblyCoverage[]>();
  for (const c of documented) {
    const key = groupOf(c) ?? UNGROUPED_ID;
    membersOf.set(key, [...(membersOf.get(key) ?? []), c]);
  }
  const groups: Placement["groups"] = (groupEnum?.values ?? [])
    .filter((v) => membersOf.has(v.code))
    .map((v) => ({ id: v.code, title: v.label, members: sorted(membersOf.get(v.code)!) }));
  const ungrouped = membersOf.get(UNGROUPED_ID);
  if (ungrouped) groups.push({ id: UNGROUPED_ID, members: sorted(ungrouped) });
  return { groups, groupIssues, undocumented, baseContracts };
}

// ───────────────────────────── 조립 ─────────────────────────────

/**
 * 조립 서명은 `assemble(master, product)` — 공유 마스터는 실행당 1회 적재해 여러 상품에 재사용한다 (ADR-0034 결정 2).
 * 결정적이다 (결정 4): 전역 상태 · 모듈 캐시 · 시각 · 난수 없음 — 같은 두 재료면 같은 `Booklet`.
 */
export function assemble(master: MasterBundle, product: ProductInput): Booklet {
  const input: AssemblyInput = { ...master, ...product };
  const s = shared(input);
  const contexts = buildContexts(input);
  const issues: Issue[] = [];
  const omitted: OmissionRecord[] = [];

  // 기본계약 0 · 2+ — 서비스 checkBaseContract 와 같은 판정·문구 (도메인 한 곳 · 기능/상품 §3.5 MVP 정확히 1개).
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

  const general = buildGeneral(input, contexts, s);
  if (!general) {
    issues.push({ kind: "brokenRef", message: "보통약관 템플릿이 선택되지 않았습니다", at: { document: "product", ownerId: input.product.id, ownerName: input.product.name } });
  }

  const placement = placeSpecials(input);
  const builtGroups = placement.groups.map((g) => ({
    ...g,
    docs: g.members.flatMap((c) => {
      const b = buildSpecial(input, contexts, s, c, general);
      return b ? [{ c, b }] : [];
    }),
  }));

  // 8. 별표 — 등장 순 자동 수집 (ADR-0063): 보통약관 → 그룹 순 → 그룹 안 순
  const appendices = collectAppendices([...(general ? [general.numbered] : []), ...builtGroups.flatMap((g) => g.docs.map(({ b }) => b.numbered))], input.appendices);

  // 7. 참조 해소 + 렌더 (책자 순으로 issues 를 모은다)
  let renderedGeneral: RenderedDoc | undefined;
  if (general) {
    const r = renderDocument(general.numbered, { document: "general", ownerId: generalCoordinate(input.product, generalDocumentOf(input)).ownerId!, appendices, aliases: general.aliases, ...(general.hidden ? { hiddenArticles: general.hidden } : {}) });
    renderedGeneral = r.doc;
    issues.push(...locateIssues(general.issues, general.numbered), ...r.issues);
  }
  const specials: RenderedGroup[] = builtGroups.map((g) => ({
    id: g.id,
    ...(g.title !== undefined ? { title: g.title } : {}),
    docs: g.docs.map(({ c, b }) => {
      const groupIssue = placement.groupIssues.get(c.snapshot.id);
      if (groupIssue) issues.push(groupIssue);
      const r = renderDocument(b.numbered, { document: "special", ownerId: c.snapshot.id, general: general?.numbered, aliases: omissionAliases(b.omitted), appendices, ...(general?.hidden ? { hiddenArticles: general.hidden } : {}) });
      issues.push(...locateIssues(b.issues, b.numbered), ...r.issues);
      omitted.push(...b.omitted);
      return r.doc;
    }),
  }));

  return { general: renderedGeneral, specials, appendices, issues, complete: !issues.some((item) => (item.severity ?? "error") === "error"), omitted, undocumented: placement.undocumented, baseContracts: placement.baseContracts, trace: contexts.traces };
}

/** 상품담보 미리보기 — 배치와 무관하게 그 담보약관 하나를 조립한다. */
export function assembleSpecial(master: MasterBundle, product: ProductInput, productCoverageId: Id): Result<SpecialPreview> {
  const input: AssemblyInput = { ...master, ...product };
  const c = input.coverages.find((x) => x.snapshot.id === productCoverageId);
  if (!c) return reject({ reason: "notFound", what: `상품담보 ${productCoverageId}` });
  if (!input.specialDocuments.has(c.snapshot.coverageId)) return reject({ reason: "notFound", what: `담보 ${c.snapshot.coverageName} 의 담보약관 문서` });

  const s = shared(input);
  const contexts = buildContexts(input);
  const general = buildGeneral(input, contexts, s);
  const b = buildSpecial(input, contexts, s, c, general)!;
  // 미리보기는 보통약관 + 이 담보약관 하나만 훑는다 — 책자 전체에서는 앞 그룹의 별표가 먼저 등장해 번호가 다를 수 있다 (ADR-0063).
  const appendices = collectAppendices([...(general ? [general.numbered] : []), b.numbered], input.appendices);
  const issues: Issue[] = [];
  let renderedGeneral: RenderedDoc | undefined;
  if (general) {
    const r = renderDocument(general.numbered, { document: "general", ownerId: generalCoordinate(input.product, generalDocumentOf(input)).ownerId!, appendices, aliases: general.aliases, ...(general.hidden ? { hiddenArticles: general.hidden } : {}) });
    renderedGeneral = r.doc;
    issues.push(...locateIssues(general.issues, general.numbered), ...r.issues);
  }
  const r = renderDocument(b.numbered, { document: "special", ownerId: c.snapshot.id, general: general?.numbered, aliases: omissionAliases(b.omitted), appendices, ...(general?.hidden ? { hiddenArticles: general.hidden } : {}) });
  issues.push(...locateIssues(b.issues, b.numbered), ...r.issues);
  const trace = contexts.traces.filter((t) => t.productCoverageId === productCoverageId || input.product.baseContractIds.includes(t.productCoverageId));
  return ok({ doc: r.doc, general: renderedGeneral, appendices, issues, complete: !issues.some((item) => (item.severity ?? "error") === "error"), omitted: b.omitted, trace });
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
