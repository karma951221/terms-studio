import { describe, expect, it } from "vitest";

import type { Discriminator } from "../catalog/types";
import type { BlockClause } from "../clause/types";
import type { Issue } from "../types";
import { nodeBuilders, sequentialIds } from "./builders";
import { blockingIssues, catalogTypeResolver, clauseGateFrom, validateDocument } from "./validate";

const catalog: Discriminator[] = [
  { code: "D0001", label: "갱신여부", description: "", level: "coverage", expression: "coverage.renewal", resultType: { kind: "boolean" } },
];

const 준용규정: BlockClause = {
  code: "C0001",
  label: "준용규정",
  mode: "block",
  description: "",
  body: [{ id: "p1", kind: "paragraph", children: [{ id: "o1", kind: "optionSlot", optionCode: "O01" }] }],
  options: [{ code: "O01", label: "준용 대상", order: 0, values: [{ code: "V01", label: "보통약관", order: 0, body: [] }] }],
  required: { discriminators: ["D0001", "D0009"], attributes: [] },
};

describe("clauseGateFrom — 공용조항 정의로 만든 게이트 (서버 · 브라우저 공용)", () => {
  it("존재 · 카탈로그에 없는 요구 구분자 · 옵션 미선택", () => {
    const gate = clauseGateFrom([준용규정], ["D0001"]);
    expect(gate.clauseExists("C0001")).toBe(true);
    expect(gate.clauseExists("C0404")).toBe(false);
    expect(gate.missingRequired("C0001")).toEqual(["D0009"]);
    expect(gate.validateOptions("C0001", {}).map((i) => i.kind)).toEqual(["optionUnselected"]);
  });
});

describe("catalogTypeResolver — 담보속성 유효값을 주면 없는 담보속성은 깨진 참조", () => {
  it("유효값 없이 만들면 담보속성은 유효값 모름", () => {
    expect(catalogTypeResolver(catalog)({ kind: "attr", code: "A01" })).toEqual({ kind: "attribute" });
    const withAttr = catalogTypeResolver(catalog, (code) => (code === "A01" ? ["base"] : undefined));
    expect(withAttr({ kind: "attr", code: "A01" })).toEqual({ kind: "attribute", validValues: ["base"] });
    expect(withAttr({ kind: "attr", code: "A02" })).toBeUndefined();
    expect(withAttr({ kind: "discriminator", code: "D0001" })).toEqual({ kind: "boolean" });
  });
});

describe("validateDocument — 저장 검증 한 벌", () => {
  it("구조 · 참조 · 식을 모두 보고, blockingIssues 는 경고를 뺀다", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const tree = b.document("D", [b.article("조", [b.paragraph([b.clauseInline("C0404", {})])]), b.condBlock([b.branch("D0001 = 3", [])])]);
    const issues = validateDocument(tree, {
      env: { kind: "general", clauseGate: clauseGateFrom([준용규정], ["D0001"]) },
      resolve: catalogTypeResolver(catalog),
      scope: {},
    });
    expect(issues.map((i) => i.kind).sort()).toEqual(["brokenRef", "typeMismatch"]);
    const warning: Issue = { kind: "structure", message: "w", at: {}, severity: "warning" };
    expect(blockingIssues([...issues, warning])).toHaveLength(2);
  });
});
