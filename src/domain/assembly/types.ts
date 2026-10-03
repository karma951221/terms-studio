/**
 * 조립 파이프라인의 타입 — 입력(MasterBundle · ProductInput) · 단계별 중간 표현 · 출력(Booklet).
 *
 * 근거: 기능/조립산출 §3 · ADR-0016(부분 조립 + 오류 좌표) · 기능/조립산출 §3.5(생략 자동 판정) ·
 * 기능/조립산출 §3.2(보통약관 문맥 = 기본계약) · 기능/상품 §3.6(옵션 해소) · ADR-0012(번호는 계산값).
 *
 * 파이프라인과 중간 표현 (아키텍처 문서에 옮길 것):
 *
 *   MasterBundle + ProductInput  (합치면 AssemblyInput · ADR-0034 결정 2)
 *     │ 1. 문맥 구성            buildContexts        → AssemblyContexts  (상품담보별 EvalContext + 보통약관 문맥)
 *     │ 2. 조건·함수조항 해소    resolveDocument      → ResolvedDoc      (밟은 가지 인라인화, 슬롯·참조 유지)
 *     │ 3. 슬롯 치환            substituteSlots      → SubstitutedDoc   (슬롯이 텍스트/오류 마커로)
 *     │ 4. 기본계약 본문 대치    replaceGeneralWithBase
 *     │ 5. 최소 준용규정 생성    ensureApplicationArticle
 *     │ 6. 항 단위 준용 판정     judgeOmission        → SubstitutedDoc + OmissionRecord[]
 *     │ 7. 번호 계산            numberDocument       → NumberedDoc      (조·항·호·목 번호)
 *     │ 8. 특약 배치            placeSpecials        → 담보의 특약 그룹(열거값 순)별 정렬된 문서 목록 — 그룹 없는 것은 끝에 제목 없이
 *     │ 9. 별표 번호            collectAppendices    → BookletAppendix[] (책자 등장 순 = 번호, ADR-0063)
 *     │ 10. 참조 슬롯 해소      renderDocument       → RenderedDoc      (조·별표 참조가 표기 문자열로)
 *     ▼
 *   Booklet
 *
 * 순서 메모: 별표 번호는 책자 등장 순이다 (ADR-0063 — 상품 별표 목록은 없앴다). 참조 해소가 그 번호를 찍는다.
 * 모든 중간 표현은 순수 데이터다 — 오류는 그 자리에 `ErrorNode` 로 심고 계속 간다.
 */

import type { StructNodeRef } from "../structure";
import type { Discriminator, EnumDef, SlotPath } from "../catalog/types";
import type { Clause } from "../clause/types";
import type { Appendix } from "../document/appendix";
import type { Box } from "../document/box";
import type { ArticleNode, DocumentNode, TableColumn } from "../document/nodes";
import type { AttributeKind, ClauseOptionOverride, PlanAxis, ProductCoverageSnapshot, ProductPlan } from "../product/types";
import type { MasterTree } from "../master";
import type { Code, Coordinate, Id, Issue, ReferenceConnector, ValueSlot } from "../types";

// ───────────────────────────── 입력 ─────────────────────────────

/**
 * 세목 선택지 — 세목 레벨 집계의 범위 하나 (설계 §2.3 · 기능/조립산출 §3.2).
 * 선택지는 유형(폼) 하나를 가지므로 값 자리는 `planTypeCode` 폼의 필드뿐이다 (owner plan, id = 선택지 id).
 */
export interface AssemblyPlanOption {
  id: Id;
  axis: PlanAxis;
  number: number;
  name: string;
  /** 세목유형 = 세목 레벨 폼키. */
  planTypeCode: Code;
  values: ReadonlyMap<SlotPath, ValueSlot>;
}

/** 상품 — 이름 · 상품 레벨 값 · 세목 선택지 · 기본계약 · 보통약관 문서 id · 상품 스코프 옵션 오버라이드. */
export interface AssemblyProduct {
  id: Id;
  name: string;
  /** 상품 레벨 값 자리 (owner product). */
  values: ReadonlyMap<SlotPath, ValueSlot>;
  /**
   * 세목 집계 범위 — **유효 조합에 등장하는 선택지 합집합** (조합에 안 든 선택지는 팔지 않는 세목이라 문면에 영향 주지 않는다).
   * 보통약관 · 담보약관 문맥이 같은 범위를 쓴다 — 상품담보별 부착 세목(`AssemblyCoverage.plans`)은 읽지 않는다.
   */
  planOptions: readonly AssemblyPlanOption[];
  /**
   * 상품에 **정의된** 세목 선택지 수 (조합 등록 여부와 무관). `planOptions` 가 비었는데 이게 0 이 아니면 선택지는 만들고
   * 유효 조합을 안 등록한 미완성 구성이다 — 축이 원래 없는 상품(0)과 가른다 (코덱스 리뷰 2026-09-14 Important-3).
   */
  planOptionCount: number;
  /** 기본계약 상품담보 id 목록. 수가 조립 모드를 정하며 MVP는 1개 모드만 지원한다. */
  baseContractIds: readonly Id[];
  /** 보통약관 템플릿 문서 id — 문면은 `MasterBundle.generalDocuments` 에서 이 id 로 고른다. 없으면 오류 + 특약만 조립. */
  generalDocumentId?: Id;
  /** 보통약관 함수조항의 상품별 옵션 오버라이드 (scope product). */
  overrides: readonly ClauseOptionOverride[];
  /**
   * 이 상품에서 「노출 끔」 한 보통약관 템플릿 조 id (기능/상품 §3.6).
   * 조립은 번호 계산 **전에** 이 조들을 마스터에서 뺀다 — 번호 순연은 그 귀결이다.
   * 숨긴 조를 가리키는 조참조·준용(조연결)은 `articleHidden` 오류로 드러난다 (조용히 빠지지 않는다).
   */
  hiddenArticleIds: ReadonlySet<Id>;
  /**
   * 이 상품의 조 사본 — 템플릿 조 id → 그 조를 갈아 끼울 내용 (ADR-0079 · 기능/상품 §3.10). 없거나 비면 템플릿 그대로.
   * 조립은 보통약관을 읽는 첫 자리(`generalDocumentOf`)에서 갈아 끼우므로 번호 · 숨김 · 준용 · 기본계약 대치가 모두 사본을 본다.
   * 템플릿에 없는 조의 사본은 쓰이지 않는다.
   */
  articleCopies?: ReadonlyMap<Id, ArticleNode>;
}

/** 상품담보(탑재분) — 스냅샷 구조·값 · 세목 부착. */
export interface AssemblyCoverage {
  /** 상품담보 + 스냅샷 노드 트리 (담보명·상품담보명·속성 조합 포함). */
  snapshot: ProductCoverageSnapshot;
  /** owner id(상품담보 id · 스냅샷 노드 id) → 값 자리. */
  values: ReadonlyMap<Id, ReadonlyMap<SlotPath, ValueSlot>>;
  /** 부착된 세목 — 조립은 읽지 않는다 (세목 범위는 상품의 `planOptions`, 기능/조립산출 §3.2). */
  plans: readonly ProductPlan[];
}

/**
 * 공유 마스터 — 전 상품이 같은 것을 읽는 재료 (ADR-0034 결정 2). 실행당 1회 적재하고 여러 상품 조립에 재사용한다.
 * 상품 하나로 좁혀 읽는 것은 여기 두지 않는다 — 문서도 **전체 맵**으로 싣고 상품이 id 로 고른다.
 */
export interface MasterBundle {
  catalog: readonly Discriminator[];
  enums: readonly EnumDef[];
  attributeKinds: readonly AttributeKind[];
  clauses: readonly Clause[];
  appendices: readonly Appendix[];
  /** 정적 마스터 박스 — 박스 참조가 여기서 내용을 읽는다 (최종 결정 9). 없으면 박스 없음. */
  boxes?: readonly Box[];
  /** 보통약관 문서 id → 문면. 상품은 `AssemblyProduct.generalDocumentId` 로 고른다. */
  generalDocuments: ReadonlyMap<Id, DocumentNode>;
  /** 담보 id → 담보약관 마스터 문서. 없는 담보의 탑재분은 문서를 내지 않는다 (오류 아님). */
  specialDocuments: ReadonlyMap<Id, DocumentNode>;
  /** 값 자리를 정하는 마스터 트리 (ADR-0037). 없으면 MVP 정본. */
  master?: MasterTree;
  /**
   * 담보 id → 특약 그룹 열거값 코드 (ADR-0080) — 담보 마스터의 그룹 칸. 없는 담보는 그룹 없음(책자에서 제목 없이).
   * 그룹 제목 · 순서는 `enums` 의 「특약 그룹」(E0008)에서 읽는다.
   */
  coverageGroups?: ReadonlyMap<Id, Code>;
}

/** 상품 고유분 — 상품 값 · 세목 · 탑재 스냅샷/값/부착 · 오버라이드 · 숨김 (ADR-0034 결정 2). 상품마다 적재한다. 특약 그룹은 담보 마스터 것이다(ADR-0080). */
export interface ProductInput {
  product: AssemblyProduct;
  coverages: readonly AssemblyCoverage[];
}

/** 호환용 — 두 재료를 한 객체로 다루는 자리(픽스처 · 적재 래퍼). 조립 서명은 `assemble(master, product)` 다. */
export type AssemblyInput = MasterBundle & ProductInput;

// ───────────────────────────── 중간 표현 — 노드 ─────────────────────────────

/** 오류 마커 — 오류가 난 자리에 대신 선다 (ADR-0016 부분 조립). `id` 는 원인 노드(또는 가지) id. */
export interface ErrorNode {
  kind: "error";
  id: Id;
  issue: Issue;
}

export interface RText {
  kind: "text";
  id: Id;
  text: string;
}

/** 해소 단계까지 남아 있는 슬롯 — 치환 단계가 텍스트/오류로 바꾼다. `at` 는 오류 좌표 (조·노드 경로). */
export interface RSlot {
  kind: "slot";
  id: Id;
  ref: string;
  at: Coordinate;
  /** 반복 표 행 안의 슬롯이면 행 노드 — 치환이 그 노드 문맥(`AssemblyContext.rows`)에서 평가한다 (ADR-0070). */
  row?: StructNodeRef;
  /** 블록 반복(세목 선택지 원천) 안의 슬롯이면 그 종(세목 선택지 id) — 치환이 그 종을 커서로 세운 문맥(`AssemblyContext.plans`)에서 평가한다 (ADR-0077). */
  plan?: Id;
}

/** 해소 단계의 조 참조 — 대상 = 조 id + (항 · 호 · 목이면) 참조 열쇠(`Keyed.key` 와 같은 모양). */
export interface RArticleRef {
  kind: "articleRef";
  id: Id;
  /**
   * 대상 — 조 · 조+코드 · 조+참조코드+안쪽코드(펼친 함수조항 안 노드). `values` = 값 한정(현재 값은 해소 단계가 원소 코드로 바꿔 둔다 —
   * 열거값 원소 반복으로 생긴 노드 중 그 값이 낸 것만, ADR-0077 결정 7).
   */
  targets: { articleId: Id; code?: string; innerCode?: string; values?: string[] }[];
  /** 참조 자리를 감싼 블록 반복의 현재 원소 — 템플릿 반복 id → 원소 id. 같은 반복 안 대상은 이 회차의 사본으로 좁힌다. */
  within?: Readonly<Record<Id, string>>;
  connector?: ReferenceConnector;
  scope: "self" | "general";
  at: Coordinate;
}

export interface RAppendixRef {
  kind: "appendixRef";
  id: Id;
  appendixCode: Code;
  at: Coordinate;
}

/** 해소 단계(ResolvedDoc)의 인라인 노드. */
export type RInline = RText | RSlot | RArticleRef | RAppendixRef | ErrorNode;
/** 치환 단계(SubstitutedDoc)의 인라인 노드 — 슬롯이 사라졌다. */
export type SInline = Exclude<RInline, RSlot>;

/** 정적 표 — 셀은 인라인 노드 목록이라 슬롯·참조가 단계마다 함께 해소된다 (기능/문면 §3.2). */
export interface RTable<I> {
  kind: "table";
  id: Id;
  title?: string;
  columns: TableColumn[];
  /** `spans` = 셀별 rowSpan (반복 표 바깥 key 병합, 0 = 위 셀에 병합됨 — ADR-0070). 없으면 병합 없음. */
  rows: { header?: boolean; cells: I[][]; spans?: number[] }[];
}
/**
 * 【용어풀이】 박스 — 줄은 인라인 목록(박스 참조 · 옛 문면 박스 노드는 줄마다 글 한 조각).
 * 렌더 결과(`RenderedBox`)에서는 줄마다 글 하나다.
 */
export interface RBox<I> {
  kind: "box";
  id: Id;
  title: string;
  lines: I[][];
}
/** 글머리 목록 — 번호 없는 항목 나열. 항목 문장은 인라인이라 슬롯 · 참조가 단계마다 함께 해소된다. 조건으로 빠진 항목은 없다. */
export interface RBulletList<I> {
  kind: "bulletList";
  id: Id;
  items: { id: Id; children: I[] }[];
}
export type RStatic<I> = RTable<I> | RBox<I> | RBulletList<I>;

/**
 * 참조 열쇠 — 조 안에서 이 노드를 가리키는 코드 (ADR-0072). 조가 직접 가진 노드는 제 P코드, 펼친 함수조항의 노드는
 * `참조노드코드/안쪽코드`(결정 3 개정 — 펼친 코드가 사용처 조의 코드와 겹치지 않는다). 코드가 없으면 가리킬 수 없다.
 */
interface Keyed {
  key?: string;
  /** 블록 반복이 만든 노드면 감싼 반복의 원소들(바깥 → 안쪽) — 반복 안 대상 · 값 한정 참조를 이 원소로 좁힌다 (ADR-0077 결정 7). */
  loops?: LoopTag[];
  /**
   * 이 노드를 (투명 자리를 거쳐) 곧바로 낸 반복 블록 · 함수조항 블록 참조의 열쇠 — 그 블록을 가리키는 참조는 이 노드들 전부다
   * (「펼친 것 전부」, ADR-0077 결정 7).
   */
  groups?: string[];
}

/** 반복 원소 표지 — 템플릿 반복 id · 원소 id(종 = 세목 선택지 id, 열거값 = 값 코드). */
export interface LoopTag {
  loop: Id;
  element: string;
  kind: "planOption" | "enumValue";
}
export interface RSubitem<I> extends Keyed {
  kind: "subitem";
  id: Id;
  children: I[];
}
export interface RItem<I> extends Keyed {
  kind: "item";
  id: Id;
  children: I[];
  subitems?: (RSubitem<I> | RBulletList<I> | ErrorNode)[];
}
export interface RParagraph<I> extends Keyed {
  kind: "paragraph";
  id: Id;
  children: I[];
  items?: (RItem<I> | RStatic<I> | ErrorNode)[];
  /** 보통약관의 block 함수조항 참조에서 펼쳐져 자동 판정 비교 대상에서 빠지는 항. */
  excludeFromComparison?: boolean;
}
export interface RArticle<I> {
  kind: "article";
  id: Id;
  title: string;
  linkedArticleId?: Id;
  children: (RParagraph<I> | RStatic<I> | ErrorNode)[];
  /**
   * 조립이 밟은 반복 블록이 낼 수 있던 코드(복제 접미사 · 펼치기 앞마디 포함 원형 — `P0100` · `P0300/…`는 참조코드만) — 원소 0개라 노드가 없어도
   * 그 대상을 가리키는 참조는 「사라짐」이 아니라 「펼친 것 0개」 오류다 (ADR-0077 결정 7).
   */
  repeatKeys?: string[];
}
/** 관 — 제목 + 조 목록. 번호는 계산값. */
export interface RSection<I> {
  kind: "section";
  id: Id;
  title: string;
  children: (RArticle<I> | ErrorNode)[];
}
export interface RDoc<I> {
  kind: "document";
  id: Id;
  title: string;
  children: (RArticle<I> | RSection<I> | ErrorNode)[];
}

export type ResolvedDoc = RDoc<RInline>;
export type SubstitutedDoc = RDoc<SInline>;

// ───────────────────────────── 중간 표현 — 번호 ─────────────────────────────

export interface NumberedNode {
  n: number;
  label: string;
}

/** 번호 계산 결과 — 노드 id → 번호 (조·항·호·목만). */
export interface NumberedDoc {
  doc: SubstitutedDoc;
  numbers: ReadonlyMap<Id, NumberedNode>;
}

// ───────────────────────────── 출력 ─────────────────────────────

export interface RenderedText {
  kind: "text";
  id: Id;
  text: string;
}
/**
 * 조 참조 — 남은 대상과 계산된 표기 (「제3조(…)부터 제5조(…)까지 및 제7조(…)」 · 기능/문면 §3.5).
 * `targets` 는 조립 결과에 살아남은 대상(해소된 노드 id — 코드를 공유한 분기 짝 중 살아남은 것)만,
 * `dropped` 는 분기·생략으로 빠진 대상 열쇠(`refKey`, 출처 추적용 · 오류 아님).
 */
export interface RenderedArticleRef {
  kind: "articleRef";
  id: Id;
  targets: { nodeId: Id; label: string }[];
  connector?: ReferenceConnector;
  label: string;
  dropped?: Id[];
}
/** 별표 참조 — 책자 전역 번호와 표기 「【별표N(이름)】」. */
export interface RenderedAppendixRef {
  kind: "appendixRef";
  id: Id;
  appendixCode: Code;
  number: number;
  label: string;
}
export type RenderedInline = RenderedText | RenderedArticleRef | RenderedAppendixRef | ErrorNode;

export interface RenderedSubitem {
  kind: "subitem";
  id: Id;
  number: number;
  label: string;
  children: RenderedInline[];
}
export interface RenderedItem {
  kind: "item";
  id: Id;
  number: number;
  label: string;
  children: RenderedInline[];
  subitems?: (RenderedSubitem | RBulletList<RenderedInline> | ErrorNode)[];
}
/** 렌더된 박스 — 줄마다 글 하나. */
export interface RenderedBox {
  kind: "box";
  id: Id;
  title: string;
  lines: string[];
}
/** 정적 표·박스 — 표는 셀이 렌더된 인라인, 박스는 줄 글. */
export type RenderedStatic = RTable<RenderedInline> | RenderedBox | RBulletList<RenderedInline>;
export interface RenderedParagraph {
  kind: "paragraph";
  id: Id;
  number: number;
  /** 항이 하나뿐인 조에서는 빈 문자열 (마커 생략 — 기능/문면 §3.2). */
  label: string;
  children: RenderedInline[];
  items?: (RenderedItem | RenderedStatic | ErrorNode)[];
}
export interface RenderedArticle {
  kind: "article";
  id: Id;
  number: number;
  /** 「제N조」 */
  label: string;
  title: string;
  linkedArticleId?: Id;
  children: (RenderedParagraph | RenderedStatic | ErrorNode)[];
}
export interface RenderedSection {
  kind: "section";
  id: Id;
  number: number;
  /** 「제N관」 */
  label: string;
  title: string;
  children: (RenderedArticle | ErrorNode)[];
}

/** 조립 결과 문서 — 순수 데이터 문서트리 (스냅샷 테스트 대상). */
export interface RenderedDoc {
  kind: "document";
  id: Id;
  /** general 은 보통약관 템플릿 id, special 은 상품담보 id. */
  document: "general" | "special";
  ownerId: Id;
  title: string;
  children: (RenderedArticle | RenderedSection | ErrorNode)[];
}

/** 책자의 특약 그룹 하나 — id 는 「특약 그룹」 열거값 코드. 그룹 없는 상품담보의 자리는 id `ungrouped` · 제목 없음(제목을 찍지 않는다). */
export interface RenderedGroup {
  id: Id;
  title?: string;
  docs: RenderedDoc[];
}

export interface BookletAppendix {
  code: Code;
  name: string;
  /** 책자 등장 순 (1부터) — ADR-0063. */
  number: number;
}

/** 항이 아닌 비교 단위 — 표 · 박스(기능/문면 §3.2 「항과 같은 한 단위로 비교」) · 오류 노드. 항이면 없음. */
export type OmissionPairKind = "table" | "box" | "bulletList" | "error";

/**
 * 판정 근거의 항 대조 한 줄 — 담보 항 ↔ 보통약관 항 (기능/조립산출 §4.1).
 * 서수는 **렌더 항 번호**(조 안에서 항만 센 값 — 비교 제외 항도 렌더되는 항이라 센다). 표 · 박스 · 오류 노드는 항 번호를 먹지 않고
 * 그 종류 안의 순번 + `…Kind` 로 표시한다. 원본 배열 자리는 여기 없다 — 준용의 `keep` 은 도메인이 따로 센다.
 */
export interface OmissionPair {
  /** 담보 조에 짝이 없는 보통약관 항(보통약관이 더 길 때)은 null. */
  special: number | null;
  /** 준용에서 보통약관에 없는(남는) 담보 항은 null. */
  general: number | null;
  matched: boolean;
  /** `special` 이 항이 아닐 때 그 종류. */
  specialKind?: OmissionPairKind;
  /** `general` 이 항이 아닐 때 그 종류. */
  generalKind?: OmissionPairKind;
}

/**
 * 생략 판정 기록 — 조연결된 조를 보통약관 조와 항 단위 위치 대조해 생략 · 준용 · 통째로 갈랐다 (기능/조립산출 §3.5 · D-P6-8).
 * 미리보기의 판정 근거 패널이 `pairs` · `excludedClauseNodeIds` · `reason` 을 그린다.
 */
export interface OmissionRecord {
  productCoverageId: Id;
  productCoverageName: string;
  articleId: Id;
  articleTitle: string;
  linkedArticleId: Id;
  disposition: "omitted" | "applied" | "full";
  /** 항별 대조 — 생략·준용은 대응, 통째는 위치 대조(i ↔ i). */
  pairs: OmissionPair[];
  /** 비교에서 뺀 보통약관 block 함수조항 참조 노드 id (`excludeFromComparison`). 이름은 화면이 붙인다. */
  excludedClauseNodeIds: Id[];
  /** 미합의 사유 문구 (기능/조립산출 §3.5 표) — `full` 이고 자동 판정을 보류했을 때만. */
  reason?: string;
}

/** 문면 없는 담보의 탑재분 — 문서를 내지 않았다 (오류 아님 · D-P6-9). */
export interface UndocumentedCoverage {
  productCoverageId: Id;
  name: string;
  coverageId: Id;
}

/** 특약 벌로 출력하지 않은 기본계약 탑재분 기록. */
export interface BaseContractRecord {
  productCoverageId: Id;
  name: string;
  coverageId: Id;
}

/** 실행이 실제로 읽은 값 자리 하나 (D-P6-7 조립 문맥 조회 · 실행 기반 완결성 필터 재료). */
export interface ReadRecord {
  /** 값 소유자 — 상품 · 세목 선택지 · 상품담보 · 스냅샷 노드. */
  owner: { kind: "product" | "plan" | "productCoverage" | "productSubCoverage" | "productBenefit"; id: Id };
  /** 대응 마스터 실체 id (상품담보 → 담보 id · 노드 → 마스터 노드 id). 상품 · 세목 선택지는 자기 id. */
  masterId: Id;
  path: SlotPath;
  /** 읽은 결과 — 값 자리 또는 자리 없음. */
  slot: ValueSlot | "missing";
}

export interface ContextTrace {
  productCoverageId: Id;
  productCoverageName: string;
  coverageId: Id;
  reads: ReadRecord[];
}

export interface Booklet {
  /** 보통약관 템플릿이 없으면 undefined (+ issues 에 brokenRef). */
  general: RenderedDoc | undefined;
  /** 그룹 순 → 그룹 안 자동 정렬 순. */
  specials: RenderedGroup[];
  appendices: BookletAppendix[];
  /** 책자 등장 순 (D-P6-12). */
  issues: Issue[];
  /** issues 가 하나라도 있으면 false — 「완성본 아님」. */
  complete: boolean;
  omitted: OmissionRecord[];
  undocumented: UndocumentedCoverage[];
  baseContracts: BaseContractRecord[];
  /** 상품담보별 실행이 읽은 값 (보통약관이 기본계약 값을 읽은 것은 기본계약 상품담보에 실린다). */
  trace: ContextTrace[];
}

/** 상품담보 미리보기 — 담보약관 하나를 특정 상품담보 문맥으로 조립한 결과 (기능/상품 §4 「상품담보 값」). */
export interface SpecialPreview {
  doc: RenderedDoc;
  /** 보통약관 (조 참조 해소·생략 판정의 상대). */
  general: RenderedDoc | undefined;
  appendices: BookletAppendix[];
  issues: Issue[];
  complete: boolean;
  omitted: OmissionRecord[];
  trace: ContextTrace[];
}
