import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "@/db/test-utils";
import { countEnumValueRows } from "./refs";
import { writeSlot } from "./values";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const P3 = "33333333-3333-4333-8333-333333333333";

/** enum 을 타입으로 쓰는 마스터 자리 둘 — scalar enum 하나 · list<enum> 하나. */
const SLOTS = [
  { path: "no_surrender.type", list: false },
  { path: "waiver.reasons", list: true },
];

describe("repo/refs — enum 값 행 집계", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await writeSlot(t.db, { kind: "plan", id: P1 }, "no_surrender.type", "V02");
    await writeSlot(t.db, { kind: "plan", id: P2 }, "no_surrender.type", "V01");
    await writeSlot(t.db, { kind: "plan", id: P1 }, "waiver.reasons", ["V01", "V02"]);
    await writeSlot(t.db, { kind: "plan", id: P2 }, "waiver.reasons", ["V02"]);
    // 원래부터 명시적 빈 목록 — 그 값을 고른 적이 없으니 세지 않는다 (점검 M17)
    await writeSlot(t.db, { kind: "plan", id: P3 }, "waiver.reasons", []);
    // 자리 밖 행 — 건드리면 안 된다
    await writeSlot(t.db, { kind: "coverage", id: P1 }, "coverage_basic.claim_name", "V02");
  });
  afterAll(async () => {
    await t.close();
  });

  it("그 값을 고른 행만 센다 — scalar 는 값 일치, list<enum> 은 원소 포함, 자리 밖 행은 제외", async () => {
    expect(await countEnumValueRows(t.db, SLOTS, "V02")).toBe(3);
    expect(await countEnumValueRows(t.db, SLOTS, "V01")).toBe(2);
    expect(await countEnumValueRows(t.db, [], "V02")).toBe(0);
  });
});
