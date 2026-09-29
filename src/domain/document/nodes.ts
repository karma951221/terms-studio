/**
 * 문면 노드 트리 — 저장 단위 (ADR-0012 · 기능/문면 §3.2).
 *
 * 문서 = 일반 노드 트리. 깊이·종류를 스키마에 고정하지 않고 **노드 종류별 허용 자식을 규칙 테이블**로 건다.
 * 노드는 세 부류다:
 *   - 구조   : document · article(조) · paragraph(항) · item(호) · subitem(목)
 *   - 블록 동적: condBlock(if/elif/else) · forBlock(자리만, 평가 P7) · clauseBlockRef(함수조항 블록 참조 — 항 · 호 · 목 유형) · boxRef(정적 마스터 박스 참조)
 *   - 인라인  : text · slot · inlineCond · inlineFor(자리만) · articleRef · appendixRef · clauseInlineRef
 *
 * - 조의 메타는 조 명 · 조연결(`linkedArticleId`) 뿐. 번호는 저장하지 않는다 (계산값 — numbering.ts).
 * - 식이 들어가는 자리(`when` · `slot.ref`)는 코드 기반 소스 문자열 — 파싱·검사는 expression 모듈.
 * - 노드 id 는 트리 안에서 유일 (조건 가지 id 포함).
 * - B2 `src/domain/clause/nodes.ts` 와 같은 모양이다 (통합 시 하나로 합친다). 차이: articleRef 에 `scope`.
 *
 * DB·React import 금지 (순수층).
 */

import { CONNECTOR_REQUIRED_MESSAGE, isReferenceConnector, type AttachLevel, type Code, type Coordinate, type Id, type Issue, type ReferenceConnector } from "../types";
import type { ClauseMode } from "../clause/types";
import type { Bindings } from "../clause/params";

// ───────────────────────────── 인라인 ─────────────────────────────

/** 텍스트런. */
export interface TextNode {
  id: Id;
  kind: "text";
  text: string;
}

/** 값 치환 슬롯 — `ref` 는 값 참조 경로 (`D0001` · `D0002.F01` · `builtin.subCoverage.name`). 이름 슬롯은 없다. */
export interface SlotNode {
  id: Id;
  kind: "slot";
  ref: string;
}

/** 인라인 조건의 가지. `when` 없음 = else (마지막 가지에만, 최대 1개 — D-P4-11). 값별 분기 운반체면 칸(`values` · `empty`). */
export interface InlineBranch extends SwitchCaseMark {
  id: Id;
  when?: string;
  children: InlineNode[];
}

/**
 * 값별 분기(switch, 최종 결정 5)의 편집 트리 운반 — 조건 노드(블록 · 문장 안)에 `switchOn`(대상 식)을 달면 값별 분기이고, 가지가 칸이다.
 * 칸은 `when` 없이 값 코드(`values`) · 「문구 없음」(`empty`)을 든다. 가지 규칙(투명 · 자리 · 문장 안 중첩 금지)을 그대로 물려받아
 * 편집 명령 · 색인 · 렌더러를 한 벌로 쓴다. 모델은 함수조항 본문의 `switchBlock` · `inlineSwitch`(clause/nodes.ts) — 어댑터(clauseTree.ts)가 옮긴다.
 * **지금은 함수조항 편집기만 싣는다** — 저장 검사는 `TreeEnv.switches` 가 없으면 거부한다(템플릿에서 열 때 이 표지만 켠다).
 */
export interface SwitchCaseMark {
  values?: Code[];
  empty?: true;
}

/** 인라인 조건 (문장 중간 if/elif/else). 중첩 금지 (기능/문면 §3.2). `switchOn` 이 있으면 문장 안 값별 분기 운반체. */
export interface InlineCondNode {
  id: Id;
  kind: "inlineCond";
  branches: InlineBranch[];
  switchOn?: string;
}

/** 인라인 반복 — 자리만 (구현 P7). `source` 는 순회 소스(`subCoverage` · `benefit`), `separator` 는 원소 구분 문자열 (D-P4-17). */
export interface InlineForNode {
  id: Id;
  kind: "inlineFor";
  source: string;
  alias?: string;
  children: InlineNode[];
  separator?: string;
}

/**
 * 조 참조 슬롯 — 조 id 를 저장하고 렌더 시 계산된 번호(+조 명)를 찍는다.
 * `self` = 같은 문서의 조, `general` = 대응 보통약관(D-P4-5)의 조 (담보약관에서만 — D-P4-20).
 */
export interface ArticleRefNode {
  id: Id;
  kind: "articleRef";
  /** 작성 순서 = 나열 순서. 연속 판정(「부터 … 까지」)은 렌더가 계산 번호로 한다 (기능/문면 §3.5). */
  targets: { nodeId: Id }[];
  /**
   * 마지막 대상(또는 마지막 구간) 앞 연결어 — 「및」·「또는」. **기본값이 없다**(결정 14): 대상이 둘 이상인데 비어 있으면 저장 오류,
   * 대상이 하나면 없어도 된다(표기에 안 나온다). 옛 문서에 저장된 「및」은 그대로 유효하다.
   */
  connector?: ReferenceConnector;
  scope: "self" | "general";
}

/** 별표 참조 슬롯 — 별표 불변 코드만. 번호는 책자별 계산값 (조립). */
export interface AppendixRefNode {
  id: Id;
  kind: "appendixRef";
  appendixCode: Code;
}

/** 공용조항 inline 참조 — 옵션 선택은 사용처(이 문서) 소유 (기능/함수조항 §3.2). */
export interface ClauseInlineRefNode {
  id: Id;
  kind: "clauseInlineRef";
  clauseCode: Code;
  /** optionCode → 선택한 valueCode. 미선택 옵션은 키 없음. */
  options: Record<Code, Code>;
  /** 인자 연결 — 인자 이름 → 연결 (최종 결정 2). 없는 인자는 기본 연결을 쓴다. 비면 키를 싣지 않는다. */
  bindings?: Bindings;
}

/**
 * 구조 표기 — 반복 표 행의 key 칩 (ADR-0070 결정 6). 평가가 그 행의 `level` 노드 표기(`keyLabel`)로 바꾼다.
 * 반복 표의 템플릿 행 안에서만 쓸 수 있다 (저장 검사).
 */
export interface StructKeyNode {
  id: Id;
  kind: "structKey";
  level: Exclude<AttachLevel, "product">;
}

export type InlineNode =
  | TextNode
  | StructKeyNode
  | SlotNode
  | InlineCondNode
  | InlineForNode
  | ArticleRefNode
  | AppendixRefNode
  | ClauseInlineRefNode;

// ───────────────────────────── 실물 재현 노드 (기능/문면 §3.2) ─────────────────────────────

/** 정적 표의 열 — 서식은 너비(%)뿐. */
export interface TableColumn {
  width?: number;
}

/**
 * 정적 표의 행 — 제목줄 여부 + 셀. 셀 수 = 열 수.
 * 셀은 **인라인 노드 목록**이다 — 표 안에서도 조·별표 번호를 평문으로 굳히지 않는다 (번호는 계산값 · ADR-0012).
 */
export interface TableRow {
  header?: boolean;
  cells: InlineNode[][];
  /**
   * 셀별 rowSpan — 반복 표 **평가 결과에만** 채운다 (저장 형식 아님). 1 = 병합 없음,
   * n > 1 = 아래 n-1 행과 병합, 0 = 위 셀에 병합됨(그리지 않는다). ADR-0070 결정 6 「바깥 key 열 세로 병합」.
   */
  spans?: number[];
}

/**
 * 표 — 항·호 뒤에 붙는 번호 없는 블록.
 * `repeat` 이 있으면 **행 반복 표**(ADR-0070 결정 6): 머리글이 아닌 행이 템플릿이 되어 문맥 노드에서 `depth` 층 내려간
 * key 조합마다 복제된다 (담보 문서: 1 = 세부보장마다, 2 = 세부보장 › 급부마다). 조합이 0 이면 표를 통째로 생략.
 */
export interface TableNode {
  id: Id;
  kind: "table";
  title?: string;
  columns: TableColumn[];
  rows: TableRow[];
  repeat?: { depth: 1 | 2 };
}

/** 【용어풀이】 박스 — 제목 + 줄 목록. 번호 없음. */
export interface BoxNode {
  id: Id;
  kind: "box";
  title: string;
  lines: string[];
}

/**
 * 글머리 목록의 항목 하나 — 번호 없는 한 줄 문장(인라인: 글 · 슬롯 · 참조 · 문장 안 조건). 항 · 호 · 목 번호 계산에 들지 않는다.
 */
export interface BulletNode {
  id: Id;
  kind: "bullet";
  children: InlineNode[];
}

/**
 * 글머리 목록 — 번호 없는 「- 」 나열 (2026-09-28). 표 · 박스처럼 항 · 호 · 목 뒤와 조 직속에 서는 번호 없는 블록이다.
 * 항목 자리에 조건 블록도 설 수 있다(항목 하나를 조건으로 감싸기). 항목이 하나 이상이어야 한다.
 */
export interface BulletListNode {
  id: Id;
  kind: "bulletList";
  children: (BulletNode | CondBlockNode)[];
}

// ───────────────────────────── 블록 ─────────────────────────────

/** 목. */
export interface SubitemNode {
  id: Id;
  kind: "subitem";
  children: InlineNode[];
}

/** 호. 목은 `subitems` 목록에 (조건 블록도 그 자리에 설 수 있다). */
export interface ItemNode {
  id: Id;
  kind: "item";
  children: InlineNode[];
  subitems?: (SubitemNode | CondBlockNode | BulletListNode)[];
}

/** 항. 호는 `items` 목록에. */
export interface ParagraphNode {
  id: Id;
  kind: "paragraph";
  children: InlineNode[];
  items?: (ItemNode | CondBlockNode | TableNode | BoxNode | BulletListNode | BoxRefNode)[];
}

/** 블록 조건의 가지. */
export interface BlockBranch extends SwitchCaseMark {
  id: Id;
  when?: string;
  children: BlockNode[];
}

/**
 * 블록 조건 — 구조 노드가 서는 자리에 대신 선다 (조 자리면 조 단위 on/off).
 * 가지 안에 올 수 있는 종류 = 이 블록이 서 있는 자리의 허용 집합 (투명). 중첩 허용.
 */
export interface CondBlockNode {
  id: Id;
  kind: "condBlock";
  branches: BlockBranch[];
  /** 있으면 값별 분기 운반체(`SwitchCaseMark`) — 대상 식. */
  switchOn?: string;
}

/** 조건 노드가 값별 분기 운반체인가. */
export function isSwitchCarrier(node: Node): boolean {
  return (node.kind === "condBlock" || node.kind === "inlineCond") && node.switchOn !== undefined;
}

/** 블록 반복 — 자리만 (P7). 항 이하 구조 노드를 품는다. 중첩 금지 (D-P4-16). */
export interface ForBlockNode {
  id: Id;
  kind: "forBlock";
  source: string;
  alias?: string;
  children: BlockNode[];
}

/**
 * 함수조항 블록 참조 — 유형에 맞는 자리에 선다: 「항」은 조 자리(항 목록을 편다), 「호」는 항의 호 목록, 「목」은 호의 목 목록 (최종 결정 4).
 * 조 제목을 품은 함수조항은 없다.
 */
export interface ClauseBlockRefNode {
  id: Id;
  kind: "clauseBlockRef";
  clauseCode: Code;
  options: Record<Code, Code>;
  /** 인자 연결 — 인자 이름 → 연결 (최종 결정 2). 없는 인자는 기본 연결을 쓴다. 비면 키를 싣지 않는다. */
  bindings?: Bindings;
  /** 보통약관의 항 단위 준용·생략 판정에서 이 block 참조가 만든 항을 뺀다. */
  excludeFromComparison?: boolean;
}

/**
 * 박스 참조 — 정적 마스터 박스(기능/박스)의 불변 코드만 저장한다. 조립이 박스 마스터에서 제목 · 줄을 읽어 이 자리에 편다(직접참조).
 * 박스는 잎이라 조 자리 · 항의 호 목록 자리(항 · 호 뒤)에 선다 — 표 · 옛 박스와 같은 자리. 최종 결정 9.
 */
export interface BoxRefNode {
  id: Id;
  kind: "boxRef";
  boxCode: Code;
}

/** 관(款) — 제목 + 조 목록. 조 번호는 관을 넘어 문서 전역 연속이다 (기능/문면 §3.2). */
export interface SectionNode {
  id: Id;
  kind: "section";
  title: string;
  children: (ArticleNode | CondBlockNode)[];
}

/** 조. 메타는 조 명 · 조연결뿐. */
export interface ArticleNode {
  id: Id;
  kind: "article";
  title: string;
  /** 조연결 — 대응 보통약관 조 id (담보약관에서만, 조당 최대 1개 — D-P4-21·22). */
  linkedArticleId?: Id;
  children: BlockNode[];
}

export type BlockNode =
  | SectionNode
  | ArticleNode
  | TableNode
  | BoxNode
  | BulletListNode
  | BulletNode
  | ParagraphNode
  | ItemNode
  | SubitemNode
  | CondBlockNode
  | ForBlockNode
  | ClauseBlockRefNode
  | BoxRefNode;

/** 문서 루트. 자식은 조 · 관 · 조 자리의 조건 블록. */
export interface DocumentNode {
  id: Id;
  kind: "document";
  title: string;
  children: (ArticleNode | SectionNode | CondBlockNode)[];
}

export type Node = DocumentNode | BlockNode | InlineNode;
export type NodeKind = Node["kind"];

// ───────────────────────────── 허용 자식 규칙 ─────────────────────────────

const INLINE: readonly NodeKind[] = ["text", "structKey", "slot", "inlineCond", "inlineFor", "articleRef", "appendixRef", "clauseInlineRef"];

/**
 * 종류별 `children` 자리의 허용 자식. 규칙의 확장(그룹 노드·표)은 여기만 고친다 (ADR-0012).
 * - condBlock 은 **투명** — 서 있는 자리의 허용 집합을 가지에 물려준다 (여기 값은 쓰이지 않는다).
 * - 인라인 조건 안에 인라인 조건 없음, 반복 안에 반복 없음 (인라인 반복 안에는 인라인 조건도 두지 않는다).
 */
export const allowedChildren: Record<NodeKind, readonly NodeKind[]> = {
  document: ["article", "section", "condBlock"],
  section: ["article", "condBlock"],
  article: ["paragraph", "condBlock", "clauseBlockRef", "forBlock", "table", "box", "bulletList", "boxRef"],
  table: [],
  box: [],
  bulletList: ["bullet", "condBlock"],
  bullet: INLINE,
  paragraph: INLINE,
  item: INLINE,
  subitem: INLINE,
  condBlock: [],
  forBlock: ["paragraph", "condBlock", "clauseBlockRef"],
  clauseBlockRef: [],
  boxRef: [],
  text: [],
  structKey: [],
  slot: [],
  inlineCond: INLINE.filter((k) => k !== "inlineCond"),
  inlineFor: INLINE.filter((k) => k !== "inlineFor" && k !== "inlineCond"),
  articleRef: [],
  appendixRef: [],
  clauseInlineRef: [],
};

/** 두 번째 목록 자리 — 항의 호 목록 · 호의 목 목록. 조건 블록도 그 자리에 설 수 있다. */
export const allowedListChildren = {
  // 목록 자리에도 함수조항 참조가 선다 — 「호」 유형은 호 목록, 「목」 유형은 목 목록 (유형 = 출력 모양, 최종 결정 4 · clausePlacement)
  "paragraph.items": ["item", "condBlock", "table", "box", "bulletList", "boxRef", "clauseBlockRef"],
  "item.subitems": ["subitem", "condBlock", "bulletList", "clauseBlockRef"],
} as const satisfies Record<string, readonly NodeKind[]>;

export type SlotName = "children" | "items" | "subitems";

/** 노드 종류가 가진 목록 자리들 (순서 = 렌더 순서). */
export function slotsOf(kind: NodeKind): readonly SlotName[] {
  switch (kind) {
    case "paragraph":
      return ["children", "items"];
    case "item":
      return ["children", "subitems"];
    case "condBlock":
    case "inlineCond":
    case "clauseBlockRef":
    case "text":
    case "structKey":
    case "slot":
    case "articleRef":
    case "appendixRef":
    case "clauseInlineRef":
    case "table":
    case "box":
    case "boxRef":
      return [];
    default:
      return ["children"];
  }
}

/** (부모 종류, 자리) 의 허용 자식. 부모가 그 자리를 갖지 않으면 undefined. */
export function allowedIn(parentKind: NodeKind, slot: SlotName): readonly NodeKind[] | undefined {
  if (slot === "children") return slotsOf(parentKind).includes("children") ? allowedChildren[parentKind] : undefined;
  if (slot === "items") return parentKind === "paragraph" ? allowedListChildren["paragraph.items"] : undefined;
  return parentKind === "item" ? allowedListChildren["item.subitems"] : undefined;
}

/** 노드의 목록 자리를 읽는다 (없으면 undefined). 가지는 별도. */
export function listOf(node: Node, slot: SlotName): Node[] | undefined {
  switch (slot) {
    case "children":
      return "children" in node ? (node.children as Node[]) : undefined;
    case "items":
      return node.kind === "paragraph" ? (node.items as Node[] | undefined) : undefined;
    case "subitems":
      return node.kind === "item" ? (node.subitems as Node[] | undefined) : undefined;
  }
}

/** 표 셀의 인라인 노드 전부 (평탄화). 표가 아니면 빈 배열 — 순회기들이 셀 안을 빠뜨리지 않게 한다. */
export function cellNodesOf(node: Node): InlineNode[] {
  return node.kind === "table" ? node.rows.flatMap((row) => row.cells.flat()) : [];
}

/** 조건 노드(블록·인라인)의 가지 목록. */
export function branchesOf(node: Node): (BlockBranch | InlineBranch)[] | undefined {
  return node.kind === "condBlock" || node.kind === "inlineCond" ? node.branches : undefined;
}

// ───────────────────────────── 색인 ─────────────────────────────

export interface NodeEntry {
  node: Node;
  /** 부모 노드 id 또는 가지 id. 루트는 없음. */
  parentId?: Id;
  slot: SlotName;
  index: number;
  /** 루트부터 자기까지의 id 경로 (가지 id 포함) — Coordinate.nodePath. */
  path: Id[];
  /** 가장 가까운 조 (자기 자신 포함). */
  articleId?: Id;
  /** 이 노드가 실제로 서 있는 자리의 허용 집합 (조건 블록의 투명성을 반영). */
  allowed: readonly NodeKind[];
  /** 조상 중 인라인 조건 · 반복이 있는가 (중첩 금지 검사용). */
  inInlineCond: boolean;
  inFor: boolean;
}

export interface BranchEntry {
  branch: BlockBranch | InlineBranch;
  /** 소유 조건 노드 id. */
  ownerId: Id;
  index: number;
  path: Id[];
  articleId?: Id;
  allowed: readonly NodeKind[];
}

export interface TreeIndex {
  nodes: Map<Id, NodeEntry>;
  branches: Map<Id, BranchEntry>;
  /** 두 번 이상 등장한 id (첫 등장만 색인에 남는다). */
  duplicates: Id[];
  /** 규칙 위반(허용 자식 · 중첩) — 색인하면서 발견한 것. */
  issues: Issue[];
}

interface Frame {
  parentId?: Id;
  slot: SlotName;
  index: number;
  path: Id[];
  articleId?: Id;
  allowed: readonly NodeKind[];
  inInlineCond: boolean;
  inFor: boolean;
}

/**
 * 표 불변식 — 열이 하나 이상 · 행마다 셀 수 = 열 수 · 너비는 1~100 정수 (기능/문면 §3.2).
 * `setTable` 커맨드와 저장 검증(`validateTree`)이 같은 규칙을 쓴다 (2026-09-08 리뷰 4).
 */
export function tableIssues(node: TableNode): string[] {
  const out: string[] = [];
  if (node.columns.length === 0) out.push("표에는 열이 하나 이상 있어야 합니다");
  node.columns.forEach((column, i) => {
    if (column.width === undefined) return;
    if (!Number.isInteger(column.width) || column.width < 1 || column.width > 100) {
      out.push(`${i + 1}번째 열의 너비(${column.width})는 1~100 사이 정수여야 합니다`);
    }
  });
  node.rows.forEach((row, i) => {
    if (row.cells.length !== node.columns.length) out.push(`${i + 1}번째 행의 셀 수(${row.cells.length})가 열 수(${node.columns.length})와 다릅니다`);
  });
  return out;
}

/** 트리를 한 번 훑어 노드·가지 색인과 구조 규칙 위반을 만든다. */
export function indexTree(doc: DocumentNode, base: Coordinate = {}): TreeIndex {
  const nodes = new Map<Id, NodeEntry>();
  const branches = new Map<Id, BranchEntry>();
  const duplicates: Id[] = [];
  const issues: Issue[] = [];
  const titles = new Map<Id, string>();

  const at = (path: Id[], articleId: Id | undefined): Coordinate => ({
    ...base,
    ...(articleId !== undefined ? { articleId, articleTitle: titles.get(articleId) } : {}),
    nodePath: path,
  });
  const structure = (message: string, path: Id[], articleId?: Id) => {
    issues.push({ kind: "structure", message, at: at(path, articleId) });
  };

  const seen = (id: Id, path: Id[], articleId: Id | undefined): boolean => {
    if (nodes.has(id) || branches.has(id)) {
      if (!duplicates.includes(id)) duplicates.push(id);
      structure(`노드 id ${id} 가 트리 안에 두 번 나옵니다`, path, articleId);
      return true;
    }
    return false;
  };

  const visit = (node: Node, f: Frame): void => {
    const path = [...f.path, node.id];
    const articleId = node.kind === "article" ? node.id : f.articleId;
    if (node.kind === "article") titles.set(node.id, node.title);
    if (seen(node.id, path, articleId)) return;

    if (f.parentId !== undefined && !f.allowed.includes(node.kind)) {
      const parentKind = nodes.get(f.parentId)?.node.kind ?? "condBlock";
      structure(`${parentKind} 의 ${f.slot} 자리에 ${node.kind} 은(는) 올 수 없습니다`, path, articleId);
    }
    if (node.kind === "inlineCond" && f.inInlineCond) {
      structure("인라인 조건 안에 인라인 조건을 둘 수 없습니다 — 항을 쪼개 블록 조건으로 푸세요", path, articleId);
    }
    if ((node.kind === "forBlock" || node.kind === "inlineFor") && f.inFor) {
      structure("반복 안에 반복을 둘 수 없습니다 (MVP)", path, articleId);
    }

    nodes.set(node.id, {
      node,
      parentId: f.parentId,
      slot: f.slot,
      index: f.index,
      path,
      articleId,
      allowed: f.allowed,
      inInlineCond: f.inInlineCond,
      inFor: f.inFor,
    });

    const inInlineCond = f.inInlineCond || node.kind === "inlineCond";
    const inFor = f.inFor || node.kind === "forBlock" || node.kind === "inlineFor";

    if (node.kind === "bulletList" && node.children.length === 0) structure("글머리 목록에는 항목이 하나 이상 있어야 합니다", path, articleId);
    if (node.kind === "table") {
      // 표 불변식 — 열이 하나 이상, 행마다 셀 수 = 열 수, 너비는 1~100 정수 (setTable · importTree 공통)
      for (const message of tableIssues(node)) structure(message, path, articleId);
      // 셀의 인라인 노드도 색인한다 — id 유일성·참조 검증이 본문과 같은 규칙으로 걸린다
      node.rows.forEach((row, ri) =>
        row.cells.forEach((cell, ci) =>
          cell.forEach((child, xi) =>
            visit(child, { parentId: node.id, slot: "children", index: xi, path: [...path, `${node.id}-r${ri}c${ci}`], articleId, allowed: INLINE, inInlineCond, inFor }),
          ),
        ),
      );
    }

    const brs = branchesOf(node);
    if (brs !== undefined) {
      if (brs.length === 0) structure("조건 노드에는 가지가 하나 이상 있어야 합니다", path, articleId);
      brs.forEach((br, i) => {
        const bpath = [...path, br.id];
        if (seen(br.id, bpath, articleId)) return;
        if (br.when === undefined && i !== brs.length - 1 && !isSwitchCarrier(node)) {
          structure("else 가지는 마지막에만 올 수 있습니다", path, articleId);
        }
        branches.set(br.id, { branch: br, ownerId: node.id, index: i, path: bpath, articleId, allowed: f.allowed });
        // 가지 안의 허용 집합 = 조건 노드가 서 있는 자리의 허용 집합 (투명)
        (br.children as Node[]).forEach((child, ci) =>
          visit(child, { parentId: br.id, slot: "children", index: ci, path: bpath, articleId, allowed: f.allowed, inInlineCond, inFor }),
        );
      });
      return;
    }

    for (const slot of slotsOf(node.kind)) {
      const list = listOf(node, slot);
      if (!list) continue;
      const allowed = allowedIn(node.kind, slot) ?? [];
      list.forEach((child, ci) =>
        visit(child, { parentId: node.id, slot, index: ci, path, articleId, allowed, inInlineCond, inFor }),
      );
    }
  };

  visit(doc, { slot: "children", index: 0, path: [], allowed: ["document"], inInlineCond: false, inFor: false });
  return { nodes, branches, duplicates, issues };
}

// ───────────────────────────── 검증 ─────────────────────────────

/**
 * 공용조항 게이트 — B2(clause) 가 구현해 주입한다. 없으면 전부 통과.
 * - clauseExists    : 코드가 정의돼 있는가 (없으면 참조 추가 실패 → brokenRef)
 * - requiredCodes   : 그 공용조항이 읽는 요구 구분자 (문서의 요구 구분자 합산 재료 — refs.ts `requiredDiscriminators`)
 * - missingRequired : 요구 구분자 중 **카탈로그에 없는** 코드 — 검사 ② (a) 「요구 구분자가 지금 존재하는가」(기능/함수조항 §3.4).
 *                     비어 있지 않으면 참조 추가 미성립 · 저장 거부 (brokenRef)
 * - validateOptions : 선택 옵션 검사 — 미선택 `optionUnselected`(저장 시점만 거부, 기능/함수조항 §3.2) · 집합 밖 `optionInvalid`
 * - validateBindings: 인자 연결 검사 — 누락 `argUnbound`(저장 시점만 거부) · 타입 불일치 · 없는 인자 (최종 결정 2 · 기능/함수조항 §3.7)
 * requiredCodes · missingRequired 는 사용처 연결(`bindings`)을 받는다 — 사용처가 읽는 구분자 = 본문 직접 읽기 + 실제 연결(사용처 연결 > 기본 연결).
 */
export interface ClauseGate {
  clauseExists(code: Code): boolean;
  /** 함수조항 유형 — 있으면 참조 자리를 유형별로 본다(문구 = 문장 안 · 항 = 조 자리 · 호 = 호 목록 · 목 = 목 목록). */
  clauseMode?(code: Code): ClauseMode | undefined;
  requiredCodes(code: Code, bindings?: Bindings): Code[];
  missingRequired(code: Code, bindings?: Bindings): Code[];
  validateOptions(code: Code, options: Record<Code, Code>): Issue[];
  validateBindings?(code: Code, bindings: Bindings | undefined): Issue[];
}

export const PERMISSIVE_GATE: ClauseGate = {
  clauseExists: () => true,
  requiredCodes: () => [],
  missingRequired: () => [],
  validateOptions: () => [],
};

/** 검증 환경 — 문서 밖의 사실. 주지 않은 항목은 검사하지 않는다. */
export interface TreeEnv {
  /** 문서 종류. general 이면 조연결·보통약관 조 참조가 금지된다 (D-P4-20·22). */
  kind?: "special" | "general";
  /** 대응 보통약관(D-P4-5)의 조 id 집합. 조연결 대상 검증. */
  generalArticleIds?: ReadonlySet<Id>;
  /** 대응 보통약관의 조·항·호·목 id 집합. `scope:'general'` 참조 대상 검증. */
  generalReferenceIds?: ReadonlySet<Id>;
  appendixExists?: (code: Code) => boolean;
  /** 정적 마스터 박스 존재 — 없는 박스를 가리키는 박스 참조는 brokenRef. */
  boxExists?: (code: Code) => boolean;
  clauseGate?: ClauseGate;
  /** 값별 분기(switch) 운반체를 싣는가 — 지금은 함수조항 편집기만 켠다(최종 결정 5 「지금은 함수조항 안에서만」). 없으면 저장 · 넣기 거부. */
  switches?: boolean;
  /** 이슈 좌표의 기본값 (document · ownerId 등). */
  coordinate?: Coordinate;
}

/**
 * 저장 시점 구조 검증 — 허용 자식 · 인라인 조건/반복 중첩 · id 중복 · 가지 규칙 · 참조 대상 존재 · 공용조항 게이트.
 * 식의 문법·타입은 `validateExpressions` (expressions.ts) 가 따로 본다.
 */
export function validateTree(doc: DocumentNode, env: TreeEnv = {}): Issue[] {
  const base = env.coordinate ?? {};
  const ix = indexTree(doc, base);
  const issues = [...ix.issues];

  if (doc.kind !== "document") {
    issues.push({ kind: "structure", message: "루트는 document 노드여야 합니다", at: { ...base, nodePath: [doc.id] } });
  }

  for (const e of ix.nodes.values()) issues.push(...checkNodeRefs(e, ix, env, true));
  return issues;
}

/** 색인 항목의 좌표 (문서 기본 좌표 + 조 + 노드 경로). */
export function coordinateOf(ix: TreeIndex, e: { path: Id[]; articleId?: Id }, base: Coordinate = {}): Coordinate {
  return {
    ...base,
    ...(e.articleId !== undefined
      ? { articleId: e.articleId, articleTitle: (ix.nodes.get(e.articleId)?.node as ArticleNode | undefined)?.title }
      : {}),
    nodePath: e.path,
  };
}

/**
 * 노드 하나의 참조 검사 — 조연결 · 조 참조 · 별표 참조 · 박스 참조 · 공용조항 참조.
 * 참조 추가 시점(`atSave=false`)과 저장 시점(`atSave=true`) 이 같은 함수를 쓴다 (기능/문면 §3.5 — 두 번 검증).
 */
export function checkNodeRefs(e: NodeEntry, ix: TreeIndex, env: TreeEnv, atSave: boolean): Issue[] {
  const n = e.node;
  const at = coordinateOf(ix, e, env.coordinate);
  const gate = env.clauseGate ?? PERMISSIVE_GATE;
  const one = (kind: Issue["kind"], message: string): Issue[] => [{ kind, message, at }];
  switch (n.kind) {
    case "article":
      if (n.linkedArticleId === undefined) return [];
      if (env.kind === "general") return one("structure", "보통약관 문서의 조에는 조연결을 둘 수 없습니다");
      if (env.generalArticleIds && !env.generalArticleIds.has(n.linkedArticleId)) {
        return one("brokenRef", `조연결 대상 조 ${n.linkedArticleId} 가 대응 보통약관에 없습니다`);
      }
      return [];
    case "articleRef":
      if (n.targets.length === 0) return one("structure", "조 참조 슬롯에는 대상이 하나 이상 있어야 합니다");
      if (n.connector === undefined) {
        if (n.targets.length >= 2) return one("structure", CONNECTOR_REQUIRED_MESSAGE);
      } else if (!isReferenceConnector(n.connector)) return one("structure", `조 참조 연결어는 「및」·「또는」 중 하나여야 합니다: ${String(n.connector)}`);
      if (n.scope === "general" && env.kind === "general") return one("structure", "보통약관 문서에서는 보통약관 조 참조를 쓸 수 없습니다");
      return n.targets.flatMap(({ nodeId }) => {
        const target = ix.nodes.get(nodeId)?.node;
        const exists = n.scope === "self"
          ? target !== undefined && ["article", "paragraph", "item", "subitem"].includes(target.kind)
          : !(env.generalReferenceIds ?? env.generalArticleIds) || (env.generalReferenceIds ?? env.generalArticleIds)!.has(nodeId);
        if (exists) return [];
        const message = n.scope === "self"
          ? `참조 대상 ${nodeId} 가 이 문서에 없습니다`
          : `보통약관 참조 대상 ${nodeId} 가 대응 보통약관에 없습니다`;
        return [{ kind: "brokenRef" as const, message, at: { ...at, refPath: nodeId } }];
      });
    case "appendixRef":
      return env.appendixExists && !env.appendixExists(n.appendixCode) ? one("brokenRef", `별표 ${n.appendixCode} 가 별표 마스터에 없습니다`) : [];
    case "boxRef":
      return env.boxExists && !env.boxExists(n.boxCode) ? one("brokenRef", `박스 ${n.boxCode} 가 정적 마스터에 없습니다`) : [];
    case "clauseBlockRef":
    case "clauseInlineRef":
      return [...clausePlacement(n, e.allowed, gate, at), ...checkClauseRef(n, gate, at, atSave)];
    case "condBlock":
    case "inlineCond":
      return n.switchOn !== undefined && !env.switches ? one("structure", "값별 분기는 지금 함수조항 안에서만 쓸 수 있습니다") : [];
    default:
      return [];
  }
}

/** 블록 참조가 선 자리 — 그 자리의 허용 집합으로 안다(조건 블록 가지는 서 있는 자리를 물려받는다). */
function blockSiteOf(allowed: readonly NodeKind[]): Exclude<ClauseMode, "inline"> {
  if (allowed.includes("item")) return "item";
  if (allowed.includes("subitem")) return "subitem";
  return "block";
}

const SITE_RULE: Record<ClauseMode, string> = {
  inline: "「문구」 함수조항은 문장 안에만 둘 수 있습니다",
  block: "「항」 함수조항은 조 자리(항 사이)에만 둘 수 있습니다",
  item: "「호」 함수조항은 항의 호 목록 자리에만 둘 수 있습니다",
  subitem: "「목」 함수조항은 호의 목 목록 자리에만 둘 수 있습니다",
};

/**
 * 함수조항 참조의 자리 — 유형 = 출력 모양 (기능/함수조항 §3.1 · 최종 결정 4): 문구는 문장 안, 항은 조 자리(조 · 반복 블록 · 그 조건 가지),
 * 호는 항의 호 목록, 목은 호의 목 목록. 어긋나면 유형이 요구하는 자리를 말한다.
 */
function clausePlacement(node: ClauseBlockRefNode | ClauseInlineRefNode, allowed: readonly NodeKind[], gate: ClauseGate, at: Coordinate): Issue[] {
  const mode = gate.clauseMode?.(node.clauseCode);
  if (mode === undefined) return [];
  const wrong = (message: string): Issue[] => [{ kind: "structure", message: `함수조항 ${node.clauseCode} — ${message}`, at }];
  if (node.kind === "clauseInlineRef") return mode === "inline" ? [] : wrong("문장 안에는 「문구」 함수조항만 둘 수 있습니다");
  return mode === blockSiteOf(allowed) ? [] : wrong(SITE_RULE[mode]);
}

/**
 * 공용조항 참조 검사 — 검사 ② 「사용처 문맥」(기능/함수조항 §3.4).
 * - (a) 요구 구분자 존재: 카탈로그에 없는 요구 구분자가 있으면 참조 추가 시점(`atSave=false`)·저장 시점 둘 다 brokenRef.
 *   없는 구분자를 삽입해 두고 조립에서야 아는 것은 「붙이는 순간이 가장 싼 발견 시점」에 어긋난다 (기능/함수조항 §3.4).
 *   미입력은 검사하지 않는다 — 그것은 ③ 조립 몫이다.
 * - 옵션: `atSave` 가 false 면(참조 추가 시점) 옵션 미선택은 거르지 않는다 (기능/함수조항 §3.2).
 */
export function checkClauseRef(
  node: ClauseBlockRefNode | ClauseInlineRefNode,
  gate: ClauseGate,
  at: Coordinate,
  atSave: boolean,
): Issue[] {
  if (!gate.clauseExists(node.clauseCode)) {
    return [{ kind: "brokenRef", message: `함수조항 ${node.clauseCode} 가 없습니다`, at }];
  }
  const issues: Issue[] = [];
  const missing = gate.missingRequired(node.clauseCode, node.bindings);
  if (missing.length > 0) {
    const codes = missing.join(" · ");
    const message = `함수조항 ${node.clauseCode} 의 요구 구분자 ${codes} 이(가) 카탈로그에 없습니다${atSave ? "" : " — 참조 추가 미성립"}`;
    issues.push({ kind: "brokenRef", message, at: { ...at, refPath: codes } });
  }
  for (const i of gate.validateOptions(node.clauseCode, node.options)) {
    if (!atSave && i.kind === "optionUnselected") continue;
    issues.push({ ...i, at: { ...at, ...i.at } });
  }
  // 인자 연결 (최종 결정 2) — 누락은 옵션 미선택처럼 저장 시점에만 거부한다(넣는 순간엔 아직 대지 않았다)
  for (const i of gate.validateBindings?.(node.clauseCode, node.bindings) ?? []) {
    if (!atSave && i.kind === "argUnbound") continue;
    issues.push({ ...i, at: { ...at, ...i.at } });
  }
  return issues;
}
