import { describe, expect, it } from "vitest";

import { bindingLabel, bindingOfValue, bindingOptions, bindingValue, paramEntries, typeOfValue, typeValue } from "./params";

const discriminators = [
  { code: "D0001", label: "갱신여부", level: "coverage" as const, type: { kind: "boolean" as const }, forms: [] },
  { code: "D0002", label: "담보명", level: "coverage" as const, type: { kind: "string" as const }, forms: [] },
  { code: "D0003", label: "사유", level: "plan" as const, type: { kind: "enum" as const, enumCode: "E0001" }, forms: [] },
];
const enums = [{ code: "E0001", label: "납입면제사유", values: [{ code: "V01", label: "암" }] }];
const forms = [{ key: "waiver", label: "납입면제", booleanFields: [{ key: "applies", label: "적용여부" }] }];

describe("인자 표 칸 값 (기능/함수조항 §4.3)", () => {
  it("타입 칸 값은 왕복한다", () => {
    for (const t of [{ kind: "boolean" as const }, { kind: "enum" as const, enumCode: "E0001" }, { kind: "planOptions" as const, form: "waiver" }]) expect(typeOfValue(typeValue(t))).toEqual(t);
  });

  it("연결 칸 후보는 타입이 같은 구분자 + 상수 — 세목 선택지 목록은 원천(폼 전체 · 참거짓 필드 = 예)", () => {
    expect(bindingOptions({ kind: "boolean" }, discriminators, enums, forms, true).map((o) => o.value)).toEqual(["d:D0001", "c:true", "c:false"]);
    expect(bindingOptions({ kind: "enum", enumCode: "E0001" }, discriminators, enums, forms, false).map((o) => o.value)).toEqual(["d:D0003"]);
    expect(bindingOptions({ kind: "planOptions", form: "waiver" }, discriminators, enums, forms, false).map((o) => o.label)).toEqual(["납입면제 — 모든 선택지", "납입면제 — 적용여부 = 예인 선택지"]);
  });

  it("연결 칸 값은 왕복한다 — 원천 「적용여부 = 예」는 거름 식 waiver.applies = true", () => {
    const source = bindingOfValue("s:waiver:applies", { kind: "planOptions", form: "waiver" });
    expect(source).toEqual({ kind: "source", source: { form: "waiver", filter: "waiver.applies = true" } });
    expect(bindingValue(source)).toBe("s:waiver:applies");
    expect(bindingOfValue("c:false", { kind: "boolean" })).toEqual({ kind: "const", value: false });
    expect(bindingLabel({ kind: "discriminator", code: "D0001" }, { kind: "boolean" }, discriminators, enums, forms)).toBe("갱신여부 (D0001)");
  });

  it("반복의 현재 원소 — 원소 타입이 같은 감싼 반복만 후보(열거값 → enum 인자 · 종 → 세목 선택지 목록 인자), 칸 값 r:<반복 id> 은 왕복한다", () => {
    const loops = [
      { id: "fo", label: "현재 종 — 납입면제종마다", type: { kind: "planOptions" as const, form: "waiver" } },
      { id: "fi", label: "현재 원소 — 납입면제사유마다", type: { kind: "enum" as const, enumCode: "E0001" } },
    ];
    expect(bindingOptions({ kind: "enum", enumCode: "E0001" }, discriminators, enums, forms, false, loops).map((o) => o.value)).toEqual(["r:fi", "d:D0003"]);
    expect(bindingOptions({ kind: "planOptions", form: "waiver" }, discriminators, enums, forms, false, loops)[0]).toEqual({ value: "r:fo", label: "현재 종 — 납입면제종마다", group: "반복" });
    const current = bindingOfValue("r:fi", { kind: "enum", enumCode: "E0001" });
    expect(current).toEqual({ kind: "current", loop: "fi" });
    expect(bindingValue(current)).toBe("r:fi");
    expect(bindingLabel(current, { kind: "enum", enumCode: "E0001" }, discriminators, enums, forms, loops)).toBe("현재 원소 — 납입면제사유마다");
  });

  it("인자는 조건 · 슬롯 고르기에 arg.<이름> 칸으로 선다 — 세목 선택지 목록은 타입 없이", () => {
    const entries = paramEntries([{ name: "갱신형", type: { kind: "boolean" } }, { name: "종들", type: { kind: "planOptions", form: "waiver" } }, { name: "", type: { kind: "string" } }], enums);
    expect(entries.map((e) => [e.code, e.type?.kind, e.param])).toEqual([
      ["arg.갱신형", "boolean", true],
      ["arg.종들", undefined, true],
    ]);
  });
});
