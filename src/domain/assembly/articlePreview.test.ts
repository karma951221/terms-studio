import { describe, expect, it } from "vitest";

import type { DocumentNode } from "../document/nodes";
import { previewArticle } from "./articlePreview";
import { assemble } from "./booklet";
import { alphaBaseDocument, alphaDeathDocument, alphaGeneralDocument, alphaPlusFixture } from "./fixture";
import type { AssemblyInput, RenderedArticle, RenderedDoc, RenderedInline } from "./types";

/** 렌더 조 → 사람이 읽는 줄 (번호 · 본문). */
function lines(a: RenderedArticle): string[] {
  const inline = (list: RenderedInline[]) => list.map((n) => (n.kind === "text" ? n.text : n.kind === "error" ? `⟦${n.issue.kind}⟧` : n.label)).join("");
  return [`${a.label}(${a.title})`, ...a.children.map((p) => (p.kind === "paragraph" ? `${p.label} ${inline(p.children)}`.trim() : `[${p.kind}]`))];
}

function articleIn(doc: RenderedDoc | undefined, id: string): RenderedArticle | undefined {
  for (const c of doc?.children ?? []) {
    if (c.kind === "article" && c.id === id) return c;
    if (c.kind === "section") for (const a of c.children) if (a.kind === "article" && a.id === id) return a;
  }
  return undefined;
}

const fx = (): AssemblyInput => alphaPlusFixture();
/** 재료를 공유 마스터 / 상품 고유분으로 나눠 넘긴다 — 한 객체를 두 번 넘기면 상품 쪽의 문서 맵이 끼운 트리를 덮는다. */
const run = (input: AssemblyInput, target: Parameters<typeof previewArticle>[2], articleId: string) => previewArticle(input, { product: input.product, coverages: input.coverages }, target, articleId);

describe("previewArticle — 저작 화면 미리보기: 고른 상품 문맥으로 조 하나 (기능/문면 §3.9)", () => {
  it("담보약관 — 그 상품담보 문맥으로 조립한 조와 책자의 같은 조가 같다 (번호 · 본문)", () => {
    const input = fx();
    const booklet = assemble(input, input);
    const expected = articleIn(booklet.specials[0].docs[1], "s-art-pay")!;
    const r = run(input, { document: "special", productCoverageId: "pc-addon", tree: alphaDeathDocument() }, "s-art-pay");
    expect(r.kind).toBe("shown");
    if (r.kind !== "shown") return;
    expect(r.article).toEqual(expected);
    expect(lines(r.article)[0]).toBe("제1조(보험금의 지급사유)");
  });

  it("담보약관 — 넘긴 트리(편집본)를 조립한다 — 저장본이 아니라", () => {
    const tree = alphaDeathDocument();
    const pay = tree.children[0];
    if (pay.kind !== "article" || pay.children[0].kind !== "paragraph") throw new Error("픽스처 모양");
    const first = pay.children[0].children[0];
    if (first.kind !== "text") throw new Error("픽스처 모양");
    first.text = "편집 중인 회사는 피보험자가 ";
    const r = run(fx(), { document: "special", productCoverageId: "pc-addon", tree }, "s-art-pay");
    expect(r.kind === "shown" && lines(r.article)[1].startsWith("편집 중인 회사는 피보험자가 계약일")).toBe(true);
  });

  it("담보약관 — 조건으로 빠진 조는 「생략」 (까닭: 조건 · 빈 조)", () => {
    const tree = alphaDeathDocument();
    const cond = tree.children[1];
    if (cond.kind !== "condBlock") throw new Error("픽스처 모양");
    cond.branches[0].when = "D0005 = false";
    expect(run(fx(), { document: "special", productCoverageId: "pc-addon", tree }, "s-art-exempt")).toEqual({ kind: "dropped", reason: "notEmitted" });
  });

  it("담보약관 — 보통약관 조와 같아 생략 판정된 조는 「생략」 (까닭: 생략 + 대응 보통약관 조 명)", () => {
    const input = fx();
    const omitted = assemble(input, input).omitted.filter((o) => o.productCoverageId === "pc-addon" && o.disposition === "omitted");
    expect(omitted.length).toBeGreaterThan(0);
    for (const o of omitted) {
      expect(run(input, { document: "special", productCoverageId: "pc-addon", tree: alphaDeathDocument() }, o.articleId)).toEqual({ kind: "dropped", reason: "omitted", linkedArticleTitle: expect.any(String) });
    }
  });

  it("담보약관 — 없는 상품담보 · 기본계약 상품담보는 미리보기할 수 없다", () => {
    expect(run(fx(), { document: "special", productCoverageId: "pc-none", tree: alphaDeathDocument() }, "s-art-pay").kind).toBe("unavailable");
    expect(run(fx(), { document: "special", productCoverageId: "pc-base", tree: alphaBaseDocument() }, "b-art-pay").kind).toBe("unavailable");
  });

  it("담보약관 — 그 조 자리의 조립 오류를 함께 준다", () => {
    const tree = alphaDeathDocument();
    const pay = tree.children[0];
    if (pay.kind !== "article" || pay.children[0].kind !== "paragraph") throw new Error("픽스처 모양");
    pay.children[0].children.push({ id: "s-slot-gone", kind: "slot", ref: "D9999" });
    const r = run(fx(), { document: "special", productCoverageId: "pc-addon", tree }, "s-art-pay");
    expect(r.kind).toBe("shown");
    if (r.kind !== "shown") return;
    expect(r.issues.length).toBeGreaterThan(0);
    expect(r.issues.every((i) => i.at.articleId === "s-art-pay")).toBe(true);
  });

  it("보통약관 — 그 상품의 보통약관 한 벌 번호 · 본문, 책자의 같은 조와 같다", () => {
    const input = fx();
    const expected = articleIn(assemble(input, input).general, "g-art-def")!;
    const r = run(input, { document: "general", tree: alphaGeneralDocument() }, "g-art-def");
    expect(r).toEqual({ kind: "shown", article: expected, issues: [] });
  });

  it("보통약관 — 기본계약 조로 대치된 조는 대치된 본문 + 그 기본계약 이름", () => {
    const r = run(fx(), { document: "general", tree: alphaGeneralDocument() }, "g-art-pay");
    expect(r.kind).toBe("shown");
    if (r.kind !== "shown") return;
    expect(lines(r.article)).toEqual(["제2조(보험금의 지급사유)", "피보험자가 보험기간 중 상해로 사망한 경우 보험금을 지급합니다."]);
    expect(r.replacedByBase).toBe("상해사망(기본계약)");
  });

  it("보통약관 — 상품이 노출을 끈 조는 「생략」 (까닭: 노출 끔), 뒤 조 번호가 당겨진다", () => {
    const input = fx();
    const hidden: AssemblyInput = { ...input, product: { ...input.product, hiddenArticleIds: new Set(["g-art-def"]) } };
    expect(run(hidden, { document: "general", tree: alphaGeneralDocument() }, "g-art-def")).toEqual({ kind: "dropped", reason: "hidden" });
    const next = run(hidden, { document: "general", tree: alphaGeneralDocument() }, "g-art-pay");
    expect(next.kind === "shown" && next.article.label).toBe("제1조");
  });

  it("보통약관 — 상품의 조 사본을 쓰는 조는 사본 본문 + 사본 표시", () => {
    const input = fx();
    const copy: DocumentNode["children"][number] = { id: "g-art-def", kind: "article", title: "용어의 정의", children: [{ id: "g-par-def", kind: "paragraph", children: [{ id: "g-txt-def-copy", kind: "text", text: "이 상품의 용어 정의." }] }] };
    if (copy.kind !== "article") throw new Error("모양");
    const withCopy: AssemblyInput = { ...input, product: { ...input.product, articleCopies: new Map([["g-art-def", copy]]) } };
    const r = run(withCopy, { document: "general", tree: alphaGeneralDocument() }, "g-art-def");
    expect(r.kind === "shown" && r.articleCopy).toBe(true);
    expect(r.kind === "shown" && lines(r.article)[1]).toBe("이 상품의 용어 정의.");
  });

  it("보통약관 — 상품이 이 보통약관을 쓰지 않으면 미리보기할 수 없다", () => {
    const input = fx();
    const none: AssemblyInput = { ...input, product: { ...input.product, generalDocumentId: undefined } };
    expect(run(none, { document: "general", tree: alphaGeneralDocument() }, "g-art-def").kind).toBe("unavailable");
  });
});
