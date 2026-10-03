/**
 * 조 사본 (ADR-0079 · 기능/상품 §3.10) — 템플릿 트리 + 상품의 조 사본 → 이 상품의 보통약관 트리, 템플릿이 바뀐 사본(노랑) 판정.
 */
import { describe, expect, it } from "vitest";

import type { ArticleNode, DocumentNode } from "@/domain/document";

import { applyArticleCopies, articleCopyStates, articleHash, articleOnlyChange, liveArticleCopies, sameArticle, stableStringify } from "./articleCopies";

const text = (id: string, t: string) => ({ id, kind: "text" as const, text: t });
const para = (id: string, t: string) => ({ id, kind: "paragraph" as const, children: [text(`${id}-t`, t)] });
const art = (id: string, title: string, body: string): ArticleNode => ({ id, kind: "article", title, children: [para(`${id}-p1`, body)] });

/** 관 하나 · 관 밖 조 하나 · 조건 블록 안 조 하나. */
const template = (): DocumentNode => ({
  id: "doc",
  kind: "document",
  title: "보통약관",
  children: [
    art("a1", "목적", "이 약관은 …"),
    { id: "s1", kind: "section", title: "보험금의 지급", children: [art("a2", "지급사유", "회사는 …"), { id: "c1", kind: "condBlock", branches: [{ id: "c1-b", when: "D0001", children: [art("a3", "적립", "1형은 …")] }] }] },
  ],
});

describe("stableStringify · articleHash — 키 순서와 무관한 내용 지문", () => {
  it("키 순서가 달라도 같은 문자열 · undefined 키는 없는 것과 같다 (jsonb 왕복)", () => {
    expect(stableStringify({ b: 1, a: [1, { y: 2, x: undefined, z: "q" }] })).toBe(stableStringify({ a: [1, { z: "q", y: 2 }], b: 1 }));
  });

  it("같은 내용이면 같은 해시, 글자 하나가 달라도 다른 해시", () => {
    const a = art("a1", "목적", "이 약관은 …");
    const reordered = JSON.parse(JSON.stringify({ children: a.children, title: a.title, kind: a.kind, id: a.id })) as ArticleNode;
    expect(articleHash(a)).toBe(articleHash(reordered));
    expect(articleHash(a)).not.toBe(articleHash(art("a1", "목적", "이 약관은 …!")));
    expect(articleHash(a)).toMatch(/^[0-9a-f]{14}$/);
    expect(sameArticle(a, reordered)).toBe(true);
  });
});

describe("applyArticleCopies — 고친 조만 사본, 나머지는 템플릿 그대로", () => {
  it("관 · 조건 블록 가지 안 조까지 같은 id 자리에 사본을 놓는다 · 구조와 순서는 템플릿", () => {
    const copy2 = art("a2", "지급사유(상품)", "이 상품은 …");
    const copy3 = art("a3", "적립", "1형만 …");
    const out = applyArticleCopies(template(), [
      { articleId: "a2", article: copy2 },
      { articleId: "a3", article: copy3 },
    ]);
    const s1 = out.children[1];
    if (s1.kind !== "section") throw new Error("관");
    expect(s1.children[0]).toEqual(copy2);
    const c1 = s1.children[1];
    if (c1.kind !== "condBlock") throw new Error("조건 블록");
    expect(c1.branches[0].children[0]).toEqual(copy3);
    expect(out.children[0]).toEqual(template().children[0]); // 고치지 않은 조는 템플릿
  });

  it("사본의 id 는 자리 id 로 맞춘다 · 템플릿에 없는 조의 사본은 버린다 · 사본이 없으면 같은 트리", () => {
    const out = applyArticleCopies(template(), [
      { articleId: "a1", article: { ...art("엉뚱", "목적", "고침"), id: "엉뚱" } },
      { articleId: "없는조", article: art("없는조", "x", "y") },
    ]);
    expect(out.children[0]).toMatchObject({ id: "a1", title: "목적" });
    expect(JSON.stringify(out)).not.toContain("없는조");
    const t = template();
    expect(applyArticleCopies(t, [])).toBe(t);
  });
});

describe("articleCopyStates — 빨강(사본) · 노랑(템플릿이 바뀜)", () => {
  it("사본을 만들 때의 템플릿 지문과 지금 템플릿 지문이 다르면 stale", () => {
    const t = template();
    const a1 = t.children[0] as ArticleNode;
    const fresh = { articleId: "a1", article: art("a1", "목적", "고침"), templateHash: articleHash(a1) };
    const stale = { articleId: "a2", article: art("a2", "지급사유", "고침"), templateHash: "옛지문" };
    const orphan = { articleId: "사라진조", article: art("사라진조", "x", "y"), templateHash: "z" };
    const states = articleCopyStates(t, [fresh, stale, orphan]);
    expect([...states]).toEqual([
      ["a1", "copied"],
      ["a2", "stale"],
    ]);
    expect(liveArticleCopies(t, [fresh, stale, orphan]).map((c) => c.articleId)).toEqual(["a1", "a2"]);
  });
});

describe("articleOnlyChange — 조 사본 편집은 그 조 안만 바꾼다", () => {
  it("그 조의 제목 · 본문만 바뀌었으면 true", () => {
    const before = template();
    const after = applyArticleCopies(before, [{ articleId: "a2", article: art("a2", "새 제목", "새 본문") }]);
    expect(articleOnlyChange(before, after, "a2")).toBe(true);
    expect(articleOnlyChange(before, before, "a2")).toBe(true);
  });

  it("조를 더하거나 · 지우거나 · 옮기거나 · 다른 조를 고치면 false", () => {
    const before = template();
    const added: DocumentNode = { ...before, children: [...before.children, art("a9", "새 조", "…")] };
    expect(articleOnlyChange(before, added, "a1")).toBe(false);
    const removed: DocumentNode = { ...before, children: before.children.slice(1) };
    expect(articleOnlyChange(before, removed, "a1")).toBe(false);
    const other = applyArticleCopies(before, [{ articleId: "a1", article: art("a1", "목적", "남의 조") }]);
    expect(articleOnlyChange(before, other, "a2")).toBe(false);
    const swapped: DocumentNode = { ...before, children: [before.children[1], before.children[0]] };
    expect(articleOnlyChange(before, swapped, "a1")).toBe(false);
  });
});
