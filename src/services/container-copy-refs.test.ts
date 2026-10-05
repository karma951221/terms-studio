/**
 * ADR-0081 관통 — 조립 루트가 상품 ↔ 문서를 실제 구현으로 이었는지: 보통약관 탭 저장의 참조 무결성 검사 ·
 * 템플릿 저장의 상품 영향 확인 카드(문서 서비스 → 상품 서비스 → 문서 게이트, 한 트랜잭션 안).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ArticleNode, DocumentNode, ParagraphNode } from "@/domain/document";
import { articleHash } from "@/domain/product";
import type { Actor, Id, Rejection } from "@/domain/types";

import { createTestDb, type TestDb } from "@/db/test-utils";
import { createServices, type Services } from "./container";

const editor: Actor = { userId: "00000000-0000-4000-8000-000000000002", role: "editor" };
function unwrap<T>(r: { ok: true; value: T } | { ok: false; rejection: unknown }): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}
function rejection(r: { ok: boolean; rejection?: Rejection }): Rejection {
  if (r.ok || !r.rejection) throw new Error("기대: 거부, 실제: ok");
  return r.rejection;
}

const text = (id: string, t = "글") => ({ id, kind: "text" as const, text: t });
const para = (id: string, code: string, ...children: ParagraphNode["children"]): ParagraphNode => ({ id, kind: "paragraph", code, children: children.length > 0 ? children : [text(`${id}-t`)] });
const ref = (id: string, articleId: string, code?: string) => ({ id, kind: "articleRef" as const, scope: "self" as const, targets: [{ articleId, ...(code ? { code } : {}) }] });
const a10 = (): ArticleNode => ({ id: "a10", kind: "article", title: "지급사유", children: [para("p10-1", "P0100"), para("p10-2", "P0200")] });
const a11 = (code = "P0100"): ArticleNode => ({ id: "a11", kind: "article", title: "지급제한", children: [para("p11-1", "P0100", text("t11", "제1조에 따라 "), ref("r11", "a10", code)), para("p11-2", "P0200")] });

describe("container — ADR-0081 관통 (PGlite)", () => {
  let t: TestDb;
  let s: Services;
  let generalId: Id;

  beforeAll(async () => {
    t = await createTestDb();
    s = createServices(t.db);
    const g = unwrap(await s.document.createGeneral(editor, "관통 보통약관"));
    generalId = g.id;
    const tree: DocumentNode = { ...g.tree, children: [a10(), a11()] };
    unwrap(await s.document.importTree(editor, g.id, tree));
  });
  afterAll(async () => {
    await t.close();
  });

  it("보통약관 탭 저장 — 사본이 지운 항을 템플릿의 다른 조가 가리키면 거부, 가리키는 조도 사본으로 고치면 저장", async () => {
    const p = unwrap(await s.product.createProduct(editor, { name: "관통 상품 1", generalDocumentId: generalId }));
    const copyA10 = { articleId: "a10", article: { ...a10(), children: [para("p10-2", "P0200")] }, templateHash: articleHash(a10()) };
    const r = rejection(await s.product.saveGeneralSettings(editor, p.id, { generalDocumentId: generalId, hiddenArticles: [], overrides: [], copies: [copyA10] }));
    expect(r.reason).toBe("invalid");
    if (r.reason === "invalid") expect(r.issues.map((i) => i.message)).toEqual(["제2조 ① — 지운 제1조 ①을 가리킴 (제1조 사본에서 지움) · 가리키는 조도 사본으로 고친다"]);
    const copyA11 = { articleId: "a11", article: a11("P0200"), templateHash: articleHash(a11()) };
    unwrap(await s.product.saveGeneralSettings(editor, p.id, { generalDocumentId: generalId, hiddenArticles: [], overrides: [], copies: [copyA10, copyA11] }));
  });

  it("템플릿 저장 — 이 템플릿을 쓰는 상품에서 참조가 깨지면 확인 카드에 상품 · 자리, 확인하면 저장 · 상품은 읽기에서 깨짐을 본다", async () => {
    const p = unwrap(await s.product.createProduct(editor, { name: "관통 상품 2", generalDocumentId: generalId }));
    // 제2조를 사본으로 둔다(글만 고침) — 제1조 ①을 그대로 가리킨다
    const own11: ArticleNode = { ...a11(), children: [para("p11-1", "P0100", text("t11", "이 상품만 "), ref("r11", "a10", "P0100")), para("p11-2", "P0200")] };
    unwrap(await s.product.saveGeneralSettings(editor, p.id, { generalDocumentId: generalId, hiddenArticles: [], overrides: [], copies: [{ articleId: "a11", article: own11, templateHash: articleHash(a11()) }] }));

    // 템플릿이 제2조의 참조를 걷고 제1조 ①을 지운다 — 템플릿은 멀쩡하고 상품 2 의 사본만 깨진다
    const g = (await s.document.get(generalId))!;
    const ops = [
      { type: "remove" as const, nodeId: "r11" },
      { type: "remove" as const, nodeId: "p10-1" },
    ];
    const first = rejection(await s.document.save(editor, generalId, { baseVersion: g.version, ops }));
    expect(first.reason).toBe("needsConfirmation");
    if (first.reason === "needsConfirmation") {
      expect(first.impact.brokenRefs.filter((c) => c.document === "product").map((c) => [c.ownerName, c.articleId, c.subjectName])).toEqual([["관통 상품 2", "a11", "제2조 ① — 없는 제1조 ①을 가리킴 · 가리키는 조를 고친다"]]);
    }
    unwrap(await s.document.save(editor, generalId, { baseVersion: g.version, ops, confirm: true }));
    expect((await s.product.generalReferenceIssues(p.id)).map((i) => i.at.articleId)).toEqual(["a11"]);
    // 다음 보통약관 탭 저장은 고치기 전까지 거부된다
    expect(rejection(await s.product.saveGeneralSettings(editor, p.id, { generalDocumentId: generalId, hiddenArticles: [], overrides: [], copies: [{ articleId: "a11", article: own11, templateHash: articleHash(a11()) }] })).reason).toBe("invalid");
  });
});
