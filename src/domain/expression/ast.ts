/**
 * 식 언어 AST — 문면 조건식과 파생식이 공유하는 한 벌 (ADR-0013).
 *
 * 문법 정본: docs/공통/기술/식언어.md. 여기에는 타입만 있다 (로직 없음).
 * 저장되는 식은 코드 기반 소스 문자열이고, AST 는 파서의 산출물이다.
 */

import type { AttachLevel, Code } from "../types";

// ───────────────────────────── 참조 ─────────────────────────────

/** 노드 한정자 — 구분자를 문맥 담보가 아니라 **이 노드** 문맥에서 평가한다 (ADR-0066 §1). id 는 담보 마스터 노드 id. */
export interface NodeQualifier {
  id: string;
}

/**
 * 구분자 참조 — `<구분자코드>` 한 마디. 구분자는 식 하나라 필드가 없다 (ADR-0037).
 * 요구 구분자의 단위가 이것이다. **문면(조건식·반복·슬롯)이 쓰는 유일한 값 참조**다.
 */
export interface DiscriminatorRef {
  kind: "discriminator";
  code: Code;
  /** 소스 표기 `<코드>@<노드id>`. 없으면 문맥 담보 문맥. */
  node?: NodeQualifier;
}

/**
 * 마스터 필드 참조 — 소스 표기 `폼키.필드키` (기능/마스터 §3.2). 예: `waiver.applies` · `pay.rate`.
 * 구분자 식의 값 참조 — 다른 구분자와 함께 (기능/구분자 §3.2). 폼의 레벨이 곧 순회 범위다 (기능/구분자 §3.2).
 * 언어는 마스터의 내용을 모른다 — 존재 · 레벨은 검증기(domain/catalog/expression)와 문맥이 안다.
 */
export interface MasterRef {
  kind: "master";
  form: Code;
  field: Code;
}

/**
 * 내장 경로 — 뼈대 속성 (기능/담보 §3.1 이름 · 기능/구분자 §3.2 내장 경로). 소스 표기 `builtin.<레벨>.<속성>`.
 * 예: `builtin.subCoverage.name` (세부보장 이름) · `builtin.benefit.name` (급부 이름).
 * 속성 코드는 파서가 제한하지 않는다 — 타입 조회(TypeResolver)와 문맥이 안다.
 */
export interface BuiltinRef {
  kind: "builtin";
  level: AttachLevel;
  prop: string;
}

/** 담보속성 참조 — `attr.<속성종류코드>` (ADR-0015). exist · = · ≠ 에서만 쓸 수 있다. */
export interface AttributeRef {
  kind: "attr";
  code: Code;
}

/**
 * 인자 참조 — 소스 표기 `arg.<이름>` (최종 결정 2 · 기능/식언어 §인자). 함수조항 본문만 쓴다 — 조항이 선언한 입력을 이름으로 읽는다.
 * 값은 사용처의 인자 연결(구분자 · 상수)이 정하고, 조립은 펼칠 때 연결로 바꿔 쓴다(`clause/bind.ts`) — 평가기는 인자를 모른다.
 * 타입 검사는 문맥 플래그(`CheckOptions.params`)가 있을 때만 푼다 — 구분자 식 · 문면 식으로 새지 않게 (경계).
 */
export interface ParamRef {
  kind: "param";
  name: string;
}

/** 값 자리를 갖는 참조 (담보속성 · 인자 제외). 문맥의 lookup/children 이 받는 것. */
export type ValueRef = DiscriminatorRef | MasterRef | BuiltinRef;

export type Ref = ValueRef | AttributeRef | ParamRef;

// ───────────────────────────── 리터럴 ─────────────────────────────

export type Literal =
  | { type: "string"; value: string }
  | { type: "number"; value: number }
  | { type: "boolean"; value: boolean }
  /** `d'YYYY-MM-DD'` — 값은 그 문자열 그대로 (types.ts 의 date 표현과 동일) */
  | { type: "date"; value: string };

// ───────────────────────────── 연산 ─────────────────────────────

/** 비교 연산. 소스의 `!=` 는 `≠` 로 정규화한다. */
export type CompareOp = "=" | "≠" | "<" | "<=" | ">" | ">=";

export const COMPARE_OPS: readonly CompareOp[] = ["=", "≠", "<", "<=", ">", ">="];

/** 집계 6종 (기능/구분자 §3.2). `notexist` 는 소스에서 한 단어다. */
export type AggregateOp = "any" | "all" | "sum" | "count" | "exist" | "notexist";

export const AGGREGATE_OPS: readonly AggregateOp[] = [
  "any",
  "all",
  "sum",
  "count",
  "exist",
  "notexist",
];

// ───────────────────────────── 노드 ─────────────────────────────

export type Expr =
  | { kind: "literal"; literal: Literal }
  | { kind: "ref"; ref: Ref }
  | { kind: "compare"; op: CompareOp; left: Expr; right: Expr }
  | { kind: "and"; left: Expr; right: Expr }
  | { kind: "or"; left: Expr; right: Expr }
  | { kind: "not"; operand: Expr }
  /**
   * 집계. `ref` 는 집계 경로 — 값 참조(any·all·sum·count·exist·notexist)
   * 또는 담보속성(exist·notexist 만). 범위(하위 트리)는 문맥이 정한다.
   */
  | { kind: "aggregate"; op: AggregateOp; ref: Ref };

export type ExprKind = Expr["kind"];

// ───────────────────────────── 경로 문자열 ─────────────────────────────

/** 참조를 소스 표기(코드 기반 경로)로. `Coordinate.refPath` 에 넣는 문자열이 이것이다. */
export function refPath(ref: Ref): string {
  switch (ref.kind) {
    case "discriminator":
      return ref.node ? `${ref.code}@${ref.node.id}` : ref.code;
    case "master":
      return `${ref.form}.${ref.field}`;
    case "builtin":
      return `builtin.${ref.level}.${ref.prop}`;
    case "attr":
      return `attr.${ref.code}`;
    case "param":
      return `arg.${ref.name}`;
  }
}

/** 두 참조가 같은 자리를 가리키는가 (경로 동치). */
export function sameRef(a: Ref, b: Ref): boolean {
  return refPath(a) === refPath(b);
}
