import { describe, expect, it } from "vitest";

import { hostLocator } from "../../src/domain/assembly/resolve";
import type { ArticleNode, DocumentNode, InlineNode, ParagraphNode } from "../../src/domain/document/nodes";

import { applyClauseUse, clauseFromSource, hostPaths, inlineBody, parameterize, placeOptions, reId, renderings, replaceInlineRun, toClauseInline, type ClauseRecord } from "./clauses";

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

  it("「항」 — 본문 항 여럿(호 · 목 포함)을 잇닿은 항들과 대조해 참조 하나로 바꾼다", () => {
    const para = (id: string, t: string, items: string[] = []) => ({
      id,
      kind: "paragraph" as const,
      children: [text(`${id}-x`, t)],
      ...(items.length ? { items: items.map((it, i) => ({ id: `${id}-i${i + 1}`, kind: "item" as const, children: [text(`${id}-i${i + 1}-x`, it)] })) } : {}),
    });
    const block: ClauseRecord = { ...INLINE, code: "C0003", mode: "block", options: [], body: [para("c-p1", "가.", ["하나", "둘"]), para("c-p2", "나.")] as ClauseRecord["body"] };
    const a: ArticleNode = { id: "g-a14", kind: "article", title: "대표자의 지정", children: [para("g-a14-p1", "가.", ["하나", "둘"]), para("g-a14-p2", "나."), { id: "g-a14-b1", kind: "box", title: "연대", lines: ["…"] }] };
    const report: string[] = [];
    expect(applyClauseUse({ article: "14", paragraph: 1, clause: "g" }, block, () => a, "[t]", report)).toBe(true);
    expect(report).toEqual([]);
    expect(a.children.map((c) => c.kind)).toEqual(["clauseBlockRef", "box"]);
    // 호가 하나라도 다르면 바꾸지 않는다
    const b: ArticleNode = { ...a, children: [para("g-a14-p1", "가.", ["하나", "셋"]), para("g-a14-p2", "나.")] };
    expect(applyClauseUse({ article: "14", paragraph: 1, clause: "g" }, block, () => b, "[t]", report)).toBe(false);
    expect(report[0]).toMatch(/제2호가 다름/);
  });

  it("「문구」 — 호 자리(`item`)면 그 호 문장에서 찾는다", () => {
    const a: ArticleNode = {
      id: "s-a4",
      kind: "article",
      title: "보험금을 지급하지 않는 사유",
      children: [{ id: "s-a4-p1", kind: "paragraph", children: [text("p", "다음:")], items: [{ id: "s-a4-p1-i1", kind: "item", children: [text("i", "이 특별약관이 소멸된 경우에는 지급하지 않습니다.")] }] }],
    };
    expect(applyClauseUse({ article: "4", paragraph: 1, item: 1, clause: "C0004", options: { O01: "V01" } }, INLINE, () => a, "[t]", [])).toBe(true);
    const p = a.children[0];
    if (p.kind !== "paragraph" || p.items?.[0].kind !== "item") throw new Error("구조");
    expect(p.items[0].children).toEqual([{ id: "s-a4-p1-i1-k1", kind: "clauseInlineRef", clauseCode: "C0004", options: { O01: "V01" } }]);
  });

  describe("조째 공용조항 — 자기 조 참조는 제 항 · 사용처 위치로 (기능/함수조항 §3.5)", () => {
    /** 특약 — 제1조 지급사유 · 제2조 세부규정 · 제3조 소멸(① 제1조 참조 · ② 제1항 참조 · ③ 사망). */
    function special(prefix: string, lapse: string): DocumentNode {
      const p = (id: string, children: InlineNode[]): ParagraphNode => ({ id, kind: "paragraph", children });
      return {
        id: `${prefix}-doc`,
        kind: "document",
        title: "특약",
        children: [
          { id: `${prefix}-a1`, kind: "article", title: "보험금의 지급사유", children: [p(`${prefix}-a1-p1`, [text(`${prefix}-a1-x`, "지급")])] },
          { id: `${prefix}-a2`, kind: "article", title: "세부규정", children: [p(`${prefix}-a2-p1`, [text(`${prefix}-a2-x`, "세부")])] },
          {
            id: `${prefix}-a3`,
            kind: "article",
            title: "특별약관의 소멸",
            children: [
              p(`${prefix}-a3-p1`, [ref(`${prefix}-r1`, `${prefix}-a1`), text(`${prefix}-t1`, `에서 정한 지급사유가 발생하면 ${lapse}.`)]),
              p(`${prefix}-a3-p2`, [ref(`${prefix}-r2`, `${prefix}-a3-p1`), text(`${prefix}-t2`, "에 따라 소멸되면 지급하지 않습니다.")]),
            ],
          },
        ],
      };
    }
    const lapseOf = (d: DocumentNode) => d.children[2] as ArticleNode;

    it("hostPaths 는 조립의 hostLocator 와 같은 셈이다", () => {
      const d = special("s", "소멸됩니다");
      const find = hostLocator(d);
      for (const [id, path] of hostPaths(d)) expect(find(path)).toBe(id);
    });

    it("원문 자리에서 딴 본문 — 딴 항 안은 「이 공용조항」, 밖은 「사용처」 위치 · 낱말은 옵션 자리 · id 는 다시 매겨도 제 항 대상이 따라간다", () => {
      const d = special("s", "그 때부터 소멸됩니다");
      const body = clauseFromSource(d, lapseOf(d).children as ParagraphNode[], "C0009");
      placeOptions(body, [{ option: "O01", text: "그 때부터 소멸됩니다" }], "C0009");
      reId(body, "c9");
      expect(body).toEqual([
        { id: "c9-n1", kind: "paragraph", children: [
          { id: "c9-n2", kind: "articleRef", targets: [{ nodeId: "1" }], connector: "및", scope: "host" },
          { id: "c9-n3", kind: "text", text: "에서 정한 지급사유가 발생하면 " },
          { id: "c9-n4", kind: "optionSlot", optionCode: "O01" },
          { id: "c9-n5", kind: "text", text: "." },
        ] },
        { id: "c9-n6", kind: "paragraph", children: [
          { id: "c9-n7", kind: "articleRef", targets: [{ nodeId: "c9-n1" }], connector: "및", scope: "clause" },
          { id: "c9-n8", kind: "text", text: "에 따라 소멸되면 지급하지 않습니다." },
        ] },
      ]);
    });

    it("다른 문서의 같은 조 — 제 항 · 사용처 위치를 그 문서 노드로 옮겨 대조하고, 고른 선택지로 참조 하나가 된다", () => {
      const source = special("s", "그 때부터 소멸됩니다");
      const body = reId(clauseFromSource(source, lapseOf(source).children as ParagraphNode[], "C0009"), "c9");
      placeOptions(body, [{ option: "O01", text: "그 때부터 소멸됩니다" }], "C0009");
      const values = [
        { code: "V01", label: "그 때부터", order: 0, body: [text("v1", "그 때부터 소멸됩니다")] },
        { code: "V02", label: "소멸", order: 1, body: [text("v2", "소멸됩니다")] },
      ];
      const clause: ClauseRecord = { code: "C0009", label: "특별약관의 소멸", mode: "block", description: "", body, options: [{ code: "O01", label: "소멸 표현", order: 0, values: values as never }] };
      const other = special("m", "소멸됩니다");
      const report: string[] = [];
      // 선택지가 원문과 다르면 바꾸지 않는다
      expect(applyClauseUse({ article: "3", paragraph: 1, clause: "C0009", options: { O01: "V01" } }, clause, () => lapseOf(other), "[t]", report, other)).toBe(false);
      expect(applyClauseUse({ article: "3", paragraph: 1, clause: "C0009", options: { O01: "V02" } }, clause, () => lapseOf(other), "[t]", report, other)).toBe(true);
      expect(lapseOf(other).children).toEqual([{ id: "m-a3-p1-k", kind: "clauseBlockRef", clauseCode: "C0009", options: { O01: "V02" } }]);
    });

    it("한 참조가 딴 항 안팎을 함께 가리키면 딸 수 없다", () => {
      const d = special("s", "소멸됩니다");
      const p2 = lapseOf(d).children[1] as ParagraphNode;
      p2.children[0] = { id: "mix", kind: "articleRef", targets: [{ nodeId: "s-a3-p1" }, { nodeId: "s-a1" }], connector: "및", scope: "self" };
      expect(() => clauseFromSource(d, lapseOf(d).children as ParagraphNode[], "C0009")).toThrow(/안팎/);
    });
  });
});

describe("구분자 직접 읽기 → 인자 + 기본 연결 (최종 결정 2 · C7 기계 변환)", () => {
  const catalog = [{ code: "D0001", label: "담보명", description: "", level: "coverage" as const, expression: "coverage_basic.claim_name", resultType: { kind: "string" as const } }];
  it("슬롯 · 조건의 구분자를 인자(이름 = 구분자 표시명, 기본 연결 = 그 구분자)로 바꾼다 — 담보속성은 그대로", () => {
    const record: ClauseRecord = {
      code: "C0021",
      label: "지급사유",
      mode: "block",
      description: "",
      body: [
        {
          id: "p",
          kind: "paragraph",
          children: [
            { id: "s", kind: "slot", ref: "D0001" },
            { id: "c", kind: "inlineCond", branches: [{ id: "b", when: "D0001 = '사망' and attr.A0001 = '2'", children: [] }] },
          ],
        },
      ],
      options: [],
    };
    const out = parameterize(record, catalog);
    expect(out.params).toEqual([{ name: "담보명", type: { kind: "string" }, default: { kind: "discriminator", code: "D0001" } }]);
    expect(JSON.stringify(out.body)).toContain('"ref":"arg.담보명"');
    expect(JSON.stringify(out.body)).toContain(`"when":"arg.담보명 = '사망' and attr.A0001 = '2'"`);
  });

  it("구분자를 읽지 않으면 그대로(params 키 없음)", () => {
    expect(parameterize(INLINE, catalog)).toEqual(INLINE);
  });
});
