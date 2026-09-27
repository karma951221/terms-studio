import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "@/db/test-utils";
import { structureDraftOf, type StructureDraftSub } from "@/domain/coverage";
import type { Actor, Id } from "@/domain/types";
import { createServices, type Services } from "@/services/container";

/**
 * 「구조 편집」 화면의 저장 액션 (ADR-0052 결정 2) — 탑재된 담보의 구조를 서비스 `applyStructurePlan` 한 번에.
 * `@/lib/services` 를 인메모리 PGlite 서비스 + 바꿔 끼울 수 있는 actor 로, `next/cache` 의 revalidatePath 를 기록만 하는 것으로 대체한다.
 */
const admin: Actor = { userId: "00000000-0000-4000-8000-000000000001", role: "admin" };
const editor: Actor = { userId: "00000000-0000-4000-8000-000000000002", role: "editor" };
let t: TestDb;
let s: Services;
let actor: Actor = editor;
const revalidated: string[] = [];

vi.mock("@/lib/services", () => ({
  getServices: () => s,
  currentActor: async () => actor,
}));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    revalidated.push(path);
  },
}));

const { saveCoverageStructureAction } = await import("./structure-actions");

function unwrap<T>(r: { ok: true; value: T } | { ok: false }): T {
  if (!r.ok) throw new Error("unexpected rejection");
  return r.value;
}

describe("saveCoverageStructureAction — 탑재된 담보의 구조 편집", () => {
  let coverageId: Id;
  let pcId: Id;

  beforeAll(async () => {
    t = await createTestDb();
    s = createServices(t.db);
    const tree = unwrap(await s.coverage.create(editor, { name: "수술비", subCoverageName: "1종수술", benefitName: "수술보험금" }));
    coverageId = tree.id;
    const product = unwrap(await s.product.createProduct(editor, { name: "상품 P" }));
    pcId = unwrap(await s.product.mount(editor, product.id, coverageId, [])).id;
  });
  afterAll(async () => {
    await t.close();
  });

  it("편집자: 추가 · 순서는 confirm 없이 저장되고 탑재 스냅샷이 따라온다 · 상세 경로를 revalidate", async () => {
    actor = editor;
    const tree = (await s.coverage.get(coverageId))!;
    const draft: StructureDraftSub[] = structureDraftOf(tree);
    draft[0]!.benefits.push({ key: "new:1", name: "입원보험금" });
    draft.unshift({ key: "new:2", name: "0종수술", benefits: [{ key: "new:3", name: "특수수술보험금" }] });
    expect(await saveCoverageStructureAction(coverageId, { structure: draft })).toEqual({ ok: true });
    expect((await s.coverage.get(coverageId))!.subCoverages.map((sub) => [sub.name, sub.benefits.map((b) => b.name)])).toEqual([["0종수술", ["특수수술보험금"]], ["1종수술", ["수술보험금", "입원보험금"]]]);
    const snap = unwrap(await s.product.getSnapshot(pcId));
    expect(snap.subCoverages.map((sub) => [sub.name, sub.benefits.map((b) => b.name)])).toEqual([["0종수술", ["특수수술보험금"]], ["1종수술", ["수술보험금", "입원보험금"]]]);
    expect(revalidated).toContain(`/coverages/${coverageId}`);
  });

  it("편집자가 삭제를 섞으면 confirm 을 위조해도 배너 문장으로 거부 · 무변경", async () => {
    actor = editor;
    const tree = (await s.coverage.get(coverageId))!;
    const draft: StructureDraftSub[] = structureDraftOf(tree).filter((sub) => sub.name !== "0종수술");
    for (const confirm of [false, true]) {
      expect(await saveCoverageStructureAction(coverageId, { structure: draft }, confirm)).toEqual({ ok: false, message: "세부보장 · 급부 삭제는 관리자만 할 수 있다" });
    }
    expect(await s.coverage.get(coverageId)).toEqual(tree);
  });

  it("관리자: 1차는 영향(탑재 상품담보 포함)만 → confirm 이면 삭제까지 한 번에, 스냅샷 노드도 사라진다", async () => {
    actor = admin;
    const tree = (await s.coverage.get(coverageId))!;
    const draft: StructureDraftSub[] = structureDraftOf(tree).filter((sub) => sub.name !== "0종수술");
    const first = await saveCoverageStructureAction(coverageId, { structure: draft });
    expect(first.ok).toBe("confirm");
    if (first.ok === "confirm") {
      expect(first.actionLabel).toBe("세부보장·급부 삭제하고 저장");
      expect(first.impact.mounts).toEqual([{ productId: expect.any(String), productName: "상품 P", productCoverageId: pcId, productCoverageName: "수술비", snapshotValueRows: 0, snapshotValueRowsLost: 0 }]);
    }
    expect(await s.coverage.get(coverageId)).toEqual(tree);

    expect(await saveCoverageStructureAction(coverageId, { structure: draft }, true)).toEqual({ ok: true });
    expect((await s.coverage.get(coverageId))!.subCoverages.map((sub) => sub.name)).toEqual(["1종수술"]);
    expect(unwrap(await s.product.getSnapshot(pcId)).subCoverages.map((sub) => sub.name)).toEqual(["1종수술"]);
  });

  it("드라이런 거부(형제 중복)는 문구로 · 없는 담보는 notFound", async () => {
    actor = admin;
    const tree = (await s.coverage.get(coverageId))!;
    const draft: StructureDraftSub[] = structureDraftOf(tree);
    draft[0]!.benefits.push({ key: "new:1", name: "수술보험금" });
    const r = await saveCoverageStructureAction(coverageId, { structure: draft }, true);
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.message).toContain("수술보험금");
    expect(await s.coverage.get(coverageId)).toEqual(tree);
    expect((await saveCoverageStructureAction("44444444-4444-4444-8444-444444444444", { structure: draft })).ok).toBe(false);
  });
});
