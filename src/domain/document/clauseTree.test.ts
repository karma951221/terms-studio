import { describe, expect, it } from "vitest";

import type * as C from "../clause/nodes";
import type { Block, Inline } from "../clause/nodes";
import { CLAUSE_ARTICLE_ID, CLAUSE_LINE_ID, HOST_TARGET_PREFIX, clauseBodyToTree, clausePositions, clauseScopedRefLabel, optionCarrier, optionCodeOf, treeToClauseBody } from "./clauseTree";
import { analyzeBody, structuralIds } from "../clause/body";
import { expandClause } from "../clause/reference";
import { applyEdit, generalRefsOf, type EditEnv } from "./edit";
import type { DocumentNode, InlineNode } from "./nodes";

const block: Block[] = [
  {
    id: "p1",
    kind: "paragraph",
    children: [
      { id: "t1", kind: "text", text: "이 특별약관은 " },
      { id: "o1", kind: "optionSlot", optionCode: "O01" },
      { id: "r1", kind: "articleRef", targets: [{ nodeId: "g-a1" }], connector: "및" },
    ],
    items: [{ id: "i1", kind: "item", children: [{ id: "t2", kind: "text", text: "호" }], subitems: [{ id: "s1", kind: "subitem", children: [] }] }],
  },
  { id: "c1", kind: "condBlock", branches: [{ id: "b1", when: "D0001 = true", children: [{ id: "p2", kind: "paragraph", children: [] }] }] },
];

const inline: Inline[] = [
  { id: "t1", kind: "text", text: "지급기일은 " },
  { id: "q1", kind: "inlineCond", branches: [{ id: "qb", when: "D0001 = true", children: [{ id: "o1", kind: "optionSlot", optionCode: "O02" }] }] },
];

describe("함수조항 본문 ↔ 편집 트리", () => {
  it("「항」 본문은 조 하나의 자식으로 싸이고, 되돌리면 그대로다 — 옵션 자리는 운반체, 조 참조는 보통약관 범위", () => {
    const tree = clauseBodyToTree("block", block, "특별약관의 소멸");
    const article = tree.children[0];
    expect(article?.id).toBe(CLAUSE_ARTICLE_ID);
    const p1 = article?.kind === "article" ? article.children[0] : undefined;
    expect(p1?.kind === "paragraph" && p1.children[1]).toEqual(optionCarrier("o1", "O01"));
    expect(p1?.kind === "paragraph" && p1.children[2]).toMatchObject({ kind: "articleRef", scope: "general" });
    expect(treeToClauseBody("block", tree)).toEqual({ ok: true, value: block });
  });

  it("「문구」 본문은 항 하나의 문장이다 — 인라인 조건 안의 옵션 자리도 되돌아온다", () => {
    const tree = clauseBodyToTree("inline", inline);
    const article = tree.children[0];
    expect(article?.kind === "article" && article.children.map((c) => c.id)).toEqual([CLAUSE_LINE_ID]);
    expect(treeToClauseBody("inline", tree)).toEqual({ ok: true, value: inline });
    expect(treeToClauseBody("inline", clauseBodyToTree("inline", []))).toEqual({ ok: true, value: [] });
  });

  it("옵션 운반체는 옵션 코드를 알아보고, 진짜 함수조항 참조는 운반체가 아니다", () => {
    expect(optionCodeOf(optionCarrier("x", "O03"))).toBe("O03");
    expect(optionCodeOf({ id: "x", kind: "clauseInlineRef", clauseCode: "C0001", options: {} })).toBeUndefined();
  });

  it("함수조항에 없는 노드(표 · 함수조항 참조 · 둘째 조)는 되돌릴 때 거부한다", () => {
    const base = clauseBodyToTree("block", block);
    const withTable: DocumentNode = {
      ...base,
      children: [{ id: CLAUSE_ARTICLE_ID, kind: "article", title: "", children: [{ id: "tb", kind: "table", columns: [{}], rows: [{ cells: [[]] }] }] }],
    };
    expect(treeToClauseBody("block", withTable).ok).toBe(false);
    const nested = clauseBodyToTree("inline", []);
    const line = nested.children[0]!.kind === "article" ? nested.children[0]!.children[0] : undefined;
    if (line?.kind === "paragraph") line.children.push({ id: "cr", kind: "clauseInlineRef", clauseCode: "C0002", options: {} });
    const r = treeToClauseBody("inline", nested);
    expect(!r.ok && r.rejection.reason === "invalid" && r.rejection.issues[0]?.message).toContain("중첩 금지");
    const twoArticles: DocumentNode = { ...base, children: [...base.children, { id: "a2", kind: "article", title: "", children: [] }] };
    expect(treeToClauseBody("block", twoArticles).ok).toBe(false);
  });

  it("문면 편집 명령이 그대로 먹는다 — 항을 넣고 보통약관 조 참조 대상은 보통약관 한 벌로 검사된다", () => {
    const general: DocumentNode = { id: "g", kind: "document", title: "보통약관", children: [{ id: "g-a1", kind: "article", title: "목적", children: [] }] };
    const env: EditEnv = { env: { kind: "special" }, generalRefs: (id) => (id === "g" ? generalRefsOf(general) : undefined) };
    const state = { tree: clauseBodyToTree("block", block), generalDocumentId: "g" };
    const added = applyEdit(state, { type: "insert", node: { id: "p3", kind: "paragraph", children: [] }, at: { parentId: CLAUSE_ARTICLE_ID } }, env);
    expect(added.ok).toBe(true);
    const back = added.ok ? treeToClauseBody("block", added.value.state.tree) : undefined;
    expect(back?.ok && (back.value as Block[]).map((b) => b.id)).toEqual(["p1", "c1", "p3"]);
    const broken = applyEdit(state, { type: "setArticleRef", nodeId: "r1", targets: [{ nodeId: "없는조" }], connector: "및", scope: "general" }, env);
    expect(broken.ok).toBe(false);
  });
});

describe("함수조항 조 참조 범위 — 편집 트리 운반 · 표기 (§3.5)", () => {
  const body: C.Block[] = [
    { id: "p1", kind: "paragraph", children: [{ id: "r1", kind: "articleRef", targets: [{ nodeId: "2.1.3" }], connector: "및", scope: "host" }], items: [{ id: "i1", kind: "item", children: [] }] },
    { id: "p2", kind: "paragraph", children: [{ id: "r2", kind: "articleRef", targets: [{ nodeId: "p1" }, { nodeId: "i1" }], connector: "및", scope: "clause" }] },
  ];

  it("제 항은 `self`, 사용처 위치는 `general` + `host:` 대상으로 싸고 되돌리면 같은 본문이다", () => {
    const tree = clauseBodyToTree("block", body);
    const [p1, p2] = (tree.children[0] as { children: { children: unknown[] }[] }).children;
    expect(p1.children[0]).toMatchObject({ scope: "general", targets: [{ nodeId: `${HOST_TARGET_PREFIX}2.1.3` }] });
    expect(p2.children[0]).toMatchObject({ scope: "self", targets: [{ nodeId: "p1" }, { nodeId: "i1" }] });
    expect(treeToClauseBody("block", tree)).toEqual({ ok: true, value: body });
  });

  it("표기 — 「사용처 제2조 제1항 제3호」 · 「이 함수조항 제1항 및 제1항 제1호」, 보통약관 참조는 undefined", () => {
    const tree = clauseBodyToTree("block", body);
    const positions = clausePositions(tree);
    const [p1, p2] = (tree.children[0] as { children: { children: InlineNode[] }[] }).children;
    expect(clauseScopedRefLabel(p1.children[0], positions)).toBe("사용처 제2조 제1항 제3호");
    expect(clauseScopedRefLabel(p2.children[0], positions)).toBe("이 함수조항 제1항 및 제1항 제1호");
    expect(clauseScopedRefLabel({ id: "g", kind: "articleRef", targets: [{ nodeId: "g-a1" }], connector: "및", scope: "general" }, positions)).toBeUndefined();
  });

  it("한 참조에 보통약관 조와 사용처 위치를 섞으면 되돌리기를 거부한다", () => {
    const tree = clauseBodyToTree("block", body);
    const p1 = (tree.children[0] as { children: { children: InlineNode[] }[] }).children[0];
    p1.children[0] = { id: "r1", kind: "articleRef", targets: [{ nodeId: "g-a1" }, { nodeId: `${HOST_TARGET_PREFIX}1` }], connector: "및", scope: "general" };
    expect(treeToClauseBody("block", tree).ok).toBe(false);
  });
});

describe("함수조항 「항」 본문의 글머리 목록 (2026-09-28)", () => {
  const withBullets: Block[] = [
    {
      id: "p1",
      kind: "paragraph",
      children: [{ id: "t1", kind: "text", text: "다음과 같습니다." }],
      items: [
        { id: "i1", kind: "item", children: [{ id: "t2", kind: "text", text: "호" }] },
        { id: "L1", kind: "bulletList", children: [{ id: "b1", kind: "bullet", children: [{ id: "t3", kind: "text", text: "호 뒤 항목" }] }] },
      ],
    },
    { id: "L2", kind: "bulletList", children: [{ id: "b2", kind: "bullet", children: [{ id: "o1", kind: "optionSlot", optionCode: "O01" }] }] },
  ];

  it("편집 트리로 싸고 되돌리면 그대로 — 항 자리 · 호 뒤 목록, 항목 안 옵션 자리도", () => {
    const tree = clauseBodyToTree("block", withBullets, "나열");
    expect(treeToClauseBody("block", tree)).toEqual({ ok: true, value: withBullets });
  });

  it("검사 ① — 항목 없는 목록은 거부, 글머리 목록은 번호가 없어 「이 함수조항」 조 참조 대상이 아니다", () => {
    const options = [{ code: "O01", label: "사유", values: [], order: 1 }];
    expect(analyzeBody("block", withBullets, options).ok).toBe(true);
    const empty: Block[] = [{ id: "L", kind: "bulletList", children: [] }];
    expect(analyzeBody("block", empty, []).ok).toBe(false);
    expect(structuralIds(withBullets)).toEqual(["p1", "i1"]);
  });

  it("펼치기 — 목록 · 항목 id 도 참조 노드 id 로 유일화하고 옵션 자리는 고른 선택지로", () => {
    const clause = {
      code: "C9001",
      label: "나열",
      mode: "block" as const,
      options: [{ code: "O01", label: "사유", order: 1, values: [{ code: "V01", label: "사망", order: 1, body: [{ id: "v1", kind: "text" as const, text: "사망" }] }] }],
      required: { discriminators: [], attributes: [] },
      body: withBullets,
    };
    const out = expandClause(clause, { O01: "V01" }, "ref");
    if (!out.ok) throw new Error("펼치기 실패");
    const list = (out.value as Block[])[1] as C.BulletListNode;
    expect(list.id).toBe("ref/L2");
    expect(list.children[0].children.map((c) => (c.kind === "text" ? c.text : c.kind))).toEqual(["사망"]);
  });
});

describe("호 · 목 유형 본문 ↔ 편집 트리 (최종 결정 4)", () => {
  const items: C.ItemBodyNode[] = [
    { id: "i1", kind: "item", children: [{ id: "t1", kind: "text", text: "암" }] },
    { id: "c1", kind: "condBlock", branches: [{ id: "b1", when: "D0001 = 1", children: [{ id: "i2", kind: "item", children: [{ id: "r1", kind: "articleRef", targets: [{ nodeId: "i1" }], scope: "clause" }] }] }] },
  ];
  const subitems: C.SubitemBodyNode[] = [
    { id: "s1", kind: "subitem", children: [] },
    { id: "c1", kind: "condBlock", branches: [{ id: "b1", when: "D0001 = 1", children: [{ id: "s2", kind: "subitem", children: [] }] }] },
  ];

  it("호 유형은 자리 항의 호 목록으로 싸고 되돌리면 같다 — 조건 블록 가지 안의 호도", () => {
    const back = treeToClauseBody("item", clauseBodyToTree("item", items));
    expect(back.ok && back.value).toEqual(items);
  });

  it("목 유형은 자리 항 › 자리 호의 목 목록으로 싸고 되돌리면 같다", () => {
    const back = treeToClauseBody("subitem", clauseBodyToTree("subitem", subitems));
    expect(back.ok && back.value).toEqual(subitems);
  });

  it("호 유형에 항 · 문장이 끼면 거부한다", () => {
    const tree = clauseBodyToTree("item", items);
    const article = tree.children[0] as { children: unknown[] };
    article.children.push({ id: "p9", kind: "paragraph", children: [] });
    expect(treeToClauseBody("item", tree).ok).toBe(false);
  });

  it("제 호 참조는 「이 함수조항 제1호」 — 자리 항은 번호 단계가 아니다", () => {
    const tree = clauseBodyToTree("item", items);
    const ref: InlineNode = { id: "r1", kind: "articleRef", targets: [{ nodeId: "i1" }], scope: "self" };
    expect(clauseScopedRefLabel(ref, clausePositions(tree))).toBe("이 함수조항 제1호");
    const subTree = clauseBodyToTree("subitem", subitems);
    expect(clauseScopedRefLabel({ ...ref, targets: [{ nodeId: "s2" }] }, clausePositions(subTree))).toBe("이 함수조항 나목");
  });
});

describe("값별 분기 — 편집 트리 운반 (최종 결정 5)", () => {
  const p = (id: string): Block => ({ id, kind: "paragraph", children: [{ id: `${id}t`, kind: "text", text: id }] });
  const sw: Block[] = [
    {
      id: "sw",
      kind: "switchBlock",
      on: "arg.사유",
      cases: [
        { id: "k1", values: ["V01", "V02"], children: [p("p1")] },
        { id: "k2", values: ["V03"], empty: true, children: [] },
      ],
    },
  ];
  const line: Inline[] = [{ id: "is", kind: "inlineSwitch", on: "arg.사유", cases: [{ id: "a", values: ["V01"], children: [{ id: "ta", kind: "text", text: "진단" }] }] }];

  it("분기는 조건 블록 + switchOn(칸 = 값 · 문구 없음 가지)으로 싸고 되돌리면 같은 본문이다 — 블록 · 문장 안 · 호 목록", () => {
    const tree = clauseBodyToTree("block", sw);
    const wrapped = (tree.children[0] as { children: { kind: string; switchOn?: string; branches: { values?: string[]; empty?: true; when?: string }[] }[] }).children[0];
    expect(wrapped).toMatchObject({ kind: "condBlock", switchOn: "arg.사유", branches: [{ values: ["V01", "V02"] }, { values: ["V03"], empty: true }] });
    expect(treeToClauseBody("block", tree)).toEqual({ ok: true, value: sw });
    expect(treeToClauseBody("inline", clauseBodyToTree("inline", line))).toEqual({ ok: true, value: line });
    const items: C.ItemBodyNode[] = [{ id: "sw", kind: "switchBlock", on: "arg.사유", cases: [{ id: "k1", values: ["V01"], children: [{ id: "i1", kind: "item", children: [] }] }] }];
    expect(treeToClauseBody("item", clauseBodyToTree("item", items))).toEqual({ ok: true, value: items });
  });

  it("편집 명령 — 칸의 값 · 「문구 없음」 · 대상 바꾸기, 칸 추가(else 규칙 없음). 「문구 없음」은 본문이 없을 때만", () => {
    const env: EditEnv = { env: { kind: "special", switches: true }, generalRefs: () => undefined };
    let state = { tree: clauseBodyToTree("block", sw) };
    const step = (op: Parameters<typeof applyEdit>[1]) => {
      const r = applyEdit(state, op, env);
      if (!r.ok) throw new Error(JSON.stringify(r.rejection));
      state = r.value.state;
    };
    step({ type: "setCase", branchId: "k1", values: ["V01"] });
    step({ type: "addBranch", condId: "sw", branch: { id: "k3", values: ["V02"], children: [p("p3") as never] } });
    step({ type: "setSwitch", nodeId: "sw", on: "var.대표" });
    const back = treeToClauseBody("block", state.tree);
    expect(back.ok && back.value[0]).toMatchObject({ on: "var.대표", cases: [{ id: "k1", values: ["V01"] }, { id: "k2", empty: true }, { id: "k3", values: ["V02"] }] });
    expect(applyEdit(state, { type: "setCase", branchId: "k1", values: ["V01"], empty: true }, env).ok).toBe(false);
  });

  it("문면(템플릿)에서는 값별 분기를 거부한다 — 지금은 함수조항 안에서만", () => {
    const env: EditEnv = { env: { kind: "special" }, generalRefs: () => undefined };
    const carrier = (clauseBodyToTree("block", sw).children[0] as unknown as { children: never[] }).children[0];
    const r = applyEdit({ tree: clauseBodyToTree("block", []) }, { type: "insert", node: carrier, at: { parentId: CLAUSE_ARTICLE_ID } }, env);
    expect(r.ok).toBe(false);
  });
});
