import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "@/db/test-utils";
import { structureDraftOf, type StructureDraftSub } from "@/domain/coverage";
import type { Actor, Id } from "@/domain/types";
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
    const r = await saveCoverageEditAction(withTwo.id, { label: "수술비2", description: "주석", specialGroup: "", structure: draft, values: {} }, true);
    expect(r).toEqual({ ok: false, message: "세부보장 · 급부 삭제는 관리자만 할 수 있다" });
    expect(await s.coverage.get(withTwo.id)).toEqual(withTwo); // 아무것도 안 바뀜

    // confirm 없는 1차도 같은 메시지 · 같은 불변
    expect(await saveCoverageEditAction(withTwo.id, { label: "수술비2", description: "주석", specialGroup: "", structure: draft, values: {} })).toEqual({ ok: false, message: "세부보장 · 급부 삭제는 관리자만 할 수 있다" });
    expect(await s.coverage.get(withTwo.id)).toEqual(withTwo);
  });

  it("관리자: 1차는 영향만(저장 없음) → confirm 이면 이름 · 추가 · 삭제 · 순서가 한 번에", async () => {
    actor = admin;
    const tree = unwrap(await s.coverage.create(editor, { name: "암진단", subCoverageName: "일반암", benefitName: "진단금" }));
    const withTwo = unwrap(await s.coverage.addBenefit(editor, tree.subCoverages[0]!.id, "위로금"));
    const draft: StructureDraftSub[] = structureDraftOf(withTwo);
    draft[0]!.benefits = [{ key: "new:1", name: "재진단금" }, draft[0]!.benefits[0]!]; // 위로금 ✕ · 새 급부를 맨 앞에
    draft.push({ key: "new:2", name: "소액암", benefits: [{ key: "new:3", name: "소액진단금" }] });

    const first = await saveCoverageEditAction(withTwo.id, { label: "암진단", description: "", specialGroup: "", structure: draft, values: {} });
    expect(first.ok).toBe("confirm");
    if (first.ok === "confirm") expect(first.actionLabel).toBe("세부보장·급부 1개 삭제하고 저장");
    expect(await s.coverage.get(withTwo.id)).toEqual(withTwo);

    expect(await saveCoverageEditAction(withTwo.id, { label: "암진단", description: "", specialGroup: "", structure: draft, values: {} }, true)).toEqual({ ok: true });
    const saved = (await s.coverage.get(withTwo.id))!;
    expect(saved.subCoverages.map((sub) => [sub.name, sub.benefits.map((b) => b.name)])).toEqual([
      ["일반암", ["재진단금", "진단금"]],
      ["소액암", ["소액진단금"]],
    ]);
  });

  it("✕ 한 급부의 이름을 새 급부에 다시 쓸 수 있다 — 최종 상태로 검사 · 화면 검사(structureIssues)와 같은 규칙 (점검 2026-09-27 H2 ③)", async () => {
    actor = admin;
    const tree = unwrap(await s.coverage.create(editor, { name: "골절", subCoverageName: "골절", benefitName: "진단금" }));
    const withTwo = unwrap(await s.coverage.addBenefit(editor, tree.subCoverages[0]!.id, "수술금"));
    const oldId = withTwo.subCoverages[0]!.benefits[1]!.id;
    const draft: StructureDraftSub[] = structureDraftOf(withTwo);
    draft[0]!.benefits = [draft[0]!.benefits[0]!, { key: "new:1", name: "수술금" }];
    expect(await saveCoverageEditAction(withTwo.id, { label: "골절", description: "", specialGroup: "", structure: draft, values: {} }, true)).toEqual({ ok: true });
    const saved = (await s.coverage.get(withTwo.id))!.subCoverages[0]!.benefits;
    expect(saved.map((b) => b.name)).toEqual(["진단금", "수술금"]);
    expect(saved[1]!.id).not.toBe(oldId); // 같은 이름의 새 노드 — 지운 노드의 값은 따라오지 않는다
  });

  it("형제 이름 A↔B 맞바꾸기가 저장된다 — 세부보장 · 급부 둘 다 (점검 2026-09-27 H2 ③)", async () => {
    actor = editor;
    const tree = unwrap(await s.coverage.create(editor, { name: "질병수술", subCoverageName: "1종", benefitName: "수술비" }));
    const a = unwrap(await s.coverage.addSubCoverage(editor, tree.id, { name: "2종", benefitName: "수술비" }));
    const b = unwrap(await s.coverage.addBenefit(editor, a.subCoverages[0]!.id, "위로금"));
    const draft: StructureDraftSub[] = structureDraftOf(b);
    [draft[0]!.name, draft[1]!.name] = [draft[1]!.name, draft[0]!.name];
    [draft[0]!.benefits[0]!.name, draft[0]!.benefits[1]!.name] = [draft[0]!.benefits[1]!.name, draft[0]!.benefits[0]!.name];
    expect(await saveCoverageEditAction(b.id, { label: "질병수술", description: "", specialGroup: "", structure: draft, values: {} })).toEqual({ ok: true });
    const saved = (await s.coverage.get(b.id))!;
    expect(saved.subCoverages.map((sub) => [sub.id, sub.name, sub.benefits.map((x) => x.name)])).toEqual([
      [b.subCoverages[0]!.id, "2종", ["위로금", "수술비"]],
      [b.subCoverages[1]!.id, "1종", ["수술비"]],
    ]);
  });

  it("부분 저장 없음 — 담보명 · 주석 · 구조를 저장한 뒤 값 쓰기가 거부되면 전부 롤백된다 (점검 2026-09-27 H1)", async () => {
    actor = editor;
    const tree = unwrap(await s.coverage.create(editor, { name: "화상수술", subCoverageName: "화상", benefitName: "수술비" }));
    const draft: StructureDraftSub[] = structureDraftOf(tree);
    draft[0]!.name = "중증화상";
    draft[0]!.benefits.push({ key: "new:1", name: "치료비" });
    const r = await saveCoverageEditAction(tree.id, {
      label: "화상수술2",
      description: "주석",
      specialGroup: "",
      structure: draft,
      values: { [`coverage:${tree.id}`]: { issues: [], values: [{ path: "coverage_basic.claim_name", value: true }] } },
    });
    expect(r.ok).toBe(false);
    expect(await s.coverage.get(tree.id)).toEqual(tree);
  });

  it("탑재된 담보: 이름만 바꾼 저장은 확인 없이 — applyStructurePlan 을 거쳐 탑재 스냅샷 이름까지 같은 트랜잭션에서 따라온다", async () => {
    actor = editor;
    const tree = unwrap(await s.coverage.create(editor, { name: "입원비", subCoverageName: "질병입원", benefitName: "입원일당" }));
    const product = unwrap(await s.product.createProduct(editor, { name: "입원 상품" }));
    const pc = unwrap(await s.product.mount(editor, product.id, tree.id, []));

    const renamed: StructureDraftSub[] = structureDraftOf(tree);
    renamed[0]!.name = "질병 입원";
    renamed[0]!.benefits[0]!.name = "질병 입원일당";
    expect(await saveCoverageEditAction(tree.id, { label: "입원비", description: "", specialGroup: "", structure: renamed, values: {} })).toEqual({ ok: true });
    // getSnapshot 은 동기화하지 않는다 — 여기 보이는 이름은 저장이 같은 트랜잭션에서 맞춘 것
    const snap = unwrap(await s.product.getSnapshot(pc.id));
    expect(snap.subCoverages.map((sub) => [sub.name, sub.benefits.map((b) => b.name)])).toEqual([["질병 입원", ["질병 입원일당"]]]);
  });

  describe("탑재된 담보의 구조 변경 — 상세 저장 하나 (ADR-0075)", () => {
    let coverageId: Id;
    let pcId: Id;

    beforeAll(async () => {
      const tree = unwrap(await s.coverage.create(editor, { name: "상해수술", subCoverageName: "1종수술", benefitName: "수술보험금" }));
      coverageId = tree.id;
      const product = unwrap(await s.product.createProduct(editor, { name: "상품 P" }));
      pcId = unwrap(await s.product.mount(editor, product.id, coverageId, [])).id;
    });
    const shape = (tree: { subCoverages: { name: string; benefits: { name: string }[] }[] }) => tree.subCoverages.map((sub) => [sub.name, sub.benefits.map((b) => b.name)]);

    it("편집자: 추가 · 순서는 1차에 영향(탑재 상품담보)만 보이고 저장하지 않는다 → confirm 이면 담보명 · 구조 · 탑재 스냅샷이 한 번에", async () => {
      actor = editor;
      const tree = (await s.coverage.get(coverageId))!;
      const draft: StructureDraftSub[] = structureDraftOf(tree);
      draft[0]!.benefits.push({ key: "new:1", name: "입원보험금" });
      draft.unshift({ key: "new:2", name: "0종수술", benefits: [{ key: "new:3", name: "특수수술보험금" }] });

      const first = await saveCoverageEditAction(coverageId, { label: "상해수술Ⅱ", description: "", specialGroup: "", structure: draft, values: {} });
      expect(first.ok).toBe("confirm");
      if (first.ok === "confirm") {
        expect(first.actionLabel).toBe("구조 바꾸고 저장");
        expect(first.impact.mounts).toEqual([{ productId: expect.any(String), productName: "상품 P", productCoverageId: pcId, productCoverageName: "상해수술", snapshotValueRows: 0, snapshotValueRowsLost: 0 }]);
      }
      expect(await s.coverage.get(coverageId)).toEqual(tree); // 확인 전엔 담보명도 그대로

      expect(await saveCoverageEditAction(coverageId, { label: "상해수술Ⅱ", description: "", specialGroup: "", structure: draft, values: {} }, true)).toEqual({ ok: true });
      const saved = (await s.coverage.get(coverageId))!;
      expect(saved.name).toBe("상해수술Ⅱ");
      expect(shape(saved)).toEqual([["0종수술", ["특수수술보험금"]], ["1종수술", ["수술보험금", "입원보험금"]]]);
      expect(shape(unwrap(await s.product.getSnapshot(pcId)))).toEqual([["0종수술", ["특수수술보험금"]], ["1종수술", ["수술보험금", "입원보험금"]]]);
    });

    it("편집자가 삭제를 섞으면 confirm 을 위조해도 배너 문장으로 거부 · 무변경", async () => {
      actor = editor;
      const tree = (await s.coverage.get(coverageId))!;
      const draft: StructureDraftSub[] = structureDraftOf(tree).filter((sub) => sub.name !== "0종수술");
      for (const confirm of [false, true]) {
        expect(await saveCoverageEditAction(coverageId, { label: tree.name, description: "", specialGroup: "", structure: draft, values: {} }, confirm)).toEqual({ ok: false, message: "세부보장 · 급부 삭제는 관리자만 할 수 있다" });
      }
      expect(await s.coverage.get(coverageId)).toEqual(tree);
    });

    it("관리자: 삭제는 1차에 영향(스냅샷 소실 행 포함)만 → confirm 이면 삭제까지 한 번에, 스냅샷 노드도 사라진다", async () => {
      actor = admin;
      const tree = (await s.coverage.get(coverageId))!;
      const draft: StructureDraftSub[] = structureDraftOf(tree).filter((sub) => sub.name !== "0종수술");
      const first = await saveCoverageEditAction(coverageId, { label: tree.name, description: "", specialGroup: "", structure: draft, values: {} });
      expect(first.ok).toBe("confirm");
      if (first.ok === "confirm") {
        expect(first.actionLabel).toBe("세부보장·급부 1개 삭제하고 저장");
        expect(first.impact.mounts?.map((m) => m.productCoverageId)).toEqual([pcId]);
      }
      expect(await s.coverage.get(coverageId)).toEqual(tree);

      expect(await saveCoverageEditAction(coverageId, { label: tree.name, description: "", specialGroup: "", structure: draft, values: {} }, true)).toEqual({ ok: true });
      expect((await s.coverage.get(coverageId))!.subCoverages.map((sub) => sub.name)).toEqual(["1종수술"]);
      expect(unwrap(await s.product.getSnapshot(pcId)).subCoverages.map((sub) => sub.name)).toEqual(["1종수술"]);
    });

    it("롤백 — 확인한 구조 변경 뒤 값 쓰기가 거부되면 담보명 · 구조 · 탑재 스냅샷 모두 그대로", async () => {
      actor = editor;
      const tree = (await s.coverage.get(coverageId))!;
      const snapBefore = shape(unwrap(await s.product.getSnapshot(pcId)));
      const draft: StructureDraftSub[] = structureDraftOf(tree);
      draft[0]!.benefits.push({ key: "new:1", name: "통원보험금" });
      const r = await saveCoverageEditAction(
        coverageId,
        { label: "상해수술Ⅲ", description: "", specialGroup: "", structure: draft, values: { [`coverage:${coverageId}`]: { issues: [], values: [{ path: "coverage_basic.claim_name", value: true }] } } },
        true,
      );
      expect(r.ok).toBe(false);
      expect(await s.coverage.get(coverageId)).toEqual(tree);
      expect(shape(unwrap(await s.product.getSnapshot(pcId)))).toEqual(snapBefore);
    });

    it("주석은 화면에 없어도 초안에 실린 저장값이 그대로 남는다", async () => {
      actor = editor;
      const tree = unwrap(await s.coverage.setDescription(editor, coverageId, "보존할 주석"));
      expect(await saveCoverageEditAction(coverageId, { label: tree.name, description: tree.description, specialGroup: "", structure: structureDraftOf(tree), values: {} })).toEqual({ ok: true });
      expect((await s.coverage.get(coverageId))!.description).toBe("보존할 주석");
    });
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
      const first = await saveCoverageEditAction(tree.id, { label: "치아", description: "", specialGroup: "", structure: draft, values: {} });
      expect(first.ok).toBe("confirm");
      if (first.ok === "confirm") expect(first.impact.cascade).toEqual([]);
      expect(await real.coverage.get(tree.id)).toEqual(fresh); // 사용자가 못 본 삭제는 적용되지 않았다 — 이름도 그대로

      expect(await saveCoverageEditAction(tree.id, { label: "치아", description: "", specialGroup: "", structure: draft, values: {} }, true)).toEqual({ ok: true });
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
      specialGroup: "",
      structure: draft,
      values: { [`coverage:${tree.id}`]: { issues: [issue], values: [] } },
    });
    expect(r).toEqual({ ok: false, message: "숫자여야 합니다" });
    expect(await s.coverage.get(tree.id)).toEqual(tree); // 이름 · 주석 · 새 급부 전부 없음
  });
});

describe("saveCoverageEditAction — 특약 그룹 (ADR-0080)", () => {
  beforeAll(async () => {
    t = await createTestDb();
    s = createServices(t.db);
    for (let i = 1; i <= 7; i++) unwrap(await s.catalog.createEnum(editor, { label: `열거형${i}`, values: [{ label: "값" }] }));
    unwrap(await s.catalog.createEnum(editor, { label: "특약 그룹", values: [{ label: "상해 관련 특별약관" }] })); // E0008
  });
  afterAll(async () => {
    await t.close();
  });

  it("편집자 저장 하나에 담보명 · 그룹이 함께 들어가고, 빈 값이면 그룹을 푼다", async () => {
    actor = editor;
    const tree = unwrap(await s.coverage.create(editor, { name: "골절진단" }));
    const data = { label: "골절진단비", description: "", specialGroup: "V01", structure: structureDraftOf(tree), values: {} };
    expect(await saveCoverageEditAction(tree.id, data)).toEqual({ ok: true });
    expect(await s.coverage.get(tree.id)).toMatchObject({ name: "골절진단비", specialGroup: "V01" });
    expect(await saveCoverageEditAction(tree.id, { ...data, specialGroup: "" })).toEqual({ ok: true });
    expect((await s.coverage.get(tree.id))?.specialGroup).toBeUndefined();
  });

  it("열거형에 없는 값이면 거부 — 같은 저장의 담보명도 남지 않는다(한 트랜잭션)", async () => {
    actor = editor;
    const tree = unwrap(await s.coverage.create(editor, { name: "화상진단" }));
    const r = await saveCoverageEditAction(tree.id, { label: "화상진단비", description: "", specialGroup: "V09", structure: structureDraftOf(tree), values: {} });
    expect(r.ok).toBe(false);
    expect(await s.coverage.get(tree.id)).toEqual(tree);
  });
});
