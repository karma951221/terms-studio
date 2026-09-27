import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "@/db/test-utils";
import type { Inline } from "@/domain/clause";
import type { Actor } from "@/domain/types";
import { createServices, type Services } from "@/services/container";

/**
 * 공용조항 에디터의 저장 · 생성 액션 — 저장 한 번 = 한 트랜잭션 (점검 2026-09-27 H1 · D1) · 선택지 교체 (H2 ②) ·
 * 선택지 문구(평문) · 저장하는 순간 생성 (기능/공용조항 §4.2 · §4.3).
 */
const editor: Actor = { userId: "00000000-0000-4000-8000-000000000002", role: "editor" };
let t: TestDb;
let s: Services;

vi.mock("@/lib/services", () => ({
  getServices: () => s,
  currentActor: async () => editor,
}));

const { saveClauseEditAction } = await import("./edit-actions");
const { createClauseAction } = await import("./actions");

function unwrap<T>(r: { ok: true; value: T } | { ok: false }): T {
  if (!r.ok) throw new Error("unexpected rejection");
  return r.value;
}

const text = (id: string, value: string): Inline => ({ id, kind: "text", text: value });

beforeAll(async () => {
  t = await createTestDb();
  s = createServices(t.db);
});
afterAll(async () => {
  await t.close();
});

describe("saveClauseEditAction", () => {
  it("부분 저장 없음 — 이름 · 새 옵션을 넣고 본문이 거부되면 이름 · 옵션도 남지 않고, 다시 저장해도 옵션 순번이 타지 않는다 (점검 H1)", async () => {
    const clause = unwrap(await s.clause.create(editor, { label: "청약철회", mode: "inline", body: [text("t", "철회할 수 있습니다.")] }));
    const option = { code: "new:1", label: "철회기간", values: [{ code: "new:2", label: "15일", text: "15일" }, { code: "new:3", label: "30일", text: "30일" }] };
    const broken: Inline[] = [text("t", "철회할 수 있습니다."), { id: "o", kind: "optionSlot", optionCode: "new:1" }, { id: "s", kind: "slot", ref: "D0099" }];
    const r = await saveClauseEditAction(clause.code, { label: "청약 철회", body: broken, options: [option] });
    expect(r.ok).toBe(false);
    expect(await s.clause.get(clause.code)).toEqual(clause);

    // 본문을 고쳐 다시 저장 — 첫 시도가 옵션을 만들었다 지웠다면 O02 가 됐을 것
    const fixed: Inline[] = [text("t", "철회할 수 있습니다."), { id: "o", kind: "optionSlot", optionCode: "new:1" }];
    expect(await saveClauseEditAction(clause.code, { label: "청약 철회", body: fixed, options: [option] })).toEqual({ ok: true, code: clause.code });
    const saved = (await s.clause.get(clause.code))!;
    expect(saved.options.map((o) => o.code)).toEqual(["O01"]);
    expect(saved.body).toEqual([text("t", "철회할 수 있습니다."), { id: "o", kind: "optionSlot", optionCode: "O01" }]);
    expect(saved.options[0]!.values.map((v) => v.body.map((n) => (n.kind === "text" ? n.text : "")).join(""))).toEqual(["15일", "30일"]);
  });

  it("선택지 2개인 옵션에서 하나를 ✕ 하고 새 선택지를 더하면(최종 2개) 저장된다 — 추가 → 이름 · 문구 → 삭제 순 (점검 H2 ②)", async () => {
    const created = unwrap(
      await s.clause.create(editor, {
        label: "보험금 지급기일",
        mode: "inline",
        body: [text("t", "지급기일은 "), { id: "o", kind: "optionSlot", optionCode: "O01" }],
        options: [{ label: "기일", values: [{ label: "3영업일" }, { label: "7영업일" }] }],
      }),
    );
    const [, second] = created.options[0]!.values;
    const r = await saveClauseEditAction(created.code, {
      label: created.label,
      body: created.body,
      options: [{ code: "O01", label: "지급기일", values: [{ code: second!.code, label: "7영업일", text: "7영업일 이내" }, { code: "new:1", label: "10영업일", text: "10영업일 이내" }] }],
    });
    expect(r).toEqual({ ok: true, code: created.code });
    const saved = (await s.clause.get(created.code))!.options[0]!;
    expect(saved.label).toBe("지급기일");
    expect(saved.values.map((v) => v.label)).toEqual(["7영업일", "10영업일"]);
    expect(saved.values.map((v) => (v.body[0]?.kind === "text" ? v.body[0].text : ""))).toEqual(["7영업일 이내", "10영업일 이내"]);
  });
});

describe("createClauseAction — 저장하는 순간 생성", () => {
  it("본문 · 새 옵션(선택지 문구 포함)을 한 번에 — 옵션 자리의 new:* 는 채번된 코드로", async () => {
    const r = await createClauseAction({
      label: "준용규정(신규)",
      mode: "block",
      body: [{ id: "p", kind: "paragraph", children: [text("t", "이 특별약관에 정하지 않은 사항은 "), { id: "o", kind: "optionSlot", optionCode: "new:4" }] }],
      options: [{ code: "new:4", label: "따를 약관", values: [{ code: "new:5", label: "보통약관", text: "보통약관" }, { code: "new:6", label: "주계약", text: "주계약 약관" }] }],
    });
    expect(r.ok).toBe(true);
    const saved = r.ok ? await s.clause.get(r.code) : undefined;
    expect(saved?.mode).toBe("block");
    expect(JSON.stringify(saved?.body)).toContain('"optionCode":"O01"');
    expect(saved?.options[0]?.values[1]?.body).toMatchObject([{ kind: "text", text: "주계약 약관" }]);
  });

  it("검사 ① 실패면 아무것도 만들지 않고 사유와 고칠 자리를 돌려준다", async () => {
    const before = (await s.clause.list()).length;
    const r = await createClauseAction({ label: "깨진 공용조항", mode: "inline", body: [{ id: "x", kind: "optionSlot", optionCode: "O09" }], options: [] });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issues?.[0]?.at.nodePath).toEqual(["x"]);
    expect((await s.clause.list()).length).toBe(before);
  });
});
