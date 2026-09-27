import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "@/db/test-utils";
import { reject, type Actor } from "@/domain/types";
import { createServices, type Services } from "@/services/container";

/**
 * 별표 상세 저장 액션 — 저장 한 번 = 한 트랜잭션 (점검 2026-09-27 H1 · D1).
 * 주석 저장은 도메인에서 거부될 일이 없어, 둘째 단계 거부는 서비스를 바꿔 끼워 흉내 낸다 (첫 단계 이름 저장은 실제 서비스).
 */
const editor: Actor = { userId: "00000000-0000-4000-8000-000000000002", role: "editor" };
let t: TestDb;
let s: Services;

vi.mock("@/lib/services", () => ({
  getServices: () => s,
  currentActor: async () => editor,
}));

const { saveAppendixEditAction } = await import("./edit-actions");

function unwrap<T>(r: { ok: true; value: T } | { ok: false }): T {
  if (!r.ok) throw new Error("unexpected rejection");
  return r.value;
}

describe("saveAppendixEditAction — 부분 저장 없음", () => {
  beforeAll(async () => {
    t = await createTestDb();
    s = createServices(t.db);
  });
  afterAll(async () => {
    await t.close();
  });

  it("이름을 바꾼 뒤 주석 단계가 거부되면 이름도 저장되지 않는다", async () => {
    const appendix = unwrap(await s.document.createAppendix(editor, { name: "장해분류표", description: "" }));
    const real = s;
    s = { ...real, document: { ...real.document, setAppendixDescription: async () => reject({ reason: "invalid", issues: [{ kind: "typeMismatch", message: "주석 거부", at: {} }] }) } };
    try {
      const r = await saveAppendixEditAction(appendix.code, { name: "장해 분류표", description: "메모" });
      expect(r).toEqual({ ok: false, message: "주석 거부" });
      expect(await real.document.getAppendix(appendix.code)).toEqual(appendix);
    } finally {
      s = real;
    }
  });

  it("거부가 없으면 이름 · 주석이 함께 저장된다", async () => {
    const appendix = unwrap(await s.document.createAppendix(editor, { name: "수술분류표", description: "" }));
    expect(await saveAppendixEditAction(appendix.code, { name: "수술 분류표", description: "메모" })).toEqual({ ok: true });
    expect(await s.document.getAppendix(appendix.code)).toMatchObject({ name: "수술 분류표", description: "메모" });
  });
});
