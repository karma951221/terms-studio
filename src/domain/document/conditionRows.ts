/**
 * 조건 팝업의 줄 모델 ↔ 식 AST (ADR-0066 §5 · §8).
 *
 * 줄 = 좌변(구분자 참조) · 연산자 · 우변(리터럴 또는 구분자 참조). 줄 사이는 and/or, 괄호 없음, **왼쪽부터 결합**.
 * 화면 괄호 (2026-09-30, 기능/문면 §3.3) — 결합이 섞였을 때만 `joinParens` 가 줄마다 여는 · 닫는 괄호 수를 준다. 표시 전용, 저장 식은 그대로.
 * 저장은 기존 AST — 새 노드 종류가 없다. 팝업이 열 수 없는 식(중첩 괄호 · not · 집계 직접 · 마스터 참조)은
 * `toRows` 가 undefined 를 돌려주고 화면은 원문 읽기 전용 + 「다시 만들기」로 간다.
 *
 * 담보속성 줄 (2026-09-28, 기능/문면 §3.3) — 좌변이 담보속성(`attr.X`)이면 연산자는 `=` · `≠`(우변은 그 속성의 유효값 코드)
 * 또는 `있음` · `없음`(우변 없음 — `exist(attr.X)` · `notexist(attr.X)`). 식 언어가 담보속성에 허용하는 모양 그대로다(ADR-0015).
 * 「갱신형이면」은 두 줄 `있음 그리고 = '2'` — 쓰지 않는 상품담보에서 `=` 는 평가 오류라 있음 줄이 앞에서 막는다.
 *
 * 인자 줄 (2026-09-30, 최종 결정 2) — 함수조항 본문에서는 좌변 · 우변에 인자(`arg.X`)도 온다. 구분자 줄과 같은 규칙(타입대로 연산자)이다.
 */
import { COMPARE_OPS, format } from "../expression";
import type { AttributeRef, CompareOp, DiscriminatorRef, Expr, Literal, ParamRef } from "../expression";
import type { FieldType, FieldTypeKind } from "../types";

/** 값을 가진 좌변 · 우변 참조 — 구분자, 또는 함수조항 본문의 인자. */
export type RowValueRef = DiscriminatorRef | ParamRef;

export type RowRight = { kind: "literal"; literal: Literal } | { kind: "ref"; ref: RowValueRef };

/** 줄의 연산자 — 비교, 또는 담보속성의 있음 · 없음(우변 없음). */
export type RowOp = CompareOp | "exist" | "notexist";

/** 담보속성 좌변의 연산자 — 식 언어가 허용하는 것만 (ADR-0015). */
export const ATTRIBUTE_OPS: readonly RowOp[] = ["=", "≠", "exist", "notexist"];

export interface ConditionRow {
  left?: RowValueRef | AttributeRef;
  op?: RowOp;
  right?: RowRight;
}

/** 우변이 없는 연산자(있음 · 없음)인가. */
export function isUnaryOp(op: RowOp | undefined): op is "exist" | "notexist" {
  return op === "exist" || op === "notexist";
}

export type Join = "and" | "or";

export interface ConditionRows {
  rows: ConditionRow[];
  /** `rows.length - 1` 개. i 번째는 i 와 i+1 사이. */
  joins: Join[];
}

/** 줄 하나의 화면 괄호 — 줄 앞에 여는 수 · 줄 뒤에 닫는 수. */
export interface RowParens {
  open: number;
  close: number;
}

/**
 * 왼쪽부터 묶기를 화면에 보이는 괄호 (2026-09-30, 기능/문면 §3.3) — 표시 전용, 저장 식은 바뀌지 않는다.
 * 줄 i(≥2) 앞 결합이 줄 i-1 앞 결합과 다르면 줄 0..i-1 이 한 묶음 — 줄 0 앞에 `(`, 줄 i-1 뒤에 `)`.
 * 결합이 모두 같으면(모두 and · 모두 or) 괄호 없음. `a or b and c` → `( a or b ) and c`.
 */
export function joinParens(joins: readonly Join[]): RowParens[] {
  const out: RowParens[] = Array.from({ length: joins.length + 1 }, () => ({ open: 0, close: 0 }));
  for (let i = 2; i < out.length; i += 1) {
    if (joins[i - 1] === joins[i - 2]) continue;
    out[0].open += 1;
    out[i - 1].close += 1;
  }
  return out;
}

export function emptyRows(): ConditionRows {
  return { rows: [{}], joins: [] };
}

function rowOf(e: Expr): ConditionRow | undefined {
  if (e.kind === "aggregate" && (e.op === "exist" || e.op === "notexist") && e.ref.kind === "attr") return { left: e.ref, op: e.op };
  if (e.kind !== "compare") return undefined;
  if (e.left.kind === "ref" && e.left.ref.kind === "attr") {
    if (e.right.kind !== "literal" || e.right.literal.type !== "string" || (e.op !== "=" && e.op !== "≠")) return undefined;
    return { left: e.left.ref, op: e.op, right: { kind: "literal", literal: e.right.literal } };
  }
  if (e.left.kind !== "ref" || (e.left.ref.kind !== "discriminator" && e.left.ref.kind !== "param")) return undefined;
  let right: RowRight;
  if (e.right.kind === "literal") right = { kind: "literal", literal: e.right.literal };
  else if (e.right.kind === "ref" && (e.right.ref.kind === "discriminator" || e.right.ref.kind === "param")) right = { kind: "ref", ref: e.right.ref };
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
  if (row.left?.kind === "attr" && isUnaryOp(row.op)) return { kind: "aggregate", op: row.op, ref: row.left };
  if (!row.left || !row.op || !row.right || isUnaryOp(row.op)) return undefined;
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

/** 줄 단위 검사 — 화면의 「n번 줄: …」 문구. 통과면 빈 배열. `valuesOf` 는 담보속성 코드 → 유효값 코드(없는 속성이면 undefined). */
export function rowIssues(
  rows: ConditionRows,
  typeOf: (ref: RowValueRef) => FieldType | undefined,
  valuesOf: (attributeCode: string) => readonly string[] | undefined = () => undefined,
): string[] {
  const out: string[] = [];
  rows.rows.forEach((row, i) => {
    const n = `${i + 1}번 줄`;
    if (!row.left) {
      out.push(`${n}: 좌변이 비어 있다`);
      return;
    }
    if (row.left.kind === "attr") {
      const values = valuesOf(row.left.code);
      if (!values) out.push(`${n}: 담보속성 ${row.left.code} 를 찾을 수 없다`);
      else if (!row.op || !ATTRIBUTE_OPS.includes(row.op)) out.push(`${n}: 연산자를 고르지 않았다`);
      else if (isUnaryOp(row.op)) return;
      else if (!row.right || row.right.kind !== "literal" || row.right.literal.type !== "string") out.push(`${n}: 우변이 비어 있다`);
      else if (!values.includes(row.right.literal.value)) out.push(`${n}: '${row.right.literal.value}' 는 담보속성 ${row.left.code} 의 유효값이 아니다`);
      return;
    }
    const lt = typeOf(row.left);
    if (!lt) {
      out.push(row.left.kind === "param" ? `${n}: 인자 ${row.left.name} 를 찾을 수 없다` : `${n}: 구분자 ${row.left.code} 를 찾을 수 없다`);
      return;
    }
    if (!row.op) {
      out.push(`${n}: 연산자를 고르지 않았다`);
      return;
    }
    if (isUnaryOp(row.op) || !operatorsFor(lt.kind).includes(row.op)) {
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
