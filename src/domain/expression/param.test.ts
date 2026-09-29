import { describe, expect, it } from "vitest";

import type { Issue } from "../types";
import type { Expr } from "./ast";
import { refPath } from "./ast";
import { evaluate, type EvalContext } from "./evaluate";
import { format } from "./format";
import { parse } from "./parser";
import { paramNames } from "./refs";
import { checkCondition, checkTypes, type ExprType, type TypeResolver } from "./typecheck";

/**
 * 인자 참조 `arg.<이름>` — 함수조항 본문만 쓰는 참조 (최종 결정 2 · 기능/식언어 §인자).
 * 경계: 문맥 플래그(`params`)가 없으면 타입 검사가 거부한다 — 구분자 식 · 문면 식으로 새지 않는다.
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

const resolve: TypeResolver = (ref) => (ref.kind === "discriminator" && ref.code === "D0001" ? { kind: "boolean" } : undefined);
const PARAMS: Record<string, ExprType> = {
  사유: { kind: "enum", enumCode: "E0001" },
  갱신형: { kind: "boolean" },
  담보명: { kind: "string" },
  종들: { kind: "planOptions", form: "waiver" },
};
const params = (name: string) => PARAMS[name];

function issuesOf(r: ReturnType<typeof checkTypes>): Issue[] {
  if (r.ok) return [];
  if (r.rejection.reason !== "invalid") throw new Error("unreachable");
  return r.rejection.issues;
}

describe("arg.<이름> 파싱 · 표기", () => {
  it("arg.사유 는 인자 참조 하나다", () => {
    expect(ast("arg.사유")).toEqual({ kind: "ref", ref: { kind: "param", name: "사유" } });
    expect(refPath({ kind: "param", name: "사유" })).toBe("arg.사유");
  });

  it("비교 · 논리 안에서도 읽고, 다시 찍으면 같은 소스다", () => {
    const src = "arg.사유 = 'V01' and not arg.갱신형";
    expect(format(ast(src))).toBe(src);
    expect(paramNames(ast(src))).toEqual(["사유", "갱신형"]);
  });

  it("arg 는 예약어라 구분자 코드로 쓸 수 없다 — 홀로 서면 arg.<이름> 을 요구한다", () => {
    expect(syntaxError("arg")).toMatch(/arg\.<이름>/);
    expect(syntaxError("waiver.arg")).toMatch(/예약어/);
  });

  it("arg.<이름> 은 두 토막 — arg.사유.약관표시명 은 아직 없다", () => {
    expect(syntaxError("arg.사유.약관표시명")).toMatch(/arg\.<이름>/);
  });

  it("인자는 집계할 수 없다 — 집계 범위는 사용처 구조다", () => {
    expect(syntaxError("any(arg.갱신형)")).toMatch(/집계/);
  });

  it("노드 한정자는 인자에 붙지 않는다", () => {
    expect(syntaxError("arg.갱신형@n1")).toMatch(/노드 한정자/);
  });
});

describe("타입 검사 — 문맥 플래그(params)가 있을 때만 인자를 푼다", () => {
  it("선언 타입 enum<E0001> 은 문자열 코드와 비교할 수 있다", () => {
    const r = checkCondition(ast("arg.사유 = 'V01'"), resolve, undefined, params);
    expect(r).toEqual({ ok: true, value: { kind: "boolean" } });
  });

  it("boolean 인자는 조건 자리에 그대로 선다 — 구분자와 섞어도 된다", () => {
    expect(checkCondition(ast("arg.갱신형 or D0001"), resolve, undefined, params).ok).toBe(true);
  });

  it("선언되지 않은 인자 = brokenRef", () => {
    const issues = issuesOf(checkTypes(ast("arg.없는인자"), resolve, { params }));
    expect(issues).toEqual([expect.objectContaining({ kind: "brokenRef", message: expect.stringContaining("선언되지 않은 인자"), at: { refPath: "arg.없는인자" } })]);
  });

  it("문맥 플래그가 없으면(구분자 식 · 문면 식) 인자를 쓸 수 없다", () => {
    const issues = issuesOf(checkTypes(ast("arg.갱신형"), resolve));
    expect(issues).toEqual([expect.objectContaining({ kind: "structure", message: expect.stringContaining("함수조항 본문에서만") })]);
  });

  it("세목 선택지 목록 인자는 비교 · 조건 자리에 쓸 수 없다 (연산은 내부 변수 몫)", () => {
    expect(issuesOf(checkCondition(ast("arg.종들"), resolve, undefined, params))[0]).toMatchObject({ kind: "typeMismatch" });
    expect(issuesOf(checkTypes(ast("arg.종들 = 'V01'"), resolve, { params }))[0]).toMatchObject({ kind: "typeMismatch" });
  });
});

describe("평가 — 연결을 거치지 않은 인자는 오류", () => {
  it("평가기에 인자가 남아 있으면 structure 오류다 (연결은 펼칠 때 끝난다)", () => {
    const ctx: EvalContext = { lookup: () => ({ kind: "undetermined" }), attribute: () => ({ kind: "undetermined" }), children: () => undefined };
    const r = evaluate(ast("arg.갱신형"), ctx);
    expect(r).toMatchObject({ kind: "error", issue: { kind: "structure", at: { refPath: "arg.갱신형" } } });
  });
});
