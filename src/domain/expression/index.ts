/**
 * 식 언어(expression) 모듈 — 문면 조건식과 파생식이 공유하는 한 벌 (ADR-0013).
 *
 * 문법 정본: docs/공통/기술/식언어.md
 *
 *   parse(src)                      소스 → AST (문법 오류는 Rejection invalid/syntax)
 *   format(expr, displayName?)      AST → 소스 (표시명 훅; parse∘format 동치)
 *   extractRefs(expr)               읽는 참조 전부 (집계·담보속성·내장 구분)
 *   requiredDiscriminatorCodes(expr) 요구 구분자 코드 집합
 *   masterFieldPaths(expr)          마스터 필드 경로 집합 (역인덱스 1단)
 *   checkTypes / checkCondition     타입 검사 (타입 조회 주입)
 *   evaluate(expr, ctx)             평가 (문맥 주입) → 값 | 미결 | 오류
 *
 * DB·React import 금지 (순수층).
 */

export type {
  AggregateOp,
  AttributeRef,
  BuiltinRef,
  CompareOp,
  DiscriminatorRef,
  Expr,
  ExprKind,
  CallExpr,
  Literal,
  LocalRef,
  MasterRef,
  MethodOp,
  NodeQualifier,
  ParamRef,
  Ref,
  ValueRef,
} from "./ast";
export { AGGREGATE_OPS, COMPARE_OPS, METHOD_OPS, refPath, sameRef } from "./ast";

export { parse, RESERVED_WORDS } from "./parser";

export type { DisplayName, MemberName } from "./format";
export { format, formatLiteral } from "./format";

export type { EnumRead, EnumReadTypes, ExtractedRef } from "./refs";
export { enumReads, extractRefs, inferType, localNames, masterFieldPaths, paramNames, requiredDiscriminatorCodes } from "./refs";

export type { CheckOptions, EnumInfo, ExprType, LocalTypes, ParamTypes, TypeResolver } from "./typecheck";
export { checkCondition, checkTypes } from "./typecheck";

export type { AttributeResult, EvalContext, EvalResult, LookupResult } from "./evaluate";
export { evaluate } from "./evaluate";
