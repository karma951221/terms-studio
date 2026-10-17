import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CoverageMasterSource, CoverageTree } from "@/domain/product";
import type { Actor, Id, Impact, Issue } from "@/domain/types";

import { readSlots, writeSlot } from "@/db/repo/values";
import { coverages } from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/test-utils";
import { createCatalogService } from "./catalog";
import { createProductService, type ProductCoveragesInput, type ProductService } from "./product";

/**
 * 상품담보 탭 저장 한 번 (기능/상품 §3.8 · §4.5, 2026-10-04) — 탑재 추가 · 상품담보명 · 세목 부착/해제 · 탑재 해제를 한 서비스 호출 ·
 * 한 트랜잭션으로. 전부 검사한 뒤 쓴다 — 하나라도 틀리면 아무것도 안 쓰고, 이슈는 그 행(`ownerId` = 상품담보 id · 추가 행 key)에 붙는다.
 * 잃는 것(탑재 해제 · 세목 부착 해제)이 있으면 1차는 영향 확인, 편집자는 그 행에서 거부된다(관리자만, ADR-0019).
 */

const admin: Actor = { userId: "00000000-0000-4000-8000-000000000001", role: "admin" };
const editor: Actor = { userId: "00000000-0000-4000-8000-000000000002", role: "editor" };

function unwrap<T>(r: { ok: true; value: T } | { ok: false; rejection: unknown }): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}
function rejected(r: { ok: boolean; rejection?: unknown }) {
  if (r.ok) throw new Error("기대: 거부, 실제: ok");
  return r.rejection as { reason: string; issues?: Issue[]; impact?: Impact };
}

const DEATH = "aaaaaaaa-0000-4000-8000-000000000001";
const DEATH_SUB = "aaaaaaaa-0000-4000-8000-000000000011";
const DEATH_BEN = "aaaaaaaa-0000-4000-8000-000000000111";
const SURGERY = "aaaaaaaa-0000-4000-8000-000000000002";
const SURGERY_SUB = "aaaaaaaa-0000-4000-8000-000000000021";
const SURGERY_BEN = "aaaaaaaa-0000-4000-8000-000000000211";
const MISSING = "aaaaaaaa-0000-4000-8000-0000000000ff";
const GENERAL_DOC = "dddddddd-0000-4000-8000-000000000001";

const trees = new Map<string, CoverageTree>([
  [DEATH, { id: DEATH, name: "일반상해사망", subCoverages: [{ id: DEATH_SUB, key: "01", name: "일반상해사망", order: 0, benefits: [{ id: DEATH_BEN, key: "1", name: "사망보험금", order: 0 }] }] }],
  [SURGERY, { id: SURGERY, name: "수술비", subCoverages: [{ id: SURGERY_SUB, key: "01", name: "1종수술", order: 0, benefits: [{ id: SURGERY_BEN, key: "1", name: "수술보험금", order: 0 }] }] }],
]);
const master: CoverageMasterSource = { tree: async (id) => trees.get(id) };

const NONE: ProductCoveragesInput = { added: [], updated: [], removed: [] };

describe("saveCoverages — 상품담보 탭 저장 한 번 (PGlite)", () => {
  let t: TestDb;
  let svc: ProductService;
  let planA: Id;
  let planB: Id;

  /** 새 상품 + 세목 조합 둘(1종 · 2종). */
  async function product(name: string): Promise<Id> {
    const p = unwrap(await svc.createProduct(editor, { name, generalDocumentId: GENERAL_DOC }));
    const o1 = unwrap(await svc.addPlanOption(editor, p.id, { axis: "type", number: 1, name: "1종", planTypeCode: "waiver" }));
    const o2 = unwrap(await svc.addPlanOption(editor, p.id, { axis: "type", number: 2, name: "2종", planTypeCode: "waiver" }));
    planA = unwrap(await svc.registerPlan(editor, p.id, [o1.id])).id;
    planB = unwrap(await svc.registerPlan(editor, p.id, [o2.id])).id;
    return p.id;
  }

  beforeAll(async () => {
    t = await createTestDb();
    const catalog = createCatalogService(t.db);
    for (let i = 1; i <= 6; i++) unwrap(await catalog.createEnum(editor, { label: `열거형${i}`, values: [{ label: "값" }] }));
    unwrap(await catalog.createEnum(editor, { label: "계약형태", values: [{ label: "주계약" }, { label: "독립특약" }] })); // E0007
    await writeSlot(t.db, { kind: "benefit", id: DEATH_BEN }, "pay.rate", 100);
    svc = createProductService(t.db, { coverageMaster: master, generalDocuments: { exists: async (id) => id === GENERAL_DOC, articleIds: async () => [], clauseRef: async () => undefined } });
    unwrap(await svc.createAttributeKind(editor, { label: "부가유형" })); // A0001
    unwrap(await svc.addAttributeValue(editor, "A0001", { label: "기본" }));
    unwrap(await svc.addAttributeValue(editor, "A0001", { label: "추가", fragment: "추가" }));
    unwrap(await svc.setNamingTemplate(editor, "[담보명] [A0001]"));
  });
  afterAll(async () => {
    await t.close();
  });

  it("편집자 — 기본계약 · 특약 추가 · 이름 · 세목 부착을 한 번에. 이름을 안 주면 작명 규칙, 스냅샷 노드 · 값이 생긴다", async () => {
    const id = await product("한 번에 저장");
    unwrap(
      await svc.saveCoverages(editor, id, {
        added: [
          { key: "new:1", coverageId: SURGERY, attributes: [], section: "base", plans: [] },
          { key: "new:2", coverageId: DEATH, attributes: [{ kindCode: "A0001", valueCode: "2" }], section: "special", plans: [planA] },
          { key: "new:3", coverageId: DEATH, attributes: [{ kindCode: "A0001", valueCode: "1" }], section: "special", name: "  사망 기본  ", plans: [] },
        ],
        updated: [],
        removed: [],
      }),
    );
    const pcs = await svc.listProductCoverages(id);
    expect(pcs.map((pc) => pc.name)).toEqual(["수술비", "일반상해사망 추가", "사망 기본"]);
    expect(await svc.listBaseContractIds(id)).toEqual([pcs[0]!.id]);
    expect((await svc.listAttachedPlans(pcs[1]!.id)).map((p) => p.id)).toEqual([planA]);
    const snap = unwrap(await svc.getSnapshot(pcs[1]!.id));
    expect(snap.subCoverages.map((s) => [s.name, s.benefits.map((b) => b.name)])).toEqual([["일반상해사망", ["사망보험금"]]]);
    expect((await readSlots(t.db, { kind: "productBenefit", id: snap.subCoverages[0]!.benefits[0]!.id })).get("pay.rate")).toEqual({ entered: true, value: 100 });

    // 이름 · 세목 부착은 기존 행의 최종 상태 — 비파괴라 편집자도 확인 없이
    unwrap(await svc.saveCoverages(editor, id, { added: [], updated: [{ id: pcs[2]!.id, name: "일반상해사망 기본", plans: [planA, planB] }], removed: [] }));
    expect((await svc.getProductCoverage(pcs[2]!.id))?.name).toBe("일반상해사망 기본");
    expect((await svc.listAttachedPlans(pcs[2]!.id)).map((p) => p.id).sort()).toEqual([planA, planB].sort());
    // 탭이 한 번에 읽는 부착 목록 — 상품담보 id → 조합 id (부착이 없는 상품담보는 없다)
    const attached = await svc.listAttachedPlanIdsOf(id);
    expect([...attached.keys()].sort()).toEqual([pcs[1]!.id, pcs[2]!.id].sort());
    expect(attached.get(pcs[1]!.id)).toEqual([planA]);
  });

  it("전부 검사한 뒤 쓴다 — 한 행이라도 틀리면 아무것도 안 쓰고, 이슈는 그 행(ownerId = 행 key · 상품담보 id)과 칸(refPath)에", async () => {
    const id = await product("전부 검사");
    unwrap(await svc.saveCoverages(editor, id, { ...NONE, added: [{ key: "new:1", coverageId: DEATH, attributes: [], section: "special", plans: [] }] }));
    const [death] = await svc.listProductCoverages(id);
    const r = rejected(
      await svc.saveCoverages(editor, id, {
        added: [
          { key: "new:ok", coverageId: SURGERY, attributes: [], section: "special", plans: [] },
          { key: "new:dup", coverageId: DEATH, attributes: [], section: "special", plans: [] }, // 이미 있는 조합
          { key: "new:gone", coverageId: MISSING, attributes: [], section: "special", plans: [] },
          { key: "new:attr", coverageId: SURGERY, attributes: [{ kindCode: "A0001", valueCode: "9" }], section: "special", plans: [] },
        ],
        updated: [{ id: death!.id, name: "  ", plans: [] }],
        removed: [],
      }),
    );
    expect(r.reason).toBe("invalid");
    const at = r.issues!.map((i) => [i.at.ownerId, i.at.refPath]);
    expect(at).toEqual(
      expect.arrayContaining([
        ["new:dup", "attributes"],
        ["new:gone", "coverage"],
        ["new:attr", "attributes"],
        [death!.id, "name"],
      ]),
    );
    expect(r.issues!.find((i) => i.at.ownerId === "new:dup")!.message).toContain("이미 탑재");
    // 아무것도 안 바뀌었다 — 「new:ok」 도 쓰지 않는다
    expect((await svc.listProductCoverages(id)).map((pc) => pc.name)).toEqual(["일반상해사망"]);
  });

  it("같은 저장 안의 두 추가가 같은 조합이면 둘째 행에 · 같은 조합을 지우고 다시 넣는 것은 된다(새 스냅샷)", async () => {
    const id = await product("조합 중복");
    const add = (key: string) => ({ key, coverageId: SURGERY, attributes: [], section: "special" as const, plans: [] });
    const r = rejected(await svc.saveCoverages(editor, id, { ...NONE, added: [add("new:a"), add("new:b")] }));
    expect(r.issues!.map((i) => i.at.ownerId)).toEqual(["new:b"]);

    unwrap(await svc.saveCoverages(editor, id, { ...NONE, added: [add("new:a")] }));
    const [old] = await svc.listProductCoverages(id);
    unwrap(await svc.saveCoverages(admin, id, { added: [add("new:again")], updated: [], removed: [old!.id] }, { confirm: true }));
    const [again] = await svc.listProductCoverages(id);
    expect(again!.id).not.toBe(old!.id);
    expect(again!.name).toBe("수술비");
  });

  it("기본계약 규칙 — 주계약은 둘째 기본계약도 추가된다(절 형태, ADR-0021 결정 1) · 지우고 새로 넣으면 바꾼다(관리자 · 확인) · 독립특약은 기본계약 추가 거부", async () => {
    const id = await product("기본계약 교체");
    unwrap(await svc.saveCoverages(editor, id, { ...NONE, added: [{ key: "new:1", coverageId: SURGERY, attributes: [], section: "base", plans: [] }] }));
    const [base] = await svc.listProductCoverages(id);
    // 둘째 기본계약 — 거부하지 않는다(2026-10-17 ① 기본계약 2+ 허용). 되돌려 하나로 돌아간 뒤 교체를 본다
    unwrap(await svc.saveCoverages(editor, id, { ...NONE, added: [{ key: "new:2", coverageId: DEATH, attributes: [], section: "base", plans: [] }] }));
    expect((await svc.listBaseContractIds(id)).length).toBe(2);
    const death = (await svc.listProductCoverages(id)).find((pc) => pc.id !== base!.id)!;
    unwrap(await svc.saveCoverages(admin, id, { ...NONE, removed: [death.id] }, { confirm: true }));

    const swap = { added: [{ key: "new:2", coverageId: DEATH, attributes: [], section: "base" as const, plans: [] }], updated: [], removed: [base!.id] };
    const first = rejected(await svc.saveCoverages(admin, id, swap));
    expect(first.reason).toBe("needsConfirmation");
    expect(first.impact!.cascade).toEqual(["탑재 해제 · 수술비 — 기본계약 해제 · 세부보장 1 · 급부 1"]);
    unwrap(await svc.saveCoverages(admin, id, swap, { confirm: true }));
    const pcs = await svc.listProductCoverages(id);
    expect(pcs.map((pc) => pc.name)).toEqual(["일반상해사망"]);
    expect(await svc.listBaseContractIds(id)).toEqual([pcs[0]!.id]);

    const standalone = await product("독립특약");
    unwrap(await svc.setProductValue(editor, standalone, "feature.contract_kind", "V02"));
    const r = rejected(await svc.saveCoverages(editor, standalone, { ...NONE, added: [{ key: "new:1", coverageId: DEATH, attributes: [], section: "base", plans: [] }] }));
    expect(r.issues!.map((i) => [i.at.ownerId, i.message])).toEqual([["new:1", "독립특약 상품은 기본계약을 두지 않습니다"]]);
  });

  it("탑재 해제 · 세목 부착 해제는 파괴적 — 편집자는 그 행에서 거부(아무것도 안 씀), 관리자는 1차 영향(값 행 · 줄) → 확인하면 연쇄 삭제", async () => {
    const id = await product("탑재 해제");
    unwrap(
      await svc.saveCoverages(editor, id, {
        ...NONE,
        added: [
          { key: "new:1", coverageId: DEATH, attributes: [], section: "special", plans: [planA] },
          { key: "new:2", coverageId: SURGERY, attributes: [], section: "special", plans: [planA, planB] },
        ],
      }),
    );
    const [death, surgery] = await svc.listProductCoverages(id);
    const input: ProductCoveragesInput = { added: [], updated: [{ id: surgery!.id, name: "수술비", plans: [planA] }], removed: [death!.id] };

    const byEditor = rejected(await svc.saveCoverages(editor, id, input));
    expect(byEditor.reason).toBe("invalid");
    expect(byEditor.issues!.map((i) => [i.at.ownerId, i.message])).toEqual([
      [death!.id, "탑재 해제는 관리자만 할 수 있습니다 — 저장하지 않았습니다"],
      [surgery!.id, "세목 부착 해제는 관리자만 할 수 있습니다 — 저장하지 않았습니다"],
    ]);
    expect(await svc.listProductCoverages(id)).toHaveLength(2);

    const first = rejected(await svc.saveCoverages(admin, id, input));
    expect(first.reason).toBe("needsConfirmation");
    expect(first.impact!.valueRowsLost).toBe(1); // 사망보험금 pay.rate 스냅샷
    expect(first.impact!.cascade).toEqual(["탑재 해제 · 일반상해사망 — 세부보장 1 · 급부 1 · 세목 부착 1건", "세목 부착 해제 · 수술비 — (제2종)"]);
    expect(await svc.listProductCoverages(id)).toHaveLength(2); // 확인 전엔 아무것도

    unwrap(await svc.saveCoverages(admin, id, input, { confirm: true }));
    expect((await svc.listProductCoverages(id)).map((pc) => pc.name)).toEqual(["수술비"]);
    expect((await svc.listAttachedPlans(surgery!.id)).map((p) => p.id)).toEqual([planA]);
    expect((await readSlots(t.db, { kind: "productCoverage", id: death!.id })).size).toBe(0);
  });

  it("남의 상품 것 · 없는 것 · 지우면서 고치기는 그 행에서 거부", async () => {
    const id = await product("좌표 확인");
    const other = await product("다른 상품");
    unwrap(await svc.saveCoverages(editor, other, { ...NONE, added: [{ key: "new:1", coverageId: DEATH, attributes: [], section: "special", plans: [] }] }));
    const [foreign] = await svc.listProductCoverages(other);
    const otherPlan = planA; // 마지막 product() 의 조합 = 다른 상품 것
    unwrap(await svc.saveCoverages(editor, id, { ...NONE, added: [{ key: "new:1", coverageId: DEATH, attributes: [], section: "special", plans: [] }] }));
    const [mine] = await svc.listProductCoverages(id);
    const r = rejected(
      await svc.saveCoverages(admin, id, {
        added: [{ key: "new:2", coverageId: SURGERY, attributes: [], section: "special", plans: [otherPlan] }],
        updated: [
          { id: foreign!.id, name: "남의 것", plans: [] },
          { id: mine!.id, name: "지우면서 고침", plans: [] },
        ],
        removed: [mine!.id],
      }),
    );
    expect(r.issues!.map((i) => [i.at.ownerId, i.at.refPath])).toEqual([
      [foreign!.id, undefined],
      [mine!.id, undefined],
      ["new:2", "plans"],
    ]);
    expect(rejected(await svc.saveCoverages(editor, "00000000-0000-4000-8000-0000000000ee", NONE)).reason).toBe("notFound");
  });

  it("바뀐 것이 없는 저장은 그대로 ok — 아무것도 쓰지 않는다", async () => {
    const id = await product("빈 저장");
    unwrap(await svc.saveCoverages(editor, id, NONE));
    expect(await svc.listProductCoverages(id)).toEqual([]);
  });
});

describe("saveCoverages — 특약 그룹 (ADR-0090 · 기능/상품 §3.7 · §4.5): 그룹 목록 · 소속도 같은 저장 한 번", () => {
  let t: TestDb;
  let svc: ProductService;

  beforeAll(async () => {
    t = await createTestDb();
    const catalog = createCatalogService(t.db);
    for (let i = 1; i <= 8; i++) unwrap(await catalog.createEnum(editor, { label: `열거형${i}`, values: [{ label: "값" }] }));
    const categories = unwrap(
      await catalog.createEnum(editor, {
        label: "담보분류",
        fields: [{ ref: "title", label: "그룹 제목", type: "string" }],
        values: [{ label: "상해", fields: { title: "상해 관련 특별약관" } }, { label: "질병", fields: { title: "질병 관련 특별약관" } }],
      }),
    );
    expect(categories.code).toBe("E0009");
    // 담보 마스터 행 — 담보분류는 담보의 뼈대 칸(coverages.category)이라 서비스가 그 열을 읽는다
    await t.db.insert(coverages).values([
      { id: DEATH, code: "COV000001", name: "일반상해사망", category: "V01" },
      { id: SURGERY, code: "COV000002", name: "수술비", category: "V02" },
    ]);
    svc = createProductService(t.db, { coverageMaster: master, generalDocuments: { exists: async (id) => id === GENERAL_DOC, articleIds: async () => [], clauseRef: async () => undefined } });
  });
  afterAll(async () => {
    await t.close();
  });

  async function mounted(name: string): Promise<Id> {
    const p = unwrap(await svc.createProduct(editor, { name, generalDocumentId: GENERAL_DOC }));
    unwrap(await svc.saveCoverages(editor, p.id, { added: [{ key: "new:1", coverageId: DEATH, attributes: [], section: "special", plans: [] }, { key: "new:2", coverageId: SURGERY, attributes: [], section: "special", plans: [] }], updated: [], removed: [] }));
    return p.id;
  }

  it("저장한 적 없으면 빈 목록 — 사용자 그룹을 만들고 담보를 넣고 순서를 정하면 다시 읽어도 그대로(새 그룹은 id 를 받는다)", async () => {
    const id = await mounted("그룹 저장");
    expect(await svc.listGroups(id)).toEqual({ groups: [], memberships: [] });
    unwrap(
      await svc.saveCoverages(editor, id, {
        ...NONE,
        groups: { list: [{ kind: "user", key: "newgroup:1", name: "수술 관련 특별약관" }, { kind: "category", code: "V01" }], memberships: [{ coverageId: SURGERY, group: "newgroup:1" }] },
      }),
    );
    const saved = await svc.listGroups(id);
    const user = saved.groups[0] as { kind: "user"; id: Id; name: string };
    expect(saved.groups).toEqual([{ kind: "user", id: user.id, name: "수술 관련 특별약관" }, { kind: "category", code: "V01" }]);
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(saved.memberships).toEqual([{ coverageId: SURGERY, groupId: user.id }]);
    // 이름 바꾸기 · 순서 바꾸기 — 같은 그룹 id 를 지킨다
    unwrap(await svc.saveCoverages(editor, id, { ...NONE, groups: { list: [{ kind: "category", code: "V01" }, { kind: "user", key: user.id, id: user.id, name: "수술 특별약관" }], memberships: [{ coverageId: SURGERY, group: user.id }] } }));
    expect(await svc.listGroups(id)).toEqual({ groups: [{ kind: "category", code: "V01" }, { kind: "user", id: user.id, name: "수술 특별약관" }], memberships: [{ coverageId: SURGERY, groupId: user.id }] });
  });

  it("빈 이름 · 기본 그룹 제목과 같은 이름은 그 그룹 줄에서 거부 — 같은 저장의 탑재 추가도 쓰지 않는다", async () => {
    const id = await mounted("그룹 거부");
    const r = rejected(
      await svc.saveCoverages(editor, id, {
        added: [{ key: "new:9", coverageId: DEATH, attributes: [{ kindCode: "A0001", valueCode: "1" }], section: "special", plans: [] }],
        updated: [],
        removed: [],
        groups: { list: [{ kind: "user", key: "newgroup:1", name: " " }, { kind: "user", key: "newgroup:2", name: "질병 관련 특별약관" }], memberships: [] },
      }),
    );
    expect(r.issues?.map((i) => [i.at.ownerId, i.message])).toEqual(
      expect.arrayContaining([
        ["newgroup:1", "그룹 이름은 비울 수 없습니다"],
        ["newgroup:2", "이 상품의 다른 그룹 제목과 같습니다 — 「질병 관련 특별약관」"],
      ]),
    );
    expect(await svc.listGroups(id)).toEqual({ groups: [], memberships: [] });
    expect(await svc.listProductCoverages(id)).toHaveLength(2);
  });

  it("탑재 해제로 상품에서 빠지는 담보의 소속은 같은 저장에서 지운다 — 그룹을 고치지 않은 저장도 · 이 상품에 없게 된 기본 그룹도", async () => {
    const id = await mounted("그룹 정리");
    unwrap(await svc.saveCoverages(editor, id, { ...NONE, groups: { list: [{ kind: "category", code: "V02" }, { kind: "user", key: "newgroup:1", name: "사망" }], memberships: [{ coverageId: DEATH, group: "newgroup:1" }] } }));
    const pcs = await svc.listProductCoverages(id);
    const death = pcs.find((pc) => pc.coverageId === DEATH)!;
    const surgery = pcs.find((pc) => pc.coverageId === SURGERY)!;
    unwrap(await svc.saveCoverages(admin, id, { ...NONE, removed: [death.id, surgery.id] }, { confirm: true }));
    const saved = await svc.listGroups(id);
    expect(saved.memberships).toEqual([]);
    expect(saved.groups.map((g) => g.kind)).toEqual(["user"]); // 빈 사용자 그룹은 남는다 — 책자에 찍지 않을 뿐
  });

  it("이 상품에 특약으로 탑재된 적 없는 담보 · 다른 상품의 그룹 id 는 거부", async () => {
    const id = await mounted("그룹 남의 것");
    const r = rejected(
      await svc.saveCoverages(editor, id, {
        ...NONE,
        groups: { list: [{ kind: "user", key: "g", id: "00000000-0000-4000-8000-0000000000aa", name: "남의 그룹" }, { kind: "user", key: "newgroup:1", name: "새 그룹" }], memberships: [{ coverageId: MISSING, group: "newgroup:1" }] },
      }),
    );
    expect(r.issues?.map((i) => [i.at.ownerId, i.kind])).toEqual([["g", "brokenRef"], ["newgroup:1", "brokenRef"]]);
  });
});
