import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "@/db/test-utils";
import type { Actor } from "@/domain/types";
import { createServices, type Services } from "@/services/container";

/**
 * 담보속성 상세 저장 액션 — 저장 한 번 = 한 트랜잭션 (점검 2026-09-27 H1 · D1) · 값 행 삭제는 저장 때 확인 (H5 · D2).
 * `@/lib/services` 를 인메모리 PGlite 서비스 + 바꿔 끼울 수 있는 actor 로 대체한다.
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

const { saveAttributeEditAction } = await import("./edit-actions");

function unwrap<T>(r: { ok: true; value: T } | { ok: false }): T {
  if (!r.ok) throw new Error("unexpected rejection");
  return r.value;
}

async function kindWith(label: string, values: string[]) {
  let kind = unwrap(await s.product.createAttributeKind(editor, { label }));
  for (const value of values) kind = unwrap(await s.product.addAttributeValue(editor, kind.code, { label: value, fragment: "" }));
  return kind;
}

describe("saveAttributeEditAction", () => {
  beforeAll(async () => {
    t = await createTestDb();
    s = createServices(t.db);
  });
  afterAll(async () => {
    await t.close();
  });

  it("부분 저장 없음 — 종류명을 바꾸고 새 값이 기존 값과 겹치면 종류명 · 상품담보명 표기도 저장되지 않는다 (점검 H1)", async () => {
    actor = editor;
    const kind = await kindWith("갱신유형", ["갱신형", "비갱신형"]);
    const [a, b] = kind.values;
    const r = await saveAttributeEditAction(kind.code, {
      label: "갱신 유형",
      values: [{ code: a!.code, label: "갱신형", fragment: "(갱신)" }, { code: b!.code, label: "비갱신형", fragment: "" }, { code: "new:1", label: "갱신형", fragment: "" }],
    });
    expect(r.ok).toBe(false);
    expect(await s.product.getAttributeKind(kind.code)).toEqual(kind);
  });

  it("유효값 이름 A↔B 맞바꾸기가 저장된다 — 최종 한 벌 검사", async () => {
    actor = editor;
    const kind = await kindWith("납입유형", ["전기납", "단기납"]);
    const [a, b] = kind.values;
    expect(await saveAttributeEditAction(kind.code, { label: "납입유형", values: [{ code: a!.code, label: "단기납", fragment: "" }, { code: b!.code, label: "전기납", fragment: "" }] })).toEqual({ ok: true });
    expect((await s.product.getAttributeKind(kind.code))?.values.map((v) => [v.code, v.label])).toEqual([[a!.code, "단기납"], [b!.code, "전기납"]]);
  });

  it("값 행 삭제는 초안에서 빠지고 저장 때 확인 — 1차는 아무것도 저장 안 됨 · 확인하면 이름 · 새 값과 함께 (점검 H5 · D2)", async () => {
    actor = admin;
    const kind = await kindWith("보장유형", ["기본형", "확장형", "실속형"]);
    const [a, b] = kind.values;
    const input = { label: "보장 유형", values: [{ code: b!.code, label: "확장형", fragment: "" }, { code: a!.code, label: "표준형", fragment: "" }, { code: "new:1", label: "고급형", fragment: "" }] };
    const first = await saveAttributeEditAction(kind.code, input);
    expect(first.ok).toBe("confirm");
    if (first.ok === "confirm") expect(first.actionLabel).toBe("값 1개 삭제하고 저장");
    expect(await s.product.getAttributeKind(kind.code)).toEqual(kind);

    expect(await saveAttributeEditAction(kind.code, input, true)).toEqual({ ok: true });
    const saved = await s.product.getAttributeKind(kind.code);
    expect(saved?.label).toBe("보장 유형");
    // 순서 = 코드 순 — 표에 넘긴 차례가 아니다. 새 값은 지운 3 을 다시 쓰지 않고 4.
    expect(saved?.values.map((v) => [v.code, v.label])).toEqual([["1", "표준형"], ["2", "확장형"], ["4", "고급형"]]);
  });

  it("「+ 값 추가」로 만들고 비워 둔 새 행은 저장에서 빠진다 — 빈 이름 오류로 막지 않는다", async () => {
    actor = editor;
    const kind = await kindWith("심사유형", ["일반심사"]);
    const [a] = kind.values;
    const r = await saveAttributeEditAction(kind.code, {
      label: "심사유형",
      values: [{ code: a!.code, label: "일반심사", fragment: "" }, { code: "new:1", label: "간편심사", fragment: "간편" }, { code: "new:2", label: " ", fragment: "" }],
    });
    expect(r).toEqual({ ok: true });
    expect((await s.product.getAttributeKind(kind.code))?.values).toEqual([
      { code: "1", label: "일반심사", fragment: "" },
      { code: "2", label: "간편심사", fragment: "간편" },
    ]);
  });

  it("편집자가 값 행을 빼고 저장하면 역할로 거부 — 나머지 변경도 저장되지 않는다", async () => {
    actor = editor;
    const kind = await kindWith("가입유형", ["일반", "간편"]);
    const [a] = kind.values;
    const r = await saveAttributeEditAction(kind.code, { label: "가입 유형", values: [{ code: a!.code, label: "일반", fragment: "(일반)" }] }, true);
    expect(r.ok).toBe(false);
    expect(await s.product.getAttributeKind(kind.code)).toEqual(kind);
  });
});
