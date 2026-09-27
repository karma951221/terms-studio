import { describe, expect, it } from "vitest";

import type { Discriminator } from "@/domain/catalog";
import { surgery, type MasterValues } from "@/domain/coverage";
import { entered, NOT_ENTERED } from "@/domain/types";

import { buildConditionContext } from "./conditionContext";

describe("buildConditionContext — 담보 트리 · 구분자(타입 · 읽는 폼) · 열린 폼 · 빠른 조건", () => {
  it("담보 트리 · 구분자(타입 · 읽는 폼) · 열린 폼 · 빠른 조건", () => {
    const { tree, b22 } = surgery();
    const defs: Discriminator[] = [
      { code: "D0002", label: "감액여부", level: "benefit", expression: "exist(reduction.periods)", description: "" },
      { code: "D0009", label: "감액여부", level: "coverage", expression: "any(D0002)", description: "" },
      { code: "D0001", label: "담보명", level: "coverage", expression: "coverage_basic.claim_name", description: "" },
    ];
    const values: MasterValues = { slots: new Map([[b22, new Map([["reduction.periods", entered([{ end: 12, rate: 50 }])]])]]) };
    const ctx = buildConditionContext({ coverage: tree, values, discriminators: defs, enums: [] });
    expect(ctx.coverage?.nodes.map((n) => n.level)).toEqual(["coverage", "subCoverage", "benefit", "subCoverage", "benefit", "benefit"]);
    expect(ctx.discriminators.find((d) => d.code === "D0009")).toMatchObject({ type: { kind: "boolean" }, forms: ["reduction"] });
    expect(ctx.openedForms[b22]).toEqual(["reduction"]);
    expect(ctx.quick).toEqual([{ label: "감액여부 = 참", source: "D0009 = true" }]);
  });

  it("하위 급부의 열린 폼을 조상에 모으되 형제에게 전파하지 않는다", () => {
    const { tree, b11, b21, b22 } = surgery();
    const values: MasterValues = { slots: new Map([
      [b21, new Map([["reduction.periods", entered([{ end: 12, rate: 50 }])]])],
      [b22, new Map([
        ["reduction.periods", entered([{ end: 24, rate: 70 }])],
        ["exemption.months", entered(3)],
      ])],
    ]) };
    const ctx = buildConditionContext({ coverage: tree, values, discriminators: [], enums: [] });
    expect(ctx.openedForms[tree.id]).toEqual(["reduction", "exemption"]);
    expect(ctx.openedForms[tree.subCoverages[1].id]).toEqual(["reduction", "exemption"]);
    expect(ctx.openedForms[b21]).toEqual(["reduction"]);
    expect(ctx.openedForms[b22]).toEqual(["reduction", "exemption"]);
    expect(ctx.openedForms[tree.subCoverages[0].id]).toBeUndefined();
    expect(ctx.openedForms[b11]).toBeUndefined();
  });

  it("미입력 슬롯과 트리 밖의 값은 배지를 만들지 않는다", () => {
    const { tree, b22 } = surgery();
    const values: MasterValues = { slots: new Map([
      [b22, new Map([["reduction.periods", NOT_ENTERED]])],
      ["outside", new Map([["exemption.months", entered(3)]])],
    ]) };
    expect(buildConditionContext({ coverage: tree, values, discriminators: [], enums: [] }).openedForms).toEqual({});
  });
});
