/**
 * 작성위치 `builtin.output` · 범위 낱말 `builtin.output.scope` (ADR-0089 결정 3 · 4 · 기능/식언어 §3).
 */
import { describe, expect, it } from "vitest";

import type { Issue } from "../types";
import type { Expr } from "./ast";
import { refPath } from "./ast";
import { evaluate, type EvalContext } from "./evaluate";
import { format } from "./format";
import { OUTPUT_POSITIONS, SCOPE_WORDS } from "./output";
import { parse } from "./parser";
import { extractRefs } from "./refs";
import { checkTypes } from "./typecheck";

function ast(src: string): Expr {
  const r = parse(src);
  if (!r.ok) throw new Error(`파싱 실패: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

function issues(src: string, output = true, expect?: "boolean"): Issue[] {
  const r = checkTypes(ast(src), () => ({ kind: "boolean" }), { ...(output ? { output: true } : {}), ...(expect ? { expect } : {}) });
  return r.ok ? [] : r.rejection.reason === "invalid" ? r.rejection.issues : [];
}

const blank: Omit<EvalContext, "output"> = {
  lookup: () => ({ kind: "missing" }),
  attribute: () => ({ kind: "unused" }),
  children: () => undefined,
};

describe("작성위치 — 파서", () => {
  it("builtin.output 은 레벨 없는 한 토막 내장 경로다", () => {
    expect(ast("builtin.output")).toEqual({ kind: "ref", ref: { kind: "output" } });
    expect(ast("builtin.output.scope")).toEqual({ kind: "ref", ref: { kind: "output", prop: "scope" } });
    expect(refPath({ kind: "output" })).toBe("builtin.output");
    expect(refPath({ kind: "output", prop: "scope" })).toBe("builtin.output.scope");
  });

  it("output 의 다른 속성은 문법 오류다", () => {
    expect(parse("builtin.output.name").ok).toBe(false);
    expect(parse("builtin.output@01").ok).toBe(false);
  });

  it("format 은 다시 파싱하면 같은 AST", () => {
    const src = "builtin.output ≠ 'replace' and builtin.output = 'special'";
    expect(ast(format(ast(src)))).toEqual(ast(src));
  });

  it("extractRefs 가 작성위치를 낸다", () => {
    expect(extractRefs(ast("builtin.output = 'block'")).map((r) => r.path)).toEqual(["builtin.output"]);
  });

  it("값 셋과 범위 낱말", () => {
    expect(OUTPUT_POSITIONS).toEqual(["replace", "block", "special"]);
    expect(SCOPE_WORDS).toEqual({ replace: "", block: "이 보장조항의", special: "이 특별약관의" });
  });
});

describe("작성위치 — 타입 검사", () => {
  it("= ≠ 와 세 코드 리터럴로 비교하면 boolean", () => {
    expect(issues("builtin.output = 'replace'", true, "boolean")).toEqual([]);
    expect(issues("builtin.output ≠ 'special' or builtin.output = 'block'", true, "boolean")).toEqual([]);
  });

  it("세 코드 밖의 리터럴은 brokenRef", () => {
    expect(issues("builtin.output = 'base'").map((i) => i.kind)).toEqual(["brokenRef"]);
  });

  it("= ≠ 밖의 연산 · 리터럴 아닌 우변 · 단독 · 집계는 typeMismatch", () => {
    expect(issues("builtin.output < 'replace'").map((i) => i.kind)).toEqual(["typeMismatch"]);
    expect(issues("builtin.output = builtin.output").map((i) => i.kind)).toEqual(["typeMismatch"]);
    expect(issues("builtin.output", true, "boolean").map((i) => i.kind)).toContain("typeMismatch");
    expect(issues("exist(builtin.output)").map((i) => i.kind)).toEqual(["typeMismatch"]);
  });

  it("범위 낱말은 슬롯 전용 — 글 타입, 비교에 못 쓴다", () => {
    const r = checkTypes(ast("builtin.output.scope"), () => undefined, { output: true });
    expect(r.ok && r.value).toEqual({ kind: "string" });
    expect(issues("builtin.output.scope = ''").map((i) => i.kind)).toEqual(["typeMismatch"]);
  });

  it("작성위치를 모르는 문맥(보통약관 · 조 사본 · 구분자 파생식)은 structure", () => {
    expect(issues("builtin.output = 'replace'", false).map((i) => i.kind)).toEqual(["structure"]);
    expect(issues("builtin.output.scope", false).map((i) => i.kind)).toEqual(["structure"]);
  });
});

describe("작성위치 — 평가", () => {
  const run = (src: string, output: EvalContext["output"]) => evaluate(ast(src), { ...blank, ...(output !== undefined ? { output } : {}) });

  it("문맥이 주는 값으로 비교한다", () => {
    expect(run("builtin.output = 'replace'", "replace")).toEqual({ kind: "value", value: true });
    expect(run("builtin.output ≠ 'replace'", "replace")).toEqual({ kind: "value", value: false });
    expect(run("builtin.output ≠ 'replace'", "special")).toEqual({ kind: "value", value: true });
  });

  it("범위 낱말은 작성위치로 찍는 글", () => {
    expect(run("builtin.output.scope", "special")).toEqual({ kind: "value", value: "이 특별약관의" });
    expect(run("builtin.output.scope", "replace")).toEqual({ kind: "value", value: "" });
    expect(run("builtin.output.scope", "block")).toEqual({ kind: "value", value: "이 보장조항의" });
  });

  it("문맥이 모르면 미결 (담보약관 저장 검사 · 담보 마스터 편집)", () => {
    expect(run("builtin.output = 'replace'", undefined)).toEqual({ kind: "undetermined", reason: "builtin.output" });
    // and 는 한쪽 false 로 결정된다
    expect(run("false and builtin.output = 'replace'", undefined)).toEqual({ kind: "value", value: false });
  });

  it("작성위치가 없는 문맥(보통약관)은 structure 오류", () => {
    const r = run("builtin.output = 'replace'", "none");
    expect(r.kind === "error" && r.issue.kind).toBe("structure");
    expect(r.kind === "error" && r.issue.at.refPath).toBe("builtin.output");
  });
});
