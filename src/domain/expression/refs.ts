/**
 * 참조 추출.
 *
 * - `extractRefs` : 식이 읽는 참조 전부 (집계 안의 경로·담보속성·내장 경로·마스터 필드를 구분해서).
 *   문면의 요구 구분자 · 역인덱스 · 구분자 식 검증 · 함수조항 본문 검사(인자 · 직접 읽기 금지, ADR-0076)가 쓴다.
 * - `requiredDiscriminatorCodes` : 구분자 코드 집합 — 문면이 요구하는 것의 단위.
 * - `masterFieldPaths` : 마스터 필드 경로 집합 — 구분자 식이 읽는 입력 항목 (역인덱스 1단).
 *
 * 2026-09-12 — 별칭형 판정(`isAliasExpression`)은 걷었다. 문면이 구분자만 보게 되면서
 * **항등 투영(`구분자 = 폼.필드`)이 필드를 문면에 내는 유일한 길**이 됐기 때문이다 (ADR-0036 §2).
 * 구분자 → 구분자 참조도 기능/구분자 §3.2 가 열었다 — 참조 규칙(레벨 · 자기 참조 · 순환)은 `domain/catalog` 가 본다.
 */

import type { Code } from "../types";
import { refPath } from "./ast";
import type { AggregateOp, Expr, Ref } from "./ast";
import type { ExprType } from "./typecheck";

export interface ExtractedRef {
  ref: Ref;
  /** 코드 기반 경로 문자열 (`refPath(ref)`) */
  path: string;
  /** 집계 인자로 쓰였으면 그 집계. 직접 참조면 없음. */
  aggregate?: AggregateOp;
}

/** 식이 읽는 참조를 등장 순서대로, (경로, 쓰임) 이 같은 것은 한 번만. */
export function extractRefs(expr: Expr): ExtractedRef[] {
  const out: ExtractedRef[] = [];
  const seen = new Set<string>();
  const push = (ref: Ref, aggregate?: AggregateOp) => {
    const path = refPath(ref);
    const key = `${aggregate ?? ""}:${path}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(aggregate === undefined ? { ref, path } : { ref, path, aggregate });
  };
  const walk = (e: Expr): void => {
    switch (e.kind) {
      case "literal":
        return;
      case "ref":
        push(e.ref);
        return;
      case "aggregate":
        push(e.ref, e.op);
        return;
      case "not":
        walk(e.operand);
        return;
      case "compare":
      case "and":
      case "or":
        walk(e.left);
        walk(e.right);
        return;
      case "member":
        walk(e.target);
        return;
      case "call":
        walk(e.target);
        if (e.op === "합치기") push(e.ref);
        return;
    }
  };
  walk(expr);
  return out;
}

/** 요구 구분자 집합 — 구분자 코드만, 중복 없이, 등장 순서대로. 마스터·담보속성·내장 경로는 제외. */
export function requiredDiscriminatorCodes(expr: Expr): Code[] {
  const codes: Code[] = [];
  for (const { ref } of extractRefs(expr)) {
    if (ref.kind === "discriminator" && !codes.includes(ref.code)) codes.push(ref.code);
  }
  return codes;
}

/** 식이 읽는 마스터 필드 경로 — 중복 없이, 등장 순서대로. */
export function masterFieldPaths(expr: Expr): string[] {
  const paths: string[] = [];
  for (const { ref, path } of extractRefs(expr)) {
    if (ref.kind === "master" && !paths.includes(path)) paths.push(path);
  }
  return paths;
}

/** 식이 읽는 인자 이름 — 중복 없이, 등장 순서대로 (함수조항 본문 검사 ① · 연결). */
export function paramNames(expr: Expr): string[] {
  const names: string[] = [];
  for (const { ref } of extractRefs(expr)) {
    if (ref.kind === "param" && !names.includes(ref.name)) names.push(ref.name);
  }
  return names;
}

/** 식이 읽는 내부 변수 이름 — 중복 없이, 등장 순서대로 (앞 이름만 읽기 검사 · 재검사). */
export function localNames(expr: Expr): string[] {
  const names: string[] = [];
  for (const { ref } of extractRefs(expr)) {
    if (ref.kind === "local" && !names.includes(ref.name)) names.push(ref.name);
  }
  return names;
}

/** 열거값 읽기 하나 — 값 나열(`= '값'` · `.있음(값…)`) 또는 필드 읽기(`.필드` · `.거르기(필드 = …)`). */
export interface EnumRead {
  kind: "value" | "field";
  enumCode: Code;
  /** 값 코드(V01) 또는 필드 키(F01). */
  code: Code;
}

/** 함수조항 식의 타입 재료 — 인자 · 내부 변수 선언 타입, 세목 폼 필드 타입. 모르는 것은 건너뛴다(그래프는 깨진 식도 견딘다). */
export interface EnumReadTypes {
  params?: (name: string) => ExprType | undefined;
  locals?: (name: string) => ExprType | undefined;
  planField?: (form: string, field: string) => ExprType | undefined;
  /** 구분자 · 마스터 필드 참조의 타입 (문면 식 · 구분자 식). */
  resolve?: (ref: Ref) => ExprType | undefined;
}

function enumCodeOf(t: ExprType | undefined): Code | undefined {
  return t && (t.kind === "enum" || t.kind === "list<enum>") ? t.enumCode : undefined;
}

/**
 * 관대한 타입 추론 — 검사가 아니다(모르면 undefined). 참조 그래프 · 내부 변수 타입 쌓기가 쓴다.
 * 필드 읽기는 필드 타입을 모르므로 undefined(열거값 간선 재료가 아니다).
 */
export function inferType(e: Expr, types: EnumReadTypes): ExprType | undefined {
  switch (e.kind) {
    case "literal":
      return { kind: e.literal.type };
    case "ref":
      if (e.ref.kind === "param") return types.params?.(e.ref.name);
      if (e.ref.kind === "local") return types.locals?.(e.ref.name);
      return types.resolve?.(e.ref);
    case "call":
      if (e.op === "합치기") {
        const code = enumCodeOf(types.planField?.(e.ref.form, e.ref.field));
        return code === undefined ? undefined : { kind: "list<enum>", enumCode: code };
      }
      if (e.op === "거르기") return inferType(e.target, types);
      return { kind: "boolean" };
    case "compare":
    case "and":
    case "or":
    case "not":
      return { kind: "boolean" };
    default:
      return undefined;
  }
}

/**
 * 식이 읽는 열거값 · 열거값 필드 — 참조 그래프가 간선으로 만든다 (ADR-0078 결정 2 · 4: 필드 삭제 · 변경 재검사, 값 추가 재검사).
 * 타입은 관대하게 추론한다(검사가 아니다) — 필드를 지운 뒤에도 읽는 곳이 간선으로 남아야 영향이 선다. 등장 순.
 */
export function enumReads(expr: Expr, types: EnumReadTypes): EnumRead[] {
  const out: EnumRead[] = [];
  const typeOf = (e: Expr) => inferType(e, types);
  const walk = (e: Expr): void => {
    switch (e.kind) {
      case "compare": {
        if (e.op === "=" || e.op === "≠") {
          for (const [a, b] of [
            [e.left, e.right],
            [e.right, e.left],
          ] as const) {
            if (b.kind !== "literal" || b.literal.type !== "string") continue;
            const code = enumCodeOf(typeOf(a));
            if (code !== undefined) out.push({ kind: "value", enumCode: code, code: b.literal.value });
          }
        }
        walk(e.left);
        walk(e.right);
        return;
      }
      case "and":
      case "or":
        walk(e.left);
        walk(e.right);
        return;
      case "not":
        walk(e.operand);
        return;
      case "member": {
        walk(e.target);
        const code = enumCodeOf(typeOf(e.target));
        if (code !== undefined) out.push({ kind: "field", enumCode: code, code: e.field });
        return;
      }
      case "call": {
        walk(e.target);
        const code = enumCodeOf(typeOf(e.target));
        if (code === undefined) return;
        if (e.op === "있음") for (const v of e.values) out.push({ kind: "value", enumCode: code, code: v });
        if (e.op === "거르기") out.push({ kind: "field", enumCode: code, code: e.field });
        return;
      }
      default:
        return;
    }
  };
  walk(expr);
  return out;
}
