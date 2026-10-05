/**
 * ADR-0081 — 상품 조 사본의 참조 무결성 (기능/상품 §3.10). 보통약관 탭 저장은 템플릿 + 사본 + 노출 끔을 얹은 최종 트리 전체를 보고,
 * 템플릿 단독일 때 없던 참조 깨짐이 하나라도 있으면 거부한다 — 같은 템플릿 안 · 노출 끔 · 탑재한 담보약관 · 함수조항 본문.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ArticleNode, DocumentNode, ParagraphNode } from "@/domain/document";
import { articleHash, outsideRefsOf, type CoverageTree, type GeneralDependents } from "@/domain/product";
import type { Actor, Issue } from "@/domain/types";

import { createTestDb, type TestDb } from "@/db/test-utils";
import { createProductService, type ProductService } from "./product";

const editor: Actor = { userId: "00000000-0000-4000-8000-000000000002", role: "editor" };
function unwrap<T>(r: { ok: true; value: T } | { ok: false; rejection: unknown }): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}
function issuesOf(r: { ok: boolean; rejection?: { reason: string; issues?: Issue[] } }): Issue[] {
  if (r.ok || r.rejection?.reason !== "invalid") throw new Error(`기대: invalid, 실제: ${JSON.stringify(r)}`);
  return r.rejection.issues!;
}

const GENERAL = "dddddddd-0000-4000-8000-0000000000aa";
const CANCER = "aaaaaaaa-0000-4000-8000-0000000000c1";
const OTHER_COVERAGE = "aaaaaaaa-0000-4000-8000-0000000000c2";
const text = (id: string, t = "글") => ({ id, kind: "text" as const, text: t });
const para = (id: string, code: string, ...children: ParagraphNode["children"]): ParagraphNode => ({ id, kind: "paragraph", code, children: children.length > 0 ? children : [text(`${id}-t`)] });
const ref = (id: string, articleId: string, code?: string) => ({ id, kind: "articleRef" as const, scope: "self" as const, targets: [{ articleId, ...(code ? { code } : {}) }] });

/** 제1조(a10) ① ② · 제2조(a11) ①이 제1조 ①을 가리킨다 · 제3조(a12) 함수조항 C0009 자리. */
function template(): DocumentNode {
  return {
    id: GENERAL,
    kind: "document",
    title: "보통약관",
    children: [
      { id: "a10", kind: "article", title: "지급사유", children: [para("p10-1", "P0100"), para("p10-2", "P0200")] },
      { id: "a11", kind: "article", title: "지급제한", children: [para("p11-1", "P0100", text("t11", "제1조 제1항에 따라 "), ref("r11", "a10", "P0100")), para("p11-2", "P0200")] },
      { id: "a12", kind: "article", title: "청구", children: [{ id: "cl12", kind: "clauseBlockRef", clauseCode: "C0009", options: {} }] },
    ],
  };
}
const a10 = () => template().children[0] as ArticleNode;
const a11 = () => template().children[1] as ArticleNode;
/** 제1조 사본 — ①(P0100)을 지우고 새 항(PZ0100 — 사본의 새 자리)을 쓴다. */
const rewrittenA10 = (): ArticleNode => ({ ...a10(), children: [para("p10-new", "PZ0100"), para("p10-2", "P0200")] });
/** 제2조 사본 — 지운 ① 대신 ②를 가리키게 고쳤다. */
const fixedA11 = (): ArticleNode => ({ ...a11(), children: [para("p11-1", "P0100", text("t11", "제1조 제2항에 따라 "), ref("r11", "a10", "P0200")), para("p11-2", "P0200")] });

/** 담보약관 — 암진단(탑재)은 제1조 ①을, 다른 담보(탑재 안 함)도 제1조 ①을 가리킨다. 함수조항 C0009 는 제1조 ②를 가리킨다. */
function dependents(): GeneralDependents {
  const special = (coverageId: string, title: string): DocumentNode => ({
    id: `doc-${coverageId}`,
    kind: "document",
    title,
    children: [{ id: `s-${coverageId}`, kind: "article", title: "보험금", children: [para(`sp-${coverageId}`, "P0100", { id: `g-${coverageId}`, kind: "articleRef", scope: "general", targets: [{ articleId: "a10", code: "P0100" }] })] }],
  });
  return {
    documents: [
      { coverageId: CANCER, clauseCodes: [], refs: outsideRefsOf(special(CANCER, "암진단 특약"), { document: "special", ownerId: CANCER, ownerName: "암진단 특약" }) },
      { coverageId: OTHER_COVERAGE, clauseCodes: [], refs: outsideRefsOf(special(OTHER_COVERAGE, "다른 특약"), { document: "special", ownerId: OTHER_COVERAGE, ownerName: "다른 특약" }) },
    ],
    clauses: [{ code: "C0009", refs: [{ key: "a10#P0200", articleId: "a10", at: { document: "clause", ownerId: "C0009", nodePath: ["x"] }, where: "함수조항 면책(C0009)" }] }],
  };
}

const trees = new Map<string, CoverageTree>([
  [CANCER, { id: CANCER, name: "암진단", subCoverages: [] }],
  [OTHER_COVERAGE, { id: OTHER_COVERAGE, name: "다른 담보", subCoverages: [] }],
]);

describe("ADR-0081 — 보통약관 탭 저장의 참조 무결성 (PGlite)", () => {
  let t: TestDb;
  let svc: ProductService;
  const save = (productId: string, input: Partial<Parameters<ProductService["saveGeneralSettings"]>[2]>) =>
    svc.saveGeneralSettings(editor, productId, { generalDocumentId: GENERAL, hiddenArticles: [], overrides: [], ...input });
  const copy = (article: ArticleNode) => ({ articleId: article.id, article, templateHash: articleHash(template().children.find((a) => a.id === article.id) as ArticleNode) });

  beforeAll(async () => {
    t = await createTestDb();
    svc = createProductService(t.db, {
      coverageMaster: { tree: async (id) => trees.get(id) },
      generalDocuments: {
        exists: async (id) => id === GENERAL,
        articleIds: async (id) => (id === GENERAL ? ["a10", "a11", "a12"] : []),
        clauseRef: async () => undefined,
        template: async (id) => (id === GENERAL ? { tree: template(), version: 1 } : undefined),
        validate: async () => [],
        dependents: async (id) => (id === GENERAL ? dependents() : { documents: [], clauses: [] }),
      },
    });
  });
  afterAll(async () => {
    await t.close();
  });

  it("사본이 지운 항을 템플릿의 다른 조가 가리키면 거부 — 가리키는 조 자리 · 원인, 가리키는 조도 사본으로 고치면 한 저장으로 나간다", async () => {
    const p = unwrap(await svc.createProduct(editor, { name: "참조 무결성 1", generalDocumentId: GENERAL }));
    const issues = issuesOf(await save(p.id, { copies: [copy(rewrittenA10())] }));
    expect(issues.map((i) => [i.at.document, i.at.articleId, i.at.nodePath?.at(-1), i.message])).toEqual([
      ["product", "a11", "r11", "제2조 ① — 지운 제1조 ①을 가리킴 (제1조 사본에서 지움) · 가리키는 조도 사본으로 고친다"],
    ]);
    expect(await svc.listArticleCopies(p.id)).toEqual([]);
    unwrap(await save(p.id, { copies: [copy(rewrittenA10()), copy(fixedA11())] }));
    expect((await svc.listArticleCopies(p.id)).map((c) => c.articleId).sort()).toEqual(["a10", "a11"]);
  });

  it("노출 끈 조만 가리키게 되면 거부 — 같은 템플릿 안 참조 · 함수조항 본문 참조", async () => {
    const p = unwrap(await svc.createProduct(editor, { name: "참조 무결성 2", generalDocumentId: GENERAL }));
    const issues = issuesOf(await save(p.id, { hiddenArticles: ["a10"] }));
    expect(issues.map((i) => [i.at.articleId, i.message])).toEqual([
      ["a11", "제2조 ① — 노출 끈 제1조 ①을 가리킴 · 가리키는 조도 사본으로 고치거나 노출을 켠다"],
      ["a10", "함수조항 면책(C0009) — 노출 끈 제1조 ②을 가리킴 · 노출을 켠다"],
    ]);
    expect(await svc.listHiddenArticles(p.id)).toEqual([]);
  });

  it("조 하나 숨기기(setArticleHidden)도 같은 검사 — 끈 조만 가리키게 되면 거부, 다시 켜기는 막지 않는다", async () => {
    const p = unwrap(await svc.createProduct(editor, { name: "참조 무결성 2b", generalDocumentId: GENERAL }));
    expect(issuesOf(await svc.setArticleHidden(editor, p.id, "a10", true)).map((i) => i.at.articleId)).toEqual(["a11", "a10"]);
    expect(await svc.listHiddenArticles(p.id)).toEqual([]);
    unwrap(await svc.setArticleHidden(editor, p.id, "a11", true));
    unwrap(await svc.setArticleHidden(editor, p.id, "a11", false));
  });

  it("탑재한 담보약관의 보통약관 조 참조 — 탑재하지 않은 담보약관은 보지 않는다", async () => {
    const p = unwrap(await svc.createProduct(editor, { name: "참조 무결성 3", generalDocumentId: GENERAL }));
    // 탑재 전 — 담보약관은 이 상품의 것이 아니다
    unwrap(await save(p.id, { copies: [copy(rewrittenA10()), copy(fixedA11())] }));
    unwrap(await svc.mount(editor, p.id, CANCER, []));
    const issues = issuesOf(await save(p.id, { copies: [copy(rewrittenA10()), copy(fixedA11())] }));
    expect(issues.map((i) => [i.at.articleId, i.at.refPath, i.message])).toEqual([["a10", "a10#P0100", "담보약관 「암진단 특약」 보험금 — 지운 제1조 ①을 가리킴 (제1조 사본에서 지움) · 사본을 되돌리거나 그 항을 남긴다"]]);
  });

  it("generalReferenceIssues — 저장본(사본 · 노출 끔)의 깨짐을 읽기 화면용으로 (템플릿이 바뀌어 깨져도 같은 목록)", async () => {
    const p = unwrap(await svc.createProduct(editor, { name: "참조 무결성 4", generalDocumentId: GENERAL }));
    expect(await svc.generalReferenceIssues(p.id)).toEqual([]);
    unwrap(await save(p.id, { copies: [copy(rewrittenA10()), copy(fixedA11())] }));
    expect(await svc.generalReferenceIssues(p.id)).toEqual([]);
  });

  it("templateImpact — 새 템플릿으로 이 템플릿을 쓰는 상품마다 다시 셈한다: 상품 · 자리 좌표(이름 · 문구), 깨짐 없는 상품은 없다", async () => {
    const p = unwrap(await svc.createProduct(editor, { name: "템플릿 영향 A", generalDocumentId: GENERAL }));
    unwrap(await svc.createProduct(editor, { name: "템플릿 영향 B", generalDocumentId: GENERAL }));
    // A 는 제2조를 사본으로 두어 제1조 ①을 그대로 가리킨다 — 템플릿이 제1조 ①을 지우고 제2조를 고치면 A 의 사본만 깨진다
    const own11: ArticleNode = { ...a11(), children: [para("p11-1", "P0100", text("t11", "이 상품의 제2조 "), ref("r11", "a10", "P0100")), para("p11-2", "P0200")] };
    unwrap(await save(p.id, { copies: [copy(own11)] }));
    const next: DocumentNode = { ...template(), children: [{ ...a10(), children: [para("p10-2", "P0200")] }, fixedA11(), template().children[2]] };
    const impact = (await svc.templateImpact(GENERAL, next)).filter((c) => c.ownerName?.startsWith("템플릿 영향"));
    expect(impact).toEqual([{ document: "product", ownerId: p.id, ownerName: "템플릿 영향 A", articleId: "a11", subjectName: "제2조 ① — 없는 제1조 ①을 가리킴 · 가리키는 조를 고친다" }]);
  });

  it("사본의 새 노드가 PZ 코드가 아니면 거부 — 이미 저장된 사본의 노드는 그대로 (ADR-0081 결정 4)", async () => {
    const p = unwrap(await svc.createProduct(editor, { name: "새 코드", generalDocumentId: GENERAL }));
    // 제1조 ②만 남기고 새 항을 P0300 으로 — 템플릿이 나중에 같은 숫자 코드를 쓰면 조용히 붙는다
    const plain: ArticleNode = { ...a10(), children: [para("p10-new", "P0300"), para("p10-2", "P0200")] };
    const issues = issuesOf(await save(p.id, { copies: [copy(plain), copy(fixedA11())] }));
    expect(issues.map((i) => [i.at.articleId, i.at.nodePath?.at(-1)])).toEqual([["a10", "p10-new"]]);
    unwrap(await save(p.id, { copies: [copy(rewrittenA10()), copy(fixedA11())] }));
  });
});

