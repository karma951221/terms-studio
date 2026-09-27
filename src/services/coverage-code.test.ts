/**
 * 담보코드 채번 — 서비스 · 저장소 끝까지 (기능/담보 §3.1, 2026-09-27).
 * 순차 · 불변(이름 · 구조 저장 뒤에도) · 거절은 순번을 안 태움 · 삭제된 코드는 다시 안 태어남 · DB 유일 제약.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { structureDraftOf } from "@/domain/coverage";
import type { Actor } from "@/domain/types";

import { coverages } from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/test-utils";
import { createCoverageService, type CoverageService } from "./coverage";

const admin: Actor = { userId: "00000000-0000-4000-8000-000000000001", role: "admin" };
const editor: Actor = { userId: "00000000-0000-4000-8000-000000000002", role: "editor" };

function unwrap<T>(r: { ok: true; value: T } | { ok: false; rejection: unknown }): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

describe("담보코드 채번 (PGlite)", () => {
  let t: TestDb;
  let svc: CoverageService;

  beforeAll(async () => {
    t = await createTestDb();
    svc = createCoverageService(t.db);
  });
  afterAll(async () => {
    await t.close();
  });

  it("만드는 순서대로 COV000001 · COV000002 — 조회 · 목록 요약에도 실린다", async () => {
    const a = unwrap(await svc.create(editor, { name: "나 담보" }));
    const b = unwrap(await svc.create(editor, { name: "가 담보" }));
    expect([a.code, b.code]).toEqual(["COV000001", "COV000002"]);
    expect((await svc.get(a.id))?.code).toBe("COV000001");
    // 목록은 이름순이지만 코드는 만든 순서다
    expect((await svc.listSummaries()).map((s) => [s.name, s.code])).toEqual([
      ["가 담보", "COV000002"],
      ["나 담보", "COV000001"],
    ]);
  });

  it("거절된 생성(중복 이름)은 순번을 태우지 않는다", async () => {
    expect((await svc.create(editor, { name: "가 담보" })).ok).toBe(false);
    const c = unwrap(await svc.create(editor, { name: "다 담보" }));
    expect(c.code).toBe("COV000003");
  });

  it("이름 · 구조를 저장해도 코드는 그대로다 (불변)", async () => {
    const c = (await svc.list()).find((x) => x.name === "다 담보")!;
    unwrap(await svc.rename(editor, c.id, "다 담보 개정"));
    const draft = structureDraftOf(c);
    unwrap(await svc.applyStructurePlan(editor, c.id, [...draft, { key: "new-1", name: "둘째", benefits: [{ key: "new-2", name: "둘째급부" }] }]));
    expect((await svc.get(c.id))?.code).toBe("COV000003");
  });

  it("지운 담보의 코드는 다시 태어나지 않는다 — 다음은 COV000004", async () => {
    const c = (await svc.list()).find((x) => x.code === "COV000003")!;
    unwrap(await svc.remove(admin, c.id, { confirm: true }));
    const d = unwrap(await svc.create(editor, { name: "라 담보" }));
    expect(d.code).toBe("COV000004");
  });

  it("DB 가 코드 유일을 지킨다", async () => {
    await expect(t.db.insert(coverages).values({ name: "겹침", code: "COV000001" })).rejects.toThrow();
  });
});
