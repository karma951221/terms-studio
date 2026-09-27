import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "../test-utils";
import {
  copySlots,
  countPathRows,
  purgePathRows,
  readSlots,
  readSlotsMany,
  valuesImpactSource,
  writeSlot,
  type ValueOwner,
} from "./values";

describe("entity_values — 실체 × 마스터 필드 값 자리 (공용 값 저장소)", () => {
  let t: TestDb;
  const cov: ValueOwner = { kind: "coverage", id: "11111111-1111-4111-8111-111111111111" };
  const pc: ValueOwner = { kind: "productCoverage", id: "22222222-2222-4222-8222-222222222222" };

  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("값 자리는 쓰기 전엔 비어 있다 — 미입력은 행 없음이다", async () => {
    const slots = await readSlots(t.db, cov);
    expect(slots.size).toBe(0);
  });

  it("명시 입력한 값은 마스터 경로로 읽힌다", async () => {
    await writeSlot(t.db, cov, "waiver.applies", true);
    await writeSlot(t.db, cov, "pay.rate", 50);
    const slots = await readSlots(t.db, cov);
    expect(slots.get("waiver.applies")).toEqual({ entered: true, value: true });
    expect(slots.get("pay.rate")).toEqual({ entered: true, value: 50 });
  });

  it("같은 자리에 다시 쓰면 덮어쓴다 (행 1개 유지)", async () => {
    await writeSlot(t.db, cov, "waiver.applies", false);
    const slots = await readSlots(t.db, cov);
    expect(slots.get("waiver.applies")).toEqual({ entered: true, value: false });
    expect(slots.size).toBe(2);
  });

  it("값 지우기 = 행 삭제 → 다시 미입력", async () => {
    await writeSlot(t.db, cov, "pay.rate", undefined);
    const slots = await readSlots(t.db, cov);
    expect(slots.has("pay.rate")).toBe(false);
  });

  it("탑재 스냅샷: 한 소유자의 값 자리를 다른 소유자로 복사한다 (미입력은 복사할 게 없다)", async () => {
    await writeSlot(t.db, cov, "pay.rate", 70);
    const copied = await copySlots(t.db, cov, pc);
    expect(copied).toBe(2);
    const slots = await readSlots(t.db, pc);
    expect(slots.get("waiver.applies")).toEqual({ entered: true, value: false });
    // 이후 마스터 변경은 스냅샷에 영향 없음
    await writeSlot(t.db, cov, "pay.rate", 99);
    expect((await readSlots(t.db, pc)).get("pay.rate")).toEqual({ entered: true, value: 70 });
  });

  it("경로 단위로 값 행을 세고 지운다 — enum 삭제 영향의 재료", async () => {
    expect(await countPathRows(t.db, ["waiver.applies"])).toBe(2);
    expect(await countPathRows(t.db, [])).toBe(0);
    await purgePathRows(t.db, ["waiver.applies"]);
    expect((await readSlots(t.db, cov)).has("waiver.applies")).toBe(false);
    expect((await readSlots(t.db, pc)).has("waiver.applies")).toBe(false);
    expect((await readSlots(t.db, pc)).has("pay.rate")).toBe(true);
  });

  it("readSlotsMany — 소유자 순서는 요청 순, 자리 순서는 경로 순 (쓴 순서와 무관 · 조립 결정성의 재료, ADR-0034 결정 4)", async () => {
    const a: ValueOwner = { kind: "productBenefit", id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
    const b: ValueOwner = { kind: "productBenefit", id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
    // 경로 역순 · 소유자 역순으로 쓴다
    await writeSlot(t.db, b, "pay.rate", 30);
    await writeSlot(t.db, b, "pay.exempt", true);
    await writeSlot(t.db, a, "pay.rate", 50);
    await writeSlot(t.db, a, "exemption.months", 3);
    await writeSlot(t.db, a, "pay.exempt", false);
    const many = await readSlotsMany(t.db, "productBenefit", [b.id, a.id]);
    expect([...many.keys()]).toEqual([b.id, a.id]);
    expect([...many.get(a.id)!.keys()]).toEqual(["exemption.months", "pay.exempt", "pay.rate"]);
    expect([...many.get(b.id)!.keys()]).toEqual(["pay.exempt", "pay.rate"]);
    expect(many.get(a.id)!.get("pay.rate")).toEqual({ entered: true, value: 50 });
  });

  it("구분자 삭제는 값 행을 지우지 않는다 — 구분자는 식이라 값이 없다 (ADR-0037)", async () => {
    const src = valuesImpactSource(t.db);
    expect(await src.countValueRows({ kind: "discriminator", code: "D0001" })).toBe(0);
    await src.purgeValueRows({ kind: "discriminator", code: "D0001" });
    expect((await readSlots(t.db, pc)).has("pay.rate")).toBe(true);
  });
});
