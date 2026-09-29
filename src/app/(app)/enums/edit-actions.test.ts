import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "@/db/test-utils";
import type { Actor } from "@/domain/types";
import { createServices, type Services } from "@/services/container";

/**
 * 열거형변수 편집 저장 액션 — 화면이 보낸 값 표 순서가 DB 에 그대로 남는지 (코덱스 리뷰 2026-09-14 Important-4).
 * `@/lib/services` 를 인메모리 PGlite 서비스 + 고정 편집자로 바꿔 끼운다 — 서버 액션의 로직만 본다.
 */
const admin: Actor = { userId: "00000000-0000-4000-8000-000000000001", role: "admin" };
const editor: Actor = { userId: "00000000-0000-4000-8000-000000000002", role: "editor" };
let t: TestDb;
let s: Services;
let actor: Actor = editor;

vi.mock("@/lib/services", () => ({
  getServices: () => s,
  currentActor: async () => actor,
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

  it("부분 저장 없음 — 이름을 바꾸고 값 이름이 최종 상태에서 겹치면 이름도 저장되지 않는다 (점검 H1)", async () => {
    actor = editor;
    const def = unwrap(await s.catalog.createEnum(editor, { label: "직업급수", values: [{ label: "1급" }, { label: "2급" }] }));
    const [a, b] = def.values.map((v) => v.code);
    const r = await saveEnumEditAction(def.code, { label: "직업 급수", description: "메모", values: [{ code: a!, label: "2급" }, { code: b!, label: "2급" }, { code: "new:1", label: "3급" }] });
    expect(r.ok).toBe(false);
    expect(await s.catalog.getEnum(def.code)).toEqual(def);
  });

  it("값 이름 A↔B 맞바꾸기 · 다른 값이 비우는 이름 받기가 저장된다 — 최종 한 벌 검사 (점검 H2 ①)", async () => {
    actor = editor;
    const def = unwrap(await s.catalog.createEnum(editor, { label: "납입주기", values: [{ label: "월납" }, { label: "연납" }, { label: "일시납" }] }));
    const [a, b, c] = def.values.map((v) => v.code);
    expect(await saveEnumEditAction(def.code, { label: "납입주기", description: "", values: [{ code: a!, label: "연납" }, { code: b!, label: "월납" }, { code: c!, label: "일시납" }] })).toEqual({ ok: true });
    expect((await s.catalog.getEnum(def.code))?.values.map((v) => [v.code, v.label])).toEqual([[a, "연납"], [b, "월납"], [c, "일시납"]]);
    // c 가 「일시납」을 비우고 새 값이 그 이름을 받는다
    expect(await saveEnumEditAction(def.code, { label: "납입주기", description: "", values: [{ code: a!, label: "연납" }, { code: b!, label: "월납" }, { code: c!, label: "일시납(폐지)" }, { code: "new:1", label: "일시납" }] })).toEqual({ ok: true });
    expect((await s.catalog.getEnum(def.code))?.values.map((v) => v.label)).toEqual(["연납", "월납", "일시납(폐지)", "일시납"]);
  });

  it("값 행 삭제는 초안에 담겨 저장 때 반영 — 1차는 영향 확인만(아무것도 저장 안 됨) · 확인하면 이름 · 새 값과 함께 한 번에 (점검 H5 · D2)", async () => {
    actor = admin;
    const def = unwrap(await s.catalog.createEnum(editor, { label: "심사구분", values: [{ label: "표준" }, { label: "간편" }, { label: "무심사" }] }));
    const [a, b] = def.values.map((v) => v.code);
    const input = { label: "심사 구분", description: "", values: [{ code: "new:1", label: "우량" }, { code: b!, label: "간편" }, { code: a!, label: "표준체" }] };
    const first = await saveEnumEditAction(def.code, input);
    expect(first.ok).toBe("confirm");
    if (first.ok === "confirm") {
      expect(first.actionLabel).toBe("값 1개 삭제하고 저장");
      expect(first.impact.valueRowsLost).toBe(0);
      // 값 행은 지우지 않는다 — 「없는 값」 오류로 남는다 (ADR-0078 결정 5)
      expect(first.title).toBe("값을 빼면 그 값을 고른 자리가 「없는 값」 오류가 된다");
      expect(first.valueRowsLine).toBe("그 값을 고른 저장 값 0건이 「없는 값」 오류로 남는다");
    }
    expect(await s.catalog.getEnum(def.code)).toEqual(def);

    expect(await saveEnumEditAction(def.code, input, true)).toEqual({ ok: true });
    expect((await s.catalog.getEnum(def.code))?.values.map((v) => v.label)).toEqual(["우량", "간편", "표준체"]);
    expect((await s.catalog.getEnum(def.code))?.label).toBe("심사 구분");
  });

  it("편집자가 값 행을 빼고 저장하면 역할로 거부 — 이름 · 새 값도 저장되지 않는다", async () => {
    actor = editor;
    const def = unwrap(await s.catalog.createEnum(editor, { label: "가입형태", values: [{ label: "개인" }, { label: "단체" }] }));
    const [a] = def.values.map((v) => v.code);
    const r = await saveEnumEditAction(def.code, { label: "가입 형태", description: "", values: [{ code: a!, label: "개인" }, { code: "new:1", label: "법인" }] }, true);
    expect(r.ok).toBe(false);
    expect(await s.catalog.getEnum(def.code)).toEqual(def);
  });
});
