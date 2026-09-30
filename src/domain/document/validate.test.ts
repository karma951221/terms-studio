import { describe, expect, it } from "vitest";

import type { Discriminator } from "../catalog/types";
import type { BlockClause } from "../clause/types";
import type { Issue } from "../types";
import { nodeBuilders, sequentialIds } from "./builders";
import { checkClauseRef, PERMISSIVE_GATE, validateTree } from "./nodes";
import { blockingIssues, catalogTypeResolver, clauseGateFrom, validateDocument } from "./validate";

const catalog: Discriminator[] = [
  { code: "D0001", label: "갱신여부", description: "", level: "coverage", expression: "coverage.renewal", resultType: { kind: "boolean" } },
];

const 준용규정: BlockClause = {
  code: "C0001",
  label: "준용규정",
  mode: "block",
  body: [{ id: "p1", kind: "paragraph", children: [{ id: "o1", kind: "optionSlot", optionCode: "O01" }] }],
  options: [{ code: "O01", label: "준용 대상", order: 0, values: [{ code: "V01", label: "보통약관", order: 0, body: [] }] }],
  params: [
    { name: "갱신", type: { kind: "boolean" }, default: { kind: "discriminator", code: "D0001" } },
    { name: "기타", type: { kind: "boolean" }, default: { kind: "discriminator", code: "D0009" } },
  ],
  required: { discriminators: ["D0001", "D0009"], attributes: [] },
};

describe("clauseGateFrom — 함수조항 정의로 만든 게이트 (서버 · 브라우저 공용)", () => {
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

describe("작업용 글자색 — 검증은 모양만 본다 (기능/문면 §3.2 작업 표시)", () => {
  const checks = { env: { kind: "general" as const, clauseGate: clauseGateFrom([], []) }, resolve: catalogTypeResolver(catalog), scope: {} };
  it("네 색은 문제없다 — 칠한 문서와 칠하지 않은 문서의 검증 결과가 같다", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const tree = b.document("D", [b.article("조", [b.paragraph([{ ...b.text("회사는 "), mark: "red" }, b.text("보험금을"), { ...b.text(" 지급"), mark: "orange" }])])]);
    expect(validateDocument(tree, checks)).toEqual([]);
  });
  it("없는 색은 구조 오류 — 저장 거부", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const tree = b.document("D", [b.article("조", [b.paragraph([{ ...b.text("회사는"), mark: "purple" as never }])])]);
    expect(validateDocument(tree, checks).map((i) => [i.kind, i.message])).toEqual([["structure", "작업용 글자색은 빨강 · 파랑 · 초록 · 주황 중 하나여야 합니다"]]);
  });
});

describe("함수조항 참조 자리 — 유형 = 출력 모양 (최종 결정 4 · 기능/함수조항 §3.1)", () => {
  const modes: Record<string, "inline" | "block" | "item" | "subitem"> = { C1: "inline", C2: "block", C3: "item", C4: "subitem" };
  const gate = { ...PERMISSIVE_GATE, clauseMode: (code: string) => modes[code] };

  it("문장 안은 「문구」만, 조 자리에 「문구」는 없다", () => {
    const b = nodeBuilders(sequentialIds("v"));
    const tree = b.document("D", [b.article("가", [b.paragraph([b.clauseInline("C2", {})]), b.clauseBlock("C1", {}), b.clauseBlock("C2", {})])]);
    expect(validateTree(tree, { clauseGate: gate }).map((i) => i.message)).toEqual([
      "함수조항 C2 — 문장 안에는 「문구」 함수조항만 둘 수 있습니다",
      "함수조항 C1 — 「문구」 함수조항은 문장 안에만 둘 수 있습니다",
    ]);
  });

  it("호 유형 함수조항은 항의 호 목록 자리에만 — 조건 가지 안(투명)도 그 자리다", () => {
    const b = nodeBuilders(sequentialIds("i"));
    const tree = b.document("D", [
      b.article("가", [
        b.paragraph([], [b.item([]), b.clauseBlock("C3", {}) as never, b.condBlock([b.branch("D0001 = 1", [b.clauseBlock("C3", {})])]) as never]),
        b.clauseBlock("C3", {}),
      ]),
    ]);
    expect(validateTree(tree, { clauseGate: gate }).map((i) => i.message)).toEqual(["함수조항 C3 — 「호」 함수조항은 항의 호 목록 자리에만 둘 수 있습니다"]);
  });

  it("목 유형은 호의 목 목록 자리에만 — 호 목록 자리에 두면 오류", () => {
    const b = nodeBuilders(sequentialIds("s"));
    const tree = b.document("D", [b.article("가", [b.paragraph([], [b.item([], [b.clauseBlock("C4", {}) as never]), b.clauseBlock("C4", {}) as never])])]);
    expect(validateTree(tree, { clauseGate: gate }).map((i) => i.message)).toEqual(["함수조항 C4 — 「목」 함수조항은 호의 목 목록 자리에만 둘 수 있습니다"]);
  });

  it("항 유형을 호 · 목 자리에 두면 오류", () => {
    const b = nodeBuilders(sequentialIds("p"));
    const tree = b.document("D", [b.article("가", [b.paragraph([], [b.clauseBlock("C2", {}) as never, b.item([], [b.clauseBlock("C2", {}) as never])])])]);
    expect(validateTree(tree, { clauseGate: gate }).map((i) => i.message)).toEqual([
      "함수조항 C2 — 「항」 함수조항은 조 자리(항 사이)에만 둘 수 있습니다",
      "함수조항 C2 — 「항」 함수조항은 조 자리(항 사이)에만 둘 수 있습니다",
    ]);
  });
});

describe("검사 ② — 함수조항 인자 연결 (최종 결정 2 · 기능/함수조항 §3.7)", () => {
  const cat: Discriminator[] = [
    ...catalog,
    { code: "D0002", label: "담보명", description: "", level: "coverage", expression: "coverage_basic.claim_name", resultType: { kind: "string" } },
    { code: "D0003", label: "갱신형(상품)", description: "", level: "coverage", expression: "coverage.renewal2", resultType: { kind: "boolean" } },
  ];
  const 지급사유: BlockClause = {
    code: "C0002",
    label: "지급사유",
    mode: "block",
    body: [{ id: "p1", kind: "paragraph", children: [{ id: "s1", kind: "slot", ref: "arg.담보명" }] }],
    options: [],
    params: [
      { name: "담보명", type: { kind: "string" }, default: { kind: "discriminator", code: "D0002" } },
      { name: "갱신형", type: { kind: "boolean" } },
    ],
    required: { discriminators: [], attributes: [] },
  };
  const gate = clauseGateFrom([지급사유], cat.map((d) => d.code), catalogTypeResolver(cat));
  const b = nodeBuilders(sequentialIds("n"));
  const docWith = (bindings?: Record<string, { kind: "discriminator"; code: string } | { kind: "const"; value: boolean }>) =>
    b.document("D", [b.article("조", [{ ...b.clauseBlock("C0002"), ...(bindings ? { bindings } : {}) }])]);

  it("기본 연결 없는 인자를 연결하지 않으면 저장 오류", () => {
    expect(validateTree(docWith(), { clauseGate: gate }).map((i) => [i.kind, i.at.refPath])).toEqual([["argUnbound", "arg.갱신형"]]);
  });

  it("기본 연결이면 연결 없이 통과 — 다른 인자만 대면 된다", () => {
    expect(validateTree(docWith({ 갱신형: { kind: "discriminator", code: "D0003" } }), { clauseGate: gate })).toEqual([]);
  });

  it("연결 구분자 타입이 다르면 오류", () => {
    expect(validateTree(docWith({ 갱신형: { kind: "discriminator", code: "D0002" } }), { clauseGate: gate }).map((i) => i.kind)).toEqual(["typeMismatch"]);
  });

  it("사용처가 읽는 구분자 = 기본 연결 + 사용처 연결 — 카탈로그에 없는 연결 구분자는 요구 구분자 오류", () => {
    expect(gate.requiredCodes("C0002", { 갱신형: { kind: "discriminator", code: "D0003" } })).toEqual(["D0002", "D0003"]);
    const shrunk = clauseGateFrom([지급사유], ["D0001", "D0003"], catalogTypeResolver(cat));
    expect(shrunk.missingRequired("C0002", { 갱신형: { kind: "const", value: true } })).toEqual(["D0002"]);
  });

  it("참조 추가 시점에는 연결 누락을 거르지 않는다 — 저장 때 잡는다", () => {
    expect(checkClauseRef(b.clauseBlock("C0002"), gate, {}, false)).toEqual([]);
    expect(checkClauseRef(b.clauseBlock("C0002"), gate, {}, true).map((i) => i.kind)).toEqual(["argUnbound"]);
  });
});
