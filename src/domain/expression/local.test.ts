import { describe, expect, it } from "vitest";

import type { Issue } from "../types";
import type { Expr } from "./ast";
import { refPath } from "./ast";
import { format } from "./format";
import { parse } from "./parser";
import { enumReads, localNames } from "./refs";
import { checkCondition, checkTypes, type EnumInfo, type ExprType, type TypeResolver } from "./typecheck";

/**
 * 함수조항 전용 식 — 내부 변수 `var.<이름>` · 열거값 필드 읽기 `.F01` · 타입별 연산(합치기 · 있음 · 거르기 · 비었음)
 * (최종 결정 2 · 18 · 기능/식언어 §12). 개수 연산은 없다. 경계: 문맥 플래그(`params`)가 없으면 거부 — 구분자 식으로 새지 않는다.
 */

function ast(src: string): Expr {
  const r = parse(src);
  if (!r.ok) throw new Error(`파싱 실패: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

function syntaxError(src: string): string {
  const r = parse(src);
  if (r.ok || r.rejection.reason !== "invalid") throw new Error(`문법 오류 기대: ${src}`);
  return r.rejection.issues[0].message;
}

function issuesOf(r: ReturnType<typeof checkTypes>): Issue[] {
  if (r.ok) return [];
  if (r.rejection.reason !== "invalid") throw new Error("unreachable");
  return r.rejection.issues;
}

const resolve: TypeResolver = (ref) => (ref.kind === "discriminator" && ref.code === "D0001" ? { kind: "list<enum>", enumCode: "E0001" } : undefined);
const PARAMS: Record<string, ExprType> = {
  사유: { kind: "enum", enumCode: "E0001" },
  사유들: { kind: "list<enum>", enumCode: "E0001" },
  종들: { kind: "planOptions", form: "waiver" },
  갱신형: { kind: "boolean" },
};
const LOCALS: Record<string, ExprType> = {
  암있음: { kind: "boolean" },
  모든사유: { kind: "list<enum>", enumCode: "E0001" },
};
const ENUMS: EnumInfo = (code) =>
  code === "E0001"
    ? {
        values: ["V01", "V02", "V03"],
        fields: [
          { key: "F01", type: "string" },
          { key: "F02", type: "boolean" },
        ],
      }
    : undefined;
const planField = (form: string, field: string): ExprType | undefined =>
  form === "waiver" && field === "reasons" ? { kind: "list<enum>", enumCode: "E0001" } : form === "waiver" && field === "applies" ? { kind: "boolean" } : undefined;

const inClause = { params: (n: string) => PARAMS[n], locals: (n: string) => LOCALS[n], enums: ENUMS, planField };

describe("내부 변수 · 연산 · 필드 — 파싱 · 표기", () => {
  it("var.<이름> 은 내부 변수 참조다", () => {
    expect(ast("var.암있음")).toEqual({ kind: "ref", ref: { kind: "local", name: "암있음" } });
    expect(refPath({ kind: "local", name: "암있음" })).toBe("var.암있음");
  });

  it("종들.합치기(waiver.reasons) — 세목 선택지 목록의 필드를 합친다", () => {
    expect(ast("arg.종들.합치기(waiver.reasons)")).toEqual({
      kind: "call",
      op: "합치기",
      target: { kind: "ref", ref: { kind: "param", name: "종들" } },
      ref: { kind: "master", form: "waiver", field: "reasons" },
    });
  });

  it("있음(값…) · 거르기(필드 = 값) · 비었음 · 필드 읽기를 사슬로 잇고, 다시 찍으면 같은 소스다", () => {
    for (const src of [
      "var.모든사유.있음('V01', 'V02')",
      "var.모든사유.거르기(F02 = true).비었음",
      "arg.사유.F01",
      "arg.사유.F02 = true and not var.모든사유.비었음",
      "arg.종들.합치기(waiver.reasons).거르기(F01 = '암').있음('V03')",
    ]) {
      expect(format(ast(src))).toBe(src);
    }
  });

  it("있음은 값이 하나 이상 · 거르기는 필드 = 리터럴 · 합치기는 폼.필드 하나", () => {
    expect(syntaxError("var.모든사유.있음()")).toMatch(/값/);
    expect(syntaxError("var.모든사유.거르기(F01)")).toMatch(/=/);
    expect(syntaxError("arg.종들.합치기(D0001)")).toMatch(/폼\.필드/);
  });

  it("var 는 예약어 — 필드 · 연산은 인자 · 내부 변수 뒤에만 붙는다", () => {
    expect(syntaxError("var")).toMatch(/var\.<이름>/);
    expect(syntaxError("waiver.reasons.있음('V01')")).toMatch(/두 토막/);
  });

  it("읽는 내부 변수 이름 · 연산 안의 인자도 참조로 뽑힌다", () => {
    expect(localNames(ast("var.암있음 and var.모든사유.있음('V01')"))).toEqual(["암있음", "모든사유"]);
  });
});

describe("내부 변수 · 연산 · 필드 — 타입 검사", () => {
  const ok = (src: string, expect?: ExprType["kind"]) => checkTypes(ast(src), resolve, { ...inClause, ...(expect ? { expect } : {}) });

  it("합치기 → list<enum>, 있음 · 비었음 → boolean, 거르기 → 같은 목록, 필드 → 필드 타입", () => {
    expect(ok("arg.종들.합치기(waiver.reasons)")).toEqual({ ok: true, value: { kind: "list<enum>", enumCode: "E0001" } });
    expect(ok("var.모든사유.있음('V01', 'V02')", "boolean").ok).toBe(true);
    expect(ok("var.모든사유.거르기(F02 = true).비었음", "boolean").ok).toBe(true);
    expect(ok("arg.사유.F01")).toEqual({ ok: true, value: { kind: "string" } });
    expect(ok("arg.사유.F02 = true", "boolean").ok).toBe(true);
    expect(ok("arg.사유 = 'V01'", "boolean").ok).toBe(true);
    expect(ok("var.암있음 or not arg.갱신형", "boolean").ok).toBe(true);
  });

  it("없는 필드 = 오류 · 없는 값 = 오류 · 필드 타입과 다른 리터럴 = 오류", () => {
    expect(issuesOf(ok("arg.사유.F09"))[0]).toMatchObject({ kind: "brokenRef", message: expect.stringMatching(/필드/) });
    expect(issuesOf(ok("var.모든사유.있음('V99')"))[0]).toMatchObject({ kind: "brokenRef", message: expect.stringMatching(/V99/) });
    expect(issuesOf(ok("var.모든사유.거르기(F02 = '예')"))[0].kind).toBe("typeMismatch");
  });

  it("연산은 제 타입에만 — 목록에 필드 · 열거값에 있음 · 다른 폼 필드 합치기 = 오류", () => {
    expect(issuesOf(ok("var.모든사유.F01"))[0].kind).toBe("typeMismatch");
    expect(issuesOf(ok("arg.사유.있음('V01')"))[0].kind).toBe("typeMismatch");
    expect(issuesOf(ok("arg.종들.합치기(no_surrender.type)"))[0].kind).toBe("typeMismatch");
    expect(issuesOf(ok("arg.종들.합치기(waiver.applies)"))[0].kind).toBe("typeMismatch");
  });

  it("선언되지 않은 내부 변수 = 오류", () => {
    expect(issuesOf(ok("var.없음"))[0]).toMatchObject({ kind: "brokenRef", message: expect.stringMatching(/내부 변수/) });
  });

  it("count 는 함수조항 식에서 거부 — 개수 연산 없음", () => {
    expect(issuesOf(checkTypes(ast("count(D0001) = 1"), resolve, inClause))[0].message).toMatch(/개수/);
  });

  it("구분자 식(문맥 플래그 없음)에서 연산 · 필드 · 내부 변수 = 거부 (경계)", () => {
    const outside = (src: string) => issuesOf(checkCondition(ast(src), resolve));
    expect(outside("var.암있음")[0].kind).toBe("structure");
    // 구분자 뒤에는 연산을 붙일 문법이 없다 — 손으로 만든 AST 라도 타입 검사가 막는다
    expect(parse("D0001.있음('V01')").ok).toBe(false);
    const handmade: Expr = { kind: "call", op: "비었음", target: { kind: "ref", ref: { kind: "discriminator", code: "D0001" } } };
    expect(issuesOf(checkCondition(handmade, resolve))[0].kind).toBe("structure");
    const member: Expr = { kind: "member", target: { kind: "ref", ref: { kind: "discriminator", code: "D0001" } }, field: "F01" };
    expect(issuesOf(checkTypes(member, resolve))[0].kind).toBe("structure");
  });
});

describe("열거값 읽기 — 참조 그래프 재료", () => {
  it("값 나열(= · 있음) 과 필드 읽기(.필드 · 거르기)를 열거형과 함께 뽑는다", () => {
    const types = { params: (n: string) => PARAMS[n], locals: (n: string) => LOCALS[n], planField };
    expect(enumReads(ast("arg.사유 = 'V02' or var.모든사유.있음('V01', 'V03')"), types)).toEqual([
      { kind: "value", enumCode: "E0001", code: "V02" },
      { kind: "value", enumCode: "E0001", code: "V01" },
      { kind: "value", enumCode: "E0001", code: "V03" },
    ]);
    expect(enumReads(ast("arg.종들.합치기(waiver.reasons).거르기(F02 = true).비었음 and arg.사유.F01 = '암'"), types)).toEqual([
      { kind: "field", enumCode: "E0001", code: "F02" },
      { kind: "field", enumCode: "E0001", code: "F01" },
    ]);
  });
});
