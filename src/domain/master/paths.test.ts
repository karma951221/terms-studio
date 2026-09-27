import { describe, expect, it } from "vitest";

import {
  MASTER,
  allMasterFields,
  fieldsOfForm,
  fieldsOfLevel,
  findForm,
  findMasterField,
  formsOfLevel,
  isMasterPathShape,
  levelDepth,
  masterFieldFullLabel,
  masterFieldLabel,
  masterPath,
  type MasterTree,
} from "./index";

const fixture: MasterTree = [
  { key: "a", label: "폼A", level: "plan", fields: [{ key: "x", label: "엑스", type: { kind: "boolean" } }] },
  { key: "b", label: "폼B", level: "benefit", fields: [{ key: "y", label: "와이", type: { kind: "number" } }, { key: "z", label: "제트", type: { kind: "string" } }] },
];

describe("마스터 경로 — 폼키.필드키", () => {
  it("경로는 두 토막이다", () => {
    expect(masterPath("waiver", "applies")).toBe("waiver.applies");
  });

  it("MVP 정본 — 폼 8벌 · 필드 15자리, 선언 순서", () => {
    expect(MASTER.map((f) => f.key)).toEqual([
      "waiver", "no_surrender", "conversion", "business_type", "coverage_basic", "pay", "reduction", "exemption",
    ]);
    expect(allMasterFields().map((r) => r.path)).toEqual([
      "waiver.applies", "waiver.reasons", "no_surrender.type", "conversion.converts", "business_type.applies",
      "coverage_basic.claim_name", "pay.exempt", "pay.rate", "pay.first_only",
      "reduction.periods", "reduction.after_rate", "reduction.new_only",
      "exemption.months", "exemption.age15_only", "exemption.new_only",
    ]);
  });

  it("pay.first_only — 최초1회한 (실물 재현 2차 §6): boolean · 급부 레벨", () => {
    const ref = findMasterField("pay.first_only");
    expect(ref?.level).toBe("benefit");
    expect(ref?.field).toMatchObject({ key: "first_only", label: "최초1회한", type: { kind: "boolean" } });
    expect(ref?.field.description).toBeTruthy();
  });

  it("폼키는 전역 유일 · 필드키는 폼 안에서 유일", () => {
    const keys = MASTER.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const form of MASTER) {
      const fieldKeys = form.fields.map((f) => f.key);
      expect(new Set(fieldKeys).size).toBe(fieldKeys.length);
    }
  });

  it("레벨별 폼 · 레벨별 필드", () => {
    expect(formsOfLevel("plan").map((f) => f.key)).toEqual(["waiver", "no_surrender", "conversion", "business_type"]);
    expect(formsOfLevel("product")).toEqual([]);
    expect(fieldsOfLevel("benefit").map((r) => r.path)).toEqual([
      "pay.exempt", "pay.rate", "pay.first_only",
      "reduction.periods", "reduction.after_rate", "reduction.new_only",
      "exemption.months", "exemption.age15_only", "exemption.new_only",
    ]);
    expect(fieldsOfLevel("benefit", fixture).map((r) => r.path)).toEqual(["b.y", "b.z"]);
  });

  it("findForm · fieldsOfForm", () => {
    expect(findForm("pay")?.label).toBe("보험금지급");
    expect(findForm("nope")).toBeUndefined();
    expect(fieldsOfForm(fixture[1]).map((r) => r.path)).toEqual(["b.y", "b.z"]);
  });

  it("findMasterField — 레벨은 폼에서 온다", () => {
    const ref = findMasterField("waiver.applies");
    expect(ref?.level).toBe("plan");
    expect(ref?.form.key).toBe("waiver");
    expect(ref?.field.label).toBe("적용여부");
    expect(findMasterField("plan.waiver.applies")).toBeUndefined();
    expect(findMasterField("waiver.nope")).toBeUndefined();
    expect(findMasterField("a.x", fixture)?.level).toBe("plan");
  });

  it("isMasterPathShape — 두 토막 코드 모양", () => {
    expect(isMasterPathShape("waiver.applies")).toBe(true);
    expect(isMasterPathShape("nope.nothing")).toBe(true);
    expect(isMasterPathShape("plan.waiver.applies")).toBe(false);
    expect(isMasterPathShape("D0001")).toBe(false);
    expect(isMasterPathShape("attr.A0001")).toBe(true); // 모양만 본다 — 파서가 attr 을 먼저 가른다
  });

  it("표시명 — 「폼 › 필드」 · 「레벨 · 폼 › 필드」", () => {
    const ref = findMasterField("waiver.applies")!;
    expect(masterFieldLabel(ref)).toBe("납입면제 › 적용여부");
    expect(masterFieldFullLabel(ref)).toBe("세목 · 납입면제 › 적용여부");
  });

  it("레벨 깊이는 부착 레벨 순서", () => {
    expect(levelDepth("product")).toBe(0);
    expect(levelDepth("benefit")).toBe(4);
  });
});
