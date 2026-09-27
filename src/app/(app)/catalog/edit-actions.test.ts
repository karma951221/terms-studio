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
    const def = unwrap(await s.catalog.create(editor, { label: "면책여부", level: "benefit", expression: "any(pay.exempt)" }));
    const r = await saveDiscriminatorEditAction(def.code, { label: "면책 여부", description: "메모", expression: "any(pay.exempt", resultTypeKind: "", resultTypeMulti: false, resultTypeEnum: "" });
    expect(r.ok).toBe(false);
    expect(await s.catalog.get(def.code)).toEqual(def);
  });

  it("결과 타입과 식을 함께 고칠 때 식이 순환으로 거부되면 — 먼저 해제한 명시 타입도 되살아 있다", async () => {
    const def = unwrap(await s.catalog.create(editor, { label: "면책구분", level: "benefit", expression: "any(pay.exempt)", resultType: { kind: "boolean" } }));
    // 해제 → 식 → 지정 순서 (resultTypeSavePlan clearThenSet). 식이 자기 참조라 「식 저장」 단계에서 거부된다.
    const r = await saveDiscriminatorEditAction(def.code, { label: "면책구분", description: "", expression: `${def.code} and any(pay.exempt)`, resultTypeKind: "", resultTypeMulti: false, resultTypeEnum: "" });
    expect(r.ok).toBe(false);
    expect(await s.catalog.get(def.code)).toEqual(def);
  });
});
