/**
 * 담보 트리 도메인 타입 — 담보 > 세부보장 > 급부 (도메인모델 §1 · 기능/담보 §3.1).
 *
 * - 실체는 **뼈대만** 갖는다: id · 관계(부모) · 순서 · 이름 · 노드 키(세부보장 `01` · 급부 `1` — 문면이 가리키는 정체, ADR-0087). 그 외 입력값은 전부 구분자 값(공용 값 저장소).
 * - 이름은 뼈대 속성 — 스냅샷 비대상, 식에서는 내장 경로 `builtin.<레벨>.name` 으로 읽는다.
 * - 순서(order)는 데이터다 — 형제 배열의 순서 = 문면 수록 순서 = 반복·집계 순회 순서. 0부터 빈틈 없이.
 * - 문면(담보약관) 문서는 B3 document 영역 소유 — 여기에는 `documentId` 자리만 둔다.
 */
import type { Code, Id } from "../types";

export interface Benefit {
  id: Id;
  /** 노드 키 `1` · `2` … — 그 세부보장 안 유일 · 불변 · 순서와 무관 (ADR-0087 결정 2, `keys.ts`). */
  key: string;
  name: string;
  order: number;
}

export interface SubCoverage {
  id: Id;
  /** 노드 키 `01` · `02` … — 담보 안 유일 · 불변 · 순서와 무관 (ADR-0087 결정 2, `keys.ts`). */
  key: string;
  name: string;
  order: number;
  /** order 오름차순. 최소 1개 (최소 구조). */
  benefits: Benefit[];
}

export interface Coverage {
  id: Id;
  /**
   * 담보코드 `COV000001` … — 시스템 채번 · 불변 · 유일 (기능/담보 §3.1, 2026-09-27 · `code.ts`).
   * 저장된 담보는 늘 갖는다. 도메인이 막 지은 트리(`createCoverageTree` · 테스트 픽스처)에는 아직 없다 — 채번은 저장 직전이다.
   */
  code?: Code;
  /** 담보 마스터 전역 유일 (D-P2-2). */
  name: string;
  description: string;
  /** 담보약관 마스터 문서 id (B3 소유). 문면 없는 담보 허용. */
  documentId?: Id;
  /**
   * 담보분류 — 열거형 「담보분류」(E0009)의 값 코드. 필수지만 옛 데이터 · 우회 저장이면 없을 수 있다(조립 `notEntered`).
   * 기본 특약 그룹의 재료다. 뼈대 속성이라 스냅샷 대상이 아니다 — 탑재한 상품은 지금 담보의 담보분류를 따른다 (ADR-0090 · `category.ts`).
   */
  category?: Code;
  /** order 오름차순. 최소 1개 (최소 구조). */
  subCoverages: SubCoverage[];
}

/** 담보 트리의 노드 레벨 — 부착 5레벨 중 담보 트리에 속하는 3개. 값 소유자(ValueOwnerKind)와 이름이 같다. */
export type CoverageNodeLevel = "coverage" | "subCoverage" | "benefit";

export const COVERAGE_NODE_LEVELS: readonly CoverageNodeLevel[] = ["coverage", "subCoverage", "benefit"];

/** 트리 노드 지시자 — 값 소유자 · 부착 소유자 · 삭제 대상을 가리키는 공통 표기. */
export interface CoverageNodeRef {
  level: CoverageNodeLevel;
  id: Id;
}

/** 열거된 노드 — 지시자 + 이름 + 조상 경로 (담보 → 세부보장 → 자기). */
export interface CoverageNode extends CoverageNodeRef {
  name: string;
  /** 자기 자신을 뺀 조상들 (담보부터). 담보 노드면 []. */
  ancestors: CoverageNodeRef[];
  /** 세부보장 `01` · 급부 `01.2`. 담보 뿌리는 없음. */
  keyPath?: string;
}

// ───────────────────────────── 생성 입력 ─────────────────────────────

/** 담보 생성 — 세부보장 1·급부 1 이 함께 태어난다 (D-P2-1). 이름을 안 주면 담보명을 쓴다. */
export interface NewCoverage {
  name: string;
  description?: string;
  subCoverageName?: string;
  benefitName?: string;
  /** 담보분류 값 코드 (ADR-0090) — 주면 서비스가 열거형으로 검사해 함께 저장한다. 생성 화면은 필수로 보낸다. */
  category?: Code;
}

/** 세부보장 추가 — 급부 1 이 함께 태어난다. 급부명을 안 주면 세부보장명을 쓴다. */
export interface NewSubCoverage {
  name: string;
  benefitName?: string;
}

/** id 발급기 — 저장소 uuid. 도메인은 발급 방식을 모른다. */
export type NewId = () => Id;
