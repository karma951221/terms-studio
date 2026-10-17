import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "@/db/test-utils";
import { insertDocument } from "@/db/repo/document";
import { nodeBuilders } from "@/domain/document";
import type { Actor } from "@/domain/types";
import { createServices, type Services } from "@/services/container";

/**
 * 「템플릿 바꾸기…」 고르기 줄의 액션 (기능/상품 §4.6) — 잃을 것이 있으면 관리자만(2026-10-17).
 * 편집자의 거부는 고르기 줄 아래에 보이도록 문장으로 돌려준다(주소를 옮기지 않는다). 확인이 필요하면 확인 카드 주소로 보낸다.
 */
const admin: Actor = { userId: "00000000-0000-4000-8000-000000000001", role: "admin" };
const editor: Actor = { userId: "00000000-0000-4000-8000-000000000002", role: "editor" };
let actor: Actor = editor;
let t: TestDb;
let s: Services;

vi.mock("@/lib/services", () => ({
  getServices: () => s,
  currentActor: async () => actor,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

const { pickProductGeneralDocumentAction } = await import("./actions");

function form(generalDocumentId: string): FormData {
  const fd = new FormData();
  fd.set("generalDocumentId", generalDocumentId);
  return fd;
}

describe("pickProductGeneralDocumentAction", () => {
  let productId: string;
  let first: string;
  let second: string;
  let articleId: string;

  beforeAll(async () => {
    t = await createTestDb();
    s = createServices(t.db);
    const b = nodeBuilders();
    const article = b.article("목적", [b.paragraph([b.text("본문")])]);
    articleId = article.id;
    first = (await insertDocument(t.db, { kind: "general", title: "템플릿 갑", tree: b.document("템플릿 갑", [article]) }, admin.userId)).id;
    second = (await insertDocument(t.db, { kind: "general", title: "템플릿 을", tree: b.document("템플릿 을", [b.article("목적", [b.paragraph([b.text("본문")])])]) }, admin.userId)).id;
    const product = await s.product.createProduct(admin, { name: "고르기 액션 상품", generalDocumentId: first });
    if (!product.ok) throw new Error("상품 생성 실패");
    productId = product.value.id;
    const hidden = await s.product.setArticleHidden(admin, productId, articleId, true);
    if (!hidden.ok) throw new Error("조 숨김 실패");
  });
  afterAll(async () => {
    await t.close();
  });

  it("편집자 — 잃을 것이 있으면 바꾸지 않고 문장을 돌려준다(교체 · 해제)", async () => {
    actor = editor;
    expect(await pickProductGeneralDocumentAction(productId, {}, form(second))).toEqual({ message: "템플릿 교체는 관리자만 할 수 있습니다 — 숨긴 조 1 가 초기화됩니다" });
    expect(await pickProductGeneralDocumentAction(productId, {}, form(""))).toEqual({ message: "템플릿 해제는 관리자만 할 수 있습니다 — 숨긴 조 1 가 초기화됩니다" });
    expect((await s.product.getProduct(productId))?.generalDocumentId).toBe(first);
  });

  it("관리자 — 잃을 것이 있으면 확인 카드 주소로 보낸다", async () => {
    actor = admin;
    await expect(pickProductGeneralDocumentAction(productId, {}, form(second))).rejects.toThrow(`REDIRECT /products/${productId}?tab=general&confirm=template:${second}`);
    expect((await s.product.getProduct(productId))?.generalDocumentId).toBe(first);
  });

  it("잃을 것이 없으면 편집자도 바꾸고 보통약관 탭으로 돌아간다", async () => {
    actor = editor;
    unwrapOk(await s.product.setArticleHidden(admin, productId, articleId, false));
    await expect(pickProductGeneralDocumentAction(productId, {}, form(second))).rejects.toThrow(`REDIRECT /products/${productId}?tab=general`);
    expect((await s.product.getProduct(productId))?.generalDocumentId).toBe(second);
  });
});

function unwrapOk(r: { ok: boolean }): void {
  if (!r.ok) throw new Error("unexpected rejection");
}
