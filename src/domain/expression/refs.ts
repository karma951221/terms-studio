/**
 * 참조 추출.
 *
 * - `extractRefs` : 식이 읽는 참조 전부 (집계 안의 경로·담보속성·내장 경로·마스터 필드를 구분해서).
 *   공용조항의 요구 구분자 자동 추출(ADR-0010)·역인덱스·구분자 식 검증이 쓴다.
 * - `requiredDiscriminatorCodes` : 구분자 코드 집합 — 문면이 요구하는 것의 단위 (ADR-0010).
 * - `masterFieldPaths` : 마스터 필드 경로 집합 — 구분자 식이 읽는 입력 항목 (역인덱스 1단).
 *
 * 2026-09-12 — 별칭형 판정(`isAliasExpression`)은 걷었다. 문면이 구분자만 보게 되면서
 * **항등 투영(`구분자 = 폼.필드`)이 필드를 문면에 내는 유일한 길**이 됐기 때문이다 (ADR-0036 §2).
 * 구분자 → 구분자 참조도 기능/구분자 §3.2 가 열었다 — 참조 규칙(레벨 · 자기 참조 · 순환)은 `domain/catalog` 가 본다.
 */

import type { Code } from "../types";
import { refPath } from "./ast";
import type { AggregateOp, Expr, Ref } from "./ast";

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
