/**
 * 조건 팝업 문맥 — 서버가 만들어 클라이언트로 넘기는 직렬화 가능 자료 (ADR-0066 §4~§7).
 *
 * `buildConditionContext`(conditionContext.ts, 서버 전용)가 만들고 조건 머리 줄(`CondRows`)·슬롯 트리
 * (클라이언트)가 그대로 소비한다 — props 로 서버 → 클라이언트를 건너가므로 함수·Map·Date 는 담지 않는다.
 */
import type { CoverageNodeLevel } from "@/domain/coverage";
import type { AttachLevel, Code, FieldType, Id } from "@/domain/types";

/** 담보 트리 노드 하나 — 트리 탭이 그리는 자리. */
export interface CtxNode {
  id: Id;
  level: CoverageNodeLevel;
  name: string;
  /** 담보 노드(뿌리)면 없음. */
  parentId?: Id;
}

/** 구분자 하나 — 좌변 칩 · 트리 잎 · 구분자 목록에 쓴다. */
export interface CtxDiscriminator {
  code: Code;
  label: string;
  level: AttachLevel;
  type?: FieldType;
  enumOptions?: { code: Code; label: string }[];
  /** 이 구분자가 (구분자 참조를 타고) 읽는 폼 키 — 「항상 거짓」 경고의 재료. */
  forms: Code[];
}

/** 담보속성 하나 — 조건 머리 줄의 「담보속성」 묶음 (`attr.X` — 있음 · 없음 · = · ≠, 기능/문면 §3.3). */
export interface CtxAttribute {
  code: Code;
  label: string;
  /** 유효값 — 코드(식에 쓰는 값) · 이름(화면). */
  values: { code: Code; label: string }[];
}

/** 빠른 조건 — 트리를 뒤지지 않고 한 번에 넣는 자주 쓰는 식. */
export interface QuickCondition {
  label: string;
  source: string;
}

export interface ConditionContext {
  /** 담보 약관이면 문맥 담보. 보통약관은 없음 → 트리 탭 없음. */
  coverage?: { id: Id; name: string; nodes: CtxNode[] };
  discriminators: CtxDiscriminator[];
  /** 담보속성 — 조건식의 `attr.X` 좌변 후보. 없으면 묶음이 없다. */
  attributes?: CtxAttribute[];
  /** 노드 id → 자신 또는 후손에 값이 든(열린) 여는 폼 키 — 배지 · 「항상 거짓」 경고. */
  openedForms: Record<Id, Code[]>;
  quick: QuickCondition[];
  /**
   * 반복 표 템플릿 셀 안에서 열었을 때만 — 행 레벨 사슬(`levels`, 바깥 → 안쪽)과 한정자 없이 읽을 수 있는 레벨(`readable`).
   * 트리 맨 위 「현재 행」 가지의 재료다 (ADR-0070 · 설계 §3.1). 반복 밖이면 없음 → 트리는 지금과 같다.
   */
  row?: { levels: Exclude<AttachLevel, "product">[]; readable: AttachLevel[] };
}
