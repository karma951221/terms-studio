import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CoverageMasterSource, CoverageTree, ProductPlan, RequiredCoverageRef } from "@/domain/product";
import { entered, type Actor, type Issue, type Value } from "@/domain/types";

import { insertBaseContract } from "@/db/repo/product";
import { readSlots, writeSlot } from "@/db/repo/values";
import { createTestDb, type TestDb } from "@/db/test-utils";
import { createCatalogService } from "./catalog";
import { createProductService, type ProductService } from "./product";

const admin: Actor = { userId: "00000000-0000-4000-8000-000000000001", role: "admin" };
const editor: Actor = { userId: "00000000-0000-4000-8000-000000000002", role: "editor" };

function unwrap<T>(r: { ok: true; value: T } | { ok: false; rejection: unknown }): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}
function reason(r: { ok: boolean; rejection?: { reason: string } }): string | undefined {
  return r.ok ? undefined : r.rejection?.reason;
}

// ───────── 담보 마스터 스텁 (B1) ─────────
const DEATH = "aaaaaaaa-0000-4000-8000-000000000001";
const DEATH_SUB = "aaaaaaaa-0000-4000-8000-000000000011";
const DEATH_BEN = "aaaaaaaa-0000-4000-8000-000000000111";
const SURGERY = "aaaaaaaa-0000-4000-8000-000000000002";
const SURGERY_SUB1 = "aaaaaaaa-0000-4000-8000-000000000021";
const SURGERY_BEN1 = "aaaaaaaa-0000-4000-8000-000000000211";
const SURGERY_SUB2 = "aaaaaaaa-0000-4000-8000-000000000022";
const SURGERY_BEN2 = "aaaaaaaa-0000-4000-8000-000000000221";
const GENERAL_DOC = "dddddddd-0000-4000-8000-000000000001";
const OTHER_DOC = "dddddddd-0000-4000-8000-000000000002";
const NODE = "eeeeeeee-0000-4000-8000-000000000001";
const MASTER_OPTIONS = { style: "A", tone: "T1" }; // NODE 자리의 마스터 기본 선택
const SEED_NODE = "g-clause-1"; // 문서 노드 id 는 uuid 가 아닐 수 있다 (시드 로더는 id 를 보존한다)
const ART_A = "ffffffff-0000-4000-8000-000000000001"; // GENERAL_DOC 의 조
const ART_B = "ffffffff-0000-4000-8000-000000000002";
const ART_OTHER = "ffffffff-0000-4000-8000-000000000003"; // OTHER_DOC 의 조

const trees = new Map<string, CoverageTree>([
  [DEATH, { id: DEATH, name: "일반상해사망", subCoverages: [{ id: DEATH_SUB, name: "일반상해사망", order: 0, benefits: [{ id: DEATH_BEN, name: "사망보험금", order: 0 }] }] }],
  [SURGERY, { id: SURGERY, name: "수술비", subCoverages: [{ id: SURGERY_SUB1, name: "1종수술", order: 0, benefits: [{ id: SURGERY_BEN1, name: "1종수술급부", order: 0 }] }] }],
]);
const master: CoverageMasterSource = { tree: async (id) => trees.get(id) };

let required: RequiredCoverageRef[] = [];
let optionIssues: Issue[] = [];
/** 검증기에 들어온 선택을 엿본다 — 「합친 결과로 검사하는가」를 직접 본다. */
let validatorSpy: ((options: Record<string, string>) => void) | undefined;

describe("product 서비스 (PGlite)", () => {
  let t: TestDb;
  let svc: ProductService;
  let productId: string;
  let pcBasic: string; // 일반상해사망 (속성 없음)
  let pcAddon: string; // 일반상해사망 추가
  let pcSurgery: string; // 갱신형 수술비

  beforeAll(async () => {
    t = await createTestDb();
    const catalog = createCatalogService(t.db);
    // 값 자리는 MVP 마스터가 정한다 — 담보 claim_name · 급부 pay.exempt · pay.rate ·
    // 세목 waiver{applies · reasons} · no_surrender{type}. 상품 레벨은 비어 있다 (ADR-0037).
    unwrap(await catalog.createEnum(editor, { label: "납입면제사유", values: [{ label: "질병" }, { label: "상해" }] })); // E0001
    unwrap(await catalog.createEnum(editor, { label: "해약환급금유형", values: [{ label: "지급형" }, { label: "미지급형" }] })); // E0002
    // 상품특성(상품 레벨)이 가리키는 다섯 — 고지유형 조건 규칙 · 계약형태(기본계약 규칙) 검사용 (2026-10-01)
    unwrap(await catalog.createEnum(editor, { label: "간편심사유형", values: [{ label: "3.0.5" }, { label: "3.5.5" }, { label: "3.10.5" }] })); // E0003
    unwrap(await catalog.createEnum(editor, { label: "건강고지유형", values: [{ label: "6년 건강고지형" }, { label: "10년 건강고지형" }] })); // E0004
    unwrap(await catalog.createEnum(editor, { label: "고지유형", values: [{ label: "일반심사" }, { label: "간편심사" }, { label: "건강고지" }] })); // E0005
    unwrap(await catalog.createEnum(editor, { label: "간편심사구분", values: [{ label: "단일심사" }, { label: "통합간편심사" }] })); // E0006
    unwrap(await catalog.createEnum(editor, { label: "계약형태", values: [{ label: "주계약" }, { label: "독립특약" }] })); // E0007 — 독립특약이면 기본계약 없음
    unwrap(await catalog.create(editor, { label: "담보명", level: "coverage", expression: "coverage_basic.claim_name" })); // D0001

    // 담보 마스터 값 (B1 이 공용 저장소에 넣는 것과 같은 자리)
    await writeSlot(t.db, { kind: "coverage", id: SURGERY }, "coverage_basic.claim_name", "수술보험금");
    await writeSlot(t.db, { kind: "benefit", id: SURGERY_BEN1 }, "pay.rate", 50);
    await writeSlot(t.db, { kind: "coverage", id: DEATH }, "coverage_basic.claim_name", "사망보험금");
    await writeSlot(t.db, { kind: "benefit", id: DEATH_BEN }, "pay.exempt", false);
    await writeSlot(t.db, { kind: "benefit", id: DEATH_BEN }, "pay.rate", 100);

    svc = createProductService(t.db, {
      coverageMaster: master,
      generalDocuments: {
        exists: async (id) => id === GENERAL_DOC || id === OTHER_DOC,
        articleIds: async (id) => (id === GENERAL_DOC ? [ART_A, ART_B] : id === OTHER_DOC ? [ART_OTHER] : []),
        // GENERAL_DOC 의 함수조항 참조 자리 하나 — 마스터 기본 선택은 { style: "A", tone: "T1" } 이다.
        clauseRef: async (id, nodeId) => (id === GENERAL_DOC && (nodeId === NODE || nodeId === SEED_NODE) ? { clauseCode: "C0001", options: MASTER_OPTIONS } : undefined),
      },
      generalAttachment: { requiredRefs: async () => required },
      optionValidator: {
        validate: async (_code, options) => {
          validatorSpy?.(options);
          return optionIssues;
        },
      },
    });
  });
  afterAll(async () => {
    await t.close();
  });

  describe("기본정보 한 번에 저장", () => {
    it("상품명·새 보험종목 값·조합을 함께 저장하고 기존 조합 ID를 유지한다", async () => {
      const p = unwrap(await svc.createProduct(editor, { name: "기본정보 통합 저장" }));
      const draftId = "bbbbbbbb-0000-4000-8000-000000000001";
      unwrap(await svc.saveBasic(editor, p.id, {
        name: "기본정보 통합 저장 완료", values: [],
        options: [{ id: draftId, isNew: true, axis: "type", number: 1, name: "보험료납입면제미적용형", planTypeCode: "waiver", values: [{ path: "waiver.applies", value: false }] }],
        combinations: [[draftId]],
      }));
      const options = await svc.listPlanOptions(p.id);
      const plans = await svc.listPlans(p.id);
      expect((await svc.getProduct(p.id))?.name).toBe("기본정보 통합 저장 완료");
      expect((await svc.getPlanOptionValues(options[0].id)).get("waiver.applies")).toEqual(entered(false));
      expect(plans[0].options[0].id).toBe(options[0].id);
      unwrap(await svc.saveBasic(editor, p.id, {
        name: "기본정보 통합 저장 완료", values: [], options: options.map((o) => ({ ...o, isNew: false, name: "수정한 종목", values: [] })), combinations: [[options[0].id]],
      }));
      expect((await svc.listPlans(p.id))[0].id).toBe(plans[0].id);
    });

    it("뒤쪽 값 또는 조합 검증이 실패하면 이름과 앞쪽 값도 쓰지 않는다", async () => {
      const p = unwrap(await svc.createProduct(editor, { name: "기본정보 원자성" }));
      const o = unwrap(await svc.addPlanOption(editor, p.id, { axis: "type", number: 1, name: "기존", planTypeCode: "waiver" }));
      const input = { name: "바뀌면 안 됨", values: [], options: [{ ...o, isNew: false, values: [{ path: "waiver.applies", value: true }, { path: "waiver.reasons", value: 123 }] }], combinations: [[o.id]] };
      expect(reason(await svc.saveBasic(editor, p.id, input))).toBe("invalid");
      expect((await svc.getProduct(p.id))?.name).toBe("기본정보 원자성");
      expect((await svc.getPlanOptionValues(o.id)).get("waiver.applies")).toBeUndefined();
      expect(reason(await svc.saveBasic(editor, p.id, { ...input, options: [{ ...o, isNew: false, values: [] }], combinations: [[o.id], [o.id]] }))).toBe("invalid");
      expect((await svc.getProduct(p.id))?.name).toBe("기본정보 원자성");
      expect(await svc.listPlans(p.id)).toEqual([]);
    });

    it("납입면제 적용여부 = 예인데 사유가 0개면 저장 거부 — 저장된 값 위에 이번 제출을 얹은 최종 상태로 본다 (결정 16)", async () => {
      const p = unwrap(await svc.createProduct(editor, { name: "기본정보 납입면제 폼 검사" }));
      const draftId = "bbbbbbbb-0000-4000-8000-000000000002";
      const draft = { id: draftId, isNew: true, axis: "type" as const, number: 1, name: "보험료납입면제형", planTypeCode: "waiver" };
      const r = await svc.saveBasic(editor, p.id, { name: p.name, values: [], options: [{ ...draft, values: [{ path: "waiver.applies", value: true }] }], combinations: [] });
      expect(reason(r)).toBe("invalid");
      if (!r.ok && r.rejection.reason === "invalid") expect(r.rejection.issues[0]).toMatchObject({ message: expect.stringContaining("납입면제사유"), at: { refPath: "waiver.reasons" } });
      expect(await svc.listPlanOptions(p.id)).toEqual([]);
      unwrap(await svc.saveBasic(editor, p.id, { name: p.name, values: [], options: [{ ...draft, values: [{ path: "waiver.applies", value: true }, { path: "waiver.reasons", value: ["V02"] }] }], combinations: [] }));
      // 기존 종목 — 사유를 싣지 않은 제출은 저장된 사유를 본다(통과), 사유를 비우는 제출은 거부
      const [o] = await svc.listPlanOptions(p.id);
      unwrap(await svc.saveBasic(editor, p.id, { name: p.name, values: [], options: [{ ...o, isNew: false, values: [{ path: "waiver.applies", value: true }] }], combinations: [] }));
      expect(reason(await svc.saveBasic(editor, p.id, { name: p.name, values: [], options: [{ ...o, isNew: false, values: [{ path: "waiver.reasons", value: [] }] }], combinations: [] }))).toBe("invalid");
      expect((await svc.getPlanOptionValues(o.id)).get("waiver.reasons")).toEqual(entered(["V02"]));
    });

    it("상품특성 고지유형 조건을 저장 때 검사한다 — 건강고지인데 건강고지유형 0개 · 통합간편심사인데 간편심사유형 1개면 거부 (2026-10-01)", async () => {
      const p = unwrap(await svc.createProduct(editor, { name: "기본정보 고지유형 검사" }));
      const save = (values: { path: string; value: Value }[]) => svc.saveBasic(editor, p.id, { name: p.name, values, options: [], combinations: [] });
      const health = await save([{ path: "feature.notice_kind", value: "V03" }]);
      expect(reason(health)).toBe("invalid");
      if (!health.ok && health.rejection.reason === "invalid") expect(health.rejection.issues[0]).toMatchObject({ at: { refPath: "feature.notice_type" } });
      expect((await svc.getProductValues(p.id)).get("feature.notice_kind")).toBeUndefined();

      const combined = [{ path: "feature.notice_kind", value: "V02" }, { path: "feature.review_scope", value: "V02" }];
      const one = await save([...combined, { path: "feature.review_type", value: ["V01"] }]);
      expect(reason(one)).toBe("invalid");
      if (!one.ok && one.rejection.reason === "invalid") expect(one.rejection.issues[0]).toMatchObject({ message: expect.stringContaining("2개 이상"), at: { refPath: "feature.review_type" } });

      unwrap(await save([...combined, { path: "feature.review_type", value: ["V01", "V02"] }]));
      expect((await svc.getProductValues(p.id)).get("feature.review_type")).toEqual(entered(["V01", "V02"]));
    });

    it("다른 상품의 종목을 거부하고 삭제는 권한·영향 확인 후에만 반영한다", async () => {
      const p = unwrap(await svc.createProduct(editor, { name: "기본정보 삭제" }));
      const other = unwrap(await svc.createProduct(editor, { name: "기본정보 다른 상품" }));
      const o = unwrap(await svc.addPlanOption(editor, p.id, { axis: "type", number: 1, name: "종목", planTypeCode: "waiver" }));
      unwrap(await svc.registerPlan(editor, p.id, [o.id]));
      expect(reason(await svc.saveBasic(editor, other.id, { name: other.name, values: [], options: [{ ...o, isNew: false, values: [] }], combinations: [] }))).toBe("invalid");
      const input = { name: "삭제 완료", values: [], options: [], combinations: [] };
      expect(reason(await svc.saveBasic(editor, p.id, input, { confirm: true }))).toBe("forbidden");
      expect(reason(await svc.saveBasic(admin, p.id, input))).toBe("needsConfirmation");
      expect((await svc.getProduct(p.id))?.name).toBe(p.name);
      unwrap(await svc.saveBasic(admin, p.id, input, { confirm: true }));
      expect(await svc.listPlanOptions(p.id)).toEqual([]);
      expect(await svc.listPlans(p.id)).toEqual([]);
    });
  });

  describe("계약형태 — 독립특약은 기본계약을 두지 않는다 (기능/상품 §3.1 · 2026-10-01)", () => {
    const STANDALONE = [{ path: "feature.contract_kind", value: "V02" }];

    it("기본계약이 있는 상품을 독립특약으로 저장 — 확인 먼저(편집자도), 확인 뒤 같은 저장에서 기본계약 해제 · 상품담보는 특별약관(미배치)으로 남는다", async () => {
      const p = unwrap(await svc.createProduct(editor, { name: "독립특약 전환" }));
      const base = unwrap(await svc.mount(editor, p.id, DEATH, [], "base"));
      const input = { name: p.name, values: STANDALONE, options: [], combinations: [] };
      const first = await svc.saveBasic(editor, p.id, input);
      expect(reason(first)).toBe("needsConfirmation");
      if (!first.ok && first.rejection.reason === "needsConfirmation") {
        expect(first.rejection.impact).toEqual({ valueRowsLost: 0, brokenRefs: [], cascade: ["기본계약 해제 · 일반상해사망 — 상품담보는 특별약관 표에 남습니다"] });
      }
      // 확인 전에는 아무것도 바뀌지 않는다
      expect((await svc.getProductValues(p.id)).get("feature.contract_kind")).toBeUndefined();
      expect(await svc.listBaseContractIds(p.id)).toEqual([base.id]);

      unwrap(await svc.saveBasic(editor, p.id, input, { confirm: true }));
      expect((await svc.getProductValues(p.id)).get("feature.contract_kind")).toEqual(entered("V02"));
      expect(await svc.listBaseContractIds(p.id)).toEqual([]);
      expect((await svc.listProductCoverages(p.id)).map((c) => c.id)).toEqual([base.id]);
      expect((await svc.listUnplaced(p.id)).map((c) => c.id)).toEqual([base.id]);
      // 기본계약 0 이 정상
      expect(unwrap(await svc.checkBaseContract(p.id))).toEqual([]);
    });

    it("세목 제거와 겹치면 확인은 한 번 — 세목 관문(관리자) 하나에 해제 줄이 함께 실린다", async () => {
      const p = unwrap(await svc.createProduct(editor, { name: "독립특약 전환 + 세목 제거" }));
      const o = unwrap(await svc.addPlanOption(editor, p.id, { axis: "type", number: 1, name: "종목", planTypeCode: "waiver" }));
      unwrap(await svc.registerPlan(editor, p.id, [o.id]));
      unwrap(await svc.mount(editor, p.id, DEATH, [], "base"));
      const input = { name: p.name, values: STANDALONE, options: [], combinations: [] };
      expect(reason(await svc.saveBasic(editor, p.id, input, { confirm: true }))).toBe("forbidden");
      const first = await svc.saveBasic(admin, p.id, input);
      expect(reason(first)).toBe("needsConfirmation");
      if (!first.ok && first.rejection.reason === "needsConfirmation") {
        expect(first.rejection.impact.cascade).toEqual(["보험종목 삭제 · 제1종(종목)", "종·형 조합 삭제 · (제1종)", "기본계약 해제 · 일반상해사망 — 상품담보는 특별약관 표에 남습니다"]);
      }
      unwrap(await svc.saveBasic(admin, p.id, input, { confirm: true }));
      expect(await svc.listPlanOptions(p.id)).toEqual([]);
      expect(await svc.listBaseContractIds(p.id)).toEqual([]);
    });

    it("독립특약 상품은 기본계약 표 탑재 · 지정을 거부한다 — 특별약관 탑재는 그대로", async () => {
      const p = unwrap(await svc.createProduct(editor, { name: "독립특약 탑재" }));
      unwrap(await svc.saveBasic(editor, p.id, { name: p.name, values: STANDALONE, options: [], combinations: [] }));
      const mounted = await svc.mount(editor, p.id, DEATH, [], "base");
      expect(reason(mounted)).toBe("invalid");
      if (!mounted.ok && mounted.rejection.reason === "invalid") expect(mounted.rejection.issues[0].message).toContain("독립특약 상품은 기본계약을 두지 않습니다");
      expect(await svc.listProductCoverages(p.id)).toEqual([]); // 반쪽(상품담보만)이 남지 않는다
      const special = unwrap(await svc.mount(editor, p.id, DEATH, []));
      unwrap(await svc.setGeneralDocument(editor, p.id, GENERAL_DOC));
      expect(reason(await svc.designateBaseContract(editor, p.id, special.id))).toBe("invalid");
      expect(unwrap(await svc.checkBaseContract(p.id))).toEqual([]);
    });

    it("우회로 독립특약 상품에 기본계약이 남아 있으면 검사가 오류로 드러낸다 · 주계약 0개는 여전히 noBaseContract", async () => {
      const p = unwrap(await svc.createProduct(editor, { name: "독립특약 우회" }));
      const pc = unwrap(await svc.mount(editor, p.id, DEATH, [], "base"));
      await writeSlot(t.db, { kind: "product", id: p.id }, "feature.contract_kind", "V02");
      const check = await svc.checkBaseContract(p.id);
      expect(reason(check)).toBe("invalid");
      if (!check.ok && check.rejection.reason === "invalid") expect(check.rejection.issues[0]).toMatchObject({ kind: "unsupported", message: expect.stringContaining("독립특약") });
      await writeSlot(t.db, { kind: "product", id: p.id }, "feature.contract_kind", "V01");
      unwrap(await svc.releaseBaseContract(editor, p.id, pc.id));
      const none = await svc.checkBaseContract(p.id);
      if (!none.ok && none.rejection.reason === "invalid") expect(none.rejection.issues[0].kind).toBe("noBaseContract");
      else throw new Error("주계약 0개는 noBaseContract 여야 한다");
    });
  });

  describe("담보속성탑재 S1 — 담보속성 카탈로그", () => {
    it("종류 「갱신유형」 A0001 · 「부가유형」 A0002 채번, 유효값(코드 1 · 2 …)·상품담보명 표기·종류 순서 저장", async () => {
      const renewal = unwrap(await svc.createAttributeKind(editor, { label: "갱신유형" }));
      expect(renewal.code).toBe("A0001");
      const r2 = unwrap(await svc.addAttributeValue(editor, "A0001", { label: "갱신형", fragment: "갱신형 " }));
      expect(r2.values[0]).toMatchObject({ code: "1", fragment: "갱신형" });
      const addon = unwrap(await svc.createAttributeKind(editor, { label: "부가유형" }));
      expect(addon).toMatchObject({ code: "A0002", order: 1 });
      unwrap(await svc.addAttributeValue(editor, "A0002", { label: "기본" }));
      unwrap(await svc.addAttributeValue(editor, "A0002", { label: "추가" }));
      unwrap(await svc.setNamingFragment(editor, "A0002", "2", " 추가"));
      expect((await svc.getAttributeKind("A0002"))?.values[1].fragment).toBe("추가");
      expect(await svc.getNamingTemplate()).toBe("[담보명]");
      unwrap(await svc.setNamingTemplate(editor, "[A0001] [담보명] [A0002]"));
      expect(await svc.getNamingTemplate()).toBe("[A0001] [담보명] [A0002]");
      // 적용 순서와 상품담보명 규칙의 칩 순서는 독립이다.
      unwrap(await svc.reorderAttributeKinds(editor, ["A0002", "A0001"]));
      expect((await svc.listAttributeKinds()).map((k) => k.code)).toEqual(["A0002", "A0001"]);
      unwrap(await svc.reorderAttributeKinds(editor, ["A0001", "A0002"]));
    });

    it("종류명 중복 거부 · 표시명 변경은 편집자 자유", async () => {
      expect(reason(await svc.createAttributeKind(editor, { label: "갱신유형" }))).toBe("duplicate");
      unwrap(await svc.renameAttributeValue(editor, "A0001", "1", "갱신형"));
      unwrap(await svc.renameAttributeKind(editor, "A0001", "갱신유형"));
    });
  });

  describe("세목구성 S1 — 상품 생성 · 보통약관 템플릿 선택 · 상품 레벨 값", () => {
    it("상품 「(무)알파Plus보장보험2604」 생성 → 보통약관 템플릿 1개 연결", async () => {
      const p = unwrap(await svc.createProduct(editor, { name: "(무)알파Plus보장보험2604" }));
      productId = p.id;
      expect(reason(await svc.createProduct(editor, { name: "(무)알파Plus보장보험2604" }))).toBe("duplicate");
      expect(reason(await svc.createProduct(editor, { name: " " }))).toBe("invalid");
      unwrap(await svc.setGeneralDocument(editor, productId, GENERAL_DOC));
      expect((await svc.getProduct(productId))?.generalDocumentId).toBe(GENERAL_DOC);
      // 없는 문서는 게이트가 거부
      expect(reason(await svc.setGeneralDocument(editor, productId, "dddddddd-0000-4000-8000-000000000099"))).toBe("notFound");
    });

    it("상품 레벨 값 자리는 공시이율 · 상품특성 두 폼 — 다른 레벨 자리는 거부된다 (ADR-0037 · 2026-09-28)", async () => {
      expect(reason(await svc.setProductValue(editor, productId, "coverage_basic.claim_name", "x"))).toBe("invalid"); // 담보 레벨 자리
      expect(reason(await svc.setProductValue(editor, productId, "product.nope", "x"))).toBe("invalid");
      expect(reason(await svc.setProductValue(editor, productId, "feature.renewable", "예"))).toBe("invalid"); // 타입 불일치
      // 완결성은 분모를 함께 준다 (디자인원칙 §9.6) — 상품 레벨 마스터 9자리 중 조건부 칸(간편심사구분 · 간편심사유형 · 건강고지유형)은
      // 고지유형이 미입력이라 자리가 없다. 분모와 미입력 목록이 같은 자리를 센다 → 6.
      expect(await svc.productCompleteness(productId)).toMatchObject({ total: 6 });
      unwrap(await svc.setProductValue(editor, productId, "disclosure.avg_rate", 2.5));
      unwrap(await svc.setProductValue(editor, productId, "feature.renewable", true));
      expect((await svc.getProductValues(productId)).get("disclosure.avg_rate")).toEqual({ entered: true, value: 2.5 });
      expect((await svc.productMissing(productId)).map((m) => m.path)).toEqual(["feature.contract_kind", "feature.fetal", "feature.group_contract", "feature.notice_kind"]);
      // 뒤 세목 검사가 세목 자리만 보도록 되돌린다(미입력으로)
      unwrap(await svc.setProductValue(editor, productId, "disclosure.avg_rate", undefined));
      unwrap(await svc.setProductValue(editor, productId, "feature.renewable", undefined));
    });
  });

  describe("세목구성 S2·S3·S5 — 세목 선택지와 유효 조합", () => {
    let t1: string, t2: string, f1: string, f2: string;
    it("종 축에 납입면제유형 1·2종, 형 축에 무저해지유형 1·2형 등록 · 유형 구조체 값 입력", async () => {
      t1 = unwrap(await svc.addPlanOption(editor, productId, { axis: "type", number: 1, name: "보험료 납입면제 미적용형", planTypeCode: "waiver" })).id;
      t2 = unwrap(await svc.addPlanOption(editor, productId, { axis: "type", number: 2, name: "보험료 납입면제형", planTypeCode: "waiver" })).id;
      f1 = unwrap(await svc.addPlanOption(editor, productId, { axis: "form", number: 1, name: "해약환급금지급형", planTypeCode: "no_surrender" })).id;
      f2 = unwrap(await svc.addPlanOption(editor, productId, { axis: "form", number: 2, name: "해약환급금미지급형", planTypeCode: "no_surrender" })).id;
      unwrap(await svc.setPlanOptionValue(editor, t2, "waiver.reasons", ["V02"]));
      expect((await svc.getPlanOptionValues(t2)).get("waiver.reasons")).toEqual({ entered: true, value: ["V02"] });
      expect(reason(await svc.setPlanOptionValue(editor, t2, "coverage_basic.claim_name", "x"))).toBe("invalid"); // 다른 레벨 자리
    });
    it("같은 레벨 · 다른 폼 거부 — 선택지는 제 세목유형 폼의 값만 갖는다 (코덱스 리뷰 Important 1)", async () => {
      // f1 은 no_surrender 유형 — waiver 폼은 같은 plan 레벨이지만 이 선택지의 자리가 아니다
      const r = await svc.setPlanOptionValue(editor, f1, "waiver.applies", true);
      expect(reason(r)).toBe("invalid");
      if (!r.ok && r.rejection.reason === "invalid") {
        expect(r.rejection.issues[0]).toMatchObject({ kind: "brokenRef", at: { refPath: "waiver.applies" } });
        expect(r.rejection.issues[0].message).toContain("no_surrender");
      }
      expect((await svc.getPlanOptionValues(f1)).has("waiver.applies")).toBe(false);
      // 미입력으로 되돌리기(undefined)도 같은 규칙
      expect(reason(await svc.setPlanOptionValue(editor, f1, "waiver.applies", undefined))).toBe("invalid");
      unwrap(await svc.setPlanOptionValue(editor, f1, "no_surrender.type", "V01"));
    });
    it("한 제출은 한 트랜잭션 — 뒤 자리가 거부되면 앞 자리도 안 바뀐다 (코덱스 리뷰 2026-09-14 Important 2)", async () => {
      unwrap(await svc.setPlanOptionValue(editor, t1, "waiver.applies", false));
      const r = await svc.setPlanOptionValues(editor, t1, [
        { path: "waiver.applies", value: true },
        { path: "waiver.reasons", value: ["DOES_NOT_EXIST"] },
      ]);
      expect(reason(r)).toBe("invalid");
      if (!r.ok && r.rejection.reason === "invalid") expect(r.rejection.issues.map((i) => i.at.refPath)).toEqual(["waiver.reasons"]);
      expect((await svc.getPlanOptionValues(t1)).get("waiver.applies")).toEqual({ entered: true, value: false });
      // 폼 소속 거부도 제출 전체를 막는다 — 거부 issue 는 자리마다 모아 돌려준다
      const r2 = await svc.setPlanOptionValues(editor, t1, [
        { path: "waiver.applies", value: true },
        { path: "no_surrender.type", value: "V01" },
      ]);
      expect(reason(r2)).toBe("invalid");
      expect((await svc.getPlanOptionValues(t1)).get("waiver.applies")).toEqual({ entered: true, value: false });
      // 전부 통하면 전부 쓴다
      // 적용여부 = 예 + 사유 0개는 폼 교차 규칙 위반 (결정 16) — 사유를 고른 제출만 통한다
      expect(reason(await svc.setPlanOptionValues(editor, t1, [{ path: "waiver.applies", value: true }, { path: "waiver.reasons", value: [] }]))).toBe("invalid");
      expect(reason(await svc.setPlanOptionValue(editor, t1, "waiver.applies", true))).toBe("invalid"); // 저장된 사유 없음 = 0개
      expect((await svc.getPlanOptionValues(t1)).get("waiver.applies")).toEqual({ entered: true, value: false });
      unwrap(await svc.setPlanOptionValues(editor, t1, [{ path: "waiver.applies", value: true }, { path: "waiver.reasons", value: ["V02"] }]));
      expect((await svc.getPlanOptionValues(t1)).get("waiver.applies")).toEqual({ entered: true, value: true });
      // 되돌리기도 한 제출로 — 다음 테스트(완결성)가 t1 미입력을 전제한다
      unwrap(await svc.setPlanOptionValues(editor, t1, [{ path: "waiver.applies", value: undefined }, { path: "waiver.reasons", value: undefined }]));
      expect((await svc.getPlanOptionValues(t1)).has("waiver.applies")).toBe(false);
      // 상품 레벨도 같은 규칙 — 없는 자리가 섞이면 아무것도 안 쓴다
      expect(reason(await svc.setProductValues(editor, productId, [{ path: "nope.x", value: 1 }]))).toBe("invalid");
    });
    it("상품 완결성이 세목 선택지 자리를 센다 — 선택지마다 제 폼의 필드만 (코덱스 리뷰 T2 ④)", async () => {
      // 상품 레벨 6자리(전부 미입력 — 조건부 칸 셋은 고지유형 미입력이라 자리가 없다) + 선택지 4개: waiver(2자리) × 2 + no_surrender(1자리) × 2 = 6
      const all = await svc.productCompleteness(productId);
      expect(all.total).toBe(12);
      const summary = { ...all, missing: all.missing.filter((m) => m.level === "plan") };
      // 입력됨: t2 waiver.reasons · f1 no_surrender.type → 미입력 4. 순서는 선택지 목록 순(축 · 번호).
      expect(summary.missing.map((m) => [m.owner.kind, m.ownerName, m.path])).toEqual([
        ["plan", "제2형(해약환급금미지급형)", "no_surrender.type"],
        ["plan", "제1종(보험료 납입면제 미적용형)", "waiver.applies"],
        ["plan", "제1종(보험료 납입면제 미적용형)", "waiver.reasons"],
        ["plan", "제2종(보험료 납입면제형)", "waiver.applies"],
      ]);
      // 상품 레벨 미입력은 6 — 고지유형이 미입력이라 조건부 칸 셋은 자리가 없다
      expect(all.missing.filter((m) => m.level === "product")).toHaveLength(6);
      expect(await svc.productMissing(productId)).toEqual(all.missing);
    });
    it("마스터에 없는 그룹은 세목유형이 아니다 · 한 유형은 한 축에만 · 번호 중복 거부", async () => {
      expect(reason(await svc.addPlanOption(editor, productId, { axis: "type", number: 3, name: "x", planTypeCode: "nope" }))).toBe("invalid");
      expect(reason(await svc.addPlanOption(editor, productId, { axis: "form", number: 3, name: "x", planTypeCode: "waiver" }))).toBe("invalid");
      expect(reason(await svc.addPlanOption(editor, productId, { axis: "type", number: 1, name: "x", planTypeCode: "waiver" }))).toBe("invalid");
    });
    it("(1종,1형)·(2종,1형)·(2종,2형) 명시 등록 — 카테시안 아님 · 중복 거부 · 축 누락 거부", async () => {
      unwrap(await svc.registerPlan(editor, productId, [t1, f1]));
      unwrap(await svc.registerPlan(editor, productId, [t2, f1]));
      const p3 = unwrap(await svc.registerPlan(editor, productId, [f2, t2]));
      expect(p3.options.map((o) => o.axis)).toEqual(["type", "form"]);
      expect(reason(await svc.registerPlan(editor, productId, [f1, t1]))).toBe("duplicate");
      expect(reason(await svc.registerPlan(editor, productId, [t1]))).toBe("invalid");
      expect((await svc.listPlans(productId)).length).toBe(3);
    });
    it("0종 0형 상품은 조합 0건이 정상 — 담보 탑재까지 정상 진행", async () => {
      const p = unwrap(await svc.createProduct(editor, { name: "0종0형 상품" }));
      expect(await svc.listPlans(p.id)).toEqual([]);
      const pc = unwrap(await svc.mount(editor, p.id, DEATH, [], "base"));
      expect(pc.name).toBe("일반상해사망");
      expect(await svc.listBaseContractIds(p.id)).toEqual([pc.id]);
    });
  });

  describe("담보속성탑재 S2·S3·S4 — 탑재 = 담보 × 속성 조합 · 작명 · 스냅샷", () => {
    it("일반상해사망을 속성 없이, 그리고 부가유형=추가 로 탑재 — 다중 탑재 · 같은 조합 재탑재 거부", async () => {
      const a = unwrap(await svc.mount(editor, productId, DEATH, []));
      pcBasic = a.id;
      expect(a.name).toBe("일반상해사망");
      const b = unwrap(await svc.mount(editor, productId, DEATH, [{ kindCode: "A0002", valueCode: "2" }]));
      pcAddon = b.id;
      expect(b.name).toBe("일반상해사망 추가");
      expect(reason(await svc.mount(editor, productId, DEATH, [{ kindCode: "A0002", valueCode: "2" }]))).toBe("duplicate");
      expect(reason(await svc.mount(editor, productId, "aaaaaaaa-0000-4000-8000-000000000099", []))).toBe("notFound");
      expect(reason(await svc.mount(editor, productId, DEATH, [{ kindCode: "A0009", valueCode: "1" }]))).toBe("invalid");
    });

    it("수술비 × 갱신형 → 「갱신형 수술비」 · 스냅샷: 담보·급부 값 복사 + 마스터 부착(감액기간) 복사", async () => {
      const s = unwrap(await svc.mount(editor, productId, SURGERY, [{ kindCode: "A0001", valueCode: "1" }]));
      pcSurgery = s.id;
      expect(s.name).toBe("갱신형 수술비");
      const snap = unwrap(await svc.getSnapshot(pcSurgery));
      expect(snap.coverageName).toBe("수술비");
      expect(snap.subCoverages).toHaveLength(1);
      expect(snap.subCoverages[0].benefits).toHaveLength(1);
      const benefitNode = snap.subCoverages[0].benefits[0];
      expect((await readSlots(t.db, { kind: "productCoverage", id: pcSurgery })).get("coverage_basic.claim_name")).toEqual({ entered: true, value: "수술보험금" });
      expect((await readSlots(t.db, { kind: "productBenefit", id: benefitNode.id })).get("pay.rate")).toEqual({ entered: true, value: 50 });
      // 스냅샷 값 조회 API
      const values = await svc.getSnapshotValues(pcSurgery);
      expect(values.get(benefitNode.id)?.get("pay.rate")).toEqual({ entered: true, value: 50 });
    });

    it("마스터 지급률 60% 변경 → 이미 탑재된 「갱신형 수술비」는 50% 유지 · 필드 단위 70% 수정 · 새 탑재분은 60%", async () => {
      await writeSlot(t.db, { kind: "benefit", id: SURGERY_BEN1 }, "pay.rate", 60);
      const snap = unwrap(await svc.getSnapshot(pcSurgery));
      const ben = snap.subCoverages[0].benefits[0];
      expect((await svc.getSnapshotValues(pcSurgery)).get(ben.id)?.get("pay.rate")).toEqual({ entered: true, value: 50 });
      unwrap(await svc.setSnapshotValue(editor, pcSurgery, { kind: "productBenefit", id: ben.id }, "pay.rate", 70));
      expect((await svc.getSnapshotValues(pcSurgery)).get(ben.id)?.get("pay.rate")).toEqual({ entered: true, value: 70 });
      expect(reason(await svc.setSnapshotValue(editor, pcSurgery, { kind: "productBenefit", id: ben.id }, "pay.rate", "70%"))).toBe("invalid");
      expect(reason(await svc.setSnapshotValue(editor, pcSurgery, { kind: "productBenefit", id: ben.id }, "coverage_basic.claim_name", "x"))).toBe("invalid"); // 급부에 담보 레벨 자리
      // 다른 상품담보의 노드는 거부
      expect(reason(await svc.setSnapshotValue(editor, pcBasic, { kind: "productBenefit", id: ben.id }, "pay.rate", 1))).toBe("notFound");

      const again = unwrap(await svc.mount(editor, productId, SURGERY, [{ kindCode: "A0002", valueCode: "2" }]));
      const snap2 = unwrap(await svc.getSnapshot(again.id));
      expect((await svc.getSnapshotValues(again.id)).get(snap2.subCoverages[0].benefits[0].id)?.get("pay.rate")).toEqual({ entered: true, value: 60 });
      unwrap(await svc.unmount(admin, again.id, { confirm: true }));
    });

    it("이름 수동 변경 「갱신형 수술비Ⅱ」 → 규칙 재생성으로 되돌림 · 속성 조합 수정(중복 검사) 후 재생성", async () => {
      unwrap(await svc.renameProductCoverage(editor, pcSurgery, "갱신형 수술비Ⅱ"));
      expect((await svc.getProductCoverage(pcSurgery))?.name).toBe("갱신형 수술비Ⅱ");
      expect(reason(await svc.renameProductCoverage(editor, pcSurgery, " "))).toBe("invalid");
      expect(unwrap(await svc.regenerateName(editor, pcSurgery)).name).toBe("갱신형 수술비");
      expect(reason(await svc.setAttributes(editor, pcAddon, []))).toBe("duplicate"); // 「일반상해사망」과 같은 조합
      const changed = unwrap(await svc.setAttributes(editor, pcAddon, [{ kindCode: "A0002", valueCode: "2" }, { kindCode: "A0001", valueCode: "1" }], { regenerateName: true }));
      expect(changed.name).toBe("갱신형 일반상해사망 추가");
      expect(changed.attributes.map((a) => a.kindCode)).toEqual(["A0001", "A0002"]);
      unwrap(await svc.setAttributes(editor, pcAddon, [{ kindCode: "A0002", valueCode: "2" }], { regenerateName: true }));
    });

    it("syncStructure — 마스터에 세부보장이 추가되면 빈 대응 노드, 사라지면 값 행과 함께 삭제", async () => {
      trees.set(SURGERY, {
        id: SURGERY,
        name: "수술비",
        subCoverages: [
          { id: SURGERY_SUB1, name: "1종수술", order: 0, benefits: [{ id: SURGERY_BEN1, name: "1종수술급부", order: 0 }] },
          { id: SURGERY_SUB2, name: "2종수술", order: 1, benefits: [{ id: SURGERY_BEN2, name: "2종수술급부", order: 0 }] },
        ],
      });
      const r = unwrap(await svc.syncStructure(pcSurgery));
      expect(r.added).toBe(2);
      const snap = unwrap(await svc.getSnapshot(pcSurgery));
      expect(snap.subCoverages.map((s) => s.name)).toEqual(["1종수술", "2종수술"]);
      const newBen = snap.subCoverages[1].benefits[0];
      expect((await svc.getSnapshotValues(pcSurgery)).get(newBen.id)?.size ?? 0).toBe(0); // 빈 값
      // 완결성: 새 급부는 선택 필드뿐이라 미입력이 없다. 새 급부에 면책 폼을 열면(신규만) 그 폼의 빈 자리가 잡힌다
      expect(await svc.coverageMissing(pcSurgery)).toEqual([]);
      await writeSlot(t.db, { kind: "productBenefit", id: newBen.id }, "exemption.new_only", true);
      const missing = await svc.coverageMissing(pcSurgery);
      expect(missing.map((m) => `${m.ownerName}:${m.path}`).sort()).toEqual([
        "2종수술급부:exemption.age15_only",
        "2종수술급부:exemption.months",
      ]);
      // 분모: 담보명 1 + 1종수술급부 입력한 지급률 1 + 2종수술급부 연 면책 폼 3 = 5 (값 없는 선택 필드는 세지 않는다)
      const summary = await svc.coverageCompleteness(pcSurgery);
      expect(summary.total).toBe(5);
      expect(summary.missing).toHaveLength(2);

      await writeSlot(t.db, { kind: "productBenefit", id: newBen.id }, "pay.exempt", true);
      trees.set(SURGERY, { id: SURGERY, name: "수술비", subCoverages: [{ id: SURGERY_SUB1, name: "1종수술", order: 0, benefits: [{ id: SURGERY_BEN1, name: "1종수술급부", order: 0 }] }] });
      const r2 = unwrap(await svc.syncStructure(pcSurgery));
      expect(r2.removed).toBe(2);
      expect((await readSlots(t.db, { kind: "productBenefit", id: newBen.id })).size).toBe(0);
      expect(unwrap(await svc.getSnapshot(pcSurgery)).subCoverages).toHaveLength(1);
    });

    it("되돌릴 수 있는 필드 — 스냅샷이 마스터와 달라진 값 자리를 센다 (디자인원칙 §1.2)", async () => {
      const before = await svc.snapshotDrift(pcBasic);
      unwrap(await svc.setSnapshotValue(editor, pcBasic, { kind: "productCoverage", id: pcBasic }, "coverage_basic.claim_name", "달라진 이름")); // 마스터는 「사망보험금」
      expect(await svc.snapshotDrift(pcBasic)).toBe(before + 1);
      unwrap(await svc.setSnapshotValue(editor, pcBasic, { kind: "productCoverage", id: pcBasic }, "coverage_basic.claim_name", "사망보험금")); // 마스터와 같아지면 다시 준다
      expect(await svc.snapshotDrift(pcBasic)).toBe(before);
    });

    it("getSnapshotMasterValues — owner id(상품담보 자신 · 노드) → 마스터 값 자리, 없는 상품담보는 빈 맵", async () => {
      const masterValues = await svc.getSnapshotMasterValues(pcSurgery);
      expect(masterValues.get(pcSurgery)?.get("coverage_basic.claim_name")).toEqual({ entered: true, value: "수술보험금" }); // 담보 마스터
      const snap = unwrap(await svc.getSnapshot(pcSurgery));
      const ben = snap.subCoverages[0].benefits[0];
      expect(masterValues.get(ben.id)?.get("pay.rate")).toEqual({ entered: true, value: 60 }); // 급부 마스터 (앞선 테스트에서 50 → 60 으로 바뀜)
      expect((await svc.getSnapshotMasterValues("cccccccc-0000-4000-8000-000000000099")).size).toBe(0);
    });
  });

  describe("담보속성탑재 S5 — 상품담보별 세목 부착 · 기본계약 지정 (기능/상품 §3.5)", () => {
    /** 조합을 축 번호로 찾는다 — 목록 순서(등록 시각)에 기대지 않는다. */
    async function plansByNumbers(): Promise<ProductPlan[]> {
      const key = (p: ProductPlan) => p.options.map((o) => o.number).join(",");
      return (await svc.listPlans(productId)).sort((a, b) => key(a).localeCompare(key(b)));
    }

    it("「갱신형 수술비」에 (1종,1형)·(2종,1형)만 부착 — 상품담보마다 다르다. 다른 상품의 조합·미등록 조합은 거부", async () => {
      const plans = await plansByNumbers(); // [0]=(1,1) [1]=(2,1) [2]=(2,2)
      unwrap(await svc.attachPlan(editor, pcSurgery, plans[0].id));
      unwrap(await svc.attachPlan(editor, pcSurgery, plans[1].id));
      expect((await svc.listAttachedPlans(pcSurgery)).map((p) => p.id)).toEqual([plans[0].id, plans[1].id]);
      expect(await svc.listAttachedPlans(pcBasic)).toEqual([]); // 기본은 미부착
      expect(reason(await svc.attachPlan(editor, pcSurgery, "cccccccc-0000-4000-8000-000000000001"))).toBe("notFound");
      // 세목 해제는 파괴적 (product.detachPlan) — 편집자 forbidden · 관리자 2단
      expect(reason(await svc.detachPlan(editor, pcSurgery, plans[1].id))).toBe("forbidden");
      expect(reason(await svc.detachPlan(admin, pcSurgery, plans[1].id))).toBe("needsConfirmation");
      unwrap(await svc.detachPlan(admin, pcSurgery, plans[1].id, { confirm: true }));
      expect((await svc.listAttachedPlans(pcSurgery)).length).toBe(1);
    });

    it("유효 조합 삭제 — 부착한 상품담보를 영향으로 보여주고 확인 후 연쇄 해제 (D-P5-12)", async () => {
      const plans = await plansByNumbers(); // [0]=(1,1) — 부착 중
      const first = await svc.removePlan(admin, plans[0].id);
      expect(first.ok).toBe(false);
      if (!first.ok && first.rejection.reason === "needsConfirmation") expect(first.rejection.impact.cascade).toEqual(["세목 부착 갱신형 수술비"]);
      unwrap(await svc.removePlan(admin, plans[0].id, { confirm: true }));
      expect(await svc.listAttachedPlans(pcSurgery)).toEqual([]);
      expect((await svc.listPlans(productId)).length).toBe(2);
    });

    it("기본계약 지정 → 보통약관 부착 검사 · 두 번째 지정은 거부 (기능/상품 §3 「기본계약」 · MVP 정확히 1개)", async () => {
      // 보통약관이 요구하는 구분자 중 D0009 는 카탈로그에 없다 — 값 자리가 아니라 정의가 없는 것이다 (ADR-0037)
      required = [
        { level: "coverage", discriminatorCode: "D0001" },
        { level: "coverage", discriminatorCode: "D0009", at: { document: "general", articleTitle: "감액" } },
      ];
      const r = unwrap(await svc.designateBaseContract(editor, productId, pcBasic));
      expect(r.productCoverageId).toBe(pcBasic);
      expect(r.issues.map((i) => [i.kind, i.at.refPath])).toEqual([["brokenRef", "D0009"]]);
      // 이미 기본계약이 있으면 두 번째 지정은 거부 — 다른 상품담보든 같은 상품담보든 (이미 기본계약이므로 같은 문구)
      const second = await svc.designateBaseContract(editor, productId, pcAddon);
      expect(reason(second)).toBe("invalid");
      if (!second.ok && second.rejection.reason === "invalid") {
        expect(second.rejection.issues).toHaveLength(1);
        expect(second.rejection.issues[0]).toMatchObject({ kind: "unsupported", message: "기본계약은 하나만 지정할 수 있습니다 — 먼저 현재 기본계약을 해제하세요 (MVP)", at: { document: "product", ownerId: productId, refPath: "baseContract" } });
      }
      const again = await svc.designateBaseContract(editor, productId, pcBasic);
      expect(reason(again)).toBe("invalid");
      if (!again.ok && again.rejection.reason === "invalid") expect(again.rejection.issues[0].kind).toBe("unsupported");
      expect(await svc.listBaseContractIds(productId)).toEqual([pcBasic]);
      // 탑재하면서 기본계약으로 넣는 경로(mount section:"base")도 같은 규칙 — 상품담보도 만들어지지 않는다
      const countBefore = (await svc.listProductCoverages(productId)).length;
      const mounted = await svc.mount(editor, productId, SURGERY, [{ kindCode: "A0002", valueCode: "1" }], "base");
      expect(reason(mounted)).toBe("invalid");
      if (!mounted.ok && mounted.rejection.reason === "invalid") expect(mounted.rejection.issues[0].kind).toBe("unsupported");
      expect((await svc.listProductCoverages(productId)).length).toBe(countBefore);
      expect(await svc.listBaseContractIds(productId)).toEqual([pcBasic]);
      // 해제 후에는 다시 지정할 수 있다
      unwrap(await svc.releaseBaseContract(editor, productId, pcBasic));
      unwrap(await svc.designateBaseContract(editor, productId, pcAddon));
      expect(await svc.listBaseContractIds(productId)).toEqual([pcAddon]);
      unwrap(await svc.releaseBaseContract(editor, productId, pcAddon));
      unwrap(await svc.designateBaseContract(editor, productId, pcBasic));
      expect(unwrap(await svc.checkBaseContract(productId)).map((c) => c.productCoverageId)).toEqual([pcBasic]);
      // 기본계약인 상품담보의 탑재 해제는 거부 (D-P5-7)
      expect(reason(await svc.unmount(admin, pcBasic, { confirm: true }))).toBe("invalid");
    });

    it("기존 데이터에 기본계약이 2행이면 읽기 검사가 unsupported 로 잡는다 — 좌표 refPath baseContract · 「하나만 남기고 해제하세요」", async () => {
      // 서비스는 두 번째 지정을 막으므로 2행은 리포로 직접 만든다 (기존 데이터 · 우회 저장을 흉내)
      await insertBaseContract(t.db, productId, pcAddon, editor.userId);
      expect(await svc.listBaseContractIds(productId)).toEqual([pcBasic, pcAddon]);
      const multiple = await svc.checkBaseContract(productId);
      expect(reason(multiple)).toBe("invalid");
      if (!multiple.ok && multiple.rejection.reason === "invalid") {
        expect(multiple.rejection.issues).toHaveLength(1);
        expect(multiple.rejection.issues[0]).toMatchObject({
          kind: "unsupported",
          message: "기본계약이 2개입니다 — 하나만 남기고 해제하세요 (MVP 는 1개)",
          at: { document: "product", ownerId: productId, refPath: "baseContract" },
          source: { document: "product", ownerId: productId, refPath: "baseContract" },
        });
      }
      // 2행 상태에서도 지정은 거부 (이미 있으므로)
      expect(reason(await svc.designateBaseContract(editor, productId, pcSurgery))).toBe("invalid");
      unwrap(await svc.releaseBaseContract(editor, productId, pcAddon));
      expect(unwrap(await svc.checkBaseContract(productId)).map((c) => c.productCoverageId)).toEqual([pcBasic]);
    });

    it("기본계약 해제 → 미지정 상태(noBaseContract) · 다른 상품의 상품담보는 지정 불가", async () => {
      unwrap(await svc.releaseBaseContract(editor, productId, pcBasic));
      const check = await svc.checkBaseContract(productId);
      expect(reason(check)).toBe("invalid");
      if (!check.ok && check.rejection.reason === "invalid") expect(check.rejection.issues[0]).toMatchObject({ kind: "noBaseContract", at: { document: "product", ownerId: productId, refPath: "baseContract" } });
      const other = unwrap(await svc.createProduct(editor, { name: "다른 상품" }));
      expect(reason(await svc.designateBaseContract(editor, other.id, pcBasic))).toBe("notFound");
      unwrap(await svc.designateBaseContract(editor, productId, pcBasic));
    });
  });

  describe("기능/상품 §3 특약 그룹 — 자동 정렬 · 미배치", () => {
    it("그룹 「상해 관련 특별약관」 생성 → 배치 → 그룹 안은 담보→종류→값 순 자동 정렬, 미배치 목록", async () => {
      const g = unwrap(await svc.createGroup(editor, productId, { title: "상해 관련 특별약관" }));
      expect(g.order).toBe(0);
      const g2 = unwrap(await svc.createGroup(editor, productId, { title: "기타" }));
      expect(g2.order).toBe(1);
      expect(reason(await svc.createGroup(editor, productId, { title: "x", generalDocumentId: OTHER_DOC }))).toBe("invalid");
      unwrap(await svc.createGroup(editor, productId, { title: "같은 템플릿", generalDocumentId: GENERAL_DOC }));

      unwrap(await svc.placeInGroup(editor, g.id, pcAddon));
      unwrap(await svc.placeInGroup(editor, g.id, pcBasic));
      const view = await svc.listGroups(productId);
      expect(view[0].members.map((m) => m.name)).toEqual(["일반상해사망", "일반상해사망 추가"]);
      expect((await svc.listUnplaced(productId)).map((m) => m.name)).toEqual(["갱신형 수술비"]);
      // 옮기기: 한 상품담보는 한 그룹에만
      unwrap(await svc.placeInGroup(editor, g2.id, pcBasic));
      expect((await svc.listGroups(productId))[1].members.map((m) => m.id)).toEqual([pcBasic]);
      unwrap(await svc.removeFromGroup(editor, pcBasic));
      expect((await svc.listUnplaced(productId)).length).toBe(2);
      unwrap(await svc.renameGroup(editor, g2.id, "기타 특별약관"));
      unwrap(await svc.reorderGroups(editor, productId, [g2.id, g.id, (await svc.listGroups(productId))[2].id]));
      expect((await svc.listGroups(productId))[0].title).toBe("기타 특별약관");
      unwrap(await svc.deleteGroup(editor, g2.id));
      expect((await svc.listGroups(productId)).length).toBe(2);
    });
  });

  describe("기능/상품 §3.6 — 함수조항 옵션 오버라이드", () => {
    const scope = () => ({ kind: "product", id: productId }) as const;

    it("오버라이드는 보통약관 자리(상품 스코프)만 — 유효 집합 밖은 거부 · 없는 상품은 notFound (기능/상품 §3.6)", async () => {
      const o = unwrap(await svc.setOptionOverride(editor, scope(), NODE, "C0001", { style: "B", tone: "T2" }));
      expect(o?.options).toEqual({ style: "B", tone: "T2" });
      unwrap(await svc.setOptionOverride(editor, scope(), NODE, "C0001", { style: "C", tone: "T2" }));
      expect((await svc.listOptionOverrides(scope())).map((x) => x.options)).toEqual([{ style: "C", tone: "T2" }]);
      optionIssues = [{ kind: "optionInvalid", message: "없는 옵션", at: {} }];
      expect(reason(await svc.setOptionOverride(editor, scope(), NODE, "C0001", { style: "Z" }))).toBe("invalid");
      optionIssues = [];
      expect(reason(await svc.setOptionOverride(editor, { kind: "product", id: "cccccccc-0000-4000-8000-000000000009" }, NODE, "C0001", {}))).toBe("notFound");
      unwrap(await svc.removeOptionOverride(editor, scope(), NODE, "C0001"));
      expect(await svc.listOptionOverrides(scope())).toEqual([]);
    });

    it("부분 오버라이드 — 마스터 기본과 합쳐 검사하고 차이만 저장한다 (코덱스 리뷰 2026-09-15 Important-1)", async () => {
      // 옵션 하나(style)만 바꾼다 — 나머지(tone)는 마스터 기본이라 「미선택」이 아니다.
      // 검증기에 들어간 것이 합친 결과인지 직접 본다.
      const seen: Record<string, string>[] = [];
      validatorSpy = (options) => void seen.push(options);
      const o = unwrap(await svc.setOptionOverride(editor, scope(), NODE, "C0001", { style: "B" }));
      validatorSpy = undefined;
      expect(seen).toEqual([{ style: "B", tone: "T1" }]);
      expect(o?.options).toEqual({ style: "B" }); // 저장은 차이만

      // 옵션 하나를 마스터로 되돌리면 그 키가 빠진다
      expect(unwrap(await svc.setOptionOverride(editor, scope(), NODE, "C0001", { style: "B", tone: "T2" }))?.options).toEqual({ style: "B", tone: "T2" });
      expect(unwrap(await svc.setOptionOverride(editor, scope(), NODE, "C0001", { style: "B", tone: "T1" }))?.options).toEqual({ style: "B" });

      // 전부 마스터로 돌아가면 행 자체를 지운다 — 빈 오버라이드를 남기지 않는다
      expect(unwrap(await svc.setOptionOverride(editor, scope(), NODE, "C0001", MASTER_OPTIONS))).toBeUndefined();
      expect(await svc.listOptionOverrides(scope())).toEqual([]);
      // 이미 없는 자리에 마스터와 같은 선택을 보내도 ok (멱등)
      expect(unwrap(await svc.setOptionOverride(editor, scope(), NODE, "C0001", {}))).toBeUndefined();
    });

    it("uuid 가 아닌 문서 노드 id 도 저장된다 — node_id 는 text (코덱스 리뷰 2026-09-15 Minor-6)", async () => {
      const o = unwrap(await svc.setOptionOverride(editor, scope(), SEED_NODE, "C0001", { style: "B" }));
      expect(o).toMatchObject({ nodeId: SEED_NODE, options: { style: "B" } });
      expect((await svc.listOptionOverrides(scope())).map((x) => x.nodeId)).toEqual([SEED_NODE]);
      unwrap(await svc.removeOptionOverride(editor, scope(), SEED_NODE, "C0001"));
      expect(await svc.listOptionOverrides(scope())).toEqual([]);
    });

    it("자리의 함수조항과 다른 clauseCode 는 notFound — 행을 남기지 않는다 (코덱스 리뷰 후속)", async () => {
      // 조립은 오버라이드를 nodeId 로만 얹는다 — 어긋난 코드가 저장되면 그 자리에 조용히 적용된다.
      expect(reason(await svc.setOptionOverride(editor, scope(), NODE, "C9999", { style: "B" }))).toBe("notFound");
      expect(await svc.listOptionOverrides(scope())).toEqual([]);
    });

    it("템플릿에 없는 참조 노드 · 템플릿 없는 상품은 notFound (Important-1)", async () => {
      expect(reason(await svc.setOptionOverride(editor, scope(), "eeeeeeee-0000-4000-8000-0000000000ff", "C0001", { style: "B" }))).toBe("notFound");
      const bare = unwrap(await svc.createProduct(editor, { name: "템플릿 없는 상품 — 오버라이드" }));
      expect(reason(await svc.setOptionOverride(editor, { kind: "product", id: bare.id }, NODE, "C0001", { style: "B" }))).toBe("notFound");
    });
  });

  // 조회·쓰기가 한 트랜잭션이라 사이에 템플릿이 바뀌어도 옛 조의 숨김 행이 남지 않는다 (코덱스 리뷰 Minor-1).
  // 경쟁 자체는 여기서 재현하지 않는다 — PGlite 는 단일 연결이라 두 호출이 직렬화돼 간섭 구간이 없다.
  describe("기능/상품 §3.6 — 보통약관 조 노출 토글", () => {
    it("숨김 → 목록에 든다 · 다시 켜면 빠진다 · 같은 동작을 두 번 해도 같다(멱등)", async () => {
      const p = unwrap(await svc.createProduct(editor, { name: "조 노출 상품" }));
      unwrap(await svc.setGeneralDocument(editor, p.id, GENERAL_DOC));
      unwrap(await svc.setArticleHidden(editor, p.id, ART_A, true));
      expect(await svc.listHiddenArticles(p.id)).toEqual([ART_A]);
      unwrap(await svc.setArticleHidden(editor, p.id, ART_A, true));
      expect(await svc.listHiddenArticles(p.id)).toEqual([ART_A]);
      unwrap(await svc.setArticleHidden(editor, p.id, ART_B, true));
      expect(await svc.listHiddenArticles(p.id)).toEqual([ART_A, ART_B]);
      unwrap(await svc.setArticleHidden(editor, p.id, ART_A, false));
      unwrap(await svc.setArticleHidden(editor, p.id, ART_A, false)); // 안 숨긴 조를 켜도 ok
      expect(await svc.listHiddenArticles(p.id)).toEqual([ART_B]);
    });

    it("템플릿을 바꾸면 비운다 — 같은 템플릿을 다시 고르면 그대로", async () => {
      const p = unwrap(await svc.createProduct(editor, { name: "조 노출 상품 2", generalDocumentId: GENERAL_DOC }));
      unwrap(await svc.setArticleHidden(editor, p.id, ART_A, true));
      unwrap(await svc.setArticleHidden(editor, p.id, ART_B, true));
      unwrap(await svc.setGeneralDocument(editor, p.id, GENERAL_DOC)); // 같은 템플릿 — 유지 (확인도 안 묻는다)
      expect(await svc.listHiddenArticles(p.id)).toEqual([ART_A, ART_B]);
      unwrap(await svc.setGeneralDocument(editor, p.id, OTHER_DOC, { confirm: true })); // 교체 — 비운다
      expect(await svc.listHiddenArticles(p.id)).toEqual([]);
    });

    it("템플릿 교체는 숨김·오버라이드를 함께 잃는다 — 잃는 수를 세어 확인부터 (코덱스 리뷰 2026-09-15 Important-6)", async () => {
      const p = unwrap(await svc.createProduct(editor, { name: "템플릿 교체 상품", generalDocumentId: GENERAL_DOC }));
      const scope = { kind: "product", id: p.id } as const;
      unwrap(await svc.setArticleHidden(editor, p.id, ART_A, true));
      unwrap(await svc.setArticleHidden(editor, p.id, ART_B, true));
      unwrap(await svc.setOptionOverride(editor, scope, NODE, "C0001", { style: "B" }));

      // 1차 호출 — 잃는 것을 세어 거부하고 아무것도 바꾸지 않는다 (예전: 숨김은 조용히 소실 · 오버라이드는 교체 거부)
      const first = await svc.setGeneralDocument(editor, p.id, OTHER_DOC);
      expect(first.ok).toBe(false);
      if (first.ok || first.rejection.reason !== "needsConfirmation") throw new Error("기대: needsConfirmation");
      expect(first.rejection.impact).toEqual({ valueRowsLost: 0, brokenRefs: [], cascade: ["숨긴 조 2", "옵션 오버라이드 1"] });
      expect((await svc.getProduct(p.id))?.generalDocumentId).toBe(GENERAL_DOC);
      expect(await svc.listHiddenArticles(p.id)).toEqual([ART_A, ART_B]);
      expect((await svc.listOptionOverrides(scope)).length).toBe(1);

      // 같은 템플릿을 다시 고르면 잃는 것이 없으니 확인도 없다
      unwrap(await svc.setGeneralDocument(editor, p.id, GENERAL_DOC));
      expect(await svc.listHiddenArticles(p.id)).toEqual([ART_A, ART_B]);
      expect((await svc.listOptionOverrides(scope)).length).toBe(1);

      // 한 트랜잭션 — 교체가 거부되면 둘 다 그대로다 (한쪽만 비워진 상태로 끝나지 않는다)
      expect(reason(await svc.setGeneralDocument(editor, p.id, "dddddddd-0000-4000-8000-000000000099", { confirm: true }))).toBe("notFound");
      expect(await svc.listHiddenArticles(p.id)).toEqual([ART_A, ART_B]);
      expect((await svc.listOptionOverrides(scope)).length).toBe(1);

      // 확인 후 — 둘 다 비우고 교체한다
      unwrap(await svc.setGeneralDocument(editor, p.id, OTHER_DOC, { confirm: true }));
      expect((await svc.getProduct(p.id))?.generalDocumentId).toBe(OTHER_DOC);
      expect(await svc.listHiddenArticles(p.id)).toEqual([]);
      expect(await svc.listOptionOverrides(scope)).toEqual([]);
    });

    it("dryRun — 같은 판정을 주고 아무것도 쓰지 않는다 (화면이 술어를 베끼지 않게 · 코덱스 리뷰 후속)", async () => {
      const p = unwrap(await svc.createProduct(editor, { name: "dryRun 상품", generalDocumentId: GENERAL_DOC }));
      const scope = { kind: "product", id: p.id } as const;
      unwrap(await svc.setArticleHidden(editor, p.id, ART_A, true));
      unwrap(await svc.setOptionOverride(editor, scope, NODE, "C0001", { style: "B" }));

      // 잃을 것이 있는 교체 — 진짜 호출과 같은 거부, 상품은 그대로
      const dry = await svc.setGeneralDocument(editor, p.id, OTHER_DOC, { dryRun: true });
      if (dry.ok || dry.rejection.reason !== "needsConfirmation") throw new Error("기대: needsConfirmation");
      expect(dry.rejection.impact.cascade).toEqual(["숨긴 조 1", "옵션 오버라이드 1"]);
      expect((await svc.getProduct(p.id))?.generalDocumentId).toBe(GENERAL_DOC);
      expect(await svc.listHiddenArticles(p.id)).toEqual([ART_A]);

      // 잃을 것이 없으면 ok — 그래도 쓰지 않는다 (confirm 까지 얹어도 마찬가지)
      unwrap(await svc.setArticleHidden(editor, p.id, ART_A, false));
      unwrap(await svc.removeOptionOverride(editor, scope, NODE, "C0001"));
      expect(unwrap(await svc.setGeneralDocument(editor, p.id, OTHER_DOC, { dryRun: true })).generalDocumentId).toBe(OTHER_DOC);
      expect(unwrap(await svc.setGeneralDocument(editor, p.id, undefined, { dryRun: true, confirm: true })).generalDocumentId).toBeUndefined();
      expect((await svc.getProduct(p.id))?.generalDocumentId).toBe(GENERAL_DOC);
    });

    it("템플릿에 없는 조 id → notFound · 템플릿 없는 상품 → invalid · 없는 상품 → notFound", async () => {
      const p = unwrap(await svc.createProduct(editor, { name: "조 노출 상품 3", generalDocumentId: GENERAL_DOC }));
      expect(reason(await svc.setArticleHidden(editor, p.id, "ffffffff-0000-4000-8000-0000000000ff", true))).toBe("notFound");
      expect(reason(await svc.setArticleHidden(editor, p.id, ART_OTHER, true))).toBe("notFound"); // 다른 템플릿의 조
      const bare = unwrap(await svc.createProduct(editor, { name: "템플릿 없는 상품" }));
      expect(reason(await svc.setArticleHidden(editor, bare.id, ART_A, true))).toBe("invalid");
      expect(await svc.listHiddenArticles(bare.id)).toEqual([]);
      expect(reason(await svc.setArticleHidden(editor, "cccccccc-0000-4000-8000-000000000009", ART_A, true))).toBe("notFound");
    });
  });

  describe("역할권한 — 파괴적 액션 2단 (탑재 해제 · 속성 삭제 · 상품 삭제)", () => {
    it("탑재 해제: 편집자 forbidden · 관리자 영향(값 행 수) 확인 후 스냅샷 값·세목 부착 연쇄 삭제", async () => {
      expect(reason(await svc.unmount(editor, pcSurgery))).toBe("forbidden");
      const first = await svc.unmount(admin, pcSurgery);
      expect(first.ok).toBe(false);
      if (!first.ok && first.rejection.reason === "needsConfirmation") {
        expect(first.rejection.impact.valueRowsLost).toBeGreaterThanOrEqual(2); // 담보명 · 급부 지급률
        expect(first.rejection.impact.cascade.some((c) => c.includes("옵션 오버라이드"))).toBe(false); // 담보 scope 오버라이드는 없다 (기능/상품 §3.6)
      }
      unwrap(await svc.unmount(admin, pcSurgery, { confirm: true }));
      expect(await svc.getProductCoverage(pcSurgery)).toBeUndefined();
      expect((await readSlots(t.db, { kind: "productCoverage", id: pcSurgery })).size).toBe(0);
    });

    it("담보속성 유효값 삭제: 사용 중인 상품담보를 깨질 참조로 보여준다 · 종류 삭제도 같은 결 (사용처는 남아 깨진 참조가 된다)", async () => {
      const first = await svc.removeAttributeValue(admin, "A0002", "2");
      expect(first.ok).toBe(false);
      if (!first.ok && first.rejection.reason === "needsConfirmation") {
        expect(first.rejection.impact.brokenRefs).toEqual([{ document: "special", ownerId: pcAddon, ownerName: "일반상해사망 추가" }]);
      }
      expect(reason(await svc.removeAttributeValue(editor, "A0002", "2"))).toBe("forbidden");
      unwrap(await svc.removeAttributeValue(admin, "A0002", "1", { confirm: true }));
      expect((await svc.getAttributeKind("A0002"))?.values.map((v) => v.code)).toEqual(["2"]);
      const kindFirst = await svc.removeAttributeKind(admin, "A0002");
      if (!kindFirst.ok && kindFirst.rejection.reason === "needsConfirmation") {
        expect(kindFirst.rejection.impact.cascade).toEqual(["값 추가(2)"]);
        expect(kindFirst.rejection.impact.brokenRefs).toHaveLength(1);
      }
      unwrap(await svc.removeAttributeKind(admin, "A0002", { confirm: true }));
      expect(await svc.getAttributeKind("A0002")).toBeUndefined();
      expect((await svc.getProductCoverage(pcAddon))?.attributes).toEqual([{ kindCode: "A0002", valueCode: "2" }]); // 깨진 참조로 남는다
    });

    it("세목 선택지 삭제(파괴적): 조합·값 연쇄 · 상품 삭제: 상품담보·스냅샷 값·세목·그룹·오버라이드 전부 연쇄", async () => {
      const opts = await svc.listPlanOptions(productId);
      const t1 = opts.find((o) => o.axis === "type" && o.number === 1)!;
      expect(reason(await svc.removePlanOption(editor, t1.id))).toBe("forbidden");
      unwrap(await svc.removePlanOption(admin, t1.id, { confirm: true }));
      expect((await svc.listPlans(productId)).length).toBe(2); // (1종,1형) 은 이미 삭제됐고 남은 조합은 2종뿐

      const first = await svc.deleteProduct(admin, productId);
      expect(first.ok).toBe(false);
      if (!first.ok && first.rejection.reason === "needsConfirmation") {
        expect(first.rejection.impact.cascade).toContain("상품담보 일반상해사망");
        expect(first.rejection.impact.valueRowsLost).toBeGreaterThan(0);
      }
      unwrap(await svc.deleteProduct(admin, productId, { confirm: true }));
      expect(await svc.getProduct(productId)).toBeUndefined();
      expect((await readSlots(t.db, { kind: "product", id: productId })).size).toBe(0);
      expect((await readSlots(t.db, { kind: "productCoverage", id: pcBasic })).size).toBe(0);
    });
  });
});
