import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "@/db/test-utils";
import type { Actor } from "@/domain/types";
import { createServices, type Services } from "@/services/container";

/**
 * 구분자 상세 저장 액션 — 저장 한 번 = 한 트랜잭션 (점검 2026-09-27 H1 · D1). 중간 단계가 거부되면 앞 단계도 남지 않는다.
 */
const editor: Actor = { userId: "00000000-0000-4000-8000-000000000002", role: "editor" };
let t: TestDb;
let s: Services;

vi.mock("@/lib/services", () => ({
  getServices: () => s,
  currentActor: async () => editor,
}));

const { saveDiscriminatorEditAction } = await import("./edit-actions");

function unwrap<T>(r: { ok: true; value: T } | { ok: false }): T {
  if (!r.ok) throw new Error("unexpected rejection");
  return r.value;
}

describe("saveDiscriminatorEditAction — 부분 저장 없음", () => {
  beforeAll(async () => {
    t = await createTestDb();
    s = createServices(t.db);
  });
  afterAll(async () => {
    await t.close();
  });

  it("구분자명 · 주석을 바꾸고 식이 거부되면 구분자명 · 주석도 저장되지 않는다", async () => {
    const def = unwrap(await s.catalog.create(editor, { label: "면책여부", level: "benefit", expression: "any(pay.exempt)", resultType: { kind: "boolean" } }));
    const r = await saveDiscriminatorEditAction(def.code, { label: "면책 여부", description: "메모", expression: "any(pay.exempt", resultTypeKind: "boolean", resultTypeMulti: false, resultTypeEnum: "" });
    expect(r.ok).toBe(false);
    expect(await s.catalog.get(def.code)).toEqual(def);
  });

  it("결과 타입과 식을 함께 고칠 때 식이 순환으로 거부되면 — 구분자명 · 결과 타입 모두 그대로다", async () => {
    const def = unwrap(await s.catalog.create(editor, { label: "면책구분", level: "benefit", expression: "any(pay.exempt)", resultType: { kind: "boolean" } }));
    const r = await saveDiscriminatorEditAction(def.code, { label: "면책구분2", description: "", expression: `${def.code} and any(pay.exempt)`, resultTypeKind: "number", resultTypeMulti: false, resultTypeEnum: "" });
    expect(r.ok).toBe(false);
    expect(await s.catalog.get(def.code)).toEqual(def);
  });

  it("식과 결과 타입을 함께 바꾸면 한 번에 저장된다 — 해제 단계 없이 새 식 · 새 타입을 서로 대조한다", async () => {
    const def = unwrap(await s.catalog.create(editor, { label: "면책월수", level: "benefit", expression: "reduction.new_only", resultType: { kind: "boolean" } }));
    const r = await saveDiscriminatorEditAction(def.code, { label: "면책월수", description: "", expression: "exemption.months", resultTypeKind: "number", resultTypeMulti: false, resultTypeEnum: "" });
    expect(r).toEqual({ ok: true });
    expect(await s.catalog.get(def.code)).toMatchObject({ expression: "exemption.months", resultType: { kind: "number" } });
  });

  it("결과 타입을 비워 저장하면 거부 — 필수다 (폼 변조 · 추론 실패로 빈 셀렉트)", async () => {
    const def = unwrap(await s.catalog.create(editor, { label: "빈타입", level: "benefit", expression: "reduction.new_only", resultType: { kind: "boolean" } }));
    const r = await saveDiscriminatorEditAction(def.code, { label: "빈타입2", description: "", expression: "reduction.new_only", resultTypeKind: "", resultTypeMulti: false, resultTypeEnum: "" });
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining("결과 타입을 고르세요") });
    expect(await s.catalog.get(def.code)).toEqual(def);
  });
});
