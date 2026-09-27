import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "@/db/test-utils";
import type { Actor } from "@/domain/types";
import { createServices, type Services } from "@/services/container";

/**
 * 열거형변수 편집 저장 액션 — 화면이 보낸 값 표 순서가 DB 에 그대로 남는지 (코덱스 리뷰 2026-09-14 Important-4).
 * `@/lib/services` 를 인메모리 PGlite 서비스 + 고정 편집자로 바꿔 끼운다 — 서버 액션의 로직만 본다.
 */
const editor: Actor = { userId: "00000000-0000-4000-8000-000000000002", role: "editor" };
let t: TestDb;
let s: Services;

vi.mock("@/lib/services", () => ({
  getServices: () => s,
  currentActor: async () => editor,
}));

const { saveEnumEditAction } = await import("./edit-actions");

function unwrap<T>(r: { ok: true; value: T } | { ok: false }): T {
  if (!r.ok) throw new Error("unexpected rejection");
  return r.value;
}

describe("saveEnumEditAction", () => {
  beforeAll(async () => {
    t = await createTestDb();
    s = createServices(t.db);
  });
  afterAll(async () => {
    await t.close();
  });

  it("새 값을 첫 행 · 중간으로 옮긴 순서가 저장된다 — 발급 코드로 바꿔 제출 순서 그대로 정렬", async () => {
    const def = unwrap(await s.catalog.createEnum(editor, { label: "심사유형", values: [{ label: "A" }, { label: "B" }] }));
    const [a, b] = def.values.map((v) => v.code);
    const r = await saveEnumEditAction(def.code, {
      label: "심사유형",
      description: "",
      values: [
        { code: "new:1", label: "C" },
        { code: a!, label: "A" },
        { code: "new:2", label: "D" },
        { code: b!, label: "B" },
      ],
    });
    expect(r).toEqual({ ok: true });
    const saved = await s.catalog.getEnum(def.code);
    expect(saved?.values.map((v) => v.label)).toEqual(["C", "A", "D", "B"]);
    // 새 값 둘은 발급 코드(V03 · V04)를 받았고 이름은 바꾸지 않았다
    expect(saved?.values.filter((v) => !v.code.startsWith("new:")).length).toBe(4);
  });
});
