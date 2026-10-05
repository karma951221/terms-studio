import { describe, expect, it } from "vitest";

import { clauseCodeIssues, withClauseCodes } from "../clause/pcode";
import type { Block } from "../clause/nodes";
import type { Result } from "../types";
import { nodeBuilders, sequentialIds } from "./builders";
import { applyCommand, applyCommands, type Command } from "./commands";
import { indexTree, validateTree, type DocumentNode, type Node } from "./nodes";
import { documentCodeEntries, documentCodeIssues, fillCodes, formatPCode, nextCode, suggestCode, withCodes } from "./pcode";

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

function rejectedMessage<T>(r: Result<T>): string {
  if (r.ok) throw new Error("기대: 거부, 실제: ok");
  return JSON.stringify(r.rejection);
}

const codeOf = (doc: DocumentNode, id: string) => (indexTree(doc).nodes.get(id)?.node as Node & { code?: string }).code;

/** 빈 조 하나 — 편집 명령으로 채워 가며 채번을 본다. */
function emptyArticle() {
  const b = nodeBuilders(sequentialIds("n"));
  const article = b.article("보험금의 지급사유", []);
  const doc = b.document("수술비", [article]);
  return { b, doc, articleId: article.id };
}

describe("P코드 형식 (ADR-0072 결정 5)", () => {
  it("P + 4자리 100 단위, P9900 을 넘으면 자릿수를 늘린다(막지 않는다)", () => {
    expect(formatPCode(100)).toBe("P0100");
    expect(formatPCode(9900)).toBe("P9900");
    expect(formatPCode(10000)).toBe("P10000");
    expect(nextCode(new Set([9900]), 99)).toBe("P10000");
  });
});

describe("수용 기준 1 — 분기 밖 충돌", () => {
  it("if 가지 항 둘 → P0100 · P0200, 분기 밖 항 → P0300, elif 가지 추가 후 항 셋 → P0100 · P0200 · P0400", () => {
    const { b, doc, articleId } = emptyArticle();
    const p1 = b.paragraph([b.text("if 1")]);
    const p2 = b.paragraph([b.text("if 2")]);
    const cond = b.condBlock([b.branch("D0001", [p1, p2])]);
    const outside = b.paragraph([b.text("밖")]);
    const e1 = b.paragraph([b.text("elif 1")]);
    const e2 = b.paragraph([b.text("elif 2")]);
    const e3 = b.paragraph([b.text("elif 3")]);
    const next = unwrap(
      applyCommands(doc, [
        { type: "insert", node: cond, at: { parentId: articleId } },
        { type: "insert", node: outside, at: { parentId: articleId } },
        { type: "addBranch", condId: cond.id, branch: b.branch("D0002", [e1, e2, e3]) },
      ]),
    );
    expect([p1, p2, outside].map((n) => codeOf(next, n.id))).toEqual(["P0100", "P0200", "P0300"]);
    expect([e1, e2, e3].map((n) => codeOf(next, n.id))).toEqual(["P0100", "P0200", "P0400"]);
    expect(validateTree(next)).toEqual([]);
  });
});

describe("수용 기준 2 — 역방향", () => {
  it("그 상태에서 분기 밖에 항 추가 → P0500 (elif 의 P0400 과 공존)", () => {
    const { b, doc, articleId } = emptyArticle();
    const cond = b.condBlock([b.branch("D0001", [b.paragraph(), b.paragraph()])]);
    const after = unwrap(
      applyCommands(doc, [
        { type: "insert", node: cond, at: { parentId: articleId } },
        { type: "insert", node: b.paragraph(), at: { parentId: articleId } },
        { type: "addBranch", condId: cond.id, branch: b.branch("D0002", [b.paragraph(), b.paragraph(), b.paragraph()]) },
      ]),
    );
    const added = b.paragraph([b.text("새 항")]);
    const next = unwrap(applyCommand(after, { type: "insert", node: added, at: { parentId: articleId } }));
    expect(codeOf(next, added.id)).toBe("P0500");
  });

  it("P0100 · P0200 사이에 끼우면 P0300 — 코드 순서 ≠ 실제 순서를 허용한다", () => {
    const { b, doc, articleId } = emptyArticle();
    const first = b.paragraph();
    const second = b.paragraph();
    const between = b.paragraph();
    const next = unwrap(
      applyCommands(doc, [
        { type: "insert", node: first, at: { parentId: articleId } },
        { type: "insert", node: second, at: { parentId: articleId } },
        { type: "insert", node: between, at: { parentId: articleId, index: 1 } },
      ]),
    );
    expect([first, between, second].map((n) => codeOf(next, n.id))).toEqual(["P0100", "P0300", "P0200"]);
  });
});

describe("수용 기준 3 — 붙여넣기(사본)는 항상 재채번", () => {
  /** 1 · 2 · 3항(P0100 ~ P0300) + 빈 if 가지 둘을 가진 조건 블록 · 다른 조. */
  function threeParagraphs() {
    const { b, doc, articleId } = emptyArticle();
    const ps = [b.paragraph([b.text("1")]), b.paragraph([b.text("2")]), b.paragraph([b.text("3")])];
    const other = b.article("다른 조", []);
    const tree = unwrap(
      applyCommands(doc, [
        ...ps.map((node): Command => ({ type: "insert", node, at: { parentId: articleId } })),
        { type: "insert", node: other, at: { parentId: doc.id } },
      ]),
    );
    return { b, tree, articleId, ps, otherId: other.id };
  }

  it("같은 조 1 · 2 · 3항 복사 → 조 끝 붙여넣기 시 겹치지 않게 P0400 ~ P0600", () => {
    const { tree, articleId, ps } = threeParagraphs();
    const ids = ["c1", "c2", "c3"];
    const next = unwrap(
      applyCommands(
        tree,
        ps.map((p, i): Command => ({ type: "duplicate", nodeId: p.id, at: { parentId: articleId }, ids: [ids[i], `${ids[i]}t`] })),
      ),
    );
    expect(ids.map((id) => codeOf(next, id))).toEqual(["P0400", "P0500", "P0600"]);
  });

  it("가지 안 붙여넣기는 분기 밖 코드를 피하고, 같은 조건 블록의 다른 가지에 붙이면 같은 코드를 다시 쓸 수 있다", () => {
    const { b, tree, articleId, ps } = threeParagraphs();
    const inIf = b.paragraph([b.text("if")]);
    const ifBranch = b.branch("D0001", [inIf]);
    const elseBranch = b.branch(undefined, []);
    const cond = b.condBlock([ifBranch, elseBranch]);
    const placed = unwrap(applyCommand(tree, { type: "insert", node: cond, at: { parentId: articleId } }));
    // 조 넷째 자리의 조건 블록 · 그 가지 첫 자리 → 기본 P0100 은 분기 밖 1항과 공존 → P0400
    expect(codeOf(placed, inIf.id)).toBe("P0400");
    // 분기 밖 1항을 else 가지에 붙이면 분기 밖 코드(P0100 ~ P0300)를 피한다 — if 가지의 P0400 은 배타라 다시 쓴다
    const pasted = unwrap(applyCommand(placed, { type: "duplicate", nodeId: ps[0].id, at: { parentId: elseBranch.id }, ids: ["e1", "e1t"] }));
    expect(codeOf(pasted, "e1")).toBe("P0400");
    expect(validateTree(pasted)).toEqual([]);
  });

  it("다른 조에 붙이면 그 조 기준으로 채번한다", () => {
    const { tree, otherId, ps } = threeParagraphs();
    const next = unwrap(applyCommand(tree, { type: "duplicate", nodeId: ps[2].id, at: { parentId: otherId }, ids: ["x", "xt"] }));
    expect(codeOf(next, "x")).toBe("P0100");
  });
});

describe("수용 기준 4 — 이동 · 직접 수정 (창 · 추천 UI 는 다음 작업)", () => {
  it("이동은 재채번하지 않는다 — 공존 충돌은 저장 검사가 추천값과 함께 드러내고, 추천값으로 고치면 풀린다", () => {
    const { b, doc, articleId } = emptyArticle();
    const inIf = b.paragraph([b.text("if")]);
    const inElse = b.paragraph([b.text("else")]);
    const cond = b.condBlock([b.branch("D0001", [inIf]), b.branch(undefined, [inElse])]);
    const tree = unwrap(applyCommand(doc, { type: "insert", node: cond, at: { parentId: articleId } }));
    expect([codeOf(tree, inIf.id), codeOf(tree, inElse.id)]).toEqual(["P0100", "P0100"]);
    const moved = unwrap(applyCommand(tree, { type: "move", nodeId: inIf.id, to: { parentId: articleId } }));
    expect(codeOf(moved, inIf.id)).toBe("P0100");
    const issues = validateTree(moved);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "structure", at: { nodePath: [doc.id, articleId, inIf.id] } });
    expect(issues[0].message).toContain("코드 P0100");
    const suggestion = suggestCode(documentCodeEntries(moved), inIf.id);
    expect(suggestion).toBe("P0200");
    expect(issues[0].message).toContain(`추천 ${suggestion}`);
    const fixed = unwrap(applyCommand(moved, { type: "setCode", nodeId: inIf.id, code: suggestion! }));
    expect(validateTree(fixed)).toEqual([]);
  });

  it("공존하는 코드를 직접 넣으면 거부 · 형식이 아니면 거부 · 배타 가지의 코드는 받는다", () => {
    const { b, doc, articleId } = emptyArticle();
    const outside = b.paragraph();
    const inIf = b.paragraph();
    const inElse = b.paragraph();
    const tree = unwrap(
      applyCommands(doc, [
        { type: "insert", node: outside, at: { parentId: articleId } },
        { type: "insert", node: b.condBlock([b.branch("D0001", [inIf]), b.branch(undefined, [inElse])]), at: { parentId: articleId } },
      ]),
    );
    expect(rejectedMessage(applyCommand(tree, { type: "setCode", nodeId: inIf.id, code: "P0100" }))).toContain("겹칩니다");
    expect(rejectedMessage(applyCommand(tree, { type: "setCode", nodeId: inIf.id, code: "Q0100" }))).toContain("P코드 형식");
    const shared = unwrap(applyCommand(tree, { type: "setCode", nodeId: inElse.id, code: codeOf(tree, inIf.id)! }));
    expect(validateTree(shared)).toEqual([]);
  });
});

describe("전환 — 코드 없는 트리 채우기 (ADR-0072 결정 10)", () => {
  it("깊이 순으로 채운다 — 항은 위치값, 배타 가지의 같은 자리 항은 같은 코드, 호 · 목은 공존 코드 다음", () => {
    const b = nodeBuilders(sequentialIds("m"));
    const item = b.item([b.text("1호")], [b.subitem([b.text("가목")])]);
    const p1 = b.paragraph([b.text("1항")], [item]);
    const ifP = b.paragraph([b.text("if")]);
    const elseP = b.paragraph([b.text("else")]);
    const cond = b.condBlock([b.branch("D0001", [ifP]), b.branch(undefined, [elseP])]);
    const p3 = b.paragraph([b.text("3항")]);
    const doc = b.document("문서", [b.article("조", [p1, cond, p3])]);
    const coded = withCodes(doc);
    // 가지 첫 자리는 기본값 P0100 이 분기 밖 1항과 겹친다 → P0200, 두 가지가 같은 코드
    expect([p1, ifP, elseP, p3].map((n) => codeOf(coded, n.id))).toEqual(["P0100", "P0200", "P0200", "P0300"]);
    expect(codeOf(coded, item.id)).toBe("P0400");
    expect(codeOf(coded, item.subitems![0].id)).toBe("P0500");
    expect(validateTree(coded)).toEqual([]);
    expect(withCodes(coded)).toBe(coded);
  });
});

describe("함수조항 본문 — 조건 가지 · switch 칸은 코드를 공유한다 (ADR-0072 결정 4 · 최종 결정 12)", () => {
  const body = (): Block[] => [
    { id: "p1", kind: "paragraph", children: [] },
    {
      id: "sw",
      kind: "switchBlock",
      on: "arg.사유",
      cases: [
        { id: "k1", values: ["V01"], children: [{ id: "a", kind: "paragraph", children: [] }] },
        { id: "k2", values: ["V02"], children: [{ id: "b", kind: "paragraph", children: [] }] },
      ],
    },
  ];

  it("전환 채번이 칸마다 같은 자리의 항에 같은 코드를 준다", () => {
    const coded = withClauseCodes(body());
    const sw = coded[1] as Extract<Block, { kind: "switchBlock" }>;
    expect((coded[0] as { code?: string }).code).toBe("P0100");
    expect(sw.cases.map((k) => (k.children[0] as { code?: string }).code)).toEqual(["P0200", "P0200"]);
    expect(clauseCodeIssues(coded)).toEqual([]);
  });

  it("칸 밖 항과 같은 코드면 공존 중복 — 경로를 달아 거부한다", () => {
    const coded = withClauseCodes(body());
    (coded[0] as { code?: string }).code = "P0200";
    expect(clauseCodeIssues(coded)).toEqual([
      { path: ["sw", "k1", "a"], message: expect.stringContaining("코드 P0200") },
      { path: ["sw", "k2", "b"], message: expect.stringContaining("코드 P0200") },
    ]);
  });
});

describe("수용 기준 7 — 조 자리 조건 블록은 IF 하나(켜고 끄기)만 (ADR-0072 결정 2b)", () => {
  function articleSiteCond() {
    const b = nodeBuilders(sequentialIds("z"));
    const cond = b.condBlock([b.branch("D0001", [b.article("켜고 끄는 조", [])])]);
    const doc = b.document("문서", [b.article("앞 조", []), cond]);
    return { b, doc, cond };
  }

  it("IF 가지 하나는 저장된다", () => {
    expect(validateTree(articleSiteCond().doc)).toEqual([]);
  });

  it("ELIF · ELSE 가지를 더하면 거부 — 조 둘이 한 자리를 번갈아 차지하면 조 uuid 참조 문제가 조 단위에서 되살아난다", () => {
    const { b, doc, cond } = articleSiteCond();
    for (const branch of [b.branch("D0002", [b.article("다른 조", [])]), b.branch(undefined, [])]) {
      expect(rejectedMessage(applyCommand(doc, { type: "addBranch", condId: cond.id, branch }))).toContain("IF 하나");
    }
  });

  it("저장 검사도 조 자리의 ELSE 를 거부한다 — 항 자리 조건 블록은 그대로 ELIF · ELSE 를 쓴다", () => {
    const { b, doc, cond } = articleSiteCond();
    cond.branches.push(b.branch(undefined, []));
    expect(validateTree(doc).map((i) => i.message)).toEqual([expect.stringContaining("IF 하나")]);
    const inside = b.document("문서", [b.article("조", [b.condBlock([b.branch("D0001", [b.paragraph()]), b.branch(undefined, [b.paragraph()])])])]);
    expect(validateTree(inside)).toEqual([]);
  });
});

describe("PZ 코드 — 상품 조 사본에서 새로 생긴 자리 (ADR-0081 결정 4)", () => {
  it("형식 PZ + 숫자 4자리 이상 · 위치값 × 100 · PZ9900 너머는 자릿수를 늘린다", () => {
    expect(formatPCode(100, "PZ")).toBe("PZ0100");
    expect(formatPCode(10000, "PZ")).toBe("PZ10000");
    expect(nextCode(new Set([100]), 1, "PZ")).toBe("PZ0200");
  });

  it("PZ 채번은 같은 조의 공존 PZ 코드만 피한다 — 템플릿 P 코드는 다른 영역이라 겹칠 수 없다", () => {
    const entries = [
      { id: "t1", code: "P0100", scope: "a", branches: [], position: 1, depth: 0 },
      { id: "z1", code: "PZ0200", scope: "a", branches: [], position: 2, depth: 0 },
      { id: "new", scope: "a", branches: [], position: 2, depth: 0 },
    ];
    expect(fillCodes(entries, { band: "PZ" }).get("new")).toBe("PZ0300");
    expect(suggestCode([...entries.slice(0, 2), { id: "z2", code: "PZ0200", scope: "a", branches: [], position: 2, depth: 0 }], "z2")).toBe("PZ0300");
  });

  it("문서 코드 검사 — PZ 는 상품 조 사본(copyCodes)에서만 유효하다. 템플릿 · 담보약관에는 「사본 전용」으로 거부, 사본 안 PZ 끼리 공존 중복은 거부", () => {
    const doc: DocumentNode = {
      id: "d",
      kind: "document",
      title: "t",
      children: [{ id: "a", kind: "article", title: "조", children: [{ id: "p1", kind: "paragraph", code: "PZ0100", children: [] }, { id: "p2", kind: "paragraph", code: "PZ0100", children: [] }] }],
    };
    expect(documentCodeIssues(doc).map((i) => i.message)).toContain("코드 PZ0100 는 상품 조 사본 전용(PZ)이다 — 템플릿 · 담보약관 · 함수조항에는 쓸 수 없다");
    const inCopy = documentCodeIssues(doc, undefined, { copyCodes: true });
    expect(inCopy.map((i) => i.id)).toEqual(["p2"]);
    expect(inCopy[0].message).toContain("(추천 PZ0200)");
  });

  it("함수조항 본문의 PZ 코드도 「사본 전용」으로 거부한다 — 사본 내용이 붙여넣기로 새지 않게", () => {
    const body = [{ id: "p", kind: "paragraph", code: "PZ0100", children: [] }] as unknown as Block[];
    expect(clauseCodeIssues(body).map((i) => i.message)).toEqual(["코드 PZ0100 는 상품 조 사본 전용(PZ)이다 — 템플릿 · 담보약관 · 함수조항에는 쓸 수 없다"]);
  });
});
