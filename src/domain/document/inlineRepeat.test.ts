import { describe, expect, it } from "vitest";

import type { EnumDef } from "../catalog/types";
import type { Issue } from "../types";
import type { RepeatSource } from "./blockRepeat";
import { enclosingLoops, loopTypesAt } from "./blockRepeat";
import { nodeBuilders, sequentialIds } from "./builders";
import { applyCommand } from "./commands";
import { fallbackPathId, indexTree, validateTree, type DocumentNode, type InlineForNode, type TreeEnv } from "./nodes";
import { catalogTypeResolver, validateDocument } from "./validate";

/**
 * 인라인 반복 저장 검사 (ADR-0088 결정 1 ② · 2 · 3 · 5 · 기능/문면 §3.12).
 * 원천 = 블록 반복과 같은 RepeatSource · 한 겹 · 연결어 기본값 없음 · 「비었을 때」 칸(원소 문맥 밖) · 「현재 값」 슬롯.
 */

const 종마다: RepeatSource = { kind: "planOptions", form: "waiver", filter: "waiver.applies = true" };
const 정의조대상마다: RepeatSource = { kind: "union", form: "waiver", filter: "waiver.applies = true", field: "reasons", where: { field: "F03", value: true } };

const E0001: EnumDef = {
  code: "E0001",
  label: "납입면제사유",
  fields: [
    { key: "F01", label: "약관표시명", type: "string", order: 1 },
    { key: "F03", label: "정의조대상", type: "boolean", order: 2 },
  ],
  values: [
    { code: "V01", label: "암", order: 0, fields: { F01: "암(유사암제외)", F03: true } },
    { code: "V02", label: "뇌졸중", order: 1, fields: { F01: "뇌졸중", F03: true } },
  ],
};
const env: TreeEnv = { enumOf: (c) => (c === "E0001" ? E0001 : undefined) };

const make = () => nodeBuilders(sequentialIds("n"));
const messages = (issues: Issue[]) => issues.map((i) => i.message);

function sentence(node: InlineForNode): DocumentNode {
  const b = nodeBuilders(sequentialIds("s"));
  return b.document("d", [b.article("a", [b.paragraph([b.text("다음 "), node, b.text("의 경우")])])]);
}

describe("인라인 반복 — 원천 · 연결어 (ADR-0088 결정 1 · 2)", () => {
  it("세목 선택지 · 합집합 원천 + 연결어 = 통과", () => {
    const b = make();
    expect(validateTree(sentence(b.inlineFor(종마다, [b.slot("builtin.plan.name")], { connector: "및" })), env)).toEqual([]);
    expect(validateTree(sentence(b.inlineFor(정의조대상마다, [b.slot("builtin.value.F01")], { connector: "또는" })), env)).toEqual([]);
  });

  it("「쉼표만」(`,`) 연결어도 통과 — 실물 정의 조 제목 「A, B, C의 정의 및 진단확정」", () => {
    const b = make();
    expect(validateTree(sentence(b.inlineFor(정의조대상마다, [b.slot("builtin.value.F01")], { connector: "," })), env)).toEqual([]);
  });

  it("연결어 미선택 = 저장 오류 (기본값 없음) · 그 밖의 값도 오류", () => {
    const b = make();
    const none = validateTree(sentence(b.inlineFor(종마다, [b.slot("builtin.plan.name")])), env);
    expect(messages(none)).toEqual([expect.stringContaining("연결어")]);
    const bad = b.inlineFor(종마다, [b.slot("builtin.plan.name")]);
    (bad as { connector?: unknown }).connector = "쉼표";
    expect(messages(validateTree(sentence(bad), env))).toEqual([expect.stringContaining("「및」·「또는」·「,」")]);
  });

  it("원천이 없거나 옛 모양(글자 원천)이면 오류", () => {
    const b = make();
    const old = { id: "f", kind: "inlineFor", source: "subCoverage", children: [], connector: "및" } as unknown as InlineForNode;
    expect(messages(validateTree(sentence(old), env))).toEqual([expect.stringContaining("원천")]);
    void b;
  });

  it("목록 필드 원천은 바깥 블록 반복이 있을 때만 — 그 바깥의 현재 종", () => {
    const b = make();
    const inline = b.inlineFor({ kind: "listOfCurrent", loop: "?", field: "reasons" }, [b.slot("builtin.value.F01")], { connector: "및" });
    const outer = b.forBlock(종마다, [b.paragraph([inline])]);
    inline.source = { kind: "listOfCurrent", loop: outer.id, field: "reasons" };
    const doc = b.document("d", [b.article("a", [outer])]);
    expect(validateTree(doc, env)).toEqual([]);
    const alone = make();
    const bare = alone.inlineFor({ kind: "listOfCurrent", loop: "x", field: "reasons" }, [alone.text("사유")], { connector: "및" });
    expect(messages(validateTree(sentence(bare), env))).toEqual([expect.stringContaining("바깥 반복")]);
  });
});

describe("인라인 반복 — 한 겹 (ADR-0088 결정 1)", () => {
  it("인라인 반복 안 인라인 반복 = 오류 (본문 · 「비었을 때」 칸 모두)", () => {
    const b = make();
    const inner = b.inlineFor(종마다, [b.text("x")], { connector: "및" });
    const r1 = validateTree(sentence(b.inlineFor(종마다, [inner], { connector: "및" })), env);
    expect(messages(r1)).toEqual([expect.stringContaining("인라인 반복 안에 인라인 반복")]);
    const inFallback = b.inlineFor(종마다, [b.text("y")], { connector: "및" });
    const r2 = validateTree(sentence(b.inlineFor(종마다, [b.text("z")], { connector: "및", fallback: [inFallback] })), env);
    expect(messages(r2)).toEqual([expect.stringContaining("인라인 반복 안에 인라인 반복")]);
  });

  it("블록 반복 하나 안 = 통과, 블록 반복 두 겹 안 = 오류", () => {
    const b = make();
    const deep = b.inlineFor({ kind: "listOfCurrent", loop: "?", field: "reasons" }, [b.text("x")], { connector: "및" });
    const second = b.forBlock({ kind: "listOfCurrent", loop: "?", field: "reasons" }, [b.item([deep])]);
    const first = b.forBlock(종마다, [b.paragraph([b.text("항")], [second])]);
    second.source = { kind: "listOfCurrent", loop: first.id, field: "reasons" };
    deep.source = { kind: "listOfCurrent", loop: first.id, field: "reasons" };
    const issues = validateTree(b.document("d", [b.article("a", [first])]), env);
    expect(issues.some((i) => i.message.includes("한 단계") && i.at.nodePath?.at(-1) === deep.id)).toBe(true);
  });

  it("인라인 반복 본문에 문장 안 조건이 설 수 있다", () => {
    const b = make();
    const node = b.inlineFor(종마다, [b.inlineCond([b.inlineBranch("D0001", [b.text("갑")])])], { connector: "및" });
    expect(validateTree(sentence(node), env)).toEqual([]);
  });
});

describe("「비었을 때」 칸 (ADR-0088 결정 3)", () => {
  it("칸 노드는 색인된다 — 경로에 칸 표지, 감싼 반복에서 그 반복은 빠진다", () => {
    const b = make();
    const inFallback = b.text("해당 없음");
    const inBody = b.slot("builtin.plan.name");
    const node = b.inlineFor(종마다, [inBody], { connector: "및", fallback: [inFallback] });
    const ix = indexTree(sentence(node));
    const fe = ix.nodes.get(inFallback.id)!;
    expect(fe.path).toContain(fallbackPathId(node.id));
    expect(fe.slot).toBe("fallback");
    expect(enclosingLoops(ix, fe)).toEqual([]);
    expect(enclosingLoops(ix, ix.nodes.get(inBody.id)!).map((l) => l.id)).toEqual([node.id]);
    expect([...loopTypesAt(ix, ix.nodes.get(inBody.id)!).keys()]).toEqual([node.id]);
  });

  it("칸 안에서 현재 원소를 읽으면 저장 오류 — 종형명 · 현재 값", () => {
    const b = make();
    const plan = validateTree(sentence(b.inlineFor(종마다, [b.slot("builtin.plan.name")], { connector: "및", fallback: [b.slot("builtin.plan.name")] })), env);
    expect(messages(plan)).toEqual([expect.stringContaining("「비었을 때」 칸")]);
    const value = validateTree(sentence(b.inlineFor(정의조대상마다, [b.slot("builtin.value.F01")], { connector: "및", fallback: [b.slot("builtin.value.F01")] })), env);
    expect(messages(value)).toEqual([expect.stringContaining("「비었을 때」 칸")]);
  });

  it("칸 안이라도 바깥 블록 반복의 현재 종은 읽는다", () => {
    const b = make();
    const inline = b.inlineFor({ kind: "listOfCurrent", loop: "?", field: "reasons" }, [b.slot("builtin.value.F01")], { connector: "및", fallback: [b.slot("builtin.plan.name"), b.text(" 사유 없음")] });
    const outer = b.forBlock(종마다, [b.paragraph([inline])]);
    inline.source = { kind: "listOfCurrent", loop: outer.id, field: "reasons" };
    expect(validateTree(b.document("d", [b.article("a", [outer])]), env)).toEqual([]);
  });
});

describe("「현재 값」 슬롯 (ADR-0088 결정 1)", () => {
  it("열거값 반복 밖이면 오류 · 종 반복 안이어도 오류", () => {
    const b = make();
    const outside = validateTree(b.document("d", [b.article("a", [b.paragraph([b.slot("builtin.value.F01")])])]), env);
    expect(messages(outside)).toEqual([expect.stringContaining("「현재 값」")]);
    const inPlan = validateTree(sentence(b.inlineFor(종마다, [b.slot("builtin.value.F01")], { connector: "및" })), env);
    expect(messages(inPlan)).toEqual([expect.stringContaining("「현재 값」")]);
  });

  it("열거형의 문자 필드만 — 없는 필드 · 참거짓 필드는 오류", () => {
    const b = make();
    expect(messages(validateTree(sentence(b.inlineFor(정의조대상마다, [b.slot("builtin.value.F09")], { connector: "및" })), env))).toEqual([expect.stringContaining("F09")]);
    expect(messages(validateTree(sentence(b.inlineFor(정의조대상마다, [b.slot("builtin.value.F03")], { connector: "및" })), env))).toEqual([expect.stringContaining("문자 필드")]);
  });

  it("값 이름(`builtin.value.name`)은 저장 오류 — 관리용이라 약관에 찍지 않는다 (2026-10-17 사용자 결정)", () => {
    const b = make();
    const inline = validateTree(sentence(b.inlineFor(정의조대상마다, [b.slot("builtin.value.name")], { connector: "및" })), env);
    expect(inline.map((i) => i.kind)).toEqual(["typeMismatch"]);
    expect(messages(inline)).toEqual([expect.stringContaining("값 이름")]);
    const block = validateTree(b.document("d", [b.article("a", [b.forBlock(정의조대상마다, [b.paragraph([b.slot("builtin.value.name")])])])]), env);
    expect(messages(block)).toEqual([expect.stringContaining("값 이름")]);
  });

  it("블록 반복(열거값 원소) 안에서도 읽는다", () => {
    const b = make();
    const doc = b.document("d", [b.article("a", [b.forBlock(정의조대상마다, [b.paragraph([b.slot("builtin.value.F01")])])])]);
    expect(validateTree(doc, env)).toEqual([]);
  });

  it("식 검사(문서 저장)도 통과한다 — 내장 경로", () => {
    const b = make();
    const doc = sentence(b.inlineFor(정의조대상마다, [b.slot("builtin.value.F01"), b.text("·"), b.slot("builtin.value.F01")], { connector: "및" }));
    expect(validateDocument(doc, { env, resolve: catalogTypeResolver([]), scope: {} })).toEqual([]);
  });
});

describe("편집 명령 — 인라인 반복 (ADR-0088)", () => {
  it("setFor 로 원천 · 연결어 · 별칭을 바꾼다 — 원천이 틀리면 거부", () => {
    const b = make();
    const node = b.inlineFor(종마다, [b.text("a")], { connector: "및" });
    const doc = sentence(node);
    const r = applyCommand(doc, { type: "setFor", nodeId: node.id, source: 정의조대상마다, connector: "또는", alias: "사유마다" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = indexTree(r.value).nodes.get(node.id)!.node as InlineForNode;
    expect(after).toMatchObject({ source: 정의조대상마다, connector: "또는", alias: "사유마다" });
    const bad = applyCommand(doc, { type: "setFor", nodeId: node.id, source: { kind: "listOfCurrent", loop: "x", field: "reasons" } });
    expect(bad.ok).toBe(false);
  });

  it("「비었을 때」 칸을 문장 자리로 고친다 (setInlines · slot fallback)", () => {
    const b = make();
    const node = b.inlineFor(종마다, [b.text("a")], { connector: "및" });
    const doc = sentence(node);
    const r = applyCommand(doc, { type: "setInlines", at: { parentId: node.id, slot: "fallback" }, runs: [{ id: "fb1", text: "해당 없음" }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((indexTree(r.value).nodes.get(node.id)!.node as InlineForNode).fallback).toEqual([{ id: "fb1", kind: "text", text: "해당 없음" }]);
    // 칸 안 현재 원소 읽기는 넣는 자리에서 거부
    const bad = applyCommand(doc, { type: "setInlines", at: { parentId: node.id, slot: "fallback" }, runs: [{ node: { id: "s", kind: "slot", ref: "builtin.plan.name" } }] });
    expect(bad.ok).toBe(false);
  });
});


describe("인라인 반복 — 담보 트리 원천은 범위 밖 (ADR-0088 결정 1 · ADR-0087 결정 5)", () => {
  const special: TreeEnv = { ...env, kind: "special" };

  it("담보약관이어도 「세부보장마다」 · 「세부보장 › 급부마다」 원천의 문장 안 반복 = 저장 오류", () => {
    const b = make();
    for (const source of [{ kind: "subCoverages" }, { kind: "benefits" }] as RepeatSource[]) {
      const issues = validateTree(sentence(b.inlineFor(source, [b.text("x")], { connector: "및" })), special);
      expect(messages(issues)).toEqual([expect.stringContaining("담보 트리")]);
    }
  });

  it("「세부보장마다」 블록 반복 안의 문장 안 반복도 트리 원천(현재 세부보장의 급부마다)은 거부 · 세목 원천은 섞인 중첩으로 거부", () => {
    const b = make();
    const inline = b.inlineFor({ kind: "benefitsOfCurrent", loop: "?" }, [b.text("x")], { connector: "및" });
    const outer = b.forBlock({ kind: "subCoverages" }, [b.paragraph([inline])]);
    inline.source = { kind: "benefitsOfCurrent", loop: outer.id };
    expect(messages(validateTree(b.document("d", [b.article("a", [outer])]), special))).toEqual([expect.stringContaining("담보 트리")]);
    const b2 = make();
    const plan = b2.inlineFor(종마다, [b2.text("x")], { connector: "및" });
    const tree = b2.forBlock({ kind: "subCoverages" }, [b2.paragraph([plan])]);
    expect(messages(validateTree(b2.document("d", [b2.article("a", [tree])]), special))).toEqual([expect.stringContaining("섞어 중첩")]);
  });
});
