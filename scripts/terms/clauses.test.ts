import { describe, expect, it } from "vitest";

import type { ArticleNode, InlineNode } from "../../src/domain/document/nodes";

import { applyClauseUse, inlineBody, renderings, replaceInlineRun, toClauseInline, type ClauseRecord } from "./clauses";

const text = (id: string, t: string): InlineNode => ({ id, kind: "text", text: t });
const ref = (id: string, nodeId: string, scope: "self" | "general" = "self"): InlineNode => ({ id, kind: "articleRef", targets: [{ nodeId }], connector: "및", scope });

const INLINE: ClauseRecord = {
  code: "C0004",
  label: "소멸 시 해약환급금 미지급",
  mode: "inline",
  description: "",
  body: [
    { id: "c4-x1", kind: "text", text: "이 특별약관이 " },
    { id: "c4-x2", kind: "optionSlot", optionCode: "O01" },
    { id: "c4-x3", kind: "text", text: " 경우에는 지급하지 않습니다." },
  ],
  options: [
    {
      code: "O01",
      label: "소멸 표현",
      order: 0,
      values: [
        { code: "V01", label: "소멸된", order: 0, body: [{ id: "v1", kind: "text", text: "소멸된" }] },
        { code: "V02", label: "소멸되는", order: 1, body: [{ id: "v2", kind: "text", text: "소멸되는" }] },
      ],
    },
  ],
};

function article(children: InlineNode[]): ArticleNode {
  return { id: "s-a3", kind: "article", title: "특별약관의 소멸", children: [{ id: "s-a3-p2", kind: "paragraph", children }] };
}

describe("공용조항 오버레이 — 원문 자리를 참조로", () => {
  it("평문 → 공용조항 인라인: {O01} 은 옵션 자리 · 보통약관 조 참조는 scope 를 뗀다 · 자기 조 참조는 거부", () => {
    const body = inlineBody("가 {O01} 나", "c1", (t, newId) => [text(newId(), t)]);
    expect(body.map((n) => n.kind)).toEqual(["text", "optionSlot", "text"]);
    expect(toClauseInline(ref("r", "g-a9", "general"))).toEqual({ id: "r", kind: "articleRef", targets: [{ nodeId: "g-a9" }], connector: "및" });
    expect(() => toClauseInline(ref("r", "s-a1"))).toThrow(/보통약관 마스터만/);
  });

  it("조건은 가지마다 렌더가 갈린다 — 가지가 모두 조건이면 빈 렌더도 있다", () => {
    const cond: InlineNode = { id: "c", kind: "inlineCond", branches: [{ id: "t", when: "x", children: [text("a", "갑")] }] };
    expect(renderings([text("x", "A"), cond]).map((r) => r.join(""))).toEqual(["A갑", "A"]);
  });

  it("「문구」 — 고른 선택지로 펼친 원자열을 항 안에서 찾아 참조 하나로 바꾸고, 앞뒤 텍스트 · 참조는 남긴다", () => {
    const a = article([ref("s-a3-p2-x1", "s-a3-p1"), text("s-a3-p2-x2", "에 따라 이 특별약관이 소멸되는 경우에는 지급하지 않습니다.")]);
    const report: string[] = [];
    expect(applyClauseUse({ article: "3", paragraph: 2, clause: "C0004", options: { O01: "V02" } }, INLINE, () => a, "[t]", report)).toBe(true);
    expect(report).toEqual([]);
    const p = a.children[0];
    if (p.kind !== "paragraph") throw new Error("항 아님");
    expect(p.children.map((n) => n.kind)).toEqual(["articleRef", "text", "clauseInlineRef"]);
    expect(p.children[1]).toEqual(text("s-a3-p2-x2", "에 따라 "));
    expect(p.children[2]).toEqual({ id: "s-a3-p2-k1", kind: "clauseInlineRef", clauseCode: "C0004", options: { O01: "V02" } });
  });

  it("선택지가 원문과 다르면 바꾸지 않고 보고한다 (조용히 다른 문장을 만들지 않는다)", () => {
    const a = article([text("x", "이 특별약관이 소멸되는 경우에는 지급하지 않습니다.")]);
    const report: string[] = [];
    expect(applyClauseUse({ article: "3", paragraph: 2, clause: "C0004", options: { O01: "V01" } }, INLINE, () => a, "[t]", report)).toBe(false);
    expect(report[0]).toMatch(/문구를 찾지 못함/);
  });

  it("「항」 — 항의 가능한 렌더가 모두 공용조항 렌더 안에 있어야 항 전체를 참조로 바꾼다", () => {
    const block: ClauseRecord = { ...INLINE, code: "C0011", mode: "block", options: [], body: [{ id: "p", kind: "paragraph", children: [{ id: "x", kind: "text", text: "합산합니다." }] }] };
    const a = article([text("x", "합산합니다.")]);
    expect(applyClauseUse({ article: "3", paragraph: 2, clause: "C0011" }, block, () => a, "[t]", [])).toBe(true);
    expect(a.children).toEqual([{ id: "s-a3-p2-k", kind: "clauseBlockRef", clauseCode: "C0011", options: {} }]);
  });

  it("구간이 텍스트 노드 가운데에서 시작 · 끝나도 쪼개 남긴다", () => {
    const owner = { id: "p", children: [text("t", "앞말 가나다 뒷말")] };
    const r: InlineNode = { id: "k", kind: "clauseInlineRef", clauseCode: "C1", options: {} };
    expect(replaceInlineRun(owner, [..."가나다"], r)).toBe(true);
    expect(owner.children).toEqual([text("t", "앞말 "), r, text("tr", " 뒷말")]);
  });
});
