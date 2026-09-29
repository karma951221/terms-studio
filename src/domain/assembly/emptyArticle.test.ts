import { describe, expect, it } from "vitest";

import type { ArticleNode, DocumentNode } from "../document/nodes";
import { assemble } from "./booklet";
import { authoredEmptyArticleIds, dropEmptyArticles } from "./emptyArticle";
import { alphaPlusFixture } from "./fixture";
import type { AssemblyInput, RArticle, RenderedArticle, SInline, SubstitutedDoc } from "./types";

/**
 * 빈 조 — 펼친 뒤 본문(항 · 표 · 박스 · 글머리 목록)이 0개인 조는 조립이 조째 뺀다 (결정 15 · 기능/문면 §3.2 · 기능/조립산출 §3.1).
 * 편집 중에는 빈 조를 허용한다. 번호 매기기 전에 빼므로 뒤 조 번호가 당겨지고, 빠진 조를 가리키는 참조는 articleGone 이다.
 */
const article = (id: string, children: RArticle<SInline>["children"]): RArticle<SInline> => ({ kind: "article", id, title: id, children });
const paragraph = (id: string) => ({ kind: "paragraph" as const, id, children: [{ kind: "text" as const, id: `${id}-t`, text: id }] });

describe("dropEmptyArticles — 본문 0개인 조를 조째 뺀다", () => {
  it("최상위 · 관 안의 빈 조를 빼고 뺀 조 id 를 돌려준다 — 본문이 있는 조와 관은 남는다", () => {
    const doc: SubstitutedDoc = {
      kind: "document",
      id: "d",
      title: "d",
      children: [
        article("a1", []),
        article("a2", [paragraph("p2")]),
        { kind: "section", id: "s", title: "관", children: [article("a3", []), article("a4", [paragraph("p4")])] },
      ],
    };
    const out = dropEmptyArticles(doc);
    expect(out.dropped).toEqual(["a1", "a3"]);
    expect(out.doc.children.map((c) => c.id)).toEqual(["a2", "s"]);
    const section = out.doc.children[1];
    expect(section.kind === "section" && section.children.map((c) => c.id)).toEqual(["a4"]);
  });

  it("오류 노드만 남은 조는 빼지 않는다 — 오류를 가리지 않는다", () => {
    const doc: SubstitutedDoc = { kind: "document", id: "d", title: "d", children: [article("a1", [{ kind: "error", id: "e", issue: { kind: "structure", message: "x", at: {} } }])] };
    expect(dropEmptyArticles(doc).dropped).toEqual([]);
  });

  it("템플릿에서 본문 없이 쓴 조(기본계약 대치 자리 · 쓰는 중인 조)는 남긴다 — 펼친 뒤 빈 조만 뺀다", () => {
    const doc: SubstitutedDoc = { kind: "document", id: "d", title: "d", children: [article("a1", []), article("a2", [])] };
    expect(dropEmptyArticles(doc, new Set(["a1"])).dropped).toEqual(["a2"]);
  });

  it("authoredEmptyArticleIds — 최상위 · 관 · 조건 블록 가지의 본문 없는 조", () => {
    const src: DocumentNode = {
      kind: "document",
      id: "d",
      title: "d",
      children: [
        { kind: "article", id: "a1", title: "a1", children: [] },
        { kind: "article", id: "a2", title: "a2", children: [{ kind: "paragraph", id: "p", children: [] }] },
        { kind: "section", id: "s", title: "s", children: [{ kind: "article", id: "a3", title: "a3", children: [] }] },
        { kind: "condBlock", id: "c", branches: [{ id: "c-if", when: "D0001 = true", children: [{ kind: "article", id: "a4", title: "a4", children: [] }] }] },
      ] as DocumentNode["children"],
    };
    expect([...authoredEmptyArticleIds(src)]).toEqual(["a1", "a3", "a4"]);
  });

  it("빈 조가 없으면 같은 문서를 그대로 돌려준다", () => {
    const doc: SubstitutedDoc = { kind: "document", id: "d", title: "d", children: [article("a1", [paragraph("p1")])] };
    expect(dropEmptyArticles(doc).doc).toBe(doc);
  });
});

describe("조립 — 조건으로 항이 전부 빠진 조는 조째 빠진다", () => {
  /** 보통약관 맨 앞에 「고지유형 = 일반심사」(픽스처는 간편심사)일 때만 항이 있는 조, 맨 뒤에 그 조를 가리키는 조. */
  const withEmptyArticle = (): AssemblyInput => {
    const input = alphaPlusFixture();
    const general = input.generalDocuments.get("g-doc")!;
    const empty: ArticleNode = {
      kind: "article",
      id: "g-art-empty",
      title: "일반심사 특칙",
      children: [
        {
          kind: "condBlock",
          id: "g-cond-empty",
          branches: [{ id: "g-cond-empty-if", when: "D0002 = 'V01'", children: [{ kind: "paragraph", id: "g-par-empty", children: [{ kind: "text", id: "g-txt-empty", text: "일반심사 계약은 …" }] }] }],
        },
      ],
    };
    const refer: ArticleNode = {
      kind: "article",
      id: "g-art-refer",
      title: "특칙의 준용",
      children: [{ kind: "paragraph", id: "g-par-refer", children: [{ kind: "articleRef", id: "g-ref-empty", targets: [{ articleId: "g-art-empty" }], scope: "self" }, { kind: "text", id: "g-txt-refer", text: "을 준용합니다." }] }],
    };
    const doc: DocumentNode = { ...general, children: [empty, ...general.children, refer] as DocumentNode["children"] };
    return { ...input, generalDocuments: new Map([...input.generalDocuments, ["g-doc", doc]]) };
  };

  it("빈 조는 책자에 없고 뒤 조 번호가 당겨진다", () => {
    const base = assemble(alphaPlusFixture(), alphaPlusFixture());
    const booklet = assemble(withEmptyArticle(), withEmptyArticle());
    const articles = (booklet.general?.children ?? []).filter((c): c is RenderedArticle => c.kind === "article");
    expect(articles.map((a) => a.id)).not.toContain("g-art-empty");
    const baseFirst = (base.general?.children ?? []).find((c): c is RenderedArticle => c.kind === "article")!;
    expect(articles[0]).toMatchObject({ id: baseFirst.id, number: 1, label: "제1조" });
  });

  it("빠진 조를 가리키는 참조는 articleGone", () => {
    const booklet = assemble(withEmptyArticle(), withEmptyArticle());
    const gone = booklet.issues.filter((i) => i.kind === "articleGone");
    expect(gone.map((i) => i.at.refPath)).toEqual(["g-art-empty"]);
  });
});
