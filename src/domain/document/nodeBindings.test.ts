// src/domain/document/nodeBindings.test.ts
import { describe, expect, it } from "vitest";

import type { Clause } from "../clause";
import type { Coverage } from "../coverage";
import { PERMISSIVE_GATE, type ClauseGate, type DocumentNode } from "./nodes";
import { nodeBindingIssues, unqualifiedNodeArgUnbound } from "./nodeBindings";
import { titleNodes } from "./title";

const coverage: Coverage = {
  id: "cov", name: "암", description: "",
  subCoverages: [{ id: "s1", key: "01", name: "유사암", order: 0, benefits: [{ id: "b1", key: "1", name: "진단", order: 0 }] }],
};
const levelOf = (c: string) => ({ D0007: "subCoverage", D0002: "benefit", D0100: "coverage" })[c] as never;
const clause = (def?: string): Clause => ({
  code: "C0001", label: "감액", mode: "block", options: [], body: [],
  required: { discriminators: [] },
  params: [{ name: "감액", type: { kind: "boolean" }, ...(def ? { default: { kind: "discriminator", code: def } } : {}) }],
} as unknown as Clause);
const gate = (c: Clause): ClauseGate => ({ ...PERMISSIVE_GATE, clauseOf: () => c, usageOf: (_code, node) => ({ options: node.options, ...(node.bindings ? { bindings: node.bindings } : {}), issues: [] }) });
const ref = (bindings?: object) => ({ kind: "clauseBlockRef", id: "r", clauseCode: "C0001", options: {}, ...(bindings ? { bindings } : {}) });
const docOf = (children: unknown[]): DocumentNode => ({ kind: "document", id: "d", title: "t", children: [{ kind: "article", id: "a", title: titleNodes("제1조", "a"), children }] } as unknown as DocumentNode);
const inLoop = (source: object, child: unknown) => ({ kind: "forBlock", id: "f", source, children: [child] });

describe("키 경로 연결 저장 검사 (ADR-0087 결정 4 · 8)", () => {
  it("세부보장 레벨 기본 연결 · 키 없음 = argUnbound", () => {
    const issues = nodeBindingIssues(docOf([ref()]), gate(clause("D0007")), { coverage, levelOf });
    expect(issues).toEqual([expect.objectContaining({ kind: "argUnbound", message: expect.stringContaining("키 경로") })]);
  });

  it("키 경로를 고르면 통과 · 없는 키 = brokenRef · 레벨 다름 = typeMismatch", () => {
    expect(nodeBindingIssues(docOf([ref({ 감액: { kind: "discriminator", code: "D0007", node: { path: "01" } } })]), gate(clause("D0007")), { coverage, levelOf })).toEqual([]);
    expect(nodeBindingIssues(docOf([ref({ 감액: { kind: "discriminator", code: "D0007", node: { path: "02" } } })]), gate(clause()), { coverage, levelOf })[0].kind).toBe("brokenRef");
    expect(nodeBindingIssues(docOf([ref({ 감액: { kind: "discriminator", code: "D0007", node: { path: "01.1" } } })]), gate(clause()), { coverage, levelOf })[0].kind).toBe("typeMismatch");
  });

  it("세부보장마다 안이면 세부보장 레벨 기본 연결이 저절로 풀린다 · 급부 레벨 기본 연결은 argUnbound (결정 8)", () => {
    expect(nodeBindingIssues(docOf([inLoop({ kind: "subCoverages" }, ref())]), gate(clause("D0007")), { coverage, levelOf })).toEqual([]);
    expect(nodeBindingIssues(docOf([inLoop({ kind: "subCoverages" }, ref())]), gate(clause("D0002")), { coverage, levelOf })[0].kind).toBe("argUnbound");
    expect(nodeBindingIssues(docOf([inLoop({ kind: "benefits" }, ref())]), gate(clause("D0007")), { coverage, levelOf })).toEqual([]);
  });

  it("「현재」는 감싼 트리 반복 안에서만 · 보통약관의 키 경로 = 오류 · 담보 레벨은 검사 밖", () => {
    const current = ref({ 감액: { kind: "discriminator", code: "D0007", node: { current: "f" } } });
    expect(nodeBindingIssues(docOf([current]), gate(clause()), { coverage, levelOf })[0].kind).toBe("structure");
    expect(nodeBindingIssues(docOf([inLoop({ kind: "subCoverages" }, current)]), gate(clause()), { coverage, levelOf })).toEqual([]);
    expect(nodeBindingIssues(docOf([ref({ 감액: { kind: "discriminator", code: "D0007", node: { path: "01" } } })]), gate(clause()), { levelOf })[0].message).toContain("보통약관");
    expect(nodeBindingIssues(docOf([ref()]), gate(clause("D0100")), { coverage, levelOf })).toEqual([]);
  });

  it("레벨을 모르는 구분자(없는 코드)에 키 경로를 붙여도 「상품 · 세목 레벨」이라 하지 않는다 — 없는 구분자는 다른 검사가 알린다", () => {
    const unknown = ref({ 감액: { kind: "discriminator", code: "D9999", node: { path: "01" } } });
    expect(nodeBindingIssues(docOf([unknown]), gate(clause()), { coverage, levelOf })).toEqual([]);
    // 레벨을 아는 상품 · 세목 레벨은 그대로 typeMismatch
    const planLevel = (c: string) => (c === "D0001" ? "plan" : levelOf(c)) as never;
    const plan = ref({ 감액: { kind: "discriminator", code: "D0001", node: { path: "01" } } });
    expect(nodeBindingIssues(docOf([plan]), gate(clause()), { coverage, levelOf: planLevel })[0].message).toContain("상품 · 세목 레벨");
  });
});

describe("한정 없는 하위 레벨 연결의 빈칸 판정 (값 패널 공용)", () => {
  it("감싼 가장 안쪽 트리 반복이 그 레벨을 풀 때만 찬다", () => {
    expect(unqualifiedNodeArgUnbound("subCoverage", [])).toBe(true);
    expect(unqualifiedNodeArgUnbound("subCoverage", [{ level: "subCoverage" }])).toBe(false);
    expect(unqualifiedNodeArgUnbound("benefit", [{ level: "subCoverage" }])).toBe(true);
    expect(unqualifiedNodeArgUnbound("subCoverage", [{ level: "subCoverage" }, { level: "benefit" }])).toBe(false);
  });

  it("사용처 연결이 키 없이 하위 레벨 구분자를 묶으면 「키를 고른다」 안내", () => {
    const issues = nodeBindingIssues(docOf([ref({ 감액: { kind: "discriminator", code: "D0002" } })]), gate(clause()), { coverage, levelOf });
    expect(issues).toEqual([expect.objectContaining({ kind: "argUnbound", message: expect.stringContaining("키를 고른다"), at: expect.objectContaining({ refPath: "arg.감액" }) })]);
  });
});
