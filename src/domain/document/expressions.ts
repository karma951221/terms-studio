/**
 * 식 자리 검증 — 저장 시점 (ADR-0013 「조건식 자리는 boolean」은 언어 밖 규칙).
 *
 * - **문면은 구분자만 본다** (ADR-0037 · ADR-0036 §3) — 마스터 필드(`폼.필드`) 직접 참조는 거부한다.
 *   필드 하나를 문면에 내는 길은 투영 구분자(`구분자 = 폼.필드`)뿐이다.
 * - 조건 가지 `when` : `parse` 문법 검사 → 마스터 참조 거부 → `checkCondition` (결과 boolean · 참조 존재).
 * - 슬롯 `ref`      : 값 참조 경로 하나여야 한다 (식 · 담보속성 · 마스터 불가) → `checkTypes` 로 존재 검사.
 * - 반복의 `source` 는 자리만 확보 (P7) — 검사하지 않는다.
 * - 행 반복 표(ADR-0070)의 저장 오류(문맥 담보 · 구조 표기 레벨 · 행 아래 참조 · 표 밖 구조 표기)도 여기서 함께 낸다.
 * 타입 조회(`TypeResolver`)는 카탈로그 정의로 서비스가 만든다.
 */

import { findNodeById } from "../coverage/tree";
import type { Coverage } from "../coverage/types";
import { checkCondition, checkTypes, extractRefs, parse } from "../expression";
import type { Expr, TypeResolver } from "../expression";
import { ATTACH_LEVEL_LABEL, type AttachLevel, type Code, type Coordinate, type Issue } from "../types";
import { coordinateOf, indexTree, type DocumentNode } from "./nodes";
import { repeatTableIssues } from "./repeat";

/** 한정자 검사 문맥 — 담보 약관이면 문맥 담보 트리와 구분자 레벨 조회. 보통약관은 둘 다 없음. */
export interface ExpressionScope {
  coverage?: Coverage;
  levelOf?: (code: Code) => AttachLevel | undefined;
}

/** `@노드` 규칙 (ADR-0066 §2 · §3): 담보 약관에서만 · 노드가 트리에 있어야 · 노드 레벨 = 구분자 레벨. */
function checkNodeQualifiers(expr: Expr, scope: ExpressionScope, at: Coordinate): Issue[] {
  const issues: Issue[] = [];
  for (const { ref, path } of extractRefs(expr)) {
    if (ref.kind !== "discriminator" || !ref.node) continue;
    const here = { ...at, refPath: path };
    if (!scope.coverage) {
      issues.push({ kind: "brokenRef", message: `노드 한정자 ${path} 는 담보 약관 문서에서만 쓸 수 있습니다 (문맥 담보 없음)`, at: here });
      continue;
    }
    const node = findNodeById(scope.coverage, ref.node.id);
    if (!node) {
      issues.push({ kind: "brokenRef", message: `문맥 담보에 노드 ${ref.node.id} 가 없습니다 — 끊어진 참조`, at: here });
      continue;
    }
    const level = scope.levelOf?.(ref.code);
    if (level !== undefined && level !== node.level) {
      issues.push({
        kind: "typeMismatch",
        message: `${ATTACH_LEVEL_LABEL[level]} 레벨 구분자 ${ref.code} 를 ${ATTACH_LEVEL_LABEL[node.level]} 「${node.name}」 에 붙일 수 없습니다`,
        at: here,
      });
    }
  }
  return issues;
}

export function validateExpressions(doc: DocumentNode, resolve: TypeResolver, base: Coordinate = {}, scope: ExpressionScope = {}): Issue[] {
  const ix = indexTree(doc, base);
  const issues: Issue[] = [];

  /** 문면이 마스터 필드를 직접 부르면 거부 (ADR-0037). 하나라도 있으면 true. */
  const rejectMasterRefs = (expr: Expr, at: Coordinate): boolean => {
    let found = false;
    for (const { ref, path } of extractRefs(expr)) {
      if (ref.kind !== "master") continue;
      found = true;
      issues.push({
        kind: "typeMismatch",
        message: `조문은 입력 항목 ${path} 를 직접 부를 수 없습니다 — 구분자를 통해야 합니다`,
        at: { ...at, refPath: path },
      });
    }
    return found;
  };

  const condition = (src: string, at: Coordinate) => {
    const parsed = parse(src, at);
    if (!parsed.ok) {
      if (parsed.rejection.reason === "invalid") issues.push(...parsed.rejection.issues);
      return;
    }
    if (rejectMasterRefs(parsed.value, at)) return;
    const q = checkNodeQualifiers(parsed.value, scope, at);
    if (q.length > 0) {
      issues.push(...q);
      return;
    }
    const checked = checkCondition(parsed.value, resolve, at);
    if (!checked.ok && checked.rejection.reason === "invalid") issues.push(...checked.rejection.issues);
  };

  const slot = (src: string, at: Coordinate) => {
    if (src.trim().startsWith("attr.")) {
      issues.push({ kind: "typeMismatch", message: "슬롯은 담보속성을 찍을 수 없습니다 (값 참조 경로만)", at: { ...at, refPath: src } });
      return;
    }
    const parsed = parse(src, at);
    if (!parsed.ok) {
      if (parsed.rejection.reason === "invalid") issues.push(...parsed.rejection.issues);
      return;
    }
    if (parsed.value.kind !== "ref" || parsed.value.ref.kind === "attr") {
      issues.push({ kind: "typeMismatch", message: "슬롯은 값 참조 경로 하나여야 합니다 (식 불가)", at: { ...at, refPath: src } });
      return;
    }
    if (rejectMasterRefs(parsed.value, at)) return;
    const q = checkNodeQualifiers(parsed.value, scope, at);
    if (q.length > 0) {
      issues.push(...q);
      return;
    }
    const checked = checkTypes(parsed.value, resolve, { coordinate: at });
    if (!checked.ok && checked.rejection.reason === "invalid") {
      issues.push(...checked.rejection.issues);
    } else if (checked.ok && checked.value.kind !== "string" && checked.value.kind !== "enum") {
      issues.push({
        kind: "typeMismatch",
        message: `값 슬롯은 string·enum 만 허용합니다 (${checked.value.kind} 불가)`,
        at: { ...at, refPath: src },
      });
    }
  };

  for (const e of ix.nodes.values()) {
    const n = e.node;
    if (n.kind === "condBlock" || n.kind === "inlineCond") {
      for (const br of n.branches) {
        const be = ix.branches.get(br.id);
        if (br.when !== undefined && be) condition(br.when, coordinateOf(ix, be, base));
      }
    } else if (n.kind === "slot") {
      slot(n.ref, coordinateOf(ix, e, base));
    }
  }
  // 반복 표 검사 (ADR-0070 · 설계 §2.6) — 저장을 막는 오류만. 경고(「모든 행이 같아집니다」)는 `repeatTableIssues` 로 따로 본다.
  issues.push(...repeatTableIssues(doc, { hasCoverage: scope.coverage !== undefined, levelOf: scope.levelOf }, base).filter((i) => i.severity !== "warning"));
  return issues;
}
