/**
 * 조건 팝업의 줄 모델 ↔ 식 AST (ADR-0066 §5 · §8).
 *
 * 줄 = 좌변(구분자 참조) · 연산자 · 우변(리터럴 또는 구분자 참조). 줄 사이는 and/or, 괄호 없음, **왼쪽부터 결합**.
 * 저장은 기존 AST — 새 노드 종류가 없다. 팝업이 열 수 없는 식(중첩 괄호 · not · 집계 직접 · 마스터 참조)은
 * `toRows` 가 undefined 를 돌려주고 화면은 원문 읽기 전용 + 「다시 만들기」로 간다.
 */
import { COMPARE_OPS, format } from "../expression";
import type { CompareOp, DiscriminatorRef, Expr, Literal } from "../expression";
import type { FieldType, FieldTypeKind } from "../types";

export type RowRight = { kind: "literal"; literal: Literal } | { kind: "ref"; ref: DiscriminatorRef };

export interface ConditionRow {
  left?: DiscriminatorRef;
  op?: CompareOp;
  right?: RowRight;
}

export type Join = "and" | "or";

export interface ConditionRows {
  rows: ConditionRow[];
  /** `rows.length - 1` 개. i 번째는 i 와 i+1 사이. */
  joins: Join[];
}

export function emptyRows(): ConditionRows {
  return { rows: [{}], joins: [] };
}

function rowOf(e: Expr): ConditionRow | undefined {
  if (e.kind !== "compare") return undefined;
  if (e.left.kind !== "ref" || e.left.ref.kind !== "discriminator") return undefined;
  let right: RowRight;
  if (e.right.kind === "literal") right = { kind: "literal", literal: e.right.literal };
  else if (e.right.kind === "ref" && e.right.ref.kind === "discriminator") right = { kind: "ref", ref: e.right.ref };
  else return undefined;
  return { left: e.left.ref, op: e.op, right };
}

export function toRows(expr: Expr): ConditionRows | undefined {
  const rows: ConditionRow[] = [];
  const joins: Join[] = [];
  const walk = (e: Expr): boolean => {
    if (e.kind === "and" || e.kind === "or") {
      if (!walk(e.left)) return false;
      const r = rowOf(e.right);
      if (!r) return false;
      joins.push(e.kind);
      rows.push(r);
      return true;
    }
    const r = rowOf(e);
    if (!r) return false;
    rows.push(r);
    return true;
  };
  return walk(expr) ? { rows, joins } : undefined;
}

function exprOf(row: ConditionRow): Expr | undefined {
  if (!row.left || !row.op || !row.right) return undefined;
  const right: Expr = row.right.kind === "literal" ? { kind: "literal", literal: row.right.literal } : { kind: "ref", ref: row.right.ref };
  return { kind: "compare", op: row.op, left: { kind: "ref", ref: row.left }, right };
}

export function toExpr(rows: ConditionRows): Expr | undefined {
  if (rows.rows.length === 0 || rows.joins.length !== rows.rows.length - 1) return undefined;
  const first = exprOf(rows.rows[0]);
  if (!first) return undefined;
  let acc: Expr = first;
  for (let i = 1; i < rows.rows.length; i += 1) {
    const next = exprOf(rows.rows[i]);
    if (!next) return undefined;
    acc = { kind: rows.joins[i - 1], left: acc, right: next };
  }
  return acc;
}

export function toSource(rows: ConditionRows): string | undefined {
  const e = toExpr(rows);
  return e ? format(e) : undefined;
}

const EQ_ONLY: readonly CompareOp[] = ["=", "≠"];

/** 좌변 타입이 정하는 연산자 목록. list<enum> · table 은 비교 연산이 없다 (B 단계). */
export function operatorsFor(kind: FieldTypeKind): readonly CompareOp[] {
  switch (kind) {
    case "boolean":
    case "string":
    case "enum":
      return EQ_ONLY;
    case "number":
    case "date":
      return COMPARE_OPS;
    case "list<enum>":
    case "table":
      return [];
  }
}

function literalKind(lit: Literal): FieldTypeKind {
  return lit.type;
}

/** 줄 단위 검사 — 화면의 「n번 줄: …」 문구. 통과면 빈 배열. */
export function rowIssues(rows: ConditionRows, typeOf: (ref: DiscriminatorRef) => FieldType | undefined): string[] {
  const out: string[] = [];
  rows.rows.forEach((row, i) => {
    const n = `${i + 1}번 줄`;
    if (!row.left) {
      out.push(`${n}: 좌변이 비어 있다`);
      return;
    }
    const lt = typeOf(row.left);
    if (!lt) {
      out.push(`${n}: 구분자 ${row.left.code} 를 찾을 수 없다`);
      return;
    }
    if (!row.op) {
      out.push(`${n}: 연산자를 고르지 않았다`);
      return;
    }
    if (!operatorsFor(lt.kind).includes(row.op)) {
      out.push(`${n}: ${lt.kind} 에는 '${row.op}' 를 쓸 수 없다`);
      return;
    }
    if (!row.right) {
      out.push(`${n}: 우변이 비어 있다`);
      return;
    }
    const rk = row.right.kind === "literal" ? literalKind(row.right.literal) : typeOf(row.right.ref)?.kind;
    if (rk === undefined) {
      out.push(`${n}: 우변 구분자를 찾을 수 없다`);
      return;
    }
    // enum ↔ string 은 양방향으로 같다고 본다 — expression/typecheck.ts 의 `equatable` 과 대칭을 맞춘다
    // (저장 시점 검사기가 허용하는데 팝업이 막으면 안 된다). `equatable` 자체는 재노출하지 않는다 — 모듈 경계.
    const same = lt.kind === rk || (lt.kind === "enum" && rk === "string") || (lt.kind === "string" && rk === "enum");
    if (!same) out.push(`${n}: 타입이 다르다 (${lt.kind} ≠ ${rk})`);
  });
  return out;
}
