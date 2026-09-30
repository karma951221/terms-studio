import { describe, expect, it } from "vitest";

import type { Expr } from "./ast";
import { parse } from "./parser";
import { extractRefs, masterFieldPaths, requiredDiscriminatorCodes } from "./refs";

function ast(src: string): Expr {
  const r = parse(src);
  if (!r.ok) throw new Error(`파싱 실패: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

describe("extractRefs — 참조 추출", () => {
  it("단순 참조는 경로와 함께 나온다", () => {
    expect(extractRefs(ast("pay.exempt = true"))).toEqual([
      {
        ref: { kind: "master", form: "pay", field: "exempt" },
        path: "pay.exempt",
      },
    ]);
  });

  it("집계 안의 경로는 어느 집계인지 표시된다", () => {
    expect(extractRefs(ast("any(pay.exempt)"))).toEqual([
      {
        ref: { kind: "master", form: "pay", field: "exempt" },
        path: "pay.exempt",
        aggregate: "any",
      },
    ]);
  });

  it("담보속성 참조와 내장 경로는 종류로 구분된다", () => {
    const refs = extractRefs(ast("exist(attr.renew) and attr.add = 'x' and builtin.subCoverage.name = 'a'"));
    expect(refs).toEqual([
      { ref: { kind: "attr", code: "renew" }, path: "attr.renew", aggregate: "exist" },
      { ref: { kind: "attr", code: "add" }, path: "attr.add" },
      { ref: { kind: "builtin", level: "subCoverage", prop: "name" }, path: "builtin.subCoverage.name" },
    ]);
  });

  it("같은 경로·같은 쓰임은 한 번만, 등장 순서대로 나온다", () => {
    const refs = extractRefs(ast("a = 1 or (b and a = 2) or any(a)"));
    expect(refs.map((r) => [r.path, r.aggregate])).toEqual([
      ["a", undefined],
      ["b", undefined],
      ["a", "any"],
    ]);
  });

  it("리터럴만 있는 식은 참조가 없다", () => {
    expect(extractRefs(ast("1 = 1"))).toEqual([]);
  });

  it("not 안의 참조도 추출된다", () => {
    expect(extractRefs(ast("not renew")).map((r) => r.path)).toEqual(["renew"]);
  });
});

describe("requiredDiscriminatorCodes — 요구 구분자 집합 (문면이 읽는 구분자)", () => {
  it("구분자 코드만 중복 없이 돌려준다 (담보속성·내장 경로 제외)", () => {
    expect(
      requiredDiscriminatorCodes(
        ast("D0001 = 'x' and D0002 > 50 and exist(attr.renew) and D0001 ≠ 'y' and builtin.benefit.name = 'z'"),
      ),
    ).toEqual(["D0001", "D0002"]);
  });
});

describe("masterFieldPaths — 구분자 식이 읽는 입력 항목 (역인덱스 1단)", () => {
  it("마스터 경로만 중복 없이 돌려준다", () => {
    expect(
      masterFieldPaths(
        ast("any(pay.exempt) and coverage_basic.claim_name ≠ '' and sum(pay.exempt) > 0 and D0001 = 'x'"),
      ),
    ).toEqual(["pay.exempt", "coverage_basic.claim_name"]);
  });
});

describe("노드 한정자 — 다른 노드는 다른 참조다 (ADR-0066 §1)", () => {
  it("extractRefs 의 path 에 한정자가 들어가고, 같은 코드 다른 노드는 다른 참조다", () => {
    const expr = ast("D0002@n1 = true and D0002@n2 = true and D0002 = true");
    expect(extractRefs(expr).map((r) => r.path)).toEqual(["D0002@n1", "D0002@n2", "D0002"]);
    expect(requiredDiscriminatorCodes(expr)).toEqual(["D0002"]);
  });
});

