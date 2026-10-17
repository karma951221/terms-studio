import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dynTableFixtureA, dynTableFixtureR } from "@/domain/dyntable";

import { createTestDb, type TestDb } from "../test-utils";
import { allocateDynTableCode, deleteDynTable, getDynTable, insertDynTable, listDynTables, nextDynTableSeq, updateDynTable } from "./dyntable";

const who = "00000000-0000-4000-8000-000000000001";

describe("dyn_tables repo (PGlite)", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("순번은 1부터 오르고 코드는 DT + 6자리", async () => {
    expect(await nextDynTableSeq(t.db)).toBe(1);
    expect(await nextDynTableSeq(t.db)).toBe(2);
    expect(await allocateDynTableCode(t.db)).toBe("DT000003");
  });

  it("insert → get → list → update → delete", async () => {
    const a = await insertDynTable(t.db, "DT000001", dynTableFixtureA(), who);
    expect(a.code).toBe("DT000001");
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.updatedBy).toBe(who);

    const got = await getDynTable(t.db, "DT000001");
    expect(got?.label).toBe("감액 지급금액 표");
    expect(got?.params).toEqual([{ name: "갱신형", type: { kind: "boolean" } }]);
    expect(got?.headers.first).toEqual(dynTableFixtureA().headers.first);
    expect(got?.cell).toEqual(dynTableFixtureA().cell);

    await insertDynTable(t.db, "DT000002", dynTableFixtureR(), who);
    expect((await listDynTables(t.db)).map((d) => d.code)).toEqual(["DT000001", "DT000002"]);

    const r = await updateDynTable(t.db, "DT000002", { ...dynTableFixtureR(), label: "(갱신) 표" }, who);
    expect(r.label).toBe("(갱신) 표");
    expect(r.columnBasis).toBe("none");

    await deleteDynTable(t.db, "DT000001");
    expect((await listDynTables(t.db)).map((d) => d.code)).toEqual(["DT000002"]);
    expect(await getDynTable(t.db, "DT000001")).toBeUndefined();
  });

  it("없는 코드의 update 는 던진다", async () => {
    await expect(updateDynTable(t.db, "DT999999", dynTableFixtureR(), who)).rejects.toThrow("DT999999");
  });
});
