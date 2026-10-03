/** 상품 화면·서버 액션이 함께 쓰는 순수 함수 — 입력 파싱 · 탭 좌표 · 보통약관의 관 묶기 · 조 수. `*.test.ts` 로 검증. */
import type { OmissionPairKind, OmissionRecord, RenderedDoc } from "@/domain/assembly";
import { indexTree, type ArticleNode, type CondBlockNode, type DocumentNode, type Node, type NodeNumber } from "@/domain/document";
import { findAttributeValue, normalizeSelections, planCombinationKey, type AttributeKind, type AttributeSelection, type ProductCoverage } from "@/domain/product";
import type { Code, Id, Issue } from "@/domain/types";
import type { FormState } from "@/forms";
import { isDirty } from "@/app/_lib/edit";
import { includesQuery } from "@/app/_lib/list";

export function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

/** `attr:<kindCode>` 이름의 select 들 → 선택된 것만 AttributeSelection[]. */
export function parseSelections(fd: FormData, kinds: readonly AttributeKind[]): AttributeSelection[] {
  const out: AttributeSelection[] = [];
  for (const k of kinds) {
    const v = str(fd, `attr:${k.code}`);
    if (v) out.push({ kindCode: k.code, valueCode: v });
  }
  return out;
}

// ───────────────────────────── 상세의 탭 ─────────────────────────────

/**
 * 상품 상세는 한 줄 탭 넷 — 기본정보(상품정보 · 세목) · 상품담보(기본계약 · 특별약관 표) · 보통약관 · 특별약관
 * (기능/상품 §3.8 저장 단위 · 화면 공통, 2026-10-03). 보통약관 = 템플릿 + 세 패널, 특별약관 = 담보 단위 세 패널.
 * 탭은 URL(`?tab=`)에 산다: 서버가 그대로 렌더하고, 새로고침 · 북마크 · 서버 액션의 redirect 가 같은 자리를 가리킨다.
 */
export type ProductTab = "basic" | "coverages" | "general" | "special";

export const PRODUCT_TAB_LABEL: Record<ProductTab, string> = { basic: "기본정보", coverages: "상품담보", general: "보통약관", special: "특별약관" };

export const PRODUCT_TABS: readonly ProductTab[] = ["basic", "coverages", "general", "special"];

/** 없는 값 · 모르는 값은 기본정보로 — URL 의 좌표를 믿지 않는다. */
export function productTabOf(value: string | undefined): ProductTab {
  return value === "coverages" || value === "general" || value === "special" ? value : "basic";
}

/**
 * 옛 탭 주소의 새 자리 — 없으면 undefined(옮길 것 없음). 나머지 쿼리는 그대로 싣는다.
 * - 옛 약관 탭(2026-09-28 ~ 10-03: `?tab=terms&sub=general|special`) → `?tab=general` · `?tab=special` (하위 탭이 없거나 모르면 보통약관).
 * - 탑재 · 기본계약의 확인 카드(`confirm=pc:|detach:`)는 상품담보 탭에만 뜬다 — 2026-09-28 이전의
 *   `?tab=general|special&confirm=…` 북마크는 상품담보 탭으로 보낸다. 옛 그룹 삭제 카드(`confirm=group:`)도 상품담보 탭으로 —
 *   그룹은 담보의 것이 되어(ADR-0080) 그 탭에서 아무 카드도 뜨지 않는다.
 */
export function legacyProductTabRedirect(id: string, sp: Readonly<Record<string, string | undefined>>): string | undefined {
  if (sp.tab !== "terms" && sp.tab !== "general" && sp.tab !== "special") return undefined;
  const confirm = sp.confirm ?? "";
  const coverageConfirm = confirm.startsWith("pc:") || confirm.startsWith("detach:") || confirm.startsWith("group:");
  let tab: ProductTab;
  if (coverageConfirm) tab = "coverages";
  else if (sp.tab === "terms") tab = sp.sub === "special" ? "special" : "general";
  else return undefined;
  const rest = Object.entries(sp).filter(([k, v]) => k !== "tab" && k !== "sub" && v !== undefined) as [string, string][];
  return `/products/${id}?${new URLSearchParams({ tab, ...Object.fromEntries(rest) }).toString()}`;
}

/** 상품 상세 경로 (+ 탭). 화면의 링크와 액션의 redirect 가 같은 함수를 쓴다. */
export function productDetailPath(id: string, tab?: ProductTab): string {
  return tab ? `/products/${id}?tab=${tab}` : `/products/${id}`;
}

// ───────────────────────────── 기본정보 탭의 초안 ─────────────────────────────

/** 기본정보 탭의 편집 초안 — 상품명 · 상품 레벨 값 · 보험종목 정의 · 종목별 값 · 사용할 조합 (기능/상품 §4.3). */
export interface BasicDraft {
  name: string;
  options: readonly unknown[];
  product: Pick<FormState, "fields" | "open">;
  forms: Readonly<Record<string, Pick<FormState, "fields" | "open">>>;
  combinations: readonly (readonly Id[])[];
}

/** 비교할 모양 — 값 칸은 입력 원문(draft)과 여는 폼만 본다(모델 · 파싱 결과는 거기서 파생). 조합은 순서가 뜻이 없다. */
function basicDraftShape(draft: BasicDraft) {
  const form = (state: Pick<FormState, "fields" | "open">) => ({ open: state.open, drafts: Object.fromEntries(Object.entries(state.fields).map(([path, field]) => [path, field.draft])) });
  return {
    name: draft.name,
    options: draft.options,
    product: form(draft.product),
    forms: Object.fromEntries(Object.entries(draft.forms).map(([id, state]) => [id, form(state)])),
    combinations: draft.combinations.map(planCombinationKey).sort(),
  };
}

/**
 * 기본정보 초안이 편집 시작(= 서버 값)과 달라졌나 — 편집 중 ✕ 취소 · 탭 링크 · 경로 링크의 「고친 내용을 버립니까?」 판정 (점검 M21).
 * 입력했다 되돌리면 바뀐 것이 아니다 — 필드의 「손댔나」 표식이 아니라 내용을 비교한다.
 */
export function basicDraftDirty(baseline: BasicDraft, draft: BasicDraft): boolean {
  return isDirty(basicDraftShape(baseline), basicDraftShape(draft));
}

// ───────────────────────────── 보통약관 탭의 「관」 ─────────────────────────────

/**
 * 약관 세 패널이 한 번에 보는 단위 = **관**(款) (기능/상품 §4.5 세 패널).
 * 관은 템플릿 최상위 `section` 노드다. 관 없이 문서 바로 아래 선 조들은 한 묶음으로 친다
 * (관이 하나도 없는 템플릿이면 문서 전체가 한 관이다).
 */
export interface GeneralSection {
  /** 관 노드 id — 관 밖의 조 묶음이면 undefined. */
  id?: Id;
  title?: string;
  /** 목차·좌표가 쓰는 **편 목록** — 조건 블록 안의 조까지 한 줄로 (`articlesIn`). */
  articles: ArticleNode[];
  /**
   * 원문 패널이 쓰는 **최상위 노드 그대로** — 조를 감싼 조건 블록을 벗기지 않는다.
   * 목차는 평탄화가 맞지만(조는 어디 있든 한 줄), 원문에서 조상 조건식을 잃으면
   * 왼쪽·가운데는 무조건 있는 것처럼 보이는데 오른쪽에서만 조가 빠진다 (코덱스 리뷰 2026-09-15 Important-3).
   */
  nodes: (ArticleNode | CondBlockNode)[];
}

/** 조건 블록은 투명하게 편다 — 문면 편집기 목차(`articlesOf`)와 같은 규칙. */
function articlesIn(nodes: readonly Node[]): ArticleNode[] {
  const out: ArticleNode[] = [];
  for (const n of nodes) {
    if (n.kind === "article") out.push(n);
    else if (n.kind === "section") out.push(...articlesIn(n.children));
    else if (n.kind === "condBlock") for (const br of n.branches) out.push(...articlesIn(br.children));
  }
  return out;
}

/** 템플릿 트리 → 문서 순서대로의 관 목록. 조가 하나도 없는 관도 자리를 지킨다(목차에 제목이 선다). */
export function generalSections(tree: DocumentNode): GeneralSection[] {
  const out: GeneralSection[] = [];
  let loose: GeneralSection | undefined;
  for (const child of tree.children) {
    if (child.kind === "section") {
      out.push({ id: child.id, title: child.title, articles: articlesIn(child.children), nodes: [...child.children] });
      loose = undefined;
      continue;
    }
    const articles = articlesIn([child]);
    if (articles.length === 0) continue;
    if (!loose) {
      loose = { articles: [], nodes: [] };
      out.push(loose);
    }
    loose.articles.push(...articles);
    loose.nodes.push(child);
  }
  return out;
}

/**
 * 오른쪽 미리보기를 **가운데와 같은 관**으로 자른다 (기능/상품 §4.5 · 코덱스 리뷰 2026-09-15 Minor-4).
 *
 * 예전 필터는 「관이면 고른 관만, 관 밖 자식은 모두 남긴다」였다 — `관 밖 A → 관 B → 관 밖 C` 처럼
 * 섞인 문서에서 A 를 고르면 가운데는 A 만인데 오른쪽은 A·B·C 가 다 보였다. 묶음의 **조 id 집합**으로
 * 자르면 관이든 관 밖이든 같은 기준이 된다 (조립은 조건 블록을 이미 풀어 조만 남기므로 조 id 로 맞는다).
 * 관이 하나도 없는 문서는 조 전부가 한 묶음이라 결과도 문서 전체다.
 *
 * 오류 마커는 남긴다 — 어느 관의 자리인지 모르는 오류를 조용히 지우지 않는다.
 */
export function sectionPreviewDoc(doc: RenderedDoc | undefined, section: GeneralSection | undefined): RenderedDoc | undefined {
  if (!doc || !section) return doc;
  const articleIds = new Set(section.articles.map((a) => a.id));
  return { ...doc, children: doc.children.filter((c) => (c.kind === "section" ? c.id === section.id : c.kind === "article" ? articleIds.has(c.id) : true)) };
}

/**
 * 세 패널의 제목에 쓰는 묶음 이름 (코덱스 리뷰 후속).
 *
 * 관이 하나도 없는 문서는 조 전부가 한 묶음이라 「전체」가 맞다. 관이 섞인 문서의 **관 밖 묶음**까지
 * 「전체」라고 부르면 옆 관이 안 보이고 있다는 사실을 제목이 덮는다 — 그 자리는 「관 밖 조」로,
 * 템플릿 번호를 알면 조 범위(`제1조 ~ 제3조`)까지 붙여 어디를 보고 있는지 말한다.
 */
export function generalSectionLabel(sections: readonly GeneralSection[], section: GeneralSection | undefined, numbers: ReadonlyMap<Id, NodeNumber>): string {
  if (section?.id) return `${numbers.get(section.id)?.label ?? "관"} ${section.title}`;
  if (!sections.some((s) => s.id)) return "전체";
  const labels = (section?.articles ?? []).map((a) => numbers.get(a.id)?.label).filter((l): l is string => !!l);
  if (labels.length === 0) return "관 밖 조";
  return labels.length === 1 ? `관 밖 조 ${labels[0]}` : `관 밖 조 ${labels[0]} ~ ${labels[labels.length - 1]}`;
}

/** 고른 조가 속한 관. 좌표가 없거나 이 템플릿의 조가 아니면 **첫 조가 있는 관** (URL 의 좌표를 믿지 않는다). */
export function sectionOfArticle(sections: readonly GeneralSection[], articleId: Id | undefined): GeneralSection | undefined {
  const found = articleId ? sections.find((s) => s.articles.some((a) => a.id === articleId)) : undefined;
  return found ?? sections.find((s) => s.articles.length > 0) ?? sections[0];
}

/** 지금 고른 조 — 좌표가 없거나 없는 조면 첫 조. */
export function currentGeneralArticle(sections: readonly GeneralSection[], articleId: Id | undefined): Id | undefined {
  const found = articleId ? sections.flatMap((s) => s.articles).find((a) => a.id === articleId) : undefined;
  return (found ?? sections.find((s) => s.articles.length > 0)?.articles[0])?.id;
}

/** 목차 링크의 좌표 — 탭을 잃지 않는다(`?tab=general&art=<조 id>`). */
export function generalArticlePath(productId: Id, articleId: Id): string {
  return `${productDetailPath(productId, "general")}&art=${articleId}`;
}

/**
 * 보통약관 탭이 보는 오류 (기능/상품 §4.5 세 패널 · 상태).
 *
 * 조 노출을 끄면 그 조를 가리키던 곳이 깨진다. 그런데 **깨졌다고 말하는 자리는 보통약관이 아니다**:
 * 준용(`omission`)·기본계약 연결(`base`)이 내는 `articleHidden` 오류의 결과 좌표는 그 특약
 * (`at.document === "special"`)이다. `document === "general"` 만 걸러 보면 조를 끈 바로 그 탭에서
 * 「오류 0」이 뜬다 — 토글이 부른 오류를 토글한 화면이 못 보는 셈이라, `articleHidden` 은 문서를
 * 가리지 않고 모두 싣는다 (결과 좌표에 상품담보명이 찍히므로 어디가 깨졌는지는 목록에서 읽힌다).
 *
 * 관 단위 필터도 `articleHidden` 에는 걸지 않는다 — 특약 조 id 는 어느 관에도 속하지 않아 전부 사라진다.
 */
export function generalTabIssues(
  issues: readonly Issue[],
  sectionArticleIds: ReadonlySet<Id>,
): { section: Issue[]; errorCount: number } {
  const general = issues.filter((i) => i.at.document === "general");
  const hiddenElsewhere = issues.filter((i) => i.kind === "articleHidden" && i.at.document !== "general");
  return {
    section: [...general.filter((i) => !i.at.articleId || sectionArticleIds.has(i.at.articleId)), ...hiddenElsewhere],
    errorCount: general.filter((i) => i.severity !== "warning").length + hiddenElsewhere.length,
  };
}

/**
 * 보통약관 탭 오류 목록의 **결과 쪽 이동 링크** — 도착할 수 있는 자리만 건다
 * (코덱스 리뷰 2026-09-15 Minor-5. `IssueList` 의 `linkFor`).
 *
 * 이 패널은 특약에서 난 `articleHidden` 까지 싣는데(위 `generalTabIssues`), 그 노드는 여기 그린
 * 보통약관에 없다 — 예전에는 그 자리에도 `#node-…` 앵커가 붙어 아무 데도 가지 않았다.
 * 특약 오류는 그 상품담보의 미리보기로 보내고(결과 좌표의 `ownerId` = 상품담보 id — `specialCoordinate`),
 * 보통약관 오류는 **지금 그린 결과에 그 노드가 있을 때만** 앵커를 건다.
 *
 * 특약 절의 상품담보는 특별약관 탭(`?tab=special&pc=…`)이 제자리다. 그런데 `articleHidden` 을
 * 가장 많이 내는 것은 **기본계약** 상품담보이고, 그 탭의 `?pc=` 는 특약 절만 믿는다(URL 의 좌표를 믿지
 * 않는다) — 기본계약 id 로 보내면 아무것도 고르지 않은 탭이 열린다. 그래서 기본계약은 제 상품담보 화면
 * (조립된 문면과 같은 오류가 그 자리에 선다)으로 보낸다. 되돌아갈 탭의 분기(`tabOfCoverage`)와 같은 기준이다.
 */
export function generalIssueLink(
  productId: Id,
  previewNodeIds: ReadonlySet<Id>,
  baseCoverageIds: ReadonlySet<Id>,
  issue: Issue,
): { href: string; label: string } | undefined {
  if (issue.at.document !== "general") {
    const owner = issue.at.ownerId;
    if (!owner) return undefined;
    const href = baseCoverageIds.has(owner) ? productCoveragePath(productId, owner) : specialPreviewPath(productId, owner);
    return { href, label: `${issue.at.ownerName ?? "특약"} 에서 보기` };
  }
  const nodeId = issue.at.nodePath?.at(-1);
  return nodeId !== undefined && previewNodeIds.has(nodeId) ? { href: `#node-${nodeId}`, label: "미리보기에서 보기" } : undefined;
}

// ───────────────────────────── 특별약관 탭의 미리보기 ─────────────────────────────

/**
 * 고른 상품담보의 미리보기 좌표 (`?tab=special&pc=<상품담보 id>`) — 특별약관 탭
 * (기능/상품 §4.7). 상품담보 표의 「미리보기」와 미리보기 화면의 상품담보 목록이 이 자리를 가리킨다.
 */
export function specialPreviewPath(productId: Id, productCoverageId: Id): string {
  return `${productDetailPath(productId, "special")}&pc=${productCoverageId}`;
}

/** 특별약관 탭에서 담보를 고르는 주소 — 상품담보는 그 담보의 첫 건이 기본이다 (기능/상품 §4.7). */
export function specialCoveragePath(productId: Id, coverageId: Id): string {
  return `${productDetailPath(productId, "special")}&cov=${coverageId}`;
}

/** 특별약관 탭 왼쪽의 한 행 — 담보 마스터 하나와 거기서 탑재한 특약 상품담보들. */
export interface SpecialCoverageGroup {
  coverageId: Id;
  /** 담보명 — 없으면 담보 id. */
  name: string;
  productCoverages: ProductCoverage[];
}

/** 특약 상품담보 → 담보 마스터별 묶음. 담보는 처음 나온 순, 묶음 안은 상품담보 순 그대로. */
export function specialCoverageGroups(specials: readonly ProductCoverage[], coverageName: (coverageId: Id) => string | undefined): SpecialCoverageGroup[] {
  const byCoverage = new Map<Id, SpecialCoverageGroup>();
  for (const pc of specials) {
    let group = byCoverage.get(pc.coverageId);
    if (!group) {
      group = { coverageId: pc.coverageId, name: coverageName(pc.coverageId) ?? pc.coverageId, productCoverages: [] };
      byCoverage.set(pc.coverageId, group);
    }
    group.productCoverages.push(pc);
  }
  return [...byCoverage.values()];
}

/**
 * `?cov=` · `?pc=` → 고른 담보와 상품담보. 특약 절에 있는 좌표만 믿는다 (URL 의 좌표를 믿지 않는다).
 * `pc` 가 있으면 제 담보를 함께 정한다(옛 `?pc=` 링크) — 없으면 `cov` 의 첫 상품담보, 그것도 없으면 첫 담보의 첫 건.
 */
export function resolveSpecialSelection(
  groups: readonly SpecialCoverageGroup[],
  params: { cov?: string | undefined; pc?: string | undefined },
): { group: SpecialCoverageGroup; pc: ProductCoverage } | undefined {
  if (params.pc) {
    for (const group of groups) {
      const pc = group.productCoverages.find((p) => p.id === params.pc);
      if (pc) return { group, pc };
    }
  }
  const group = (params.cov ? groups.find((g) => g.coverageId === params.cov) : undefined) ?? groups[0];
  const pc = group?.productCoverages[0];
  return group && pc ? { group, pc } : undefined;
}

/**
 * 조립 결과가 **앵커(`#node-<id>`)를 심은 노드 id 전부** — 오류 목록의 「미리보기에서 보기」가
 * 도착할 수 있는 자리 (`RenderedDoc.tsx` 가 id 를 다는 자리와 짝). 관을 잘라 그린 결과에 이 함수를
 * 물으면 「지금 화면에 있는가」를 알 수 있다 (코덱스 리뷰 2026-09-15 Minor-5).
 */
interface AnchoredNode {
  id: Id;
  children?: readonly AnchoredNode[];
  items?: readonly AnchoredNode[];
  subitems?: readonly AnchoredNode[];
  rows?: readonly { cells: readonly (readonly AnchoredNode[])[] }[];
}

export function renderedNodeIds(doc: RenderedDoc | undefined): Set<Id> {
  const out = new Set<Id>();
  const walk = (node: AnchoredNode) => {
    out.add(node.id);
    for (const slot of [node.children, node.items, node.subitems]) for (const child of slot ?? []) walk(child);
    for (const row of node.rows ?? []) for (const cell of row.cells) for (const inline of cell) walk(inline);
  };
  for (const c of (doc?.children ?? []) as readonly AnchoredNode[]) walk(c);
  return out;
}

/** 상품담보 한 건의 화면 (값 · 조립된 문면 미리보기) — 기본계약이든 특약이든 같은 자리. */
export function productCoveragePath(productId: Id, productCoverageId: Id): string {
  return `${productDetailPath(productId)}/coverages/${productCoverageId}`;
}

/** 조 수 — 관 안의 조까지 세고, 오류 마커 노드는 조가 아니므로 뺀다 (조립 미리보기 · 특약 미리보기 공용). */
export function articleCount(doc: RenderedDoc | undefined): number {
  if (!doc) return 0;
  let n = 0;
  for (const c of doc.children) {
    if (c.kind === "article") n += 1;
    else if (c.kind === "section") n += c.children.filter((a) => a.kind === "article").length;
  }
  return n;
}

// ───────────────────────────── 조립 미리보기 — 조연결 판정 절 (기능/조립산출 §4.1) ─────────────────────────────

/** 판정별 건수 — 「생략 n」 은 `disposition === "omitted"` 만 센다 (준용·통째는 본문에 남는다). */
export function omissionCounts(records: readonly OmissionRecord[]): Record<OmissionRecord["disposition"], number> {
  const out = { omitted: 0, applied: 0, full: 0 };
  for (const record of records) out[record.disposition] += 1;
  return out;
}

/** 항 대조 한 칸의 이름 — 항이면 렌더 항 번호 「제N항」, 표 · 박스 · 오류 노드는 항 번호를 먹지 않으니 종류로 (`OmissionPair` 서수 규칙). */
export function omissionPairLabel(n: number, kind?: OmissionPairKind): string {
  switch (kind) {
    case "table":
      return `표 ${n}`;
    case "box":
      return `박스 ${n}`;
    case "bulletList":
      return `글머리 목록 ${n}`;
    case "error":
      return `오류 노드 ${n}`;
    default:
      return `제${n}항`;
  }
}

/**
 * 비교에서 뺀 block 함수조항 참조 노드의 화면 이름 — 보통약관 템플릿 트리에서 그 노드를 찾아 「함수조항 C0003(라벨)」.
 * 트리에 없거나 함수조항 참조가 아니면(템플릿이 바뀐 뒤의 저장본) 노드 id 를 그대로 보인다 — 숨기지 않는다.
 */
export function excludedClauseLabel(tree: DocumentNode | undefined, nodeId: Id, clauseLabelOf: (code: Code) => string | undefined): string {
  const node = tree ? indexTree(tree).nodes.get(nodeId)?.node : undefined;
  if (!node || node.kind !== "clauseBlockRef") return nodeId;
  const label = clauseLabelOf(node.clauseCode);
  return `함수조항 ${node.clauseCode}${label ? `(${label})` : ""}`;
}

// ───────────────────────────── 탑재 표 — 기본계약 · 특별약관 (기능/상품 §4.6) ─────────────────────────────

/**
 * 담보속성 조합의 표시 — `갱신유형=갱신형 · 부가유형=추가` (종류 order 순). 붙인 속성이 없으면 「—」.
 * 없어진 종류 · 유효값은 코드를 그대로 보인다 — 화면이 이름을 지어내지 않는다.
 */
export function attributeComboLabel(selections: readonly AttributeSelection[], kinds: readonly AttributeKind[]): string {
  const parts = normalizeSelections(selections, kinds).map((s) => {
    const kind = kinds.find((k) => k.code === s.kindCode);
    const value = findAttributeValue(kinds, s.kindCode, s.valueCode);
    return `${kind?.label ?? s.kindCode}=${value?.label ?? s.valueCode}`;
  });
  return parts.length > 0 ? parts.join(" · ") : "—";
}

/** 탑재 표의 한 행 = 상품담보 하나 — 담보코드 · 담보속성 조합 · 상품담보명. */
export interface MountRow {
  pc: ProductCoverage;
  /** 담보코드 `COV000001` — 담보가 없어졌으면 undefined. */
  coverageCode?: string;
  /** 담보 마스터 이름 — 담보가 없어졌으면 undefined. */
  coverageName?: string;
  /** `attributeComboLabel` 결과. */
  attributes: string;
  /** 특약 그룹 — 그 담보의 「특약 그룹」 값 이름(읽기 전용 · 상품이 못 바꾼다, ADR-0080). 그룹 없는 담보는 undefined. */
  group?: string;
}

/**
 * 탑재 표의 행 — **담보 : 상품담보 = 1 : N** 이라 같은 담보의 상품담보(담보속성 조합별 탑재분)를 이어 놓는다
 * (2026-09-28 사용자 확정). 묶음의 순서는 그 담보가 처음 나온 순서, 묶음 안은 탑재 순서 그대로(안정 정렬).
 */
export function mountRows(
  items: readonly ProductCoverage[],
  coverages: readonly { id: Id; code?: string; name: string; group?: string }[],
  kinds: readonly AttributeKind[],
): MountRow[] {
  const byId = new Map(coverages.map((c) => [c.id, c]));
  const firstSeen = new Map<Id, number>();
  items.forEach((pc, i) => firstSeen.has(pc.coverageId) || firstSeen.set(pc.coverageId, i));
  return items
    .map((pc, i) => ({ pc, i }))
    .sort((a, b) => firstSeen.get(a.pc.coverageId)! - firstSeen.get(b.pc.coverageId)! || a.i - b.i)
    .map(({ pc }) => {
      const coverage = byId.get(pc.coverageId);
      return { pc, coverageCode: coverage?.code, coverageName: coverage?.name, attributes: attributeComboLabel(pc.attributes, kinds), group: coverage?.group };
    });
}

/**
 * 보이는 행마다 「이 담보 묶음의 첫 행인가」 — 담보코드 · 담보명 칸은 묶음 첫 행에만 찍는다(나머지는 빈칸).
 * 검색 · 페이지로 잘린 **보이는 행** 기준이라 걸러져도 같은 규칙이다(한 쪽의 첫 행은 늘 코드를 갖는다).
 */
export function withGroupStarts<T extends { pc: { coverageId: Id } }>(rows: readonly T[]): (T & { groupStart: boolean })[] {
  return rows.map((row, i) => ({ ...row, groupStart: i === 0 || rows[i - 1].pc.coverageId !== row.pc.coverageId }));
}

/** 「담보 검색」 — 담보코드 · 상품담보명 · 담보명 · 담보속성 값(「갱신유형=갱신형」의 어느 조각이든). 빈 검색어면 전부. */
export function filterMountRows(rows: readonly MountRow[], query: string): MountRow[] {
  return rows.filter((row) =>
    includesQuery(query, [row.coverageCode ?? "", row.pc.name, row.coverageName ?? "", row.attributes === "—" ? "" : row.attributes]),
  );
}

/**
 * 세목 표 칸을 지금 그리나 — 같은 행의 다른 값에 따라 비운다(화면 규칙만, 마스터 필드 조건이 아니다 · 2026-10-03 QA).
 * 납입면제사유는 적용여부 = 예일 때만 뜻이 있다 — 「아니오」 · 미입력 행에서 사유 칸이 열려 있으면 고를 것처럼 보였다.
 */
export function planCellShown(path: string, valueOf: (path: string) => unknown): boolean {
  if (path === "waiver.reasons") return valueOf("waiver.applies") === true;
  return true;
}
