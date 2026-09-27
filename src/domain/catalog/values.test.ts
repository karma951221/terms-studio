import { describe, expect, it } from "vitest";

import type { MasterForm } from "../master";
import { entered, NOT_ENTERED, type FieldType, type ValueSlot } from "../types";
import type { EnumDef, EnumLookup } from "./types";
import { countedSlotsOf, isFormOpened, missingSlots, prefill, slotType, validateValue, valueSlotsOf, type SlotReader } from "./values";

const 고지유형: EnumDef = {
  code: "E0001",
  label: "고지유형",
  values: [
    { code: "V01", label: "일반심사", order: 0 },
    { code: "V02", label: "간편심사", order: 1 },
    { code: "V03", label: "건강고지", order: 2 },
  ],
};
const enums: EnumLookup = (c) => (c === "E0001" ? 고지유형 : undefined);

describe("값 규칙 — validateValue(fieldType, value, enums)", () => {
  it("string · number · boolean 은 JS 원시 타입이 맞아야 한다", () => {
    expect(validateValue({ kind: "string" }, "2.5%", enums)).toEqual([]);
    expect(validateValue({ kind: "number" }, 100, enums)).toEqual([]);
    expect(validateValue({ kind: "boolean" }, false, enums)).toEqual([]);
    expect(validateValue({ kind: "number" }, "100", enums)[0].kind).toBe("typeMismatch");
    expect(validateValue({ kind: "boolean" }, 0, enums)[0].kind).toBe("typeMismatch");
    expect(validateValue({ kind: "number" }, Number.NaN, enums)[0].kind).toBe("typeMismatch");
  });

  it("date 는 YYYY-MM-DD 문자열이고 실제 존재하는 날짜여야 한다", () => {
    expect(validateValue({ kind: "date" }, "2026-01-01", enums)).toEqual([]);
    expect(validateValue({ kind: "date" }, "2026-02-30", enums)[0].kind).toBe("typeMismatch");
    expect(validateValue({ kind: "date" }, "20260101", enums)[0].kind).toBe("typeMismatch");
  });

  it("enum 값은 그 enum 의 값 코드여야 한다 — 표시명이 아니다", () => {
    expect(validateValue({ kind: "enum", enumCode: "E0001" }, "V02", enums)).toEqual([]);
    expect(validateValue({ kind: "enum", enumCode: "E0001" }, "간편심사", enums)[0].kind).toBe(
      "brokenRef",
    );
  });

  it("없는 enum 을 가리키면 brokenRef", () => {
    const issues = validateValue({ kind: "enum", enumCode: "E9999" }, "V01", enums);
    expect(issues[0].kind).toBe("brokenRef");
  });

  it("list<enum> 은 값 코드 배열 — 중복 없이", () => {
    const t = { kind: "list<enum>", enumCode: "E0001" } as const;
    expect(validateValue(t, ["V01", "V03"], enums)).toEqual([]);
    expect(validateValue(t, [], enums)).toEqual([]);
    expect(validateValue(t, "V01", enums)[0].kind).toBe("typeMismatch");
    expect(validateValue(t, ["V01", "V01"], enums)[0].kind).toBe("typeMismatch");
    expect(validateValue(t, ["V01", "V09"], enums)[0].kind).toBe("brokenRef");
  });

  it("좌표를 주면 Issue 에 실린다", () => {
    const issues = validateValue({ kind: "number" }, "x", enums, { refPath: "waiver.applies" });
    expect(issues[0].at.refPath).toBe("waiver.applies");
  });
});

describe("값 자리 — 노드 × 마스터 필드 (ADR-0037)", () => {
  it("레벨의 값 자리는 그 레벨 마스터 필드 전부다 — 부착·선택 필드가 없다", () => {
    expect(valueSlotsOf("plan")).toEqual([
      "waiver.applies",
      "waiver.reasons",
      "no_surrender.type",
      "conversion.converts",
      "business_type.applies",
    ]);
    expect(valueSlotsOf("coverage")).toEqual(["coverage_basic.claim_name"]);
  });

  it("마스터가 비어 있는 레벨은 값 자리가 없다", () => {
    expect(valueSlotsOf("product")).toEqual([]);
    expect(valueSlotsOf("subCoverage")).toEqual([]);
    expect(valueSlotsOf("benefit")).toEqual([
      "pay.exempt",
      "pay.rate",
      "pay.first_only",
      "reduction.periods",
      "reduction.after_rate",
      "reduction.new_only",
      "exemption.months",
      "exemption.age15_only",
      "exemption.new_only",
    ]);
  });

  it("자리의 타입을 경로로 찾는다 — 레벨이 다르면 못 찾는다", () => {
    expect(slotType("plan", "waiver.applies")).toEqual({ kind: "boolean" });
    expect(slotType("coverage", "coverage_basic.claim_name")).toEqual({ kind: "string" });
    expect(slotType("plan", "coverage_basic.claim_name")).toBeUndefined();
    expect(slotType("plan", "plan.waiver.nope")).toBeUndefined();
  });
});

describe("폼입력 S1 — 기본값 프리필: 저장 전에는 미입력", () => {
  it("prefill 은 기본값이 있는 자리만 폼 초기값으로 돌려준다 — 저장소로 가지 않는다", () => {
    // MVP 마스터에는 기본값이 아직 없다 — 자리는 있고 제안은 없다.
    expect(prefill("plan")).toEqual({});
    expect(prefill("coverage")).toEqual({});
  });

  it("저장소가 비어 있으면 그 레벨 자리가 전부 미입력이다", () => {
    const empty = () => undefined;
    expect(missingSlots("coverage", empty)).toEqual(["coverage_basic.claim_name"]);
    expect(missingSlots("plan", empty)).toHaveLength(5);
  });
});

describe("폼입력 S2 — 미입력 상태로 중간 저장", () => {
  it("일부만 입력된 레벨의 미입력 목록은 나머지 자리다 — entered:false 도 미입력", () => {
    const store: Record<string, ValueSlot> = {
      "waiver.applies": entered(true),
      "waiver.reasons": NOT_ENTERED,
    };
    expect(missingSlots("plan", (p) => store[p])).toEqual([
      "waiver.reasons",
      "no_surrender.type",
      "conversion.converts",
      "business_type.applies",
    ]);
  });

  it("전부 입력되면 미입력 없음", () => {
    const store: Record<string, ValueSlot> = { "coverage_basic.claim_name": entered("사망보험금") };
    expect(missingSlots("coverage", (p) => store[p])).toEqual([]);
  });
});

describe("validateValue — table", () => {
  const 구간표: FieldType = {
    kind: "table",
    columns: [
      { key: "end", label: "기간", type: "period" },
      { key: "rate", label: "지급률", type: "percent" },
    ],
  };
  const enums: EnumLookup = () => undefined;

  it("열 키가 맞는 행 배열이면 통과", () => {
    expect(validateValue(구간표, [{ end: 12, rate: 50 }], enums)).toEqual([]);
  });
  it("빈 표는 거부 — 열고 비운 것은 저장하지 않는다 (ADR-0065 §4)", () => {
    expect(validateValue(구간표, [], enums)).toMatchObject([{ kind: "typeMismatch", message: expect.stringContaining("행") }]);
  });
  it("열이 빠지거나 남거나 타입이 틀리면 행 · 열 좌표로 거부", () => {
    expect(validateValue(구간표, [{ end: 12 }], enums)[0].message).toContain("1행");
    expect(validateValue(구간표, [{ end: 12, rate: 50, x: 1 }], enums)[0].message).toContain("x");
    expect(validateValue(구간표, [{ end: "1Y", rate: 50 }], enums)[0].message).toContain("기간");
    expect(validateValue(구간표, [{ end: 12, rate: 150 }], enums)[0].message).toContain("0~100");
    expect(validateValue(구간표, [{ end: 1.5, rate: 50 }], enums)[0].message).toContain("정수");
  });
  it("행이 객체가 아니면 거부", () => {
    expect(validateValue(구간표, ["a"], enums)).toHaveLength(1);
    expect(validateValue(구간표, "x", enums)).toHaveLength(1);
  });
});

describe("여는 폼(optional) — 값 행이 없으면 자리 없음 (ADR-0065 §4)", () => {
  const master: MasterForm[] = [
    { key: "pay", label: "지급", level: "benefit", fields: [{ key: "rate", label: "지급률", type: { kind: "number" } }] },
    {
      key: "reduction",
      label: "감액",
      level: "benefit",
      optional: true,
      fields: [
        { key: "periods", label: "구간", type: { kind: "table", columns: [{ key: "end", label: "기간", type: "period" }] } },
        { key: "new_only", label: "신규만", type: { kind: "boolean" }, defaultValue: true },
      ],
    },
  ];
  it("안 연 폼의 자리는 미입력 목록에 없다 · 열면(값 하나라도) 나머지 자리는 센다", () => {
    expect(missingSlots("benefit", () => undefined, master)).toEqual(["pay.rate"]);
    const opened: SlotReader = (p) => (p === "reduction.new_only" ? entered(true) : undefined);
    expect(missingSlots("benefit", opened, master)).toEqual(["pay.rate", "reduction.periods"]);
  });
  it("isFormOpened — 폼 필드 중 하나라도 입력됨", () => {
    expect(isFormOpened(master[1], () => undefined)).toBe(false);
    expect(isFormOpened(master[1], (p) => (p === "reduction.periods" ? entered([{ end: 12 }]) : undefined))).toBe(true);
  });
});

describe("선택 필드(MasterField.optional) — 값이 없으면 세지 않는다 (2026-09-27)", () => {
  const master: MasterForm[] = [
    {
      key: "pay",
      label: "보험금지급",
      level: "benefit",
      fields: [
        { key: "exempt", label: "면책여부", type: { kind: "boolean" }, optional: true },
        { key: "rate", label: "지급률", type: { kind: "number" }, optional: true },
        { key: "note", label: "비고", type: { kind: "string" } },
      ],
    },
  ];
  it("값 없는 선택 필드는 미입력 목록 · 분모에 없다 · 값이 있으면 센다", () => {
    expect(missingSlots("benefit", () => undefined, master)).toEqual(["pay.note"]);
    expect(countedSlotsOf("benefit", () => undefined, master)).toEqual(["pay.note"]);
    const withRate: SlotReader = (p) => (p === "pay.rate" ? entered(80) : undefined);
    expect(countedSlotsOf("benefit", withRate, master)).toEqual(["pay.rate", "pay.note"]);
    expect(missingSlots("benefit", withRate, master)).toEqual(["pay.note"]);
  });
  it("값 자리 목록(valueSlotsOf)에는 그대로 있다 — 자리는 늘 있고 보이는 방식만 다르다", () => {
    expect(valueSlotsOf("benefit", master)).toEqual(["pay.exempt", "pay.rate", "pay.note"]);
  });
  it("정본 마스터 — 보험금지급의 면책여부 · 지급률이 선택 필드다", () => {
    expect(slotType("benefit", "pay.exempt")).toEqual({ kind: "boolean" });
    expect(countedSlotsOf("benefit", () => undefined).filter((p) => p.startsWith("pay."))).not.toContain("pay.exempt");
    expect(countedSlotsOf("benefit", () => undefined).filter((p) => p.startsWith("pay."))).not.toContain("pay.rate");
  });
});
