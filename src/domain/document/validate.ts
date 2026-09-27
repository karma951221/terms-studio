/**
 * 문서 전체 저장 검증 한 벌 — 서버의 저장과 브라우저 편집본의 「템플릿 전체」 검증 목록이 같은 함수를 쓴다 (ADR-0074).
 *
 * 구조(허용 자식 · 중첩 · id · 가지) · 참조 대상 · 공용조항(`validateTree`) + 식(문법 · boolean · 구분자만 · `@노드`) · 반복 표 오류
 * (`validateExpressions`) + 반복 표 경고. 경고(`severity: "warning"`)는 저장을 막지 않는다 — `blockingIssues` 로 거른다.
 *
 * 검증 재료(공용조항 게이트 · 식 타입 조회)도 여기서 만든다 — 서버는 DB 에서 읽은 정의로, 브라우저는 서버가 넘긴 같은 정의로.
 */
import { discriminatorResultType, type Discriminator } from "../catalog";
import { validateOptionSelection, type Clause } from "../clause";
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
 * 공용조항 게이트 — 정의 존재 · 요구 구분자 · 옵션 선택 검증 (ADR-0010 · 기능/공용조항 §3.2).
 * `missingRequired` 는 요구 구분자를 카탈로그 코드와 대조한다 (기능/공용조항 §3.4).
 */
export function clauseGateFrom(clauses: readonly Clause[], catalogCodes: Iterable<Code>): ClauseGate {
  const byCode = new Map(clauses.map((c) => [c.code, c]));
  const catalog = new Set(catalogCodes);
  return {
    clauseExists: (code) => byCode.has(code),
    requiredCodes: (code) => byCode.get(code)?.required.discriminators ?? [],
    missingRequired: (code) => (byCode.get(code)?.required.discriminators ?? []).filter((d) => !catalog.has(d)),
    validateOptions: (code, options) => {
      const clause = byCode.get(code);
      return clause ? validateOptionSelection(clause, options) : [];
    },
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
  return issues;
}

/** 저장을 막는 것만 — 경고를 뺀다. */
export function blockingIssues(issues: readonly Issue[]): Issue[] {
  return issues.filter((i) => i.severity !== "warning");
}
