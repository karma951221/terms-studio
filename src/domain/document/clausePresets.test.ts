import { describe, expect, it } from "vitest";

import type { Clause } from "../clause/types";
import { presetUses, renameBindingsIn, unfoldPresetsIn } from "./clausePresets";
import type { DocumentNode } from "./nodes";

/** 프리셋 삭제 = 사용처를 직접 연결로 풀고 지운다 (ADR-0084 결정 7) · 관계정보 프리셋별 사용 수 (결정 8). */
const 호: Clause = {
  code: "C0022",
  label: "납입면제 호",
  mode: "block",
  body: [],
  options: [{ code: "O01", label: "기산", order: 0, values: [{ code: "V01", label: "계약일", order: 0, body: [] }, { code: "V02", label: "최초계약일", order: 1, body: [] }] }],
  params: [{ name: "갱신", type: { kind: "boolean" } }],
  presets: [
    { code: "S01", name: "상해", options: { O01: "V01" }, bindings: { 갱신: { kind: "const", value: true } } },
    { code: "S02", name: "질병", options: { O01: "V02" }, bindings: { 갱신: { kind: "const", value: false } } },
  ],
  required: { discriminators: [], attributes: [] },
};

const tree = (): DocumentNode =>
  ({
    kind: "document",
    id: "d",
    title: "특약",
    children: [
      { kind: "article", id: "a1", title: "면제", children: [{ kind: "clauseBlockRef", id: "k1", clauseCode: "C0022", options: {}, preset: "S01" }, { kind: "clauseBlockRef", id: "k2", clauseCode: "C0022", options: {}, preset: "S02" }] },
      { kind: "article", id: "a2", title: "다른", children: [{ kind: "clauseBlockRef", id: "k3", clauseCode: "C0099", options: {}, preset: "S01" }] },
    ],
  }) as DocumentNode;

describe("프리셋 풀기 · 사용 수", () => {
  it("지운 프리셋을 쓰던 참조만 프리셋 값의 직접 연결 · 옵션 선택으로 — 다른 함수조항 · 남는 프리셋은 그대로, 원본은 바꾸지 않는다", () => {
    const before = tree();
    const r = unfoldPresetsIn(before, 호, new Set(["S01"]));
    expect(r.count).toBe(1);
    const [k1, k2] = (r.node as DocumentNode).children[0].kind === "article" ? ((r.node as DocumentNode).children[0] as { children: unknown[] }).children : [];
    expect(k1).toEqual({ kind: "clauseBlockRef", id: "k1", clauseCode: "C0022", options: { O01: "V01" }, bindings: { 갱신: { kind: "const", value: true } } });
    expect(k2).toMatchObject({ preset: "S02" });
    expect(JSON.stringify(r.node)).toContain('"clauseCode":"C0099","options":{},"preset":"S01"');
    expect(before.children[0]).toMatchObject({ children: [{ preset: "S01" }, { preset: "S02" }] });
  });

  it("프리셋별 사용 수", () => {
    expect(presetUses(tree(), "C0022")).toEqual(new Map([["S01", 1], ["S02", 1]]));
  });
});

describe("renameBindingsIn — 인자 이름 바꾸기의 사용처 연결 키 (기능/함수조항 §3.7)", () => {
  it("그 함수조항 참조의 bindings 키만 바꾸고 센다 — 다른 함수조항 · 값은 그대로, 원본은 바꾸지 않는다", () => {
    const tree = {
      kind: "document",
      children: [
        { kind: "clauseBlockRef", id: "r1", clauseCode: "C0001", options: {}, bindings: { 사유: { kind: "discriminator", code: "D0001" }, 갱신: { kind: "const", value: true } } },
        { kind: "clauseBlockRef", id: "r2", clauseCode: "C0002", options: {}, bindings: { 사유: { kind: "discriminator", code: "D0001" } } },
        { kind: "clauseInlineRef", id: "r3", clauseCode: "C0001", options: {} },
      ],
    };
    const out = renameBindingsIn(tree, "C0001", new Map([["사유", "면제사유"]]));
    expect(out.count).toBe(1);
    expect(out.node.children[0]).toMatchObject({ bindings: { 면제사유: { kind: "discriminator", code: "D0001" }, 갱신: { kind: "const", value: true } } });
    expect(out.node.children[1]).toMatchObject({ bindings: { 사유: { kind: "discriminator", code: "D0001" } } });
    expect(tree.children[0]).toMatchObject({ bindings: { 사유: { kind: "discriminator", code: "D0001" } } });
  });
});
