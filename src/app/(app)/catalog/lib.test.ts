import { describe, expect, it } from "vitest";

import type { Issue } from "@/domain/types";

import type { Discriminator } from "@/domain/catalog/types";
import type { MasterForm } from "@/domain/master";

import { bool, fieldTypeFrom, insertAt, insertPanelData, insideAggregate, inspectInputFrom, OPERATOR_TOKENS, referenceToken, resultTypeFromForm, resultTypeLabel, resultTypeSavePlan, resultTypeToForm, sameInspectInput, str, valueFromInput, warningBadges } from "./lib";

describe("catalog lib — FormData 파싱 (순수)", () => {
  it("str — trim 된 문자열, 없으면 빈 문자열", () => {
    const fd = new FormData();
    fd.set("a", "  hi  ");
    expect(str(fd, "a")).toBe("hi");
    expect(str(fd, "b")).toBe("");
  });

  it("bool — 체크박스 on/true 만 참", () => {
    const fd = new FormData();
    fd.set("a", "on");
    expect(bool(fd, "a")).toBe(true);
    expect(bool(fd, "b")).toBe(false);
  });

  it("fieldTypeFrom — scalar 4종은 그대로, enum/list<enum> 은 enumCode 필요", () => {
    expect(fieldTypeFrom("string", "")).toEqual({ kind: "string" });
    expect(fieldTypeFrom("number", "")).toEqual({ kind: "number" });
    expect(fieldTypeFrom("boolean", "")).toEqual({ kind: "boolean" });
    expect(fieldTypeFrom("date", "")).toEqual({ kind: "date" });
    expect(fieldTypeFrom("enum", "")).toBeUndefined();
    expect(fieldTypeFrom("enum", "E0001")).toEqual({ kind: "enum", enumCode: "E0001" });
    expect(fieldTypeFrom("list<enum>", "E0001")).toEqual({ kind: "list<enum>", enumCode: "E0001" });
    expect(fieldTypeFrom("bogus", "")).toBeUndefined();
  });

  it("valueFromInput — 빈 문자열은 undefined, 타입별로 파싱", () => {
    expect(valueFromInput({ kind: "string" }, "")).toBeUndefined();
    expect(valueFromInput({ kind: "string" }, "hi")).toBe("hi");
    expect(valueFromInput({ kind: "number" }, "3.5")).toBe(3.5);
    expect(valueFromInput({ kind: "boolean" }, "true")).toBe(true);
    expect(valueFromInput({ kind: "boolean" }, "false")).toBe(false);
    expect(valueFromInput({ kind: "date" }, "2026-01-01")).toBe("2026-01-01");
    expect(valueFromInput({ kind: "enum", enumCode: "E0001" }, "V01")).toBe("V01");
    expect(valueFromInput({ kind: "list<enum>", enumCode: "E0001" }, "V01, V02")).toEqual(["V01", "V02"]);
  });
});

describe("catalog lib — 결과 타입 폼 ↔ DiscriminatorResultType (기능/구분자 §3.1)", () => {
  it("resultTypeFromForm — 빈 종류는 미지정(undefined), scalar 는 그대로", () => {
    expect(resultTypeFromForm("", false, "")).toBeUndefined();
    expect(resultTypeFromForm("string", false, "")).toEqual({ kind: "string" });
    expect(resultTypeFromForm("number", true, "E0001")).toEqual({ kind: "number" });
    expect(resultTypeFromForm("boolean", false, "")).toEqual({ kind: "boolean" });
  });

  it("resultTypeFromForm — 목록값은 복수 여부로 enum / list<enum> 이 갈린다", () => {
    expect(resultTypeFromForm("enum", false, "E0001")).toEqual({ kind: "enum", enumCode: "E0001" });
    expect(resultTypeFromForm("enum", true, "E0001")).toEqual({ kind: "list<enum>", enumCode: "E0001" });
  });

  it("resultTypeFromForm — 화면 옵션에 없는 종류(폼 변조, 예: table)는 미지정으로 취급한다 — 도메인에 닿지 않게", () => {
    expect(resultTypeFromForm("table", false, "")).toBeUndefined();
    expect(resultTypeFromForm("bogus", false, "")).toBeUndefined();
  });

  it("resultTypeFromForm — 열거형변수를 안 고른 실수는 미지정으로 바꾸지 않고 빈 enumCode 로 넘긴다 (서비스가 brokenRef 로 거부)", () => {
    expect(resultTypeFromForm("enum", false, "")).toEqual({ kind: "enum", enumCode: "" });
    expect(resultTypeFromForm("enum", true, "")).toEqual({ kind: "list<enum>", enumCode: "" });
  });

  it("resultTypeToForm — 역변환. list<enum> 은 종류 enum + 복수", () => {
    expect(resultTypeToForm(undefined)).toEqual({ kind: "", multi: false, enumCode: "" });
    expect(resultTypeToForm({ kind: "boolean" })).toEqual({ kind: "boolean", multi: false, enumCode: "" });
    expect(resultTypeToForm({ kind: "enum", enumCode: "E0001" })).toEqual({ kind: "enum", multi: false, enumCode: "E0001" });
    expect(resultTypeToForm({ kind: "list<enum>", enumCode: "E0001" })).toEqual({ kind: "enum", multi: true, enumCode: "E0001" });
  });

  it("resultTypeToForm ∘ resultTypeFromForm 은 항등이다", () => {
    const types = [
      { kind: "string" },
      { kind: "date" },
      { kind: "enum", enumCode: "E0002" },
      { kind: "list<enum>", enumCode: "E0002" },
    ] as const;
    for (const t of types) {
      const f = resultTypeToForm(t);
      expect(resultTypeFromForm(f.kind, f.multi, f.enumCode)).toEqual(t);
    }
  });

  it("resultTypeLabel — 한글 타입명, enum 이면 열거형변수 표시명(없으면 코드)을 붙인다", () => {
    const enumLabel = (code: string) => (code === "E0001" ? "해약환급금유형" : undefined);
    expect(resultTypeLabel(undefined, enumLabel)).toBe("미지정");
    expect(resultTypeLabel({ kind: "boolean" }, enumLabel)).toBe("참거짓");
    expect(resultTypeLabel({ kind: "enum", enumCode: "E0001" }, enumLabel)).toBe("목록값 · 해약환급금유형");
    expect(resultTypeLabel({ kind: "list<enum>", enumCode: "E0001" }, enumLabel)).toBe("목록값(복수) · 해약환급금유형");
    expect(resultTypeLabel({ kind: "enum", enumCode: "E9999" }, enumLabel)).toBe("목록값 · E9999");
  });

  it("resultTypeSavePlan — 같으면 none (깊은 비교)", () => {
    expect(resultTypeSavePlan(undefined, undefined, true)).toBe("none");
    expect(resultTypeSavePlan({ kind: "boolean" }, { kind: "boolean" }, true)).toBe("none");
    expect(resultTypeSavePlan({ kind: "enum", enumCode: "E0001" }, { kind: "enum", enumCode: "E0001" }, false)).toBe("none");
  });

  it("resultTypeSavePlan — 다르고 식은 그대로면 set, 식도 바뀌었으면 clearThenSet", () => {
    expect(resultTypeSavePlan(undefined, { kind: "boolean" }, false)).toBe("set");
    expect(resultTypeSavePlan({ kind: "boolean" }, undefined, false)).toBe("set");
    expect(resultTypeSavePlan({ kind: "enum", enumCode: "E0001" }, { kind: "enum", enumCode: "E0002" }, false)).toBe("set");
    expect(resultTypeSavePlan({ kind: "boolean" }, { kind: "number" }, true)).toBe("clearThenSet");
    expect(resultTypeSavePlan(undefined, { kind: "number" }, true)).toBe("clearThenSet");
    expect(resultTypeSavePlan({ kind: "number" }, undefined, true)).toBe("clearThenSet");
  });
});

describe("catalog lib — 「검사」 입력과 오래됨 판정 (기능/구분자 §3.3)", () => {
  const form = { expression: " any(pay.exempt) ", resultTypeKind: "enum", resultTypeMulti: true, resultTypeEnum: "E0001" };

  it("inspectInputFrom — 폼 모양을 서비스 입력으로 (식은 trim · 결과 타입은 도메인 타입 · code 는 있을 때만)", () => {
    expect(inspectInputFrom("D0001", "coverage", form)).toEqual({ code: "D0001", expression: "any(pay.exempt)", level: "coverage", resultType: { kind: "list<enum>", enumCode: "E0001" } });
    expect(inspectInputFrom(undefined, "benefit", { ...form, resultTypeKind: "" })).toEqual({ expression: "any(pay.exempt)", level: "benefit" });
  });

  it("sameInspectInput — 식 · 레벨 · 결과 타입이 전부 같아야 같다 (결과가 오래됐는지 보는 기준)", () => {
    const a = inspectInputFrom("D0001", "coverage", form);
    expect(sameInspectInput(a, inspectInputFrom("D0001", "coverage", { ...form, expression: "any(pay.exempt)" }))).toBe(true);
    expect(sameInspectInput(a, inspectInputFrom("D0001", "coverage", { ...form, expression: "all(pay.exempt)" }))).toBe(false);
    expect(sameInspectInput(a, inspectInputFrom("D0001", "coverage", { ...form, resultTypeMulti: false }))).toBe(false);
    expect(sameInspectInput(a, inspectInputFrom("D0001", "coverage", { ...form, resultTypeEnum: "E0002" }))).toBe(false);
    expect(sameInspectInput(a, inspectInputFrom("D0001", "benefit", form))).toBe(false);
    expect(sameInspectInput(a, inspectInputFrom("D0001", "coverage", { ...form, resultTypeKind: "" }))).toBe(false);
  });
});

describe("catalog lib — 경고 배지 (기능/구분자 §3.3 「경고는 배지로 남는다」)", () => {
  const alias: Issue = { kind: "alias", severity: "warning", message: "별칭입니다 — 이 구분자는 D0002 하나를 그대로 돌려줍니다", at: { refPath: "D0002" } };
  const brk = (n: number): Issue => ({ kind: "typeMismatch", severity: "warning", message: `슬롯 사용처 ${n} 가 깨집니다`, at: {} });

  it("별칭은 「별칭」 하나, 사용처 경고는 건수를 묶어 「깨질 사용처 N」 — title 에 문구", () => {
    expect(warningBadges([alias, brk(1), brk(2)])).toEqual([
      { label: "별칭", title: alias.message },
      { label: "깨질 사용처 2", title: "슬롯 사용처 1 가 깨집니다\n슬롯 사용처 2 가 깨집니다" },
    ]);
  });

  it("경고가 없으면 빈 배열", () => {
    expect(warningBadges([])).toEqual([]);
  });
});

describe("catalog lib — 넣기 패널 (기능/구분자 §4.3)", () => {
  it("insertAt — 커서 자리에 넣고 커서는 넣은 텍스트 뒤로", () => {
    expect(insertAt("", 0, "D0001")).toEqual({ value: "D0001", cursor: 5 });
    expect(insertAt("any()", 4, "pay.exempt")).toEqual({ value: "any(pay.exempt)", cursor: 14 });
  });

  it("insertAt — 앞뒤에 글자가 붙어 있으면 공백을 넣어 토큰을 뗀다 (괄호 안쪽은 붙인다)", () => {
    expect(insertAt("D0001", 5, "and")).toEqual({ value: "D0001 and", cursor: 9 });
    expect(insertAt("D0001 and", 9, "D0002")).toEqual({ value: "D0001 and D0002", cursor: 15 });
    expect(insertAt("D0001D0002", 5, "and")).toEqual({ value: "D0001 and D0002", cursor: 9 });
    expect(insertAt("(x)", 1, "not")).toEqual({ value: "(not x)", cursor: 4 });
  });

  it("insertAt — caret 을 주면 넣은 텍스트 안 그 자리에 커서 (집계 괄호 안)", () => {
    expect(insertAt("", 0, "any()", 4)).toEqual({ value: "any()", cursor: 4 });
    expect(insertAt("D0001 and", 9, "any()", 4)).toEqual({ value: "D0001 and any()", cursor: 14 });
  });

  it("referenceToken — 같은 레벨은 경로 그대로 · 하위는 참거짓 any(…) · 숫자 sum(…) · 그 밖(문자열 · 목록값 · 모름)은 exist(…) · 상위는 undefined", () => {
    expect(referenceToken("coverage_basic.claim_name", "coverage", "coverage")).toBe("coverage_basic.claim_name");
    expect(referenceToken("pay.exempt", "benefit", "coverage", "boolean")).toBe("any(pay.exempt)");
    expect(referenceToken("pay.rate", "benefit", "coverage", "number")).toBe("sum(pay.rate)");
    // any/all 은 boolean 경로만 받는다 (typecheck) — 문자열 · 목록값을 any 로 감싸면 늘 거부되는 토큰이다
    expect(referenceToken("coverage_basic.claim_name", "coverage", "product", "string")).toBe("exist(coverage_basic.claim_name)");
    expect(referenceToken("waiver.reasons", "plan", "product", "list<enum>")).toBe("exist(waiver.reasons)");
    expect(referenceToken("D0002", "benefit", "product")).toBe("exist(D0002)");
    expect(referenceToken("waiver.applies", "plan", "coverage")).toBeUndefined();
  });

  it("referenceToken — 커서가 집계 괄호 바로 안이면 하위 레벨도 감싸지 않는다 (겹집계 방지)", () => {
    expect(referenceToken("pay.exempt", "benefit", "coverage", "boolean", { insideAggregate: true })).toBe("pay.exempt");
    expect(referenceToken("waiver.applies", "plan", "coverage", "boolean", { insideAggregate: true })).toBeUndefined(); // 상위는 여전히 불가
  });

  it("insideAggregate — 커서 바로 앞이 집계 이름 + 여는 괄호인가", () => {
    expect(insideAggregate("any()", 4)).toBe(true);
    expect(insideAggregate("D0001 and notexist()", 19)).toBe(true);
    expect(insideAggregate("sum( )", 5)).toBe(false); // 괄호 뒤에 공백이 있으면 「바로 안」이 아니다
    expect(insideAggregate("(x)", 1)).toBe(false); // 이름 없는 괄호
    expect(insideAggregate("foo()", 4)).toBe(false); // 집계가 아닌 이름
    expect(insideAggregate("any(pay.exempt)", 15)).toBe(false);
  });

  it("OPERATOR_TOKENS — 집계는 괄호 안에 커서, and/or/비교는 뒤에", () => {
    const any = OPERATOR_TOKENS.find((t) => t.label === "any()");
    expect(any).toEqual({ label: "any()", text: "any()", caret: 4, hint: expect.any(String) });
    const notexist = OPERATOR_TOKENS.find((t) => t.label === "not exist()");
    expect(notexist?.text).toBe("notexist()");
    expect(notexist?.caret).toBe(9);
    expect(OPERATOR_TOKENS.find((t) => t.label === "≠")).toEqual({ label: "≠", text: "≠", hint: expect.any(String) }); // caret 없음 = 뒤
    expect(OPERATOR_TOKENS.map((t) => t.label)).toEqual(["any()", "all()", "sum()", "count()", "exist()", "not exist()", "and", "or", "not", "=", "≠", ">", "<"]);
  });

  it("insertPanelData — 마스터는 폼별 트리(표시명 · 경로 · 타입), 구분자는 코드 · 표시명 · 레벨 · 결과 타입", () => {
    const master: MasterForm[] = [
      { key: "waiver", label: "납입면제", level: "plan", fields: [{ key: "applies", label: "적용여부", type: { kind: "boolean" } }] },
      { key: "pay", label: "보험금지급", level: "benefit", fields: [{ key: "exempt", label: "면책여부", type: { kind: "boolean" } }, { key: "rate", label: "지급률", type: { kind: "number" } }] },
    ];
    const defs: Discriminator[] = [
      { code: "D0001", label: "면책구분", level: "coverage", expression: "any(pay.exempt)", description: "" },
      { code: "D0002", label: "지급률합", level: "coverage", expression: "sum(pay.rate)", description: "", resultType: { kind: "number" } },
    ];
    expect(insertPanelData(master, defs)).toEqual({
      forms: [
        { key: "waiver", label: "납입면제", level: "plan", fields: [{ path: "waiver.applies", label: "세목 · 납입면제 › 적용여부", typeKind: "boolean" }] },
        { key: "pay", label: "보험금지급", level: "benefit", fields: [{ path: "pay.exempt", label: "급부 · 보험금지급 › 면책여부", typeKind: "boolean" }, { path: "pay.rate", label: "급부 · 보험금지급 › 지급률", typeKind: "number" }] },
      ],
      discriminators: [
        { code: "D0001", label: "면책구분", level: "coverage", typeKind: "boolean" },
        { code: "D0002", label: "지급률합", level: "coverage", typeKind: "number" },
      ],
    });
  });
});
