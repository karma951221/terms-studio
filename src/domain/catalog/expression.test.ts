import { describe, expect, it } from "vitest";

import { parse } from "../expression";
import type { Issue } from "../types";
import {
  checkDiscriminatorExpression,
  checkReferenceRules,
  checkReferenceCycle,
  checkResultType,
  discriminatorResultType,
  discriminatorWarnings,
  inspectExpression,
  planFormOf,
  planFormScope,
} from "./expression";
import type { Discriminator } from "./types";

function issues(source: string, level: Parameters<typeof checkDiscriminatorExpression>[1]): Issue[] {
  const r = checkDiscriminatorExpression(source, level);
  if (r.ok) return [];
  if (r.rejection.reason !== "invalid") throw new Error("unreachable");
  return r.rejection.issues;
}

function typeOf(source: string, level: Parameters<typeof checkDiscriminatorExpression>[1]) {
  const r = checkDiscriminatorExpression(source, level);
  if (!r.ok) throw new Error(`검증 실패: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

const CATALOG: ReadonlyMap<string, Discriminator> = new Map(
  (
    [
      ["D0001", "coverage", "coverage_basic.claim_name"],
      ["D0002", "coverage", "any(pay.exempt)"],
      ["D0004", "product", "any(waiver.applies)"],
      ["D0005", "product", "not all(waiver.applies)"],
      ["D0006", "product", "D0004 and D0005"],
      ["D0007", "plan", "no_surrender.type = 'V01'"],
      ["D0008", "product", "notexist(no_surrender.type) or any(D0007)"],
      ["D0012", "plan", "not D0007"],
      ["D0013", "plan", "builtin.plan.name = '무배당'"],
      ["D0020", "benefit", "pay.exempt"],
      // 순환 — 정의 저장은 거부되지만 카탈로그에 이미 있다고 치고 타입 조회가 멈추는지 본다
      ["D0090", "product", "D0091"],
      ["D0091", "product", "D0090"],
    ] as const
  ).map(([code, level, expression]) => [code, { code, label: code, description: "", level, expression }]),
);

function issuesIn(source: string, level: Parameters<typeof checkDiscriminatorExpression>[1]): Issue[] {
  const r = checkDiscriminatorExpression(source, level, { catalog: CATALOG });
  if (r.ok) return [];
  if (r.rejection.reason !== "invalid") throw new Error("unreachable");
  return r.rejection.issues;
}

function typeIn(source: string, level: Parameters<typeof checkDiscriminatorExpression>[1]) {
  const r = checkDiscriminatorExpression(source, level, { catalog: CATALOG });
  if (!r.ok) throw new Error(`검증 실패: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

describe("규칙 1 — 마스터 필드와 구분자를 참조한다 (기능/구분자 §3.2)", () => {
  it("카탈로그를 안 주면 구분자 참조는 brokenRef 다 (모르는 참조)", () => {
    const found = issues("D0001", "coverage");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "brokenRef", at: { refPath: "D0001" } });
  });

  it("카탈로그에 없는 구분자는 brokenRef 다", () => {
    expect(issuesIn("D0099", "coverage")[0]).toMatchObject({ kind: "brokenRef", at: { refPath: "D0099" } });
    expect(issuesIn("any(D0099)", "product")[0]).toMatchObject({ kind: "brokenRef", at: { refPath: "D0099" } });
  });

  it("같은 레벨 구분자는 그대로 참조한다", () => {
    expect(typeIn("D0004 and D0005", "product")).toEqual({ kind: "boolean" });
    expect(typeIn("D0002", "coverage")).toEqual({ kind: "boolean" });
    expect(typeIn("D0001", "coverage")).toEqual({ kind: "string" });
  });

  it("하위 레벨 구분자는 집계 안에서만 — 집계 없이 쓰면 거부한다", () => {
    expect(typeIn("any(D0007)", "product")).toEqual({ kind: "boolean" });
    expect(typeIn("not all(D0007)", "product")).toEqual({ kind: "boolean" });
    const found = issuesIn("D0007", "product");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "typeMismatch", at: { refPath: "D0007" } });
    expect(found[0].message).toContain("집계");
  });

  it("상위 레벨 구분자는 집계가 있든 없든 거부한다", () => {
    expect(issuesIn("D0002", "benefit")[0].message).toContain("상위 레벨");
    expect(issuesIn("any(D0004)", "coverage")[0].message).toContain("상위 레벨");
  });

  it("참조한 구분자의 결과 타입이 타입 검사에 흐른다", () => {
    expect(typeIn("D0002 = true", "coverage")).toEqual({ kind: "boolean" });
    const bad = issuesIn("D0001 = true", "coverage");
    expect(bad[0]).toMatchObject({ kind: "typeMismatch", at: { refPath: "D0001" } });
    expect(bad[0].message).toContain("string = boolean");
  });

  it("구분자 → 구분자 → 필드 — 참조를 타고 들어가 타입을 푼다", () => {
    expect(typeIn("D0006", "product")).toEqual({ kind: "boolean" });
    expect(typeIn("D0008 and D0006", "product")).toEqual({ kind: "boolean" });
    expect(discriminatorResultType(CATALOG.get("D0006")!, undefined, CATALOG)).toEqual({ kind: "boolean" });
  });

  it("카탈로그 안에 순환이 있으면 그 구분자의 타입은 모름(brokenRef)이다 — 무한 재귀하지 않는다", () => {
    expect(issuesIn("D0090", "product")[0]).toMatchObject({ kind: "brokenRef", at: { refPath: "D0090" } });
    expect(discriminatorResultType(CATALOG.get("D0090")!, undefined, CATALOG)).toBeUndefined();
  });

  it("마스터에 없는 경로는 brokenRef 다 — 파서는 모양만 보고, 존재는 여기서 본다 (기능/마스터 §3.2)", () => {
    expect(issues("coverage_basic.nope", "coverage")[0]).toMatchObject({
      kind: "brokenRef",
      at: { refPath: "coverage_basic.nope" },
    });
    expect(issues("nope.claim_name", "coverage")[0]).toMatchObject({
      kind: "brokenRef",
      at: { refPath: "nope.claim_name" },
    });
  });

  it("담보속성 · 내장 경로는 그대로 쓸 수 있다", () => {
    expect(typeOf("exist(attr.A0001)", "coverage")).toEqual({ kind: "boolean" });
    expect(typeOf("builtin.coverage.name", "coverage")).toEqual({ kind: "string" });
  });
});

describe("세목 레벨 구분자는 폼 하나만 읽는다 (설계 §2.3 항목 3)", () => {
  it("세목 폼 둘을 직접 읽으면 거부한다", () => {
    const found = issuesIn("no_surrender.type = 'V01' and waiver.applies", "plan");
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe("typeMismatch");
    expect(found[0].message).toContain("세목 레벨 구분자는 폼 하나만 읽는다");
    expect(found[0].message).toContain("no_surrender");
    expect(found[0].message).toContain("waiver");
  });

  it("구분자 참조를 타고 들어간 폼도 센다", () => {
    expect(issuesIn("D0007 and waiver.applies", "plan")[0].message).toContain("세목 레벨 구분자는 폼 하나만 읽는다");
    expect(typeIn("D0007 and no_surrender.type ≠ 'V02'", "plan")).toEqual({ kind: "boolean" });
    expect(typeIn("D0012 or D0007", "plan")).toEqual({ kind: "boolean" });
  });

  it("세목 폼이 아닌 자리(하위 레벨 집계 · 내장 경로)는 폼 수에 안 든다", () => {
    expect(typeIn("no_surrender.type = 'V01' and exist(coverage_basic.claim_name)", "plan")).toEqual({ kind: "boolean" });
    expect(typeIn("D0007 and builtin.plan.name = '무배당'", "plan")).toEqual({ kind: "boolean" });
  });

  it("다른 레벨에는 이 규칙이 없다", () => {
    expect(typeIn("any(waiver.applies) and exist(no_surrender.type)", "product")).toEqual({ kind: "boolean" });
  });
});

describe("planFormOf — 세목 레벨 구분자가 읽는 폼키", () => {
  it("직접 읽는 폼키를 돌려준다", () => {
    expect(planFormOf(CATALOG.get("D0007")!, CATALOG)).toBe("no_surrender");
  });

  it("구분자 참조를 타고 들어가 폼키를 찾는다", () => {
    expect(planFormOf(CATALOG.get("D0012")!, CATALOG)).toBe("no_surrender");
    expect(planFormOf({ level: "plan", expression: "not D0012 and D0007" }, CATALOG)).toBe("no_surrender");
  });

  it("세목 폼을 하나도 안 읽으면 undefined 다 — planFormScope 는 「전부」(all)", () => {
    expect(planFormOf(CATALOG.get("D0013")!, CATALOG)).toBeUndefined();
    expect(planFormOf({ level: "plan", expression: "exist(coverage_basic.claim_name)" }, CATALOG)).toBeUndefined();
    expect(planFormScope(CATALOG.get("D0013")!, CATALOG)).toEqual({ kind: "all" });
    expect(planFormScope(CATALOG.get("D0007")!, CATALOG)).toEqual({ kind: "form", form: "no_surrender" });
  });

  it("planFormScope 는 「안 읽음」과 「깨짐」을 가른다 — 깨진 정의를 선택지 전부로 평가하지 않도록 (코덱스 리뷰 2026-09-14 Important-1)", () => {
    expect(planFormScope({ level: "plan", expression: "D0007 and waiver.applies" }, CATALOG)).toEqual({ kind: "invalid", forms: ["no_surrender", "waiver"] });
    expect(planFormScope({ level: "plan", expression: "no_surrender.type =" }, CATALOG)).toEqual({ kind: "invalid", forms: [] });
    expect(planFormScope(CATALOG.get("D0004")!, CATALOG)).toEqual({ kind: "invalid", forms: [] });
  });

  it("둘 이상 읽거나 · 순환이거나 · 세목 레벨이 아니거나 · 문법이 틀리면 undefined 다", () => {
    expect(planFormOf({ level: "plan", expression: "D0007 and waiver.applies" }, CATALOG)).toBeUndefined();
    const cyclic = new Map(CATALOG);
    cyclic.set("D0092", { code: "D0092", label: "", description: "", level: "plan", expression: "D0093" });
    cyclic.set("D0093", { code: "D0093", label: "", description: "", level: "plan", expression: "D0092 and no_surrender.type = 'V01'" });
    expect(planFormOf(cyclic.get("D0092")!, cyclic)).toBeUndefined();
    expect(planFormOf(CATALOG.get("D0004")!, CATALOG)).toBeUndefined();
    expect(planFormOf({ level: "plan", expression: "no_surrender.type =" }, CATALOG)).toBeUndefined();
  });
});

describe("규칙 2 · 3 — 같은 레벨은 직접 · 하위는 집계 안 · 상위는 거부", () => {
  it("같은 레벨 필드는 그대로 쓴다", () => {
    expect(typeOf("coverage_basic.claim_name", "coverage")).toEqual({ kind: "string" });
    expect(typeOf("waiver.applies", "plan")).toEqual({ kind: "boolean" });
  });

  it("하위 레벨 필드를 집계 없이 쓰면 거부한다", () => {
    const found = issues("coverage_basic.claim_name", "plan");
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("집계");
    expect(found[0].at.refPath).toBe("coverage_basic.claim_name");
  });

  it("하위 레벨 필드는 집계 안에서 쓸 수 있다", () => {
    expect(typeOf("count(coverage_basic.claim_name)", "plan")).toEqual({ kind: "number" });
    expect(typeOf("exist(coverage_basic.claim_name)", "product")).toEqual({ kind: "boolean" });
  });

  it("상위 레벨 필드는 집계가 있든 없든 거부한다 (MVP 는 상위 → 하위만)", () => {
    const direct = issues("waiver.applies", "benefit");
    expect(direct[0].message).toContain("상위 레벨");
    const inAggregate = issues("any(waiver.applies)", "benefit");
    expect(inAggregate[0].message).toContain("상위 레벨");
  });
});

describe("규칙 4 — 파서 · 타입 검사", () => {
  it("빈 식 · 문법 오류를 거부한다", () => {
    expect(issues("   ", "coverage")[0].kind).toBe("syntax");
    expect(issues("coverage_basic.claim_name and", "coverage")[0].kind).toBe("syntax");
  });

  it("타입이 맞지 않으면 typeMismatch 다", () => {
    expect(issues("waiver.applies > 1", "plan")[0].kind).toBe("typeMismatch");
    expect(issues("any(coverage_basic.claim_name)", "plan")[0].kind).toBe("typeMismatch"); // any 는 boolean 경로만
  });

  it("결과 타입은 식에서 추론한다 — 정의에 표기하지 않는다", () => {
    expect(typeOf("waiver.applies = true", "plan")).toEqual({ kind: "boolean" });
    expect(typeOf("no_surrender.type", "plan")).toEqual({ kind: "enum", enumCode: "E0002" });
    expect(typeOf("waiver.reasons", "plan")).toEqual({ kind: "list<enum>", enumCode: "E0001" });
  });

  it("담보속성 유효값을 주면 리터럴을 그 목록으로 검사한다", () => {
    const attributeValues = (code: string) => (code === "A0001" ? ["1", "2"] : undefined);
    const bad = checkDiscriminatorExpression("attr.A0001 = '9'", "coverage", { attributeValues });
    expect(bad.ok).toBe(false);
    const good = checkDiscriminatorExpression("attr.A0001 = '2'", "coverage", { attributeValues });
    expect(good.ok).toBe(true);
  });

  it("호출자가 준 좌표 위에 refPath 를 얹는다", () => {
    const r = checkDiscriminatorExpression("D0001", "coverage", {
      coordinate: { document: "clause", articleTitle: "소멸" },
    });
    expect(r.ok).toBe(false);
    if (r.ok || r.rejection.reason !== "invalid") return;
    expect(r.rejection.issues[0].at).toMatchObject({ document: "clause", refPath: "D0001" });
  });
});

describe("checkResultType — 명시 결과 타입과 추론 타입 대조 (기능/구분자 §3.1)", () => {
  it("kind 가 같으면 통과한다", () => {
    expect(checkResultType({ kind: "boolean" }, { kind: "boolean" })).toEqual([]);
    expect(checkResultType({ kind: "enum", enumCode: "E0002" }, { kind: "enum", enumCode: "E0002" })).toEqual([]);
  });

  it("kind 가 다르면 typeMismatch — 문구에 두 kind 를 담는다", () => {
    const found = checkResultType({ kind: "boolean" }, { kind: "string" });
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe("typeMismatch");
    expect(found[0].message).toContain("boolean");
    expect(found[0].message).toContain("string");
  });

  it("enum 계열인데 enumCode 가 다르면 typeMismatch", () => {
    const found = checkResultType({ kind: "enum", enumCode: "E0001" }, { kind: "enum", enumCode: "E0002" });
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe("typeMismatch");
    expect(found[0].message).toContain("E0001");
    expect(found[0].message).toContain("E0002");
  });

  it("list<enum> 도 enumCode 대조를 본다", () => {
    const found = checkResultType({ kind: "list<enum>", enumCode: "E0001" }, { kind: "list<enum>", enumCode: "E0002" });
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe("typeMismatch");
  });

  it("추론이 담보속성(attribute)이면 typeMismatch — 결과 타입이 아니다", () => {
    const found = checkResultType({ kind: "boolean" }, { kind: "attribute" });
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe("typeMismatch");
    expect(found[0].message).toContain("담보속성은 결과 타입이 아닙니다");
  });
});

describe("discriminatorResultType — 명시 타입이 있으면 그것을 그대로 돌려준다 (기능/구분자 §3.1)", () => {
  it("식과 무관하게 resultType 을 돌려준다 — 추론하지 않는다", () => {
    const def = {
      code: "D0099",
      level: "coverage" as const,
      expression: "coverage_basic.claim_name", // 식은 string 이지만
      resultType: { kind: "boolean" as const }, // 명시 타입이 정본이다
    };
    expect(discriminatorResultType(def)).toEqual({ kind: "boolean" });
  });
});

describe("checkReferenceRules — 참조 규칙만 따로", () => {
  it("여러 위반을 한 번에 모은다", () => {
    const parsed = parse("D0001 = 'x' and coverage_basic.claim_name ≠ 'y'");
    if (!parsed.ok) throw new Error("파싱 실패");
    expect(checkReferenceRules(parsed.value, "plan").map((i) => i.kind)).toEqual([
      "brokenRef", // 카탈로그 없음 — 구분자 D0001 을 모른다
      "typeMismatch", // 하위 레벨 필드를 집계 없이
    ]);
    expect(checkReferenceRules(parsed.value, "plan", {}, undefined, CATALOG).map((i) => i.kind)).toEqual([
      "typeMismatch", // 담보 레벨 구분자를 세목 레벨에서 집계 없이
      "typeMismatch",
    ]);
  });

  it("구분자코드.필드(옛 구조체 필드 모양)는 파서를 지나 여기서 brokenRef 다 — 그런 폼이 마스터에 없다", () => {
    const parsed = parse("D0001.F01");
    if (!parsed.ok) throw new Error("파싱 실패");
    expect(checkReferenceRules(parsed.value, "coverage")).toEqual([
      expect.objectContaining({ kind: "brokenRef", at: { refPath: "D0001.F01" } }),
    ]);
  });
});

describe("discriminatorWarnings — 별칭 경고 (기능/구분자 §3.2)", () => {
  it("식이 구분자 하나뿐이면 별칭 경고 — 참조 경로를 문구에 담는다", () => {
    const w = discriminatorWarnings({ expression: "D0001", level: "coverage" }, { catalog: CATALOG });
    expect(w).toEqual([
      expect.objectContaining({ kind: "alias", severity: "warning", at: { refPath: "D0001" } }),
    ]);
    expect(w[0].message).toBe("별칭입니다 — 이 구분자는 D0001 하나를 그대로 돌려줍니다");
  });

  it("식이 마스터 필드 하나뿐이어도 별칭 경고 — 항등 투영은 허용하되 경고 (ADR-0036 §2)", () => {
    const w = discriminatorWarnings({ expression: "coverage_basic.claim_name", level: "coverage" }, {});
    expect(w.map((i) => [i.kind, i.severity, i.at.refPath])).toEqual([["alias", "warning", "coverage_basic.claim_name"]]);
  });

  it("집계 하나 · 비교 · 리터럴 · 내장 경로 · 담보속성은 별칭이 아니다", () => {
    for (const source of ["any(pay.exempt)", "coverage_basic.claim_name = 'x'", "'2.5%'", "builtin.plan.name", "attr.A0001", "not D0002"]) {
      expect(discriminatorWarnings({ expression: source, level: "coverage" }, { catalog: CATALOG }), source).toEqual([]);
    }
  });

  it("파싱 안 되는 식은 경고를 내지 않는다 — 오류는 검사가 따로 낸다", () => {
    expect(discriminatorWarnings({ expression: "D0001 and", level: "coverage" }, { catalog: CATALOG })).toEqual([]);
  });
});

describe("checkReferenceCycle — 자기 참조 · 순환 (기능/구분자 §3.2)", () => {
  it("자기 자신을 부르면 오류", () => {
    expect(checkReferenceCycle("D0001", "D0001 = 'x'", CATALOG)).toEqual([
      expect.objectContaining({ kind: "typeMismatch", message: "구분자 D0001 는 자기 자신을 참조할 수 없습니다" }),
    ]);
  });

  it("카탈로그를 따라 돌아오면 경로를 담은 오류", () => {
    // D0006 = D0004 and D0005 — D0004 의 새 식이 D0006 을 부르면 D0004 → D0006 → D0004
    expect(checkReferenceCycle("D0004", "D0006", CATALOG)[0]?.message).toBe("구분자 참조가 순환합니다: D0004 → D0006 → D0004");
  });

  it("순환이 없으면 빈 배열", () => {
    expect(checkReferenceCycle("D0099", "D0006", CATALOG)).toEqual([]);
  });
});

describe("inspectExpression — 오류 · 경고 · 추론 타입을 한 번에 (기능/구분자 §3.3)", () => {
  it("오류 없는 식 — errors 비고 inferred 가 채워진다", () => {
    const r = inspectExpression({ expression: "any(pay.exempt)", level: "coverage" }, { catalog: CATALOG });
    expect(r).toEqual({ errors: [], warnings: [], inferred: { kind: "boolean" } });
  });

  it("별칭이면 warnings 에 alias 가 들고 inferred 도 온다 — 경고는 저장을 막지 않는다", () => {
    const r = inspectExpression({ expression: "D0002", level: "coverage" }, { catalog: CATALOG });
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((i) => i.kind)).toEqual(["alias"]);
    expect(r.inferred).toEqual({ kind: "boolean" });
  });

  it("문법 오류 — errors 에 syntax · inferred 없음 · 경고 없음", () => {
    const r = inspectExpression({ expression: "any(", level: "coverage" }, { catalog: CATALOG });
    expect(r.errors.map((i) => i.kind)).toEqual(["syntax"]);
    expect(r.inferred).toBeUndefined();
    expect(r.warnings).toEqual([]);
  });

  it("명시 타입 ≠ 추론 타입은 errors 에 들고 inferred 는 그대로 온다 (채울 수 있으니)", () => {
    const r = inspectExpression({ expression: "any(pay.exempt)", level: "coverage", resultType: { kind: "string" } }, { catalog: CATALOG });
    expect(r.errors).toEqual([expect.objectContaining({ kind: "typeMismatch" })]);
    expect(r.errors[0].message).toContain("명시한 결과 타입 string");
    expect(r.inferred).toEqual({ kind: "boolean" });
  });

  it("code 가 있으면 자기 참조 · 순환도 errors 에 든다 — 생성(code 없음)에서는 안 본다", () => {
    const withCode = inspectExpression({ code: "D0004", expression: "D0006", level: "product" }, { catalog: CATALOG });
    expect(withCode.errors.map((i) => i.message)).toEqual(["구분자 참조가 순환합니다: D0004 → D0006 → D0004"]);
    const without = inspectExpression({ expression: "D0006", level: "product" }, { catalog: CATALOG });
    expect(without.errors).toEqual([]);
    expect(without.warnings.map((i) => i.kind)).toEqual(["alias"]);
  });

  it("오류가 있으면 경고는 내지 않는다 — 별칭 + 명시 타입 불일치면 오류만 (고칠 것 하나씩), 추론은 온다", () => {
    const r = inspectExpression({ expression: "D0002", level: "coverage", resultType: { kind: "number" } }, { catalog: CATALOG });
    expect(r.errors).toHaveLength(1);
    expect(r.warnings).toEqual([]);
    expect(r.inferred).toEqual({ kind: "boolean" });
  });

  it("모르는 구분자 하나뿐인 식 — brokenRef 오류만, 별칭 경고 없음", () => {
    const r = inspectExpression({ expression: "D9999", level: "coverage" }, { catalog: CATALOG });
    expect(r.errors.map((i) => i.kind)).toEqual(["brokenRef"]);
    expect(r.warnings).toEqual([]);
  });
});
