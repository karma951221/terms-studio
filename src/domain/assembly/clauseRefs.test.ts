import { describe, expect, it } from "vitest";

import type { BlockClause, ItemClause } from "../clause/types";
import { clauseBodyToTree, clauseModelNumbers, clauseSpanBy } from "../document/clauseTree";
import type { DocumentNode } from "../document/nodes";
import { numberTree } from "../document/numbering";
import { specialContext } from "./context";
import { alphaPlusFixture } from "./fixture";
import { numberDocument, renderDocument } from "./render";
import { hostLocator, resolveDocument } from "./resolve";
import type { SubstitutedDoc } from "./types";

/**
 * 조째 함수조항의 조 참조 (기능/함수조항 §3.5) — 「제1조(보험금의 지급사유)에서 정한」(사용처 위치) · 「제1항에 따라」(제 항)가
 * 사용처에 펼쳐진 자리의 계산 번호로 찍힌다.
 */
const 소멸: BlockClause = {
  code: "C0009",
  label: "특별약관의 소멸",
  mode: "block",
  options: [],
  required: { discriminators: [], attributes: [] },
  body: [
    { id: "p1", kind: "paragraph", children: [
      { id: "r1", kind: "articleRef", targets: [{ host: "1" }], connector: "및", scope: "host" },
      { id: "t1", kind: "text", text: "에서 정한 지급사유가 발생하면 소멸됩니다." },
    ] },
    { id: "p2", kind: "paragraph", children: [
      // 제 항은 P코드 — 본문 첫 항은 저장(또는 펼칠 때)의 채번으로 P0100
      { id: "r2", kind: "articleRef", targets: [{ code: "P0100" }], connector: "및", scope: "clause" },
      { id: "t2", kind: "text", text: "에 따라 소멸되면 해약환급금을 지급하지 않습니다." },
      { id: "r3", kind: "articleRef", targets: [{ host: "2.1" }], connector: "및", scope: "host" },
    ] },
  ],
};

function doc(): DocumentNode {
  return {
    kind: "document",
    id: "s",
    title: "특약",
    children: [
      { kind: "article", id: "a1", title: "보험금의 지급사유", children: [{ kind: "paragraph", id: "a1-p", children: [{ kind: "text", id: "a1-t", text: "지급" }] }] },
      { kind: "article", id: "a2", title: "세부규정", children: [{ kind: "paragraph", id: "a2-p", code: "P0100", children: [{ kind: "text", id: "a2-t", text: "세부" }] }, { kind: "paragraph", id: "a2-q", code: "P0200", children: [] }] },
      { kind: "article", id: "a3", title: "특별약관의 소멸", children: [{ kind: "clauseBlockRef", id: "k", clauseCode: "C0009", options: {} }] },
    ],
  };
}

describe("조째 함수조항의 조 참조 — 사용처 위치 · 제 항", () => {
  it("hostLocator — n번째 조 · m번째 항 → 참조 대상(조 · 조+P코드) (함수조항 블록이 펼칠 항은 세지 않는다)", () => {
    const find = hostLocator(doc());
    expect([find("1"), find("2.2"), find("3"), find("3.1"), find("9")]).toEqual([{ articleId: "a1" }, { articleId: "a2", code: "P0200" }, { articleId: "a3" }, undefined, undefined]);
  });

  it("펼치면 사용처 자기 참조가 되어 「제1조(보험금의 지급사유)」 · 「제1항」 · 「제2조(세부규정) 제1항」으로 찍힌다", () => {
    const input = alphaPlusFixture();
    const ctx = specialContext(input, input.coverages[0]);
    const resolved = resolveDocument(doc(), ctx, { clauses: new Map([["C0009", 소멸]]), overrides: new Map(), coordinate: { document: "special", ownerId: "pc" } });
    expect(resolved.issues).toEqual([]);
    const result = renderDocument(numberDocument(resolved.doc as unknown as SubstitutedDoc), { document: "special", ownerId: "pc", appendices: [] });
    expect(result.issues).toEqual([]);
    const lapse = result.doc.children[2];
    if (lapse.kind !== "article") throw new Error("조 아님");
    const labels = lapse.children.flatMap((p) => (p.kind === "paragraph" ? p.children.filter((c) => c.kind === "articleRef").map((c) => (c as { label: string }).label) : []));
    expect(labels).toEqual(["제1조(보험금의 지급사유)", "제1항", "제2조(세부규정) 제1항"]);
  });
});

describe("호 목록 자리(항 · 호 뒤)의 함수조항 참조 — 박스는 정적 마스터 박스 참조라 함수조항은 조 자리에만 (기능/박스 §3.2)", () => {
  const tree = {
    kind: "document",
    id: "s",
    title: "특약",
    children: [
      {
        kind: "article",
        id: "a1",
        title: "보장",
        children: [{ kind: "paragraph", id: "p1", children: [{ kind: "text", id: "t1", text: "다음과 같다." }], items: [{ kind: "item", id: "i1", children: [{ kind: "text", id: "t2", text: "하나" }] }, { kind: "clauseBlockRef", id: "k1", clauseCode: "C0100", options: {} }] }],
      },
    ],
  } as unknown as DocumentNode;

  it("호 목록 자리에 함수조항 참조가 오면 조립 오류(자리 유형)", () => {
    const input = alphaPlusFixture();
    const ctx = specialContext(input, input.coverages[0]);
    const wrong = resolveDocument(tree, ctx, { clauses: new Map([["C0100", { ...소멸, code: "C0100" }]]), overrides: new Map(), coordinate: { document: "special", ownerId: "pc" } });
    expect(wrong.issues.map((i) => i.kind)).toContain("structure");
  });
});

describe("호 유형 함수조항 — 항의 호 목록 자리에서 펼쳐 사용처 번호로 (최종 결정 4 · 기능/함수조항 §3.1)", () => {
  const 호 = (id: string, text: string) => ({ id, kind: "item" as const, children: [{ id: `${id}t`, kind: "text" as const, text }] });
  const 사유호: ItemClause = {
    code: "C0200",
    label: "납입면제 호",
    mode: "item",
    options: [],
    required: { discriminators: [], attributes: [] },
    body: [
      호("i1", "암으로 진단확정된 경우"),
      { id: "c1", kind: "condBlock", branches: [{ id: "b1", when: "1 = 1", children: [호("i2", "뇌졸중으로 진단확정된 경우")] }] },
      { id: "c2", kind: "condBlock", branches: [{ id: "b2", when: "1 = 2", children: [호("i3", "나오지 않는 호")] }] },
    ],
  };
  const 빈호: ItemClause = { ...사유호, code: "C0201", label: "빈 호", body: [{ id: "c9", kind: "condBlock", branches: [{ id: "b9", when: "1 = 2", children: [호("i9", "나오지 않는 호")] }] }] };

  const tree = (clauseCode: string): DocumentNode =>
    ({
      kind: "document",
      id: "s",
      title: "특약",
      children: [
        {
          kind: "article",
          id: "a1",
          title: "납입면제",
          children: [
            {
              kind: "paragraph",
              id: "p1",
              children: [{ kind: "text", id: "t1", text: "다음 중 어느 하나에 해당하는 경우 납입을 면제합니다." }],
              items: [호("h1", "사망한 경우"), { kind: "clauseBlockRef", id: "k1", clauseCode, options: {} }, 호("h2", "장해를 입은 경우")],
            },
          ],
        },
      ],
    }) as unknown as DocumentNode;

  const render = (clauseCode: string) => {
    const input = alphaPlusFixture();
    const ctx = specialContext(input, input.coverages[0]);
    const resolved = resolveDocument(tree(clauseCode), ctx, { clauses: new Map([["C0200", 사유호], ["C0201", 빈호]]), overrides: new Map(), coordinate: { document: "special", ownerId: "pc" } });
    expect(resolved.issues).toEqual([]);
    const result = renderDocument(numberDocument(resolved.doc as unknown as SubstitutedDoc), { document: "special", ownerId: "pc", appendices: [] });
    expect(result.issues).toEqual([]);
    const article = result.doc.children[0];
    if (article.kind !== "article" || article.children[0].kind !== "paragraph") throw new Error("조 · 항 아님");
    return (article.children[0].items ?? []).map((it) => (it.kind === "item" ? `${it.label} ${it.children.map((c) => (c as { text?: string }).text ?? "").join("")}` : it.kind));
  };

  it("호 유형이 호 둘을 내면 사용처 번호로 이어서 매긴다", () => {
    expect(render("C0200")).toEqual(["1. 사망한 경우", "2. 암으로 진단확정된 경우", "3. 뇌졸중으로 진단확정된 경우", "4. 장해를 입은 경우"]);
  });

  it("IF 로 호 0개 → 그 자리 없음", () => {
    expect(render("C0201")).toEqual(["1. 사망한 경우", "2. 장해를 입은 경우"]);
  });
});

describe("원문 모델 번호(clauseSpan)는 조립 번호와 같다 (2026-10-03 사용자 QA)", () => {
  const 두항: BlockClause = {
    code: "C0013",
    label: "약관의 해석",
    mode: "block",
    options: [],
    required: { discriminators: [], attributes: [] },
    body: [
      { id: "q1", kind: "paragraph", children: [{ id: "q1t", kind: "text", text: "회사는 약관의 뜻이" }] },
      { id: "q2", kind: "paragraph", children: [{ id: "q2t", kind: "text", text: "회사는 보험금을" }] },
    ],
  };
  const tree: DocumentNode = {
    kind: "document",
    id: "s",
    title: "특약",
    children: [
      {
        kind: "article",
        id: "a1",
        title: "약관의 해석",
        children: [
          { kind: "paragraph", id: "h1", children: [{ kind: "text", id: "h1t", text: "앞 항" }] },
          { kind: "clauseBlockRef", id: "k", clauseCode: "C0013", options: {} },
          { kind: "paragraph", id: "h2", children: [{ kind: "text", id: "h2t", text: "뒤 항" }] },
        ],
      },
    ],
  };

  it("② 자리의 2항 함수조항 — 모델은 ① · (②③) · ④, 조립도 ①②③④", () => {
    const input = alphaPlusFixture();
    const ctx = specialContext(input, input.coverages[0]);
    const resolved = resolveDocument(tree, ctx, { clauses: new Map([["C0013", 두항]]), overrides: new Map(), coordinate: { document: "special", ownerId: "pc" } });
    expect(resolved.issues).toEqual([]);
    const result = renderDocument(numberDocument(resolved.doc as unknown as SubstitutedDoc), { document: "special", ownerId: "pc", appendices: [] });
    const article = result.doc.children[0];
    if (article.kind !== "article") throw new Error("조 아님");
    const assembled = article.children.map((p) => (p.kind === "paragraph" ? p.label : p.kind));

    const numbers = numberTree(tree, { clauseSpan: clauseSpanBy((code) => (code === "C0013" ? 두항 : undefined)) });
    const inner = clauseModelNumbers(clauseBodyToTree("block", 두항.body), numbers.get("k"));
    const model = [numbers.get("h1")?.label, inner.get("q1")?.label, inner.get("q2")?.label, numbers.get("h2")?.label];
    expect(model).toEqual(["①", "②", "③", "④"]);
    expect(assembled).toEqual(model);
  });
});
