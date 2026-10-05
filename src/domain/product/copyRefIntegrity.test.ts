/**
 * 상품 조 사본의 참조 무결성 (ADR-0081 · 기능/상품 §3.10) — 템플릿 + 사본 + 노출 끔을 얹은 최종 트리에서 **새로 생긴** 참조 깨짐.
 */
import { describe, expect, it } from "vitest";

import type { ArticleNode, DocumentNode, ParagraphNode } from "@/domain/document";
import type { Issue } from "@/domain/types";

import { applyArticleCopies } from "./articleCopies";
import { clauseGeneralRefs, copyCodeIssues, copyRefBreaks, newIssuesOnly, outsideRefsOf, productRefIssues, refBreakIssues } from "./copyRefIntegrity";

const text = (id: string, t: string) => ({ id, kind: "text" as const, text: t });
const para = (id: string, code: string, ...children: ParagraphNode["children"]): ParagraphNode => ({ id, kind: "paragraph", code, children: children.length > 0 ? children : [text(`${id}-t`, "글")] });
const ref = (id: string, articleId: string, code?: string) => ({ id, kind: "articleRef" as const, scope: "self" as const, targets: [{ articleId, ...(code ? { code } : {}) }] });

/** 제1조(a10) ① ② · 제2조(a11) ①이 제1조 ①을 · 제3조(a12, 항 하나라 번호 없음)가 제1조를 · 제4조(a13) ①이 템플릿에도 없는 제1조 P0900 을 가리킨다. */
const template = (): DocumentNode => ({
  id: "doc",
  kind: "document",
  title: "보통약관",
  children: [
    { id: "a10", kind: "article", title: "지급사유", children: [para("p10-1", "P0100"), para("p10-2", "P0200")] },
    { id: "a11", kind: "article", title: "지급제한", children: [para("p11-1", "P0100", text("t11", "제1조 제1항에 따라 "), ref("r11", "a10", "P0100")), para("p11-2", "P0200")] },
    { id: "a12", kind: "article", title: "청구", children: [para("p12-1", "P0100", ref("r12", "a10"))] },
    { id: "a13", kind: "article", title: "옛 깨짐", children: [para("p13-1", "P0100", ref("r13", "a10", "P0900"))] },
  ],
});
const a10 = () => template().children[0] as ArticleNode;
/** 제1조 사본 — ①(P0100)을 지우고 새 항(PZ0100)을 쓴다. */
const rewrittenA10 = (): ArticleNode => ({ ...a10(), children: [para("p10-new", "PZ0100"), para("p10-2", "P0200")] });
const product = { document: "product" as const, ownerId: "prod" };

describe("copyRefBreaks — 템플릿 단독일 때 없던 깨짐만", () => {
  it("사본이 지운 항을 가리키던 템플릿의 다른 조 — 가리키는 쪽 자리에 원인(지운 사본 조)과 함께", () => {
    const final = applyArticleCopies(template(), [{ articleId: "a10", article: rewrittenA10() }]);
    const breaks = copyRefBreaks({ template: template(), final, hidden: [], coordinate: product });
    expect(breaks.map((b) => [b.at.articleId, b.at.nodePath?.at(-1), b.key, b.cause])).toEqual([["a11", "r11", "a10#P0100", "removed"]]);
    const [issue] = refBreakIssues(breaks, { template: template(), final });
    expect(issue).toMatchObject({ kind: "brokenRef", at: { document: "product", ownerId: "prod", articleId: "a11", nodePath: expect.arrayContaining(["r11"]), refPath: "a10#P0100" } });
    expect(issue.message).toBe("제2조 ① — 지운 제1조 ①을 가리킴 (제1조 사본에서 지움) · 가리키는 조도 사본으로 고친다");
  });

  it("노출 끈 조를 가리키는 참조 — 끈 조 안에서 나가는 참조는 보지 않는다", () => {
    const breaks = copyRefBreaks({ template: template(), final: template(), hidden: ["a10", "a13"], coordinate: product });
    expect(breaks.map((b) => [b.at.articleId, b.key, b.cause])).toEqual([
      ["a11", "a10#P0100", "hidden"],
      ["a12", "a10", "hidden"],
    ]);
    expect(refBreakIssues(breaks, { template: template(), final: template() }).map((i) => i.message)).toEqual([
      "제2조 ① — 노출 끈 제1조 ①을 가리킴 · 가리키는 조도 사본으로 고치거나 노출을 켠다",
      "제3조 — 노출 끈 제1조를 가리킴 · 가리키는 조도 사본으로 고치거나 노출을 켠다",
    ]);
  });

  it("템플릿 단독일 때부터 깨진 참조(제4조 → P0900)는 이 상품의 일이 아니다 · 깨짐이 없으면 빈 목록", () => {
    expect(copyRefBreaks({ template: template(), final: template(), hidden: [] })).toEqual([]);
  });

  it("사본 안에서 새로 가리킨 없는 대상 · 템플릿이 지운 대상을 사본이 가리킴 — 「없는 대상」", () => {
    const a11 = template().children[1] as ArticleNode;
    const copy11: ArticleNode = { ...a11, children: [para("p11-1", "P0100", ref("r11", "a10", "P0700")), para("p11-2", "P0200")] };
    const final = applyArticleCopies(template(), [{ articleId: "a11", article: copy11 }]);
    const breaks = copyRefBreaks({ template: template(), final, hidden: [] });
    expect(breaks.map((b) => [b.at.articleId, b.key, b.cause])).toEqual([["a11", "a10#P0700", "missing"]]);
    expect(refBreakIssues(breaks, { template: template(), final })[0].message).toBe("제2조 ① — 없는 대상 a10 의 P0700을 가리킴 · 가리키는 조를 고친다");
  });

  it("밖의 참조(담보약관 · 함수조항) — 지운 대상 · 끈 조를 가리키면 원인 조의 목차 줄에, 템플릿에 없던 대상은 보지 않는다", () => {
    const final = applyArticleCopies(template(), [{ articleId: "a10", article: rewrittenA10() }]);
    const outside = [
      { key: "a10#P0100", articleId: "a10", where: "담보약관 「암진단」 제3조(보험금) ②", at: { document: "special" as const, ownerId: "cov", articleId: "s3" } },
      { key: "a12", articleId: "a12", where: "함수조항 C0002", at: { document: "clause" as const, ownerId: "C0002" } },
      { key: "a10#P0900", articleId: "a10", where: "함수조항 C0003", at: { document: "clause" as const, ownerId: "C0003" } },
    ];
    const breaks = copyRefBreaks({ template: template(), final, hidden: ["a12"], outside, coordinate: product });
    expect(breaks.map((b) => [b.at.articleId, b.at.nodePath, b.key, b.cause])).toEqual([
      ["a11", expect.anything(), "a10#P0100", "removed"],
      ["a10", undefined, "a10#P0100", "removed"],
      ["a12", undefined, "a12", "hidden"],
    ]);
    expect(refBreakIssues(breaks, { template: template(), final }).slice(1).map((i) => [i.at.document, i.message])).toEqual([
      ["product", "담보약관 「암진단」 제3조(보험금) ② — 지운 제1조 ①을 가리킴 (제1조 사본에서 지움) · 사본을 되돌리거나 그 항을 남긴다"],
      ["product", "함수조항 C0002 — 노출 끈 제3조를 가리킴 · 노출을 켠다"],
    ]);
  });
});

describe("outsideRefsOf · clauseGeneralRefs — 템플릿 밖에서 이 템플릿을 가리키는 참조", () => {
  it("담보약관의 조연결 · 보통약관 조 참조 (자기 조 참조는 뺀다)", () => {
    const special: DocumentNode = {
      id: "sdoc",
      kind: "document",
      title: "암진단 특약",
      children: [
        {
          id: "s1",
          kind: "article",
          title: "보험금",
          linkedArticleId: "a10",
          children: [para("sp1", "P0100", { id: "g1", kind: "articleRef", scope: "general", targets: [{ articleId: "a10", code: "P0100" }] }, ref("self1", "s1"))],
        },
      ],
    };
    const refs = outsideRefsOf(special, { document: "special", ownerId: "cov", ownerName: "암진단 특약" });
    expect(refs.map((r) => [r.key, r.articleId, r.at.articleId])).toEqual([
      ["a10", "a10", "s1"],
      ["a10#P0100", "a10", "s1"],
    ]);
    expect(refs[0].where).toBe("담보약관 「암진단 특약」 보험금");
  });

  it("함수조항 본문 · 선택지 본문의 보통약관 참조 (「이 함수조항」 · 「사용처」 범위는 뺀다)", () => {
    const clause = {
      code: "C0002",
      label: "면책 보충",
      body: [{ id: "b1", kind: "paragraph", children: [{ id: "r1", kind: "articleRef", targets: [{ articleId: "a10", code: "P0100" }] }, { id: "r2", kind: "articleRef", scope: "clause", targets: [{ code: "P0100" }] }] }],
      options: [{ code: "o1", values: [{ code: "v1", body: [{ id: "r3", kind: "articleRef", targets: [{ articleId: "a12" }] }] }] }],
    };
    expect(clauseGeneralRefs(clause).map((r) => [r.key, r.at.ownerId, r.at.nodePath, r.where])).toEqual([
      ["a10#P0100", "C0002", ["r1"], "함수조항 면책 보충(C0002)"],
      ["a12", "C0002", ["r3"], "함수조항 면책 보충(C0002)"],
    ]);
  });
});

describe("newIssuesOnly — 최종 트리 검사에서 템플릿 단독 검사에 없던 것만 (E − T)", () => {
  it("종류 · 조 · 자리 · 대상 열쇠가 같으면 같은 오류", () => {
    const issue = (articleId: string, node: string, refPath?: string, message = "m"): Issue => ({ kind: "brokenRef", message, at: { articleId, nodePath: ["doc", articleId, node], ...(refPath ? { refPath } : {}) } });
    const t = [issue("a13", "r13", "a10#P0900")];
    const e = [issue("a13", "r13", "a10#P0900", "문구가 달라도"), issue("a11", "r11", "a10#P0100")];
    expect(newIssuesOnly(e, t)).toEqual([e[1]]);
  });
});

describe("productRefIssues — 화면 · 서버가 같은 한 벌로 (템플릿 · 사본 · 노출 끔 · 밖의 참조 재료 → 이슈)", () => {
  it("탑재로 거른 담보약관 재료 + 트리가 쓰는 함수조항만", () => {
    const dependents = {
      documents: [{ coverageId: "cov", clauseCodes: [], refs: [{ key: "a10#P0100", articleId: "a10", at: { document: "special" as const }, where: "담보약관 「암」 보험금" }] }],
      clauses: [{ code: "C0001", refs: [{ key: "a10#P0200", articleId: "a10", at: { document: "clause" as const }, where: "함수조항 C0001" }] }],
    };
    const issues = productRefIssues({ template: template(), copies: [{ articleId: "a10", article: rewrittenA10() }], hidden: [], dependents, coordinate: product });
    expect(issues.map((i) => [i.at.articleId, i.message.split(" — ")[0]])).toEqual([
      ["a11", "제2조 ①"],
      ["a10", "담보약관 「암」 보험금"],
    ]);
    expect(productRefIssues({ template: template(), copies: [], hidden: [] })).toEqual([]);
  });
});

describe("copyCodeIssues — 사본의 새 노드는 PZ 코드여야 한다 (ADR-0081 결정 4)", () => {
  it("템플릿 원본 조에 없는 노드 id 가 P 코드면 그 자리에 오류, PZ · 템플릿 노드는 통과", () => {
    const copy: ArticleNode = { ...a10(), children: [para("p10-new", "P0300"), para("p10-2", "P0200"), para("p10-z", "PZ0100")] };
    const issues = copyCodeIssues(a10(), copy, undefined, product);
    expect(issues.map((i) => [i.kind, i.at.articleId, i.at.nodePath])).toEqual([["structure", "a10", ["p10-new"]]]);
    expect(issues[0].message).toBe("사본에 새로 넣은 자리의 코드 P0300 은 PZ 코드여야 한다 — 템플릿 코드(P)와 갈라 둔다 (추천 PZ0200)");
  });

  it("이미 저장된 사본에 같은 id · 같은 코드로 있던 노드는 그대로 둔다 — 이 결정 전 사본을 다시 쓰지 않는다", () => {
    const copy: ArticleNode = { ...a10(), children: [para("p10-new", "P0300"), para("p10-2", "P0200")] };
    expect(copyCodeIssues(a10(), copy, copy, product)).toEqual([]);
    expect(copyCodeIssues(a10(), copy, { ...copy, children: [para("p10-new", "P0500")] }, product)).toHaveLength(1);
  });
});
