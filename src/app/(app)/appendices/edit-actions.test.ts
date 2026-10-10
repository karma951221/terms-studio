import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "@/db/test-utils";
import type { Actor } from "@/domain/types";
import { createServices, type Services } from "@/services/container";

/**
 * 별표 상세 저장 액션 — 저장 한 번 = 한 트랜잭션 (점검 2026-09-27 H1 · D1).
 * 별표가 들고 다니는 값은 이름 하나다 (주석 폐지 2026-10-10, 기능/별표 §6.2).
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

describe("saveAppendixEditAction", () => {
  beforeAll(async () => {
    t = await createTestDb();
    s = createServices(t.db);
  });
  afterAll(async () => {
    await t.close();
  });

  it("이름을 저장한다 — 들고 오는 값에 주석이 없다", async () => {
    const appendix = unwrap(await s.document.createAppendix(editor, { name: "수술분류표" }));
    expect(appendix).toEqual({ code: appendix.code, name: "수술분류표" });
    expect(await saveAppendixEditAction(appendix.code, { name: "수술 분류표" })).toEqual({ ok: true });
    expect(await s.document.getAppendix(appendix.code)).toEqual({ code: appendix.code, name: "수술 분류표" });
  });

  it("빈 이름은 거부하고 저장값을 그대로 둔다", async () => {
    const appendix = unwrap(await s.document.createAppendix(editor, { name: "장해분류표" }));
    const r = await saveAppendixEditAction(appendix.code, { name: "  " });
    expect(r.ok).toBe(false);
    expect(await s.document.getAppendix(appendix.code)).toEqual(appendix);
  });
});
