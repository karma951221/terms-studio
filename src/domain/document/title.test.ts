import { describe, expect, it } from "vitest";

import { articleHash } from "../product/articleCopies";
import { applyCommand } from "./commands";
import { numberTree, referenceTargetIndex } from "./numbering";
import { validateTree, type ArticleNode, type DocumentNode, type InlineNode } from "./nodes";
import { foldTitle, normalizeArticle, normalizeTitle, relabelTitle, textOnlyTitle, titleKindMessage, titleNodes, TITLE_INLINE, withInlineTitles } from "./title";

const text = (id: string, t: string): InlineNode => ({ id, kind: "text", text: t });

describe("조 제목 = 인라인 노드 목록 (ADR-0088 결정 1 ①)", () => {
  it("글 제목은 [글 하나] — id 는 조 id 에서 짓는다, 빈 글은 빈 목록", () => {
    expect(titleNodes("보험금의 지급사유", "a1")).toEqual([{ id: "a1.title", kind: "text", text: "보험금의 지급사유" }]);
    expect(titleNodes("", "a1")).toEqual([]);
  });

  it("옛 글 제목을 읽으면 [글 하나]로 이행한다 — 새 모양은 그대로", () => {
    expect(normalizeTitle("목적", "a1")).toEqual([text("a1.title", "목적")]);
    const already = [text("x", "목적")];
    expect(normalizeTitle(already, "a1")).toBe(already);
    expect(normalizeTitle(undefined, "a1")).toEqual([]);
  });

  it("문서 트리의 조 제목을 모두 이행한다 — 관 · 조 자리 조건 가지 안까지, 문서 · 관 제목은 글 그대로", () => {
    const old = {
      id: "d",
      kind: "document",
      title: "보통약관",
      children: [
        { id: "a1", kind: "article", title: "목적", children: [] },
        { id: "s1", kind: "section", title: "제1관 목적 및 용어의 정의", children: [{ id: "a2", kind: "article", title: "용어의 정의", children: [] }] },
        { id: "c1", kind: "condBlock", branches: [{ id: "b1", when: "D0001 = true", children: [{ id: "a3", kind: "article", title: "납입면제", children: [] }] }] },
      ],
    } as unknown as DocumentNode;
    const next = withInlineTitles(old);
    const titles = JSON.stringify(next);
    expect(titles).toContain('"title":[{"id":"a1.title","kind":"text","text":"목적"}]');
    expect(titles).toContain('"title":[{"id":"a2.title","kind":"text","text":"용어의 정의"}]');
    expect(titles).toContain('"title":[{"id":"a3.title","kind":"text","text":"납입면제"}]');
    expect(next.title).toBe("보통약관");
    expect((next.children[1] as { title: unknown }).title).toBe("제1관 목적 및 용어의 정의");
    // 이미 새 모양이면 같은 트리를 돌려준다
    expect(withInlineTitles(next)).toBe(next);
  });

  it("글로만 된 제목은 글 하나로 읽힌다 — 작업용 글자색 · 칩이 끼면 아니다", () => {
    expect(textOnlyTitle([text("a", "보험금"), text("b", "의 지급사유")])).toBe("보험금의 지급사유");
    expect(textOnlyTitle([])).toBe("");
    expect(textOnlyTitle([{ id: "a", kind: "text", text: "목적", mark: "red" }])).toBeUndefined();
    expect(textOnlyTitle([{ id: "s", kind: "slot", ref: "D0001" }])).toBeUndefined();
  });

  it("사본 · 복제의 제목 노드 id 는 새 조 id 에서 전위 순으로 다시 짓는다 (가지 id 포함)", () => {
    const title: InlineNode[] = [
      text("x1", "보험금 "),
      { id: "x2", kind: "inlineCond", branches: [{ id: "x3", when: "D0001 = true", children: [text("x4", "등")] }, { id: "x5", children: [] }] },
      text("x6", "의 지급절차"),
    ];
    const ids: string[] = [];
    const walk = (list: readonly InlineNode[]) =>
      list.forEach((n) => {
        ids.push(n.id);
        if (n.kind === "inlineCond") n.branches.forEach((br) => (ids.push(br.id), walk(br.children)));
      });
    walk(relabelTitle(title, "n9"));
    expect(ids).toEqual(["n9.title", "n9.title1", "n9.title2", "n9.title3", "n9.title4", "n9.title5"]);
    expect(title[0].id).toBe("x1"); // 원본은 그대로
  });
});

describe("조 제목에 서는 인라인 (ADR-0088 결정 5)", () => {
  it("글 · 인라인 조건 · 슬롯 · 조사만 — 조 참조 · 별표 · 함수조항 · 구조 표기는 막는다", () => {
    expect([...TITLE_INLINE].sort()).toEqual(["inlineCond", "particle", "slot", "text"]);
  });
});

describe("상품 문맥 없는 화면의 접은 제목 (ADR-0088 결정 6)", () => {
  it("글은 그대로", () => {
    expect(foldTitle([text("a", "보험금의 지급사유")])).toBe("보험금의 지급사유");
    expect(foldTitle([])).toBe("");
  });

  it("슬롯은 「〔슬롯 이름〕」 — 이름을 모르면 경로", () => {
    expect(foldTitle([{ id: "s", kind: "slot", ref: "builtin.plan.name" }, text("t", " 보장")])).toBe("〔종형명〕 보장");
    expect(foldTitle([{ id: "s", kind: "slot", ref: "D0007" }])).toBe("〔D0007〕");
    expect(foldTitle([{ id: "s", kind: "slot", ref: "D0007" }], { slotLabel: (ref) => (ref === "D0007" ? "상품명" : undefined) })).toBe("〔상품명〕");
  });

  it("인라인 조건은 첫 가지의 글 — 그 안도 같은 규칙", () => {
    const title: InlineNode[] = [
      text("a", "보험금 "),
      { id: "c", kind: "inlineCond", branches: [{ id: "b1", when: "D0001 = true", children: [text("x", "등"), { id: "s", kind: "slot", ref: "builtin.plan.number" }] }, { id: "b2", children: [] }] },
      text("z", "의 지급절차"),
    ];
    expect(foldTitle(title)).toBe("보험금 등〔선택지 번호〕의 지급절차");
  });

  it("조사는 칩 표기", () => {
    expect(foldTitle([text("a", "보험금"), { id: "p", kind: "particle", preset: "eul-reul" }, text("b", " 받는 자")])).toBe("보험금을/를 받는 자");
  });
});

describe("제목 자리의 저장 검사 · 편집 명령 (ADR-0088 결정 5 · 수용 기준 1 · 5)", () => {
  const doc = (title: InlineNode[]): DocumentNode => ({ id: "d", kind: "document", title: "약관", children: [{ id: "a1", kind: "article", title, children: [] }, { id: "a2", kind: "article", title: titleNodes("다른 조", "a2"), children: [] }] });
  const structure = (d: DocumentNode) => validateTree(d).filter((i) => i.kind === "structure").map((i) => i.message);

  it("글 · 슬롯 · 문장 안 조건 · 조사는 저장된다", () => {
    const title: InlineNode[] = [
      { id: "x", kind: "text", text: "보험금" },
      { id: "p", kind: "particle", preset: "eul-reul" },
      { id: "s", kind: "slot", ref: "D0001" },
      { id: "c", kind: "inlineCond", branches: [{ id: "b", when: "D0001 = true", children: [{ id: "y", kind: "text", text: "등" }] }] },
    ];
    expect(structure(doc(title))).toEqual([]);
  });

  it("조 참조 · 별표 참조 · 문장 안 함수조항 · 구조 표기는 거부 — 제목 안 조건 가지 안까지", () => {
    const ref: InlineNode = { id: "r", kind: "articleRef", targets: [{ articleId: "a2" }], scope: "self" };
    expect(structure(doc([ref]))).toEqual([titleKindMessage("articleRef")]);
    expect(structure(doc([{ id: "x", kind: "appendixRef", appendixCode: "AX000001" }]))).toEqual([titleKindMessage("appendixRef")]);
    expect(structure(doc([{ id: "x", kind: "clauseInlineRef", clauseCode: "C0001", options: {} }]))).toEqual([titleKindMessage("clauseInlineRef")]);
    expect(structure(doc([{ id: "x", kind: "structKey", level: "subCoverage" }]))).toEqual([titleKindMessage("structKey")]);
    expect(structure(doc([{ id: "c", kind: "inlineCond", branches: [{ id: "b", when: "D0001 = true", children: [ref] }] }]))).toEqual([titleKindMessage("articleRef")]);
  });

  it("제목 노드 id 도 트리 안에서 유일하다", () => {
    expect(structure(doc([{ id: "a2", kind: "text", text: "겹침" }]))).toEqual(["노드 id a2 가 트리 안에 두 번 나옵니다"]);
  });

  it("제목 자리(`slot: title`)에 칩을 넣고 글을 고친다 — 허용 밖 칩은 명령이 거부", () => {
    const start = doc(titleNodes("지급절차", "a1"));
    const next = applyCommand(start, { type: "setInlines", at: { parentId: "a1", slot: "title" }, runs: [{ id: "n1", text: "보험금 " }, { node: { id: "s", kind: "slot", ref: "D0001" } }, { keep: "a1.title" }] });
    expect(next.ok && (next.value.children[0] as ArticleNode).title.map((n) => n.id)).toEqual(["n1", "s", "a1.title"]);
    const bad = applyCommand(start, { type: "setInlines", at: { parentId: "a1", slot: "title" }, runs: [{ node: { id: "r", kind: "articleRef", targets: [{ articleId: "a2" }], scope: "self" } }] });
    expect(bad.ok).toBe(false);
  });

  it("글로 고친 조 명(setTitle)은 [글 하나] — 첫 글의 id 를 잇는다", () => {
    const next = applyCommand(doc(titleNodes("목적", "a1")), { type: "setTitle", nodeId: "a1", title: "목적과 정의" });
    expect(next.ok && (next.value.children[0] as ArticleNode).title).toEqual([{ id: "a1.title", kind: "text", text: "목적과 정의" }]);
  });

  it("조 복제의 제목 노드 id 는 새 조 id 에서 짓는다 — 공급원은 조 · 본문 노드만 쓴다", () => {
    const ids = ["k1"];
    const next = applyCommand(doc(titleNodes("목적", "a1")), { type: "duplicate", nodeId: "a1", ids });
    expect(next.ok && (next.value.children[1] as ArticleNode)).toMatchObject({ id: "k1", title: [{ id: "k1.title", kind: "text", text: "목적" }] });
  });
});

describe("조 사본 지문은 옛 글 제목과 같은 뜻으로 센다 (ADR-0088 결정 1)", () => {
  it("글 제목으로 만든 지문이 [글 하나]로 이행한 뒤에도 맞는다", () => {
    const old = { id: "a1", kind: "article", title: "목적", children: [] } as unknown as ArticleNode;
    expect(articleHash(normalizeArticle(old))).toBe(articleHash(old));
    expect(articleHash({ ...normalizeArticle(old), title: [{ id: "a1.title", kind: "text", text: "목적", mark: "red" }] })).not.toBe(articleHash(old));
  });
});

describe("편집기 대상 고르기 · 참조 칩의 조 명은 접은 제목 (ADR-0088 결정 6 · 수용 기준 2 후반)", () => {
  it("제목 인라인 조건은 첫 가지 글 · 슬롯은 이름", () => {
    const d: DocumentNode = {
      id: "d",
      kind: "document",
      title: "약관",
      children: [
        {
          id: "a1",
          kind: "article",
          title: [
            { id: "x", kind: "text", text: "보험금 " },
            { id: "c", kind: "inlineCond", branches: [{ id: "b1", when: "D0001 = true", children: [{ id: "y", kind: "text", text: "등의 " }] }, { id: "b2", children: [] }] },
            { id: "z", kind: "text", text: "지급절차" },
          ],
          children: [],
        },
      ],
    };
    const index = referenceTargetIndex(d, numberTree(d));
    expect(index.get("a1")).toMatchObject({ article: { title: "보험금 등의 지급절차" } });
    const s: DocumentNode = { ...d, children: [{ id: "a1", kind: "article", title: [{ id: "s", kind: "slot", ref: "D0007" }], children: [] }] };
    expect(referenceTargetIndex(s, numberTree(s), { fold: { slotLabel: () => "감액기간문구" } }).get("a1")).toMatchObject({ article: { title: "〔감액기간문구〕" } });
  });
});
