import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "@/db/test-utils";
import { structureDraftOf, type StructureDraftSub } from "@/domain/coverage";
import type { Actor } from "@/domain/types";
import { createServices, type Services } from "@/services/container";

/**
 * 담보 상세 저장 액션 — 「영향 확인 전엔 아무것도 저장하지 않는다」 가 서버 액션을 직접 부르는 경로에서도 지켜지는지.
 * `@/lib/services` 를 인메모리 PGlite 서비스 + 바꿔 끼울 수 있는 actor 로 대체한다 — 액션의 순서 로직만 본다.
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

const { saveCoverageEditAction } = await import("./edit-actions");

function unwrap<T>(r: { ok: true; value: T } | { ok: false }): T {
  if (!r.ok) throw new Error("unexpected rejection");
  return r.value;
}

describe("saveCoverageEditAction — 삭제가 섞인 저장", () => {
  beforeAll(async () => {
    t = await createTestDb();
    s = createServices(t.db);
  });
  afterAll(async () => {
    await t.close();
  });

  it("편집자가 confirm=true 를 위조해도 ① 이름 · ② 추가가 저장되기 전에 역할로 거부된다", async () => {
    actor = editor;
    const tree = unwrap(await s.coverage.create(editor, { name: "수술비", subCoverageName: "1종수술", benefitName: "수술보험금" }));
    const withTwo = unwrap(await s.coverage.addBenefit(editor, tree.subCoverages[0]!.id, "입원보험금"));
    const draft: StructureDraftSub[] = structureDraftOf(withTwo);
    // 담보명 · 세부보장명 개명 · 새 급부 추가 · 기존 급부 ✕ — 삭제가 섞였으니 편집자는 전부 거부돼야 한다
    draft[0]!.name = "일종수술";
    draft[0]!.benefits = [draft[0]!.benefits[0]!, { key: "new:1", name: "통원보험금" }];
    const r = await saveCoverageEditAction(withTwo.id, { label: "수술비2", description: "주석", structure: draft, values: {} }, true);
    expect(r).toEqual({ ok: false, message: "세부보장 · 급부 삭제는 관리자만 할 수 있다" });
    expect(await s.coverage.get(withTwo.id)).toEqual(withTwo); // 아무것도 안 바뀜

    // confirm 없는 1차도 같은 메시지 · 같은 불변
    expect(await saveCoverageEditAction(withTwo.id, { label: "수술비2", description: "주석", structure: draft, values: {} })).toEqual({ ok: false, message: "세부보장 · 급부 삭제는 관리자만 할 수 있다" });
    expect(await s.coverage.get(withTwo.id)).toEqual(withTwo);
  });

  it("관리자: 1차는 영향만(저장 없음) → confirm 이면 이름 · 추가 · 삭제 · 순서가 한 번에", async () => {
    actor = admin;
    const tree = unwrap(await s.coverage.create(editor, { name: "암진단", subCoverageName: "일반암", benefitName: "진단금" }));
    const withTwo = unwrap(await s.coverage.addBenefit(editor, tree.subCoverages[0]!.id, "위로금"));
    const draft: StructureDraftSub[] = structureDraftOf(withTwo);
    draft[0]!.benefits = [{ key: "new:1", name: "재진단금" }, draft[0]!.benefits[0]!]; // 위로금 ✕ · 새 급부를 맨 앞에
    draft.push({ key: "new:2", name: "소액암", benefits: [{ key: "new:3", name: "소액진단금" }] });

    const first = await saveCoverageEditAction(withTwo.id, { label: "암진단", description: "", structure: draft, values: {} });
    expect(first.ok).toBe("confirm");
    if (first.ok === "confirm") expect(first.actionLabel).toBe("세부보장·급부 1개 삭제하고 저장");
    expect(await s.coverage.get(withTwo.id)).toEqual(withTwo);

    expect(await saveCoverageEditAction(withTwo.id, { label: "암진단", description: "", structure: draft, values: {} }, true)).toEqual({ ok: true });
    const saved = (await s.coverage.get(withTwo.id))!;
    expect(saved.subCoverages.map((sub) => [sub.name, sub.benefits.map((b) => b.name)])).toEqual([
      ["일반암", ["재진단금", "진단금"]],
      ["소액암", ["소액진단금"]],
    ]);
  });

  it("✕ 한 급부의 이름을 새 급부에 다시 쓰면 도메인 dry-run 이 서비스 호출 전에 거부한다", async () => {
    actor = admin;
    const tree = unwrap(await s.coverage.create(editor, { name: "골절", subCoverageName: "골절", benefitName: "진단금" }));
    const withTwo = unwrap(await s.coverage.addBenefit(editor, tree.subCoverages[0]!.id, "수술금"));
    const draft: StructureDraftSub[] = structureDraftOf(withTwo);
    draft[0]!.benefits = [draft[0]!.benefits[0]!, { key: "new:1", name: "수술금" }];
    const r = await saveCoverageEditAction(withTwo.id, { label: "화상진단2", description: "", structure: draft, values: {} }, true);
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.message).toContain("수술금");
    expect(await s.coverage.get(withTwo.id)).toEqual(withTwo);
  });

  it("탑재된 담보: 구조 변경은 거부 · 이름만 바꾼 저장은 applyStructurePlan 을 거쳐 탑재 스냅샷 이름까지 같은 트랜잭션에서 따라온다", async () => {
    actor = editor;
    const tree = unwrap(await s.coverage.create(editor, { name: "입원비", subCoverageName: "질병입원", benefitName: "입원일당" }));
    const product = unwrap(await s.product.createProduct(editor, { name: "입원 상품" }));
    const pc = unwrap(await s.product.mount(editor, product.id, tree.id, []));

    const structural: StructureDraftSub[] = structureDraftOf(tree);
    structural[0]!.benefits.push({ key: "new:1", name: "간병일당" });
    expect(await saveCoverageEditAction(tree.id, { label: "입원비", description: "", structure: structural, values: {} })).toEqual({ ok: false, message: "탑재된 담보의 구조는 여기서 고칠 수 없다" });

    const renamed: StructureDraftSub[] = structureDraftOf(tree);
    renamed[0]!.name = "질병 입원";
    renamed[0]!.benefits[0]!.name = "질병 입원일당";
    expect(await saveCoverageEditAction(tree.id, { label: "입원비", description: "", structure: renamed, values: {} })).toEqual({ ok: true });
    // getSnapshot 은 동기화하지 않는다 — 여기 보이는 이름은 저장이 같은 트랜잭션에서 맞춘 것
    const snap = unwrap(await s.product.getSnapshot(pc.id));
    expect(snap.subCoverages.map((sub) => [sub.name, sub.benefits.map((b) => b.name)])).toEqual([["질병 입원", ["질병 입원일당"]]]);
  });

  it("경쟁: 액션의 사전 계획엔 삭제가 없는데 트랜잭션 안 계획에 삭제가 있으면 — 서비스의 needsConfirmation 이 confirm 대화상자로 돌아오고(적용 없음), confirm=true 에 적용된다", async () => {
    actor = admin;
    const tree = unwrap(await s.coverage.create(editor, { name: "치아", subCoverageName: "보존치료", benefitName: "치료비" }));
    const stale = tree; // 액션이 보는 트리 — 그 사이 다른 저장이 급부를 하나 더했다
    const fresh = unwrap(await s.coverage.addBenefit(editor, tree.subCoverages[0]!.id, "위로금"));
    const real = s;
    s = { ...real, coverage: { ...real.coverage, get: async () => stale } }; // 사전 계획은 stale 로, applyStructurePlan 은 실제 DB 로
    try {
      const draft: StructureDraftSub[] = structureDraftOf(stale);
      draft[0]!.name = "보존 치료"; // 사전 계획: 이름만 (삭제 없음) → 서비스 안에서는 위로금 삭제가 섞인다
      const first = await saveCoverageEditAction(tree.id, { label: "치아", description: "", structure: draft, values: {} });
      expect(first.ok).toBe("confirm");
      if (first.ok === "confirm") expect(first.impact.cascade).toEqual([]);
      expect(await real.coverage.get(tree.id)).toEqual(fresh); // 사용자가 못 본 삭제는 적용되지 않았다 — 이름도 그대로

      expect(await saveCoverageEditAction(tree.id, { label: "치아", description: "", structure: draft, values: {} }, true)).toEqual({ ok: true });
      expect((await real.coverage.get(tree.id))!.subCoverages.map((sub) => [sub.name, sub.benefits.map((b) => b.name)])).toEqual([["보존 치료", ["치료비"]]]);
    } finally {
      s = real;
    }
  });
  it("폼이 낸 issue 가 있으면 담보명 · 주석 · 구조(추가)도 저장하지 않는다 — 입력 검사는 어떤 쓰기보다 앞", async () => {
    actor = editor;
    const tree = unwrap(await s.coverage.create(editor, { name: "화상진단", subCoverageName: "화상", benefitName: "진단비" }));
    const draft: StructureDraftSub[] = structureDraftOf(tree);
    draft[0]!.benefits.push({ key: "new:1", name: "깁스치료비" });
    const issue = { kind: "typeMismatch" as const, severity: "error" as const, message: "숫자여야 합니다", at: { document: "coverageMaster" as const, ownerId: tree.id, refPath: "coverage_basic.claim_name" } };
    const r = await saveCoverageEditAction(tree.id, {
      label: "화상진단2",
      description: "주석",
      structure: draft,
      values: { [`coverage:${tree.id}`]: { issues: [issue], values: [] } },
    });
    expect(r).toEqual({ ok: false, message: "숫자여야 합니다" });
    expect(await s.coverage.get(tree.id)).toEqual(tree); // 이름 · 주석 · 새 급부 전부 없음
  });
});
