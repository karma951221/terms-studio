import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Coverage } from "@/domain/coverage";
import { nodeBuilders } from "@/domain/document";
import { findForm } from "@/domain/master";
import type { Actor, Id } from "@/domain/types";

import { insertDocument } from "@/db/repo/document";
import { createTestDb, type TestDb } from "@/db/test-utils";
import { createServices, type Services } from "./container";

const editor: Actor = { userId: "00000000-0000-4000-8000-000000000002", role: "editor" };

function unwrap<T>(r: { ok: true; value: T } | { ok: false; rejection: unknown }): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

/**
 * 마스터 서비스 — 마스터 화면 S2 사용처 패널의 데이터원 (기능/마스터 §4.3).
 * 값 노드는 그 레벨 노드 **전부**를 세고 미입력을 포함한다 — 어디가 비었느냐가 추적에서 더 중요하다.
 */
describe("master 서비스 (PGlite)", () => {
  let t: TestDb;
  let s: Services;
  let death: Coverage;
  let surgery: Coverage;
  let productId: Id;
  const b = nodeBuilders();

  beforeAll(async () => {
    t = await createTestDb();
    s = createServices(t.db);
    // MVP 마스터가 가리키는 열거형변수 둘 — 없으면 마스터 필드의 타입 간선이 깨진 참조가 된다
    unwrap(await s.catalog.createEnum(editor, { label: "납입면제사유", values: [{ label: "질병" }, { label: "상해" }] }));
    unwrap(await s.catalog.createEnum(editor, { label: "해약환급금유형", values: [{ label: "지급형" }, { label: "미지급형" }] }));
    unwrap(await s.catalog.create(editor, { label: "담보명", level: "coverage", expression: "coverage_basic.claim_name" })); // D0001
  });
  afterAll(async () => {
    await t.close();
  });

  describe("valueNodes — 그 레벨 노드 전부 · 미입력 포함", () => {
    it("담보 둘 중 하나에만 값을 쓰면 total 2 · entered 1 · notEntered 1, href 는 담보 화면의 값 자리", async () => {
      death = unwrap(await s.coverage.create(editor, { name: "일반상해사망", benefitName: "사망보험금" }));
      surgery = unwrap(await s.coverage.create(editor, { name: "수술비", benefitName: "수술보험금" }));
      unwrap(await s.coverage.writeValue(editor, { level: "coverage", id: death.id }, "coverage_basic.claim_name", "사망보험금"));

      const page = await s.master.valueNodes("coverage_basic.claim_name");
      expect(page).toMatchObject({ total: 2, entered: 1, notEntered: 1, page: 1, pageSize: 20 });
      expect(page.rows).toHaveLength(2);

      const deathRow = page.rows.find((r) => r.ownerId === death.id)!;
      expect(deathRow).toMatchObject({ ownerKind: "coverage", label: "일반상해사망", value: "사망보험금" });
      expect(deathRow.href).toBe(`/coverages/${death.id}?tab=coverage&node=coverage:${death.id}&field=coverage_basic.claim_name`);

      const surgeryRow = page.rows.find((r) => r.ownerId === surgery.id)!;
      expect(surgeryRow.label).toBe("수술비");
      expect("value" in surgeryRow).toBe(false);
    });

    it("급부 레벨 필드는 급부 노드를 「담보명 › 세부보장명 › 급부명」으로 부른다", async () => {
      const page = await s.master.valueNodes("pay.rate");
      expect(page.total).toBe(2);
      const benefit = death.subCoverages[0].benefits[0];
      const row = page.rows.find((r) => r.ownerId === benefit.id)!;
      expect(row.ownerKind).toBe("benefit");
      expect(row.label).toBe(`일반상해사망 › ${death.subCoverages[0].name} › 사망보험금`);
      expect(row.href).toBe(`/coverages/${death.id}?tab=benefit&node=benefit:${benefit.id}&field=pay.rate`);
    });

    it("존재하지 않는 경로 → 빈 결과 (거부 아님)", async () => {
      const page = await s.master.valueNodes("nope.nothing");
      expect(page).toMatchObject({ total: 0, entered: 0, notEntered: 0, rows: [] });
    });
  });

  describe("fieldUsage — 마스터 필드 → 구분자 → 문면", () => {
    it("D0001(식 coverage_basic.claim_name)을 담보약관 슬롯이 읽으면 discriminators[0] 이 D0001 이고 documents 가 1건 이상", async () => {
      const art = b.article("보험금의 지급사유", [b.paragraph([b.text("담보명 "), b.slot("D0001")])]);
      const special = await insertDocument(s.db, { kind: "special", ownerId: death.id, title: "일반상해사망 특별약관", tree: b.document("일반상해사망 특별약관", [art]) }, editor.userId);
      unwrap(await s.coverage.setDocument(editor, death.id, special.id));

      const usage = await s.master.fieldUsage("coverage_basic.claim_name");
      expect(usage.path).toBe("coverage_basic.claim_name");
      expect(usage.discriminators).toHaveLength(1);
      const d = usage.discriminators[0];
      expect(d).toMatchObject({ code: "D0001", label: "담보명", expression: "coverage_basic.claim_name", level: "coverage" });
      expect(d.documents.length).toBeGreaterThanOrEqual(1);
      expect(d.documents[0].via).toBe("slot");
      expect(d.documents[0].at).toMatchObject({ document: "special", ownerId: death.id, articleId: art.id });
      expect(d.documents[0].label).toContain("일반상해사망 특별약관");
      expect(d.referencedBy).toEqual([]);
    });

    it("아무 구분자도 읽지 않는 필드 · 없는 경로 → discriminators 빈 배열", async () => {
      expect((await s.master.fieldUsage("waiver.applies")).discriminators).toEqual([]);
      expect((await s.master.fieldUsage("nope.nothing")).discriminators).toEqual([]);
    });
  });

  describe("formNodeCount — 폼이 서는 노드 수", () => {
    it("세목 폼 = 그 폼을 세목유형으로 고른 선택지 수 · product = 상품 수 · 담보 트리 레벨은 레벨 노드 수", async () => {
      productId = unwrap(await s.product.createProduct(editor, { name: "알파Plus" })).id;
      unwrap(await s.product.addPlanOption(editor, productId, { axis: "type", number: 1, name: "납입면제 미적용형", planTypeCode: "waiver" }));
      unwrap(await s.product.addPlanOption(editor, productId, { axis: "type", number: 2, name: "납입면제형", planTypeCode: "waiver" }));
      unwrap(await s.product.addPlanOption(editor, productId, { axis: "form", number: 1, name: "해약환급금지급형", planTypeCode: "no_surrender" }));

      // 세목 선택지는 제 세목유형 폼의 값만 갖는다 — 다른 유형의 선택지는 이 폼의 값 노드가 아니다
      expect(await s.master.formNodeCount(findForm("waiver")!)).toBe(2);
      expect(await s.master.formNodeCount(findForm("no_surrender")!)).toBe(1);
      expect(await s.master.formNodeCount(findForm("conversion")!)).toBe(0);
      // MVP 마스터에 상품 폼은 없다 — 레벨만 보는 규칙이라 가짜 폼으로 확인한다
      expect(await s.master.formNodeCount({ key: "product_x", label: "상품", level: "product", fields: [] })).toBe(1);
      expect(await s.master.formNodeCount(findForm("coverage_basic")!)).toBe(2);
      expect(await s.master.formNodeCount(findForm("pay")!)).toBe(2);
    });

    it("세목 값 노드는 그 폼 유형의 선택지만 — 라벨 「상품명 › 선택지 라벨」, href 는 상품 화면의 값 자리", async () => {
      const waiver = await s.master.valueNodes("waiver.applies");
      expect(waiver).toMatchObject({ total: 2, entered: 0, notEntered: 2 });
      expect(waiver.rows.map((r) => r.label)).toEqual(["알파Plus › 제1종(납입면제 미적용형)", "알파Plus › 제2종(납입면제형)"]);
      // href 는 그 선택지의 값 폼에 닿는다 — 선택지 좌표(option) + 강조 필드(field)
      expect(waiver.rows[0]).toMatchObject({ ownerKind: "plan", href: `/products/${productId}?option=${waiver.rows[0].ownerId}&field=waiver.applies` });

      const noSurrender = await s.master.valueNodes("no_surrender.type");
      expect(noSurrender.total).toBe(1);
      expect(noSurrender.rows[0].label).toBe("알파Plus › 제1형(해약환급금지급형)");
    });
  });

  describe("페이저 — 라벨 오름차순 · 20건", () => {
    it("담보 25개 → page 1 은 20행, page 2 는 5행", async () => {
      for (let i = 3; i <= 25; i += 1) {
        unwrap(await s.coverage.create(editor, { name: `담보${String(i).padStart(2, "0")}`, benefitName: `급부${i}` }));
      }
      const p1 = await s.master.valueNodes("coverage_basic.claim_name");
      expect(p1).toMatchObject({ total: 25, page: 1, pageSize: 20 });
      expect(p1.rows).toHaveLength(20);
      const p2 = await s.master.valueNodes("coverage_basic.claim_name", 2);
      expect(p2).toMatchObject({ total: 25, page: 2 });
      expect(p2.rows).toHaveLength(5);
      // 마지막을 넘는 페이지는 마지막으로, 0 이하는 1 로 죈다
      expect(await s.master.valueNodes("coverage_basic.claim_name", 9)).toMatchObject({ page: 2, rows: p2.rows });
      expect((await s.master.valueNodes("coverage_basic.claim_name", 0)).page).toBe(1);
      // 두 페이지를 이으면 라벨 오름차순 (localeCompare ko)
      const labels = [...p1.rows, ...p2.rows].map((r) => r.label);
      expect(labels).toEqual([...labels].sort((a, c) => a.localeCompare(c, "ko")));
    });
  });
});
