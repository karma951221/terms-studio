/**
 * 문서 전체 저장 검증 한 벌 — 서버의 저장과 브라우저 편집본의 「템플릿 전체」 검증 목록이 같은 함수를 쓴다 (ADR-0074).
 *
 * 구조(허용 자식 · 중첩 · id · 가지) · 참조 대상 · 함수조항(`validateTree`) + 식(문법 · boolean · 구분자만 · `@노드`) · 반복 표 오류
 * (`validateExpressions`) + 반복 표 경고. 경고(`severity: "warning"`)는 저장을 막지 않는다 — `blockingIssues` 로 거른다.
 *
 * 검증 재료(함수조항 게이트 · 식 타입 조회)도 여기서 만든다 — 서버는 DB 에서 읽은 정의로, 브라우저는 서버가 넘긴 같은 정의로.
 */
import { discriminatorResultType, type Discriminator } from "../catalog";
import { boundDiscriminators, checkUsageBindings, validateOptionSelection, type BindingEnv, type Clause } from "../clause";
import type { EnumDef } from "../catalog/types";
import { definitionCrossCheck, valueBranchWarnings } from "./blockRepeat";
import type { ExprType, TypeResolver } from "../expression";
import type { Code, Issue } from "../types";
import { validateExpressions, type ExpressionScope } from "./expressions";
import { validateTree, type ClauseGate, type DocumentNode, type TreeEnv } from "./nodes";
import { repeatTableIssues } from "./repeat";

/**
 * 카탈로그 정의로 식 타입 조회를 만든다.
 * **문면은 구분자만 본다** (ADR-0037) — 마스터 필드 직접 참조는 타입이 없어 brokenRef 로 걸린다.
 * 구분자의 결과 타입은 명시 타입이 있으면 그것, 없으면 식에서 추론한다 (`discriminatorResultType`, 기능/구분자 §3.1, 코드마다 한 번만).
 * `attributeValues` 를 주면 담보속성(`attr.X`)의 유효값까지 — 없는 담보속성은 깨진 참조. 안 주면 「담보속성 타입(유효값 모름)」.
 */
export function catalogTypeResolver(defs: readonly Discriminator[], attributeValues?: (kindCode: Code) => readonly Code[] | undefined): TypeResolver {
  const byCode: ReadonlyMap<Code, Discriminator> = new Map(defs.map((d) => [d.code, d]));
  const cache = new Map<Code, ExprType | undefined>();
  return (ref) => {
    switch (ref.kind) {
      case "attr": {
        if (!attributeValues) return { kind: "attribute" };
        const values = attributeValues(ref.code);
        return values ? { kind: "attribute", validValues: [...values] } : undefined;
      }
      case "builtin":
        return { kind: "string" };
      case "master":
        return undefined;
      case "discriminator": {
        if (cache.has(ref.code)) return cache.get(ref.code);
        const def = byCode.get(ref.code);
        const type = def ? discriminatorResultType(def, undefined, byCode) : undefined;
        cache.set(ref.code, type);
        return type;
      }
    }
  };
}

/**
 * 함수조항 게이트 — 정의 존재 · 요구 구분자 · 옵션 선택 · 인자 연결 검증 (기능/함수조항 §3.2 · §3.7).
 * `missingRequired` 는 사용처가 읽는 구분자(본문 직접 읽기 + 실제 연결)를 카탈로그 코드와 대조한다 (기능/함수조항 §3.4).
 * `resolve` 를 주면 연결 구분자의 타입까지 본다(없으면 누락 · 없는 인자만).
 */
export function clauseGateFrom(clauses: readonly Clause[], catalogCodes: Iterable<Code>, resolve?: TypeResolver, enums?: readonly EnumDef[]): ClauseGate {
  const byCode = new Map(clauses.map((c) => [c.code, c]));
  const enumValues = enums ? new Map(enums.map((e) => [e.code, e.values.map((v) => v.code)])) : undefined;
  const catalog = new Set(catalogCodes);
  const required = (code: Code, bindings?: Parameters<ClauseGate["requiredCodes"]>[1]) => {
    const clause = byCode.get(code);
    return clause ? boundDiscriminators(clause, bindings) : [];
  };
  return {
    clauseExists: (code) => byCode.has(code),
    clauseMode: (code) => byCode.get(code)?.mode,
    requiredCodes: required,
    missingRequired: (code, bindings) => required(code, bindings).filter((d) => !catalog.has(d)),
    validateOptions: (code, options) => {
      const clause = byCode.get(code);
      return clause ? validateOptionSelection(clause, options) : [];
    },
    validateBindings: (code, bindings, loops) => {
      const clause = byCode.get(code);
      if (!clause) return [];
      // 카탈로그에 없는 연결 구분자는 missingRequired 가 낸다 — 여기서는 타입만
      const env: BindingEnv = {
        ...(resolve ? { discriminatorType: (c: Code) => resolve({ kind: "discriminator", code: c }), discriminatorExists: (c: Code) => catalog.has(c) } : {}),
        ...(enumValues ? { enumValues: (c: Code) => enumValues.get(c) } : {}),
        ...(loops ? { loops } : {}),
      };
      return checkUsageBindings(clause, bindings, env);
    },
    clauseOf: (code) => byCode.get(code),
  };
}

export interface DocumentChecks {
  env: TreeEnv;
  resolve: TypeResolver;
  scope: ExpressionScope;
}

/** 문서 전체 검증 — 오류 + 반복 표 경고. */
export function validateDocument(tree: DocumentNode, checks: DocumentChecks): Issue[] {
  const { env, resolve, scope } = checks;
  const issues = validateTree(tree, env);
  issues.push(...validateExpressions(tree, resolve, env.coordinate, scope));
  // 반복 표 경고(저장은 막지 않음) — 검증 목록에만 보인다 (ADR-0070 · 설계 §2.6). 오류는 validateExpressions 가 이미 냈다.
  issues.push(...repeatTableIssues(tree, { hasCoverage: scope.coverage !== undefined }, env.coordinate).filter((i) => i.severity === "warning"));
  // 블록 반복 (ADR-0077) — 사유 값 분기 경고(결정 10) · 정의 조 교차 검사(결정 23 — 「문구 없음」 = 오류 · 펼쳐지지 않는 문장 = 경고)
  issues.push(...valueBranchWarnings(tree, resolve, env.master, env.coordinate));
  const clauseOf = env.clauseGate?.clauseOf?.bind(env.clauseGate);
  if (clauseOf && env.enumOf) issues.push(...definitionCrossCheck(tree, clauseOf, env.enumOf, env.master, env.coordinate));
  return issues;
}

/** 저장을 막는 것만 — 경고를 뺀다. */
export function blockingIssues(issues: readonly Issue[]): Issue[] {
  return issues.filter((i) => i.severity !== "warning");
}
