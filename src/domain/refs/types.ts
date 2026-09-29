/**
 * 참조 그래프 타입 (순수) — 기능/관계정보 §3 「참조 그래프」.
 *
 * - 노드 = 실체. 구분자·마스터 필드·enum·enum 값·공용조항·옵션·선택지·문서·조·별표·담보 노드·담보속성·유효값·상품·상품담보.
 *   키는 `nodeKey()` 로 문자열화한다 (`discriminator:D0001` · `masterField:waiver.applies` · `article:<docId>/<articleId>` …).
 * - **2단 역인덱스** (기능/관계정보 §3 「다른 기능이 쓰는 질의」 · 기능/마스터 §4.3): 마스터 필드 → 구분자(`expression`) → 문면(`when`·`slot`).
 * - 간선 = 참조. 「무엇이(from) 무엇을(to) 어떤 형태로(via) 읽는가」 + 좌표(`Coordinate`).
 *   대상이 선언되지 않은 간선 = 깨진 참조 (삭제 후 남은 오류 상태).
 * - 포함 관계(enum 값 ⊂ enum · 옵션 ⊂ 공용조항 · 조 ⊂ 문서 · 유효값 ⊂ 종류 · 급부 ⊂ 세부보장 ⊂ 담보)는
 *   `RefNodeInfo.parent` 와 키 구조(`structuralParent`)로 안다.
 *
 * DB·React import 금지 (순수층).
 */
import type { Bindings } from "../clause/params";
import type { Discriminator, EnumDef } from "../catalog/types";
import type { Clause } from "../clause/types";
import type { CoverageNodeLevel, Coverage } from "../coverage/types";
import type { Appendix } from "../document/appendix";
import type { Box } from "../document/box";
import type { DocumentNode } from "../document/nodes";
import type { AggregateOp } from "../expression";
import type { MasterTree } from "../master";
import type { AttributeKind, ClauseOptionOverride, ProductCoverage } from "../product/types";
import type { AttachLevel, Code, Coordinate, Id } from "../types";

// ───────────────────────────── 노드 ─────────────────────────────

export type RefNodeKey =
  | { kind: "discriminator"; code: Code }
  /** 입력 마스터의 값 자리 — 코드에 사는 실체 (ADR-0037). `path` 가 곧 코드다. */
  | { kind: "masterField"; path: string }
  | { kind: "enum"; enumCode: Code }
  | { kind: "enumValue"; enumCode: Code; valueCode: Code }
  /** 열거형 유저 정의 필드 (ADR-0078 결정 2). 읽는 간선(함수조항 내부 변수 · 슬롯)은 함수조항 인자 · 내부 변수가 들어올 때 붙는다 */
  | { kind: "enumField"; enumCode: Code; key: Code }
  | { kind: "clause"; code: Code }
  | { kind: "clauseOption"; clauseCode: Code; optionCode: Code }
  | { kind: "clauseOptionValue"; clauseCode: Code; optionCode: Code; valueCode: Code }
  | { kind: "document"; id: Id }
  | { kind: "article"; documentId: Id; articleId: Id }
  | { kind: "appendix"; code: Code }
  /** 정적 마스터 박스 (최종 결정 9). */
  | { kind: "box"; code: Code }
  | { kind: "coverageNode"; level: CoverageNodeLevel; id: Id }
  | { kind: "attribute"; code: Code }
  | { kind: "attributeValue"; code: Code; valueCode: Code }
  | { kind: "product"; id: Id }
  | { kind: "productCoverage"; id: Id }
  /** 그래프가 따로 모델링하지 않는 값 소유 실체 (세목 선택지 · 스냅샷 노드 등). */
  | { kind: "entity"; entityKind: string; id: Id };

export type RefNodeKind = RefNodeKey["kind"];

/** 선언된 실체의 정보. */
export interface RefNodeInfo {
  key: RefNodeKey;
  label: string;
  /** 포함 관계의 상위 실체. */
  parent?: RefNodeKey;
  /** 구분자·마스터 필드의 레벨. */
  level?: AttachLevel;
  /** 종류 세부 — 마스터 필드 타입(boolean · enum …) · 문서 kind(special·general) 등. */
  detail?: string;
  /** 문서 노드의 소유 실체 id (담보약관 = 담보 id · 보통약관 = 문서 id). */
  ownerId?: Id;
}

// ───────────────────────────── 간선 ─────────────────────────────

/** 참조의 형태. */
export type EdgeVia =
  /** 조건식(`when`) 안의 참조 — 문서·공용조항 본문 */
  | "when"
  /** 슬롯(`slot.ref`) 참조 — 문서·공용조항 본문 */
  | "slot"
  /** 구분자 식 안의 참조 (구분자 → 마스터 필드) */
  | "expression"
  /** 구분자 참조의 노드 한정자 `D@노드` → 담보 노드 (ADR-0066). 구분자 간선(when·slot·expression)과 나란히 난다 */
  | "nodeQualifier"
  /** 문서 → 공용조항 참조 노드 */
  | "clauseRef"
  /** 문서의 공용조항 참조 노드가 고른 옵션 선택지 (마스터 기본 선택) */
  | "optionSelect"
  /** 상품·상품담보의 옵션 오버라이드 (기능/상품 §3.6) */
  | "override"
  /** 조 참조 슬롯 (self · general) */
  | "articleRef"
  /** 조연결 (담보약관 조 → 보통약관 조) */
  | "link"
  /** 별표 참조 슬롯 */
  | "appendixRef"
  /** 박스 참조 — 정적 마스터 박스를 그 자리에 편다 */
  | "boxRef"
  /** 함수조항 → 구분자 — 인자의 기본 연결 (최종 결정 2). 그 구분자를 지우면 정의가 깨진다 */
  | "defaultBinding"
  /** 문서(조) → 구분자 — 함수조항 참조 노드의 인자 연결 (사용처가 기본 연결을 바꿈) */
  | "binding"
  /** 담보약관 → 대응 보통약관 · 상품 → 보통약관 템플릿 */
  | "generalDocument"
  /** 담보 마스터 → 담보약관 문서 */
  | "document"
  /** 마스터 필드 → enum (타입) */
  | "type"
  /** 상품담보 → 담보 마스터 (탑재) */
  | "mount"
  /** 상품담보 → 담보속성 유효값 (조합) */
  | "combination";

export interface RefEdge {
  from: RefNodeKey;
  to: RefNodeKey;
  via: EdgeVia;
  /** 참조가 있는 자리의 좌표 (아는 만큼). */
  at: Coordinate;
  /** 집계 인자로 읽었으면 그 집계 (파생식·조건식). */
  aggregate?: AggregateOp;
  /** clauseRef — 참조 노드의 옵션 선택. */
  options?: Record<Code, Code>;
  /** clauseRef — 참조 노드의 인자 연결(없으면 기본 연결). binding · defaultBinding — 그 인자 이름은 `param`. */
  bindings?: Bindings;
  /** binding · defaultBinding — 연결한 인자 이름. */
  param?: string;
  /** override — 오버라이드가 매달린 문서 쪽 노드(조 또는 문서). */
  through?: RefNodeKey;
}

// ───────────────────────────── 그래프 ─────────────────────────────

export interface RefGraph {
  /** 선언된 실체. 키 = nodeKey. */
  nodes: Map<string, RefNodeInfo>;
  /** 등장 순. */
  edges: RefEdge[];
}

// ───────────────────────────── 입력 ─────────────────────────────

export interface DocumentInput {
  id: Id;
  kind: "special" | "general";
  /** special 의 담보 id. */
  ownerId?: Id;
  title: string;
  generalDocumentId?: Id;
  tree: DocumentNode;
}

export interface ProductInput {
  id: Id;
  name: string;
  generalDocumentId?: Id;
  coverages: readonly ProductCoverage[];
  overrides: readonly ClauseOptionOverride[];
}

/** 주지 않은 종류는 「선언된 실체 없음」 — 그쪽으로 가는 간선은 깨진 것으로 본다. */
export interface GraphInputs {
  discriminators?: readonly Discriminator[];
  enums?: readonly EnumDef[];
  clauses?: readonly Clause[];
  documents?: readonly DocumentInput[];
  appendices?: readonly Appendix[];
  boxes?: readonly Box[];
  coverages?: readonly Coverage[];
  attributeKinds?: readonly AttributeKind[];
  products?: readonly ProductInput[];
  /** 값 자리를 정하는 마스터 트리 (ADR-0037). 없으면 MVP 정본. */
  master?: MasterTree;
}
