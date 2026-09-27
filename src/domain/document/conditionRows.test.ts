import { describe, expect, it } from "vitest";

import { parse } from "../expression";
import type { FieldType } from "../types";
import { emptyRows, operatorsFor, rowIssues, toExpr, toRows, toSource, type ConditionRows } from "./conditionRows";

const ok = (src: string) => { const r = parse(src); if (!r.ok) throw new Error(src); return r.value; };

describe("toRows — 팝업이 열 수 있는 모양만 (ADR-0066 §8)", () => {
  it("비교 하나", () => {
    expect(toRows(ok("D0009 = true"))).toEqual({ rows: [{ left: { kind: "discriminator", code: "D0009" }, op: "=", right: { kind: "literal", literal: { type: "boolean", value: true } } }], joins: [] });
  });
  it("왼쪽 결합 체인 → 줄 + 접속", () => {
    const rows = toRows(ok("D0009@n1 = true and D0006 = false or D0005 >= 3"));
    expect(rows?.rows).toHaveLength(3);
    expect(rows?.joins).toEqual(["and", "or"]);
    expect(rows?.rows[0].left).toEqual({ kind: "discriminator", code: "D0009", node: { id: "n1" } });
  });
  it("우변이 구분자여도 된다", () => {
    expect(toRows(ok("D0005 = D0003"))?.rows[0].right).toEqual({ kind: "ref", ref: { kind: "discriminator", code: "D0003" } });
  });
  it("괄호 중첩 · not · 집계 직접 · 좌변 리터럴 · 마스터 참조는 undefined (원문 읽기 전용)", () => {
    for (const src of ["D0009 = true and (D0006 = false or D0005 >= 3)", "not D0009 = true", "any(D0002)", "true = D0009", "pay.rate = 1"]) {
      expect(toRows(ok(src))).toBeUndefined();
    }
  });
});

describe("toExpr / toSource — 왼쪽 결합 · 왕복", () => {
  it("줄 → 식 → 줄 이 같다", () => {
    const src = "D0009@n1 = true and D0006 = false or D0005 >= 3";
    const rows = toRows(ok(src))!;
    expect(toSource(rows)).toBe(src);
    expect(toRows(toExpr(rows)!)).toEqual(rows);
  });
  it("(a or b) and c 는 괄호가 붙어 다시 같은 줄로", () => {
    // 주의(브리프 이탈): "D0001 = 'x' or D0009 = true and D0006 = false" 는 and 가 or 보다 세게 묶여
    // or(a, and(b, c)) 로 파싱된다 — 오른쪽 자식이 and 라 toRows 는 undefined 를 돌려준다(왼쪽 결합 체인이 아님).
    // 그래서 앞 두 줄은 "D0001 = 'x' or D0009 = true" 에서 뽑고, 세 번째 줄(c)은 직접 만든다.
    const ab = toRows(ok("D0001 = 'x' or D0009 = true"))!;
    const rows: ConditionRows = {
      rows: [...ab.rows, { left: { kind: "discriminator", code: "D0006" }, op: "=", right: { kind: "literal", literal: { type: "boolean", value: false } } }],
      joins: ["or", "and"],
    };
    expect(toSource(rows)).toBe("(D0001 = 'x' or D0009 = true) and D0006 = false");
    expect(toRows(ok(toSource(rows)!))).toEqual(rows);
  });
  it("빈 칸이 있으면 undefined", () => {
    expect(toExpr(emptyRows())).toBeUndefined();
  });
});

describe("operatorsFor / rowIssues", () => {
  const typeOf = (ref: { code: string }): FieldType | undefined =>
    ref.code === "D0009" ? { kind: "boolean" }
    : ref.code === "D0005" ? { kind: "number" }
    : ref.code === "D0011" ? { kind: "string" }
    : ref.code === "D0012" ? { kind: "enum", enumCode: "E0001" }
    : undefined;
  it("타입별 연산자", () => {
    expect(operatorsFor("boolean")).toEqual(["=", "≠"]);
    expect(operatorsFor("number")).toHaveLength(6);
    expect(operatorsFor("list<enum>")).toEqual([]);
    expect(operatorsFor("table")).toEqual([]);
  });
  it("빈 좌변 · 빈 우변 · 타입 불일치 · 모르는 구분자 · 연산자 불허를 줄 번호로", () => {
    const rows: ConditionRows = {
      rows: [
        {},
        { left: { kind: "discriminator", code: "D0009" }, op: "=" },
        { left: { kind: "discriminator", code: "D0009" }, op: ">", right: { kind: "literal", literal: { type: "number", value: 1 } } },
        { left: { kind: "discriminator", code: "D0005" }, op: "=", right: { kind: "ref", ref: { kind: "discriminator", code: "D0009" } } },
        { left: { kind: "discriminator", code: "D9999" }, op: "=", right: { kind: "literal", literal: { type: "boolean", value: true } } },
      ],
      joins: ["and", "and", "and", "and"],
    };
    const issues = rowIssues(rows, typeOf);
    expect(issues[0]).toContain("1번 줄");
    expect(issues[1]).toContain("2번 줄");
    expect(issues[2]).toContain("3번 줄");
    expect(issues[3]).toContain("4번 줄");
    expect(issues[4]).toContain("5번 줄");
    expect(rowIssues(toRows(ok("D0009 = true and D0005 >= 3"))!, typeOf)).toEqual([]);
  });
  it("string 좌변 · enum 우변도 대칭으로 같다고 본다 (expression/typecheck.ts 의 equatable 과 대칭)", () => {
    const rows: ConditionRows = {
      rows: [{ left: { kind: "discriminator", code: "D0011" }, op: "=", right: { kind: "ref", ref: { kind: "discriminator", code: "D0012" } } }],
      joins: [],
    };
    expect(rowIssues(rows, typeOf)).toEqual([]);
  });
});

describe("담보속성 줄 (2026-09-28, 기능/문면 §3.3) — 있음 · 없음 · = · ≠", () => {
  const src = "exist(attr.A0001) and attr.A0001 = '2'";
  it("「갱신형이면」 두 줄로 풀리고 다시 같은 식으로 묶인다", () => {
    const rows = toRows(ok(src))!;
    expect(rows.rows).toEqual([
      { left: { kind: "attr", code: "A0001" }, op: "exist" },
      { left: { kind: "attr", code: "A0001" }, op: "=", right: { kind: "literal", literal: { type: "string", value: "2" } } },
    ]);
    expect(rows.joins).toEqual(["and"]);
    expect(toSource(rows)).toBe(src);
  });
  it("없음 · ≠ 도 왕복한다", () => {
    const s2 = "notexist(attr.A0002) or attr.A0002 ≠ '1'";
    expect(toSource(toRows(ok(s2))!)).toBe(s2);
  });
  it("담보속성의 크기 비교 · 우변 없는 = 는 줄이 아니다", () => {
    expect(toExpr({ rows: [{ left: { kind: "attr", code: "A0001" }, op: "=" }], joins: [] })).toBeUndefined();
  });
  it("검사 — 없는 속성 · 유효값 밖 · 구분자에 있음", () => {
    const valuesOf = (code: string) => (code === "A0001" ? ["1", "2"] : undefined);
    const typeOf = () => ({ kind: "boolean" }) as FieldType;
    expect(rowIssues(toRows(ok(src))!, typeOf, valuesOf)).toEqual([]);
    expect(rowIssues(toRows(ok("attr.A0001 = '9'"))!, typeOf, valuesOf)[0]).toMatch(/유효값이 아니다/);
    expect(rowIssues(toRows(ok("exist(attr.A0009)"))!, typeOf, valuesOf)[0]).toMatch(/찾을 수 없다/);
    expect(rowIssues({ rows: [{ left: { kind: "discriminator", code: "D0009" }, op: "exist" }], joins: [] }, typeOf, valuesOf)[0]).toMatch(/쓸 수 없다/);
  });
});
