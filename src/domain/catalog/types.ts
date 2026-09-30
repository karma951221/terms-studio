/**
 * 구분자 카탈로그 도메인 타입 (값의 체계 2층).
 *
 * 근거: docs/기능/구분자/구분자.md §3.1 · §3.2 · ADR-0005 · ADR-0036 · ADR-0037.
 *
 * **구분자는 식 하나다.** 종류(scalar · struct · const · derived)는 없다 —
 * 필드를 그대로 잇든(`담보명 = coverage_basic.claim_name`) 계산하든(`면책구분 = any(pay.exempt)`)
 * 같은 자리에 쓰고, 결과 타입은 식에서 나온다.
 *
 * 구분자는 **값 행을 갖지 않는다.** 값 자리는 노드 × 마스터 필드고 (domain/master),
 * 구분자의 부착 레벨은 「식이 평가되는 자리 = 집계의 뿌리」다.
 *
 * 코드는 시스템 채번 · 불변 — 생성 입력(New*)에는 code 필드가 없다 (타입으로 강제).
 */
import type { AttachLevel, Code, FieldType } from "../types";

/**
 * 구분자 결과 타입으로 쓸 수 있는 타입 (기능/구분자 §3.1) —
 * string · number · boolean · date · enum · list<enum>. `table` 은 값 자리 전용이라 뺀다.
 */
export type DiscriminatorResultType = Exclude<FieldType, { kind: "table" }>;

export interface Discriminator {
  /** 자동 채번 코드 (`D0001`). 불변. 문면이 참조하는 이름이다. */
  code: Code;
  /** 표시명. 언제든 변경 가능. 문면이 묻는 개념으로 딴다. */
  label: string;
  /** 식이 평가되는 자리 = 집계 범위의 뿌리 (기능/구분자 §3.2). */
  level: AttachLevel;
  /** 식 원문 (코드 기반 경로). 파싱·검증은 expression 모듈 + `checkDiscriminatorExpression`. */
  expression: string;
  description: string;
  /** 명시 결과 타입 (기능/구분자 §3.1). 없으면 미지정 — 추론 타입만 쓴다(과도기). */
  resultType?: DiscriminatorResultType;
}

/** enum 정의 — enum 자체도 코드+표시명 (D-P1-7). */
export interface EnumDef {
  code: Code;
  label: string;
  description?: string;
  /**
   * 유저 정의 필드 (ADR-0078 결정 2) — 값마다 채우는 사실(약관표시명 · 면책여부 …). 순서대로.
   * **없으면 필드 없음** — 빈 목록은 저장 · 조립 스냅샷에 싣지 않는다(키를 뺀다).
   */
  fields?: EnumFieldDef[];
  /** 선택지 표시 순서대로. */
  values: EnumValueDef[];
}

/** 열거형 필드 타입 — 우선 문자열 · 참거짓 둘 (ADR-0078 결정 2). */
export const ENUM_FIELD_TYPES = ["string", "boolean"] as const;
export type EnumFieldType = (typeof ENUM_FIELD_TYPES)[number];
/** 필드 타입의 사람 말 — 화면 · 확인창 · 오류가 같은 낱말을 쓴다 (마스터 필드 타입 「참거짓」과 같은 말). */
export const ENUM_FIELD_TYPE_LABEL: Record<EnumFieldType, string> = { string: "문자열", boolean: "참거짓" };

/** 열거형 필드 정의. `key` 는 그 열거형 안에서 자동 채번(`F01`) · 불변 — 이름은 언제든 바꾼다 (ADR-0005). */
export interface EnumFieldDef {
  key: Code;
  label: string;
  type: EnumFieldType;
  order: number;
}

export type EnumFieldValue = string | boolean;

export interface EnumValueDef {
  code: Code;
  label: string;
  order: number;
  /** 필드 코드 → 값. **키 없음 = 미입력**(빈 칸). 없으면 모든 필드가 미입력. */
  fields?: Record<Code, EnumFieldValue>;
}

// ───────────────────────────── 생성 입력 (code 없음) ─────────────────────────────

export interface NewDiscriminator {
  label: string;
  level: AttachLevel;
  expression: string;
  description?: string;
  /** 명시 결과 타입 (기능/구분자 §3.1). 없으면 미지정 — 추론 타입만 쓴다(과도기). */
  resultType?: DiscriminatorResultType;
}

export interface NewEnumValue {
  label: string;
}

export interface NewEnum {
  label: string;
  description?: string;
  values?: NewEnumValue[];
}

// ───────────────────────────── 조회 인터페이스 ─────────────────────────────

/** enum 코드 → 정의. 없으면 undefined. */
export type EnumLookup = (enumCode: Code) => EnumDef | undefined;

/** 값 자리 경로 = 마스터 필드 경로 (`waiver.applies`). 구분자 식의 참조 경로와 같다. */
export type SlotPath = string;
