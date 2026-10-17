import { describe, expect, it } from "vitest";

import type { Discriminator } from "../catalog/types";
import { dynTableFixtureA, type DynTable } from "../dyntable";
import { nodeBuilders, sequentialIds } from "./builders";
import { renameDynTableBindingsIn } from "./clausePresets";
import { allowedChildren, allowedListChildren, PERMISSIVE_DYN_TABLE_GATE, validateTree, type DynTableGate, type DynTableRefNode } from "./nodes";
import { dynTableCodesIn } from "./refs";
import { catalogTypeResolver, dynTableGateFrom, validateDocument } from "./validate";

const catalog: Discriminator[] = [
  { code: "D0001", label: "갱신여부", description: "", level: "coverage", expression: "coverage.renewal", resultType: { kind: "boolean" } },
  { code: "D0002", label: "담보명", description: "", level: "coverage", expression: "coverage.name", resultType: { kind: "string" } },
];

const tableA: DynTable = { id: "t-a", code: "T0001", ...dynTableFixtureA() };

function make() {
  return nodeBuilders(sequentialIds("n"));
}

function summary(issues: { kind: string; message: string; at: { nodePath?: string[]; refPath?: string } }[]) {
  return issues.map((i) => [i.kind, i.at.refPath ?? i.at.nodePath?.at(-1), i.message]);
}

describe("동적표 참조 노드 dynTableRef — 자리 (기능/동적표 §3.5)", () => {
  it("조 자리 · 항의 호 목록 자리에 선다, 호의 목 목록에는 못 선다", () => {
    expect(allowedChildren.article).toContain("dynTableRef");
    expect(allowedListChildren["paragraph.items"]).toContain("dynTableRef");
    expect(allowedListChildren["item.subitems"]).not.toContain("dynTableRef");
    expect(allowedChildren.dynTableRef).toEqual([]);
  });

  it("빌더 — 코드만 · 연결까지", () => {
    const b = make();
    expect(b.dynTableRef("T0001")).toEqual({ id: "n1", kind: "dynTableRef", tableCode: "T0001" });
    expect(b.dynTableRef("T0001", { 갱신형: { kind: "const", value: true } })).toEqual({ id: "n2", kind: "dynTableRef", tableCode: "T0001", bindings: { 갱신형: { kind: "const", value: true } } });
  });

  it("조 아래 · 항 아래 목록은 통과, 호의 목 목록은 구조 오류", () => {
    const b = make();
    const ref = b.dynTableRef("T0001");
    const ok = b.document("d", [b.article("a", [b.paragraph([b.text("표")], [ref]), b.dynTableRef("T0001")])]);
    expect(validateTree(ok, { kind: "special" })).toEqual([]);
    const bad = b.document("d", [b.article("a", [b.paragraph([b.text("x")], [b.item([b.text("호")], [b.dynTableRef("T0001") as unknown as never])])])]);
    expect(validateTree(bad, { kind: "special" }).map((i) => i.message)).toEqual(["item 의 subitems 자리에 dynTableRef 은(는) 올 수 없습니다"]);
  });

  it("보통약관 문맥(general)에는 넣을 수 없다 — structure", () => {
    const b = make();
    const doc = b.document("d", [b.article("a", [b.dynTableRef("T0001")])]);
    expect(validateTree(doc, { kind: "general" }).map((i) => [i.kind, i.message])).toEqual([["structure", "동적표는 담보약관(상품담보) 문맥에서만 쓸 수 있습니다 — 보통약관에는 넣을 수 없습니다"]]);
  });

  it("게이트가 모르는 동적표는 brokenRef, 게이트가 없거나 PERMISSIVE 면 통과", () => {
    const b = make();
    const doc = b.document("d", [b.article("a", [b.dynTableRef("T0404")])]);
    const gate: DynTableGate = { exists: (c) => c === "T0001" };
    expect(validateTree(doc, { kind: "special", dynTableGate: gate }).map((i) => [i.kind, i.message, i.at.nodePath?.at(-1)])).toEqual([["brokenRef", "동적표 T0404 이(가) 없습니다", "n1"]]);
    expect(validateTree(doc, { kind: "special" })).toEqual([]);
    expect(validateTree(doc, { kind: "special", dynTableGate: PERMISSIVE_DYN_TABLE_GATE })).toEqual([]);
  });
});

describe("dynTableGateFrom — 정의로 만든 게이트 · 연결 검사 (기능/동적표 §3.6 삽입 검사)", () => {
  const resolve = catalogTypeResolver(catalog);
  const gate = dynTableGateFrom([tableA], { discriminatorType: (c) => resolve({ kind: "discriminator", code: c }), discriminatorExists: (c) => catalog.some((d) => d.code === c) });
  const check = (node: DynTableRefNode) => {
    const b = nodeBuilders(sequentialIds("d"));
    const doc = b.document("d", [b.article("a", [node])]);
    return summary(validateDocument(doc, { env: { kind: "special", dynTableGate: gate }, resolve, scope: {} }));
  };

  it("존재", () => {
    expect(gate.exists("T0001")).toBe(true);
    expect(gate.exists("T0002")).toBe(false);
  });

  it("갱신형을 연결하지 않으면(기본 연결 없음) argUnbound — 저장 거부", () => {
    const b = make();
    expect(check(b.dynTableRef("T0001"))).toEqual([["argUnbound", "arg.갱신형", "동적표 T0001 의 인자 갱신형 이(가) 연결되지 않았습니다 — 기본 연결이 없어 넣는 자리에서 구분자 · 상수를 댄다"]]);
  });

  it("상수 boolean 연결은 통과, 글 상수를 boolean 인자에 대면 typeMismatch", () => {
    const b = make();
    expect(check(b.dynTableRef("T0001", { 갱신형: { kind: "const", value: true } }))).toEqual([]);
    const bad = check(b.dynTableRef("T0001", { 갱신형: { kind: "const", value: "예" } }));
    expect(bad.map((x) => [x[0], x[1]])).toEqual([["typeMismatch", "arg.갱신형"]]);
  });

  it("구분자 연결 — 타입이 맞으면 통과, 다르면 typeMismatch, 없는 인자에 연결하면 brokenRef", () => {
    const b = make();
    expect(check(b.dynTableRef("T0001", { 갱신형: { kind: "discriminator", code: "D0001" } }))).toEqual([]);
    // 구분자 타입 불일치의 좌표는 그 구분자 코드 — 함수조항 연결 검사(`checkBinding`)와 같은 규약
    expect(check(b.dynTableRef("T0001", { 갱신형: { kind: "discriminator", code: "D0002" } })).map((x) => [x[0], x[1]])).toEqual([["typeMismatch", "D0002"]]);
    expect(check(b.dynTableRef("T0001", { 갱신형: { kind: "const", value: true }, 단서: { kind: "const", value: "x" } })).map((x) => [x[0], x[1]])).toEqual([["brokenRef", "arg.단서"]]);
  });

  it("없는 동적표는 brokenRef 하나 — 연결 검사는 하지 않는다", () => {
    const b = make();
    expect(check(b.dynTableRef("T0009")).map((x) => [x[0], x[1]])).toEqual([["brokenRef", "n1"]]);
  });
});

describe("dynTableCodesIn — 문서가 참조하는 동적표 코드 (관계정보 · 삭제 영향)", () => {
  it("조 자리 · 항 아래 · 조건 가지 안까지, 중복 없이", () => {
    const b = make();
    const doc = b.document("d", [
      b.article("a", [b.dynTableRef("T0001"), b.paragraph([b.text("x")], [b.dynTableRef("T0002")]), b.condBlock([b.branch("D0001", [b.dynTableRef("T0001")])])]),
    ]);
    expect([...dynTableCodesIn(doc)]).toEqual(["T0001", "T0002"]);
    expect(dynTableCodesIn(b.document("e", []))).toEqual(new Set());
  });
});

describe("renameDynTableBindingsIn — 동적표 인자 이름 바꾸기의 사용처 몫", () => {
  it("그 동적표 참조의 연결 키만 바꾼다 — 다른 코드 · 함수조항 참조는 그대로, 원본 불변", () => {
    const b = make();
    const mine = b.dynTableRef("T0001", { 갱신형: { kind: "const", value: true } });
    const other = b.dynTableRef("T0002", { 갱신형: { kind: "const", value: false } });
    const doc = b.document("d", [b.article("a", [mine, b.paragraph([b.text("x")], [other])])]);
    const { node, count } = renameDynTableBindingsIn(doc, "T0001", new Map([["갱신형", "갱신"]]));
    expect(count).toBe(1);
    expect([...dynTableCodesIn(node)]).toEqual(["T0001", "T0002"]);
    const renamed = (node.children[0] as { children: DynTableRefNode[] }).children[0];
    expect(renamed.bindings).toEqual({ 갱신: { kind: "const", value: true } });
    expect(mine.bindings).toEqual({ 갱신형: { kind: "const", value: true } });
    expect(((node.children[0] as { children: { items?: DynTableRefNode[] }[] }).children[1].items ?? [])[0].bindings).toEqual({ 갱신형: { kind: "const", value: false } });
  });
});
