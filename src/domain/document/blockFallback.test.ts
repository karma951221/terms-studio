import { describe, expect, it } from "vitest";

import { clauseCodeIssues, withClauseCodes } from "../clause/pcode";
import type { ClauseBody } from "../clause/types";
import type { EnumDef } from "../catalog/types";
import type { Issue } from "../types";
import type { RepeatSource } from "./blockRepeat";
import { enclosingLoops, loopTypesAt, repeatedKeys } from "./blockRepeat";
import { nodeBuilders, sequentialIds } from "./builders";
import { applyCommand } from "./commands";
import { fallbackPathId, indexTree, validateTree, type DocumentNode, type ForBlockNode, type TreeEnv } from "./nodes";
import { numberTree, referenceOutline, referenceTargetIndex } from "./numbering";
import { documentCodeIssues, refKey, withCodes } from "./pcode";

/**
 * 블록 반복의 「비었을 때」 칸 (ADR-0088 결정 3 · 4 · 기능/문면 §3.12).
 * 칸 = 블록 내용(반복 본문과 같은 허용 집합) · 원소 문맥 밖 · 본문 ↔ 칸은 IF / 그 밖의 경우 분기 짝(같은 P코드 공존 허용 · 대상 고르기 한 줄).
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
  values: [{ code: "V01", label: "암", order: 0, fields: { F01: "암(유사암제외)", F03: true } }],
};
const env: TreeEnv = { enumOf: (c) => (c === "E0001" ? E0001 : undefined) };

const make = () => nodeBuilders(sequentialIds("n"));
const messages = (issues: Issue[]) => issues.map((i) => i.message);

/** 조 하나 · 그 조 자리에 반복 블록 하나(본문 · 칸). */
function withRepeat(b: ReturnType<typeof make>, body: ForBlockNode["children"], fallback: ForBlockNode["fallback"], source: RepeatSource = 종마다) {
  const loop = b.forBlock(source, body, undefined, fallback);
  const doc = b.document("d", [b.article("a", [loop])]);
  return { b, doc, loop };
}

describe("블록 반복 「비었을 때」 칸 — 모양 · 색인 (ADR-0088 결정 4)", () => {
  it("칸 노드는 색인된다 — 경로에 칸 표지 · 자리 fallback · 원소 문맥 밖(inFor 아님) · 감싼 반복에서 그 반복은 빠진다", () => {
    const b = make();
    const inBody = b.paragraph([b.text("본문")]);
    const inFallback = b.paragraph([b.text("해당 없음")]);
    const { doc, loop } = withRepeat(b, [inBody], [inFallback]);
    const ix = indexTree(doc);
    const fe = ix.nodes.get(inFallback.id)!;
    expect(fe.slot).toBe("fallback");
    expect(fe.parentId).toBe(loop.id);
    expect(fe.path).toContain(fallbackPathId(loop.id));
    expect(fe.inFor).toBe(false);
    expect(enclosingLoops(ix, fe)).toEqual([]);
    expect(ix.nodes.get(inBody.id)!.inFor).toBe(true);
    expect([...loopTypesAt(ix, ix.nodes.get(inBody.id)!).keys()]).toEqual([loop.id]);
  });

  it("칸의 허용 집합 = 반복 본문과 같다 — 항은 서고 표는 안 된다", () => {
    const b = make();
    const ok = withRepeat(b, [b.paragraph([b.text("x")])], [b.paragraph([b.text("y")])]);
    expect(validateTree(ok.doc, env)).toEqual([]);
    const table = b.table({ columns: [{}], rows: [{ cells: [[b.text("셀")]] }] });
    const bad = withRepeat(b, [b.paragraph([b.text("x")])], [table]);
    expect(messages(validateTree(bad.doc, env))).toEqual([expect.stringContaining("table")]);
  });

  it("칸 안 항에서 그 반복의 현재 원소를 읽으면 저장 오류 — 종형명 · 「현재 값」", () => {
    const b = make();
    const plan = withRepeat(b, [b.paragraph([b.slot("builtin.plan.name")])], [b.paragraph([b.slot("builtin.plan.name")])]);
    expect(messages(validateTree(plan.doc, env))).toEqual([expect.stringContaining("「비었을 때」 칸")]);
    const value = withRepeat(b, [b.paragraph([b.slot("builtin.value.F01")])], [b.paragraph([b.slot("builtin.value.F01")])], 정의조대상마다);
    expect(messages(validateTree(value.doc, env))).toEqual([expect.stringContaining("「비었을 때」 칸")]);
  });

  it("안쪽 반복의 칸 안이라도 바깥 반복의 현재 종은 읽는다", () => {
    const b = make();
    const inner = b.forBlock({ kind: "listOfCurrent", loop: "?", field: "reasons" }, [b.item([b.slot("builtin.value.F01")])], undefined, [b.item([b.slot("builtin.plan.name"), b.text(" — 사유 없음")])]);
    const outer = b.forBlock(종마다, [b.paragraph([b.text("항")], [inner])]);
    inner.source = { kind: "listOfCurrent", loop: outer.id, field: "reasons" };
    expect(validateTree(b.document("d", [b.article("a", [outer])]), env)).toEqual([]);
  });

  it("칸 안 값 한정 「현재 값」 = 저장 오류 (그 반복이 감싸지 않는다)", () => {
    const b = make();
    const target = b.paragraph([b.slot("builtin.value.F01")]);
    target.code = "P0100";
    const loop = b.forBlock(정의조대상마다, [target], undefined, []);
    const ref = b.articleRef({ articleId: "a", code: "P0100", restrict: { current: loop.id } }, "self", "및");
    loop.fallback = [b.paragraph([ref])];
    const article = b.article("제목", [loop]);
    const doc = b.document("d", [{ ...article, id: "a" }]);
    expect(messages(validateTree(doc, env)).some((m) => m.includes("「현재 값」의 반복이 이 참조를 감싸지 않습니다"))).toBe(true);
  });

  it("편집 명령 — 칸 자리에 항을 넣는다(없으면 칸을 만든다) · 표는 거부", () => {
    const b = make();
    const { doc, loop } = withRepeat(b, [b.paragraph([b.text("x")])], undefined);
    const r = applyCommand(doc, { type: "insert", node: { id: "fp", kind: "paragraph", children: [{ id: "ft", kind: "text", text: "해당 없음" }] }, at: { parentId: loop.id, slot: "fallback" } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = indexTree(r.value).nodes.get(loop.id)!.node as ForBlockNode;
    expect(after.fallback?.map((n) => n.id)).toEqual(["fp"]);
    const t = applyCommand(doc, { type: "insert", node: b.table({ columns: [{}], rows: [{ cells: [[]] }] }), at: { parentId: loop.id, slot: "fallback" } });
    expect(t.ok).toBe(false);
  });
});

describe("블록 반복 「비었을 때」 칸 — P코드 분기 짝 (ADR-0088 결정 4 · ADR-0072 결정 4)", () => {
  const b = make();
  const coded = (code: string, text: string) => {
    const p = b.paragraph([b.text(text)]);
    p.code = code;
    return p;
  };

  it("본문 항과 칸 항은 같은 코드를 쓸 수 있다 — 배타", () => {
    const { doc } = withRepeat(b, [coded("P0100", "본문")], [coded("P0100", "칸")]);
    expect(documentCodeIssues(doc)).toEqual([]);
  });

  it("칸 안끼리 · 칸 ↔ 반복 밖 항은 공존 — 같은 코드면 오류", () => {
    const inside = withRepeat(b, [coded("P0100", "본문")], [coded("P0200", "칸1"), coded("P0200", "칸2")]);
    expect(documentCodeIssues(inside.doc).map((i) => i.message)).toEqual([expect.stringContaining("P0200")]);
    const loop = b.forBlock(종마다, [coded("P0100", "본문")], undefined, [coded("P0300", "칸")]);
    const doc = b.document("d", [b.article("a", [loop, coded("P0300", "밖")])]);
    expect(documentCodeIssues(doc).map((i) => i.message)).toEqual([expect.stringContaining("P0300")]);
  });

  it("코드 채우기 — 칸의 같은 자리 항은 본문과 같은 코드(배타 가지의 같은 자리 규칙)", () => {
    const b = make();
    const body = b.paragraph([b.text("본문")]);
    const fb = b.paragraph([b.text("칸")]);
    const { doc } = withRepeat(b, [body], [fb]);
    const filled = withCodes(doc);
    const ix = indexTree(filled);
    const bodyCode = (ix.nodes.get(body.id)!.node as { code?: string }).code;
    expect(bodyCode).toMatch(/^P\d{4}$/);
    expect((ix.nodes.get(fb.id)!.node as { code?: string }).code).toBe(bodyCode);
  });

  it("함수조항 본문의 반복 블록도 본문 ↔ 칸 배타 (clause/pcode)", () => {
    const body = [
      {
        id: "f",
        kind: "forBlock",
        children: [{ id: "p1", kind: "paragraph", code: "P0100", children: [] }],
        fallback: [{ id: "p2", kind: "paragraph", code: "P0100", children: [] }, { id: "p3", kind: "paragraph", children: [] }],
      },
    ] as unknown as ClauseBody;
    expect(clauseCodeIssues(body)).toEqual([]);
    const filled = withClauseCodes(body) as unknown as { fallback: { code?: string }[] }[];
    expect(filled[0]!.fallback.map((p) => p.code)).toEqual(["P0100", "P0200"]);
  });

  it("칸 안 항은 반복 안 대상이 아니다 — 칸에만 있는 코드는 연결어 없이 가리킨다", () => {
    const { doc } = withRepeat(b, [coded("P0100", "본문")], [coded("P0100", "칸 짝"), coded("P0900", "칸만")]);
    const keys = repeatedKeys(indexTree(doc));
    const articleId = doc.children[0]!.id;
    expect(keys.has(refKey({ articleId, code: "P0100" }))).toBe(true);
    expect(keys.has(refKey({ articleId, code: "P0900" }))).toBe(false);
  });
});

describe("블록 반복 「비었을 때」 칸 — 편집기 번호 · 대상 고르기 (2026-10-15 「분기 짝 한 줄」)", () => {
  function sample(): { doc: DocumentNode; loop: ForBlockNode } {
    const b = make();
    const p = (code: string, text: string, items: ReturnType<typeof b.item>[] = []) => {
      const n = b.paragraph([b.text(text)], items);
      n.code = code;
      return n;
    };
    const i = (code: string, text: string) => {
      const n = b.item([b.text(text)]);
      n.code = code;
      return n;
    };
    const loop = b.forBlock(종마다, [p("P0100", "본문 항", [i("P0200", "본문 호")])], undefined, [p("P0100", "칸 항", [i("P0200", "칸 호 짝"), i("P0400", "칸 호")]), p("P0300", "칸만 항")]);
    loop.code = "P0500";
    const doc = b.document("d", [b.article("조", [loop])]);
    return { doc, loop };
  }

  it("편집기 번호는 칸도 센다 — 그 밖의 경우 가지처럼(전체 뷰)", () => {
    const { doc, loop } = sample();
    const numbers = numberTree(doc);
    const [fb1, fb2] = loop.fallback!;
    expect(numbers.get(loop.children[0]!.id)?.n).toBe(1);
    expect(numbers.get(fb1!.id)?.n).toBe(2);
    expect(numbers.get(fb2!.id)?.n).toBe(3);
  });

  it("대상 고르기 — 같은 코드의 본문 · 칸 항은 한 줄(본문 줄), 하위는 코드 기준 합집합, 칸에만 있는 항도 반복 줄 아래", () => {
    const { doc, loop } = sample();
    const index = referenceTargetIndex(doc, numberTree(doc));
    const groups = referenceOutline(index);
    const article = groups[0]!.rows[0]!;
    const repeatRow = article.children[0]!;
    expect(repeatRow.id).toBe(loop.id);
    expect(repeatRow.children.map((r) => r.id)).toEqual([loop.children[0]!.id, loop.fallback![1]!.id]);
    const merged = repeatRow.children[0]!;
    expect(merged.children.map((r) => (r.target.item?.code))).toEqual(["P0200", "P0400"]);
  });
});
