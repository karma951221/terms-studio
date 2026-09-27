import { describe, expect, it } from "vitest";

import {
  LEVEL_STRUCTURE,
  childLevelOf,
  descend,
  dictTypeOf,
  enumerateRows,
  keyLabel,
  levelStructure,
  type ChildrenProviders,
  type StructNode,
} from "./structure";

const node = (level: StructNode["level"], id: string, name: string, order: number): StructNode => ({ level, id, name, order });

describe("구조 상수 — 다섯 층 사슬 (ADR-0070 결정 2)", () => {
  it("상품 › 세목 › 담보 › 세부보장 › 급부 순서이고 급부가 잎이다", () => {
    expect(LEVEL_STRUCTURE.map((l) => l.level)).toEqual(["product", "plan", "coverage", "subCoverage", "benefit"]);
    expect(LEVEL_STRUCTURE.map((l) => l.child)).toEqual(["plan", "coverage", "subCoverage", "benefit", undefined]);
    expect(childLevelOf("benefit")).toBeUndefined();
    expect(childLevelOf("coverage")).toBe("subCoverage");
    expect(levelStructure("plan").child).toBe("coverage");
  });
});

describe("descend — 반복 표의 행 레벨 사슬", () => {
  it("담보에서 깊이 1 = [세부보장], 깊이 2 = [세부보장, 급부]", () => {
    expect(descend("coverage", 1)).toEqual(["subCoverage"]);
    expect(descend("coverage", 2)).toEqual(["subCoverage", "benefit"]);
  });
  it("상품에서 깊이 2 = [세목, 담보] (자리만 — 상품 문맥 반복은 이후)", () => {
    expect(descend("product", 2)).toEqual(["plan", "coverage"]);
  });
  it("잎 아래로는 내려갈 수 없다 — 사슬이 짧아진다", () => {
    expect(descend("subCoverage", 2)).toEqual(["benefit"]);
    expect(descend("benefit", 1)).toEqual([]);
  });
});

describe("dictTypeOf — 상수에서 파생된 dict 타입", () => {
  it("담보 = dict<세부보장, dict<급부, 잎>>", () => {
    expect(dictTypeOf("coverage")).toEqual({
      kind: "dict",
      key: { kind: "node", level: "subCoverage" },
      value: { kind: "dict", key: { kind: "node", level: "benefit" }, value: { kind: "string" } },
    });
  });
  it("잎 타입을 주면 가장 안쪽 value 가 그 타입이다", () => {
    expect(dictTypeOf("subCoverage", { kind: "number" })).toEqual({ kind: "dict", key: { kind: "node", level: "benefit" }, value: { kind: "number" } });
  });
  it("급부(잎)는 dict 가 아니다", () => {
    expect(dictTypeOf("benefit")).toBeUndefined();
  });
});

describe("keyLabel — key 표기", () => {
  it("세부보장 · 담보 · 세목은 이름, 급부는 「급부 N 급부명」(N = order + 1)", () => {
    expect(keyLabel(node("subCoverage", "s", "1종수술", 0))).toBe("1종수술");
    expect(keyLabel(node("plan", "p", "1종(고지)", 0))).toBe("1종(고지)");
    expect(keyLabel(node("benefit", "b", "입원보험금", 1))).toBe("급부 2 입원보험금");
  });
});

describe("enumerateRows — key 조합 열거 (order 오름차순)", () => {
  const cov = node("coverage", "c", "수술비", 0);
  const providers: ChildrenProviders = {
    coverage: { children: () => [node("subCoverage", "s2", "2종", 1), node("subCoverage", "s1", "1종", 0)] },
    subCoverage: {
      children: (n) =>
        n.id === "s1" ? [node("benefit", "b11", "수술", 0)] : [node("benefit", "b22", "입원", 1), node("benefit", "b21", "수술", 0)],
    },
  };

  it("깊이 1 — 세부보장마다 한 줄", () => {
    const r = enumerateRows(cov, 1, providers);
    expect(r.ok && r.value.map((row) => row.map((n) => n.id))).toEqual([["s1"], ["s2"]]);
  });
  it("깊이 2 — 세부보장 order → 급부 order", () => {
    const r = enumerateRows(cov, 2, providers);
    expect(r.ok && r.value.map((row) => row.map((n) => n.id))).toEqual([["s1", "b11"], ["s2", "b21"], ["s2", "b22"]]);
  });
  it("자식이 없으면 조합 0", () => {
    const r = enumerateRows(cov, 1, { coverage: { children: () => [] } });
    expect(r.ok && r.value).toEqual([]);
  });
  it("제공자가 없는 레벨(세목 · 상품)은 「제공자 없음」 거부", () => {
    const r = enumerateRows(node("product", "p", "상품", 0), 1, providers);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection).toMatchObject({ reason: "notFound" });
  });
});
