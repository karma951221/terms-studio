import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Clause } from "@/domain/clause";
import type { Coverage } from "@/domain/coverage";
import { nodeBuilders } from "@/domain/document";
import { describeKey, nodeKey } from "@/domain/refs";
import type { Actor, Id } from "@/domain/types";

import { insertClause } from "@/db/repo/clause";
import { insertAppendix, insertDocument, type DocumentRecord } from "@/db/repo/document";
import { insertAttributeKind, insertProduct, insertProductCoverage, upsertOverride } from "@/db/repo/product";
import { readSlots, writeSlot } from "@/db/repo/values";
import { createTestDb, type TestDb } from "@/db/test-utils";
import { createCatalogService } from "./catalog";
import { createCoverageService } from "./coverage";
import { attributeRefSource, catalogImpactSource, clauseUsageSource, coverageUsageSource, createRefsService, documentUsageSource, type RefsService } from "./refs";
import { contextualDb } from "./txContext";

const admin: Actor = { userId: "00000000-0000-4000-8000-000000000001", role: "admin" };
const editor: Actor = { userId: "00000000-0000-4000-8000-000000000002", role: "editor" };

function unwrap<T>(r: { ok: true; value: T } | { ok: false; rejection: unknown }): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

describe("refs 서비스 · 주입 소스 (PGlite)", () => {
  let t: TestDb;
  let refs: RefsService;
  let surgery: Coverage;
  let general: DocumentRecord;
  let special: DocumentRecord;
  let productId: Id;
  let pcId: Id;
  const b = nodeBuilders();
  const artPay = b.article("보험금의 지급사유", [
    b.paragraph([
      b.text("회사는 피보험자가 "),
      b.inlineCond([b.inlineBranch("D0001 = true and attr.A0001 = '1'", [b.text("최초계약일")]), b.inlineBranch(undefined, [b.text("계약일")])]),
      b.text(" 이후 평균공시이율 "),
      b.slot("D0004"),
    ]),
  ]);
  const artExempt = b.article("보험금을 지급하지 않는 사유", [b.paragraph([b.text("지급률 "), b.slot("D0003")])]);
  const exemptBlock = b.condBlock([b.branch("D0005 = true", [artExempt])]);
  const clauseBlock = b.clauseBlock("C001", { O01: "death" });
  const artLapse = b.article("특별약관의 소멸", [b.paragraph([b.text("이 특별약관은 다음의 경우 소멸합니다.")]), clauseBlock]);
  const gPay = b.article("보험금의 지급사유", [b.paragraph([b.text("기본계약의 지급사유에 따라")])]);
  const gApply = b.article("준용규정", [b.paragraph([b.text("관계 법령을 따릅니다.")])]);
  const gNotice = b.condBlock([b.branch("D0002 = 'V02'", [b.article("간편고지 특칙", [b.paragraph([b.text("간편심사")])])])]);
  const clauseInline = b.clauseInline("C002", {});
  const artApply = b.article("준용규정", [b.paragraph([b.articleRef(gPay.id, "general"), b.articleRef(artPay.id, "self"), b.appendixRef("APX_BURN"), clauseInline])], { linkedArticleId: gApply.id });

  beforeAll(async () => {
    t = await createTestDb();
    const db = contextualDb(t.db);
    refs = createRefsService(db);
    const catalog = createCatalogService(db);
    // 구분자는 전부 식 하나다 (ADR-0037) — 값 자리는 마스터가 정한다.
    // MVP 마스터가 가리키는 열거형변수 둘을 그대로 만든다 — 없으면 마스터 필드의 타입 간선이 깨진 참조가 된다
    unwrap(await catalog.createEnum(editor, { label: "납입면제사유", values: [{ label: "질병" }, { label: "상해" }] })); // E0001
    unwrap(await catalog.createEnum(editor, { label: "해약환급금유형", values: [{ label: "지급형" }, { label: "미지급형" }] })); // E0002 V01 V02
    unwrap(await catalog.createEnum(editor, { label: "간편심사유형", values: [{ label: "단일심사구분" }, { label: "통합간편심사" }] })); // E0003 — 상품특성
    unwrap(await catalog.createEnum(editor, { label: "건강고지유형", values: [{ label: "일반고지" }, { label: "간편고지(3.5.5)" }] })); // E0004 — 상품특성
    unwrap(await catalog.create(editor, { label: "갱신여부", level: "coverage", expression: "coverage_basic.claim_name = '갱신'" })); // D0001
    unwrap(await catalog.create(editor, { label: "무저해지유형", level: "plan", expression: "no_surrender.type" })); // D0002
    unwrap(await catalog.create(editor, { label: "지급률", level: "benefit", expression: "pay.rate" })); // D0003
    unwrap(await catalog.create(editor, { label: "평균공시이율", level: "product", expression: "'2.5%'" })); // D0004
    unwrap(await catalog.create(editor, { label: "면책여부합", level: "coverage", expression: "any(pay.exempt)" })); // D0005
    unwrap(await catalog.create(editor, { label: "수술급여기준", level: "coverage", expression: "coverage_basic.claim_name" })); // D0006
    unwrap(await catalog.create(editor, { label: "아무도 안 쓰는 것", level: "coverage", expression: "coverage_basic.claim_name" })); // D0007

    const coverage = createCoverageService(db);
    surgery = unwrap(await coverage.create(editor, { name: "수술비", subCoverageName: "1종수술", benefitName: "수술보험금" }));

    for (const a of [{ code: "APX_DISABILITY", name: "장해분류표", description: "" }, { code: "APX_BURN", name: "화상 분류표", description: "" }]) await insertAppendix(db, a, editor.userId);
    const clauses: Clause[] = [
      {
        code: "C001",
        label: "특별약관의 소멸",
        mode: "block",
        body: [{ id: "c1-p", kind: "paragraph", children: [{ id: "c1-t", kind: "text", text: "소멸합니다. " }, { id: "c1-o", kind: "optionSlot", optionCode: "O01" }] }],
        options: [{ code: "O01", label: "어조", order: 0, values: [{ code: "death", label: "사망", body: [{ id: "c1-v1", kind: "text", text: "사망 시" }], order: 0 }, { code: "lapse", label: "해지", body: [], order: 1 }] }],
        required: { discriminators: [], attributes: [] },
      },
      {
        code: "C002",
        label: "준용규정",
        mode: "inline",
        body: [
          { id: "c2-c", kind: "inlineCond", branches: [{ id: "c2-b", when: "D0006 = '기준A'", children: [{ id: "c2-t", kind: "text", text: "기준A 적용" }] }] },
          { id: "c2-a", kind: "appendixRef", appendixCode: "APX_BURN" },
        ],
        options: [],
        required: { discriminators: ["D0006"], attributes: [] },
      },
    ];
    for (const c of clauses) await insertClause(db, c, editor.userId);

    general = await insertDocument(db, { kind: "general", title: "알파Plus 보통약관", tree: b.document("알파Plus 보통약관", [gPay, gNotice, gApply]) }, editor.userId);
    special = await insertDocument(db, { kind: "special", ownerId: surgery.id, title: "수술비 특별약관", generalDocumentId: general.id, tree: b.document("수술비 특별약관", [artPay, exemptBlock, artLapse, artApply]) }, editor.userId);
    unwrap(await coverage.setDocument(editor, surgery.id, special.id));

    await insertAttributeKind(db, { code: "A0001", label: "갱신유형", order: 0, values: [{ code: "1", label: "갱신형", fragment: "" }, { code: "2", label: "비갱신형", fragment: "" }] }, editor.userId);
    const product = await insertProduct(db, { name: "알파Plus", generalDocumentId: general.id }, editor.userId);
    productId = product.id;
    const pc = await insertProductCoverage(db, { productId, coverageId: surgery.id, coverageName: "수술비", name: "갱신형 수술비", attributes: [{ kindCode: "A0001", valueCode: "1" }], combinationKey: "k" }, editor.userId);
    pcId = pc.id;
    await upsertOverride(db, { kind: "product", id: productId }, clauseBlock.id, "C001", { O01: "lapse" }, editor.userId);
    await writeSlot(db, { kind: "plan", id: productId }, "no_surrender.type", "V02");
  });
  afterAll(async () => {
    await t.close();
  });

  describe("관계정보 (구분자정의 S6 · 기능/관계정보 §3 「그래프 뷰」)", () => {
    it("구분자 「갱신여부」 조회 → 참조하는 문면의 좌표(문서 · 담보 · 조 · 노드 경로)가 나온다", async () => {
      const u = await refs.usages({ kind: "discriminator", code: "D0001" });
      expect(u).toHaveLength(1);
      expect(u[0].at).toMatchObject({ document: "special", ownerId: surgery.id, ownerName: "수술비 특별약관", articleId: artPay.id, articleTitle: "보험금의 지급사유", refPath: "D0001" });
    });

    it("공용조항 관계정보 — 역방향(참조 문서·옵션 선택) · 옵션별 오버라이드 사용처 (기능/공용조항 §3.2)", async () => {
      const v = await refs.relation({ kind: "clause", code: "C001" });
      expect(v.node?.label).toBe("특별약관의 소멸");
      expect(v.incoming.map((e) => [e.via, e.at.articleTitle])).toEqual([["clauseRef", "특별약관의 소멸"], ["optionSelect", "특별약관의 소멸"]]);
      expect(v.overrides).toEqual([expect.objectContaining({ from: { kind: "product", id: productId }, through: { kind: "article", documentId: special.id, articleId: artLapse.id }, at: expect.objectContaining({ document: "product", ownerId: productId, ownerName: "알파Plus", nodePath: [clauseBlock.id], refPath: "C001.O01" }) })]);
    });

    it("무결성 — 고아(미참조 구분자 · 별표) · 순환 없음 · 깨진 참조 없음 + 분모", async () => {
      const r = await refs.integrity();
      expect(r.orphans.map((n) => nodeKey(n.key))).toEqual(["discriminator:D0007", "appendix:APX_DISABILITY"]);
      expect(r.cycles).toEqual([]);
      expect(r.broken).toEqual([]);
      expect(r.issues).toEqual([]);
      // 분모 — 고아 2 를 셀 수 있으려면 고아 후보 수가 그보다 크거나 같아야 한다 (§9.6)
      expect(r.stats.orphanCandidates).toBeGreaterThanOrEqual(r.orphans.length);
      expect(r.stats.edges).toBeGreaterThan(0);
    });

    it("overview — 그래프 한 번으로 무결성·규모·관계 뷰를 함께 낸다 (관계정보 화면)", async () => {
      const o = await refs.overview({ kind: "clause", code: "C001" });
      expect(o.integrity.stats.nodes).toBe(o.graph.nodes.size);
      expect(o.integrity.stats.edges).toBe(o.graph.edges.length);
      expect(o.relation?.node?.label).toBe("특별약관의 소멸");
      // 좌표를 이름으로 부를 수 있다 — 조는 「문서 › 제N조(조 명)」 (리뷰 #24)
      expect(describeKey({ kind: "article", documentId: special.id, articleId: artLapse.id }, o.graph)).toBe("수술비 특별약관 › 제3조(특별약관의 소멸)");
      expect((await refs.overview()).relation).toBeUndefined();
    });
  });

  describe("catalogImpactSource — 구분자 삭제·enum 값 삭제의 영향 (기능/구분자 §3.4)", () => {
    it("구분자의 깨질 참조 = 그 구분자를 읽는 문면 · 공용조항 식 (부착은 없다)", async () => {
      const src = catalogImpactSource(contextualDb(t.db));
      expect(await src.findBrokenRefs({ kind: "discriminator", code: "D0006" })).toEqual([
        expect.objectContaining({ document: "clause", ownerId: "C002", ownerName: "준용규정", nodePath: ["c2-c", "c2-b"], refPath: "D0006" }),
      ]);
      expect(await src.findBrokenRefs({ kind: "discriminator", code: "D0003" })).toEqual([
        expect.objectContaining({ document: "special", articleTitle: "보험금을 지급하지 않는 사유", refPath: "D0003" }),
      ]);
      // 구분자는 식이라 값 행이 없다
      expect(await src.countValueRows({ kind: "discriminator", code: "D0003" })).toBe(0);
    });

    it("enum 값 E0002/V02 — 리터럴로 비교하는 조건식이 깨질 참조, 그 값을 고른 값 행만 세고 지운다", async () => {
      const src = catalogImpactSource(contextualDb(t.db));
      expect(await src.findBrokenRefs({ kind: "enumValue", enumCode: "E0002", valueCode: "V02" })).toEqual([expect.objectContaining({ document: "general", ownerId: general.id, refPath: "D0002" })]);
      expect(await src.findBrokenRefs({ kind: "enumValue", enumCode: "E0002", valueCode: "V01" })).toEqual([]);
      expect(await src.countValueRows({ kind: "enumValue", enumCode: "E0002", valueCode: "V02" })).toBe(1);
      expect(await src.countValueRows({ kind: "enumValue", enumCode: "E0002", valueCode: "V01" })).toBe(0);
      expect(await src.countValueRows({ kind: "enum", enumCode: "E0002" })).toBe(1);
      await src.purgeValueRows({ kind: "enumValue", enumCode: "E0002", valueCode: "V02" });
      expect((await readSlots(t.db, { kind: "plan", id: productId })).size).toBe(0);
    });

    it("트랜잭션 안에서 불러도 교착하지 않는다 (contextualDb)", async () => {
      const db = contextualDb(t.db);
      const src = catalogImpactSource(db);
      const n = await db.transaction(async () => (await src.findBrokenRefs({ kind: "discriminator", code: "D0001" })).length);
      expect(n).toBe(1);
    });
  });

  describe("coverageUsageSource — 노드 삭제가 깨뜨릴 문면 사용처", () => {
    const src = () => coverageUsageSource(contextualDb(t.db));

    it("급부 삭제: 급부 레벨 구분자를 읽는 슬롯 · 집계를 거친 조건이 사용처", async () => {
      const benefit = surgery.subCoverages[0].benefits[0];
      const u = await src().findUsages({ kind: "deleteNode", coverageId: surgery.id, node: { level: "benefit", id: benefit.id } });
      expect(u.map((c) => c.refPath).sort()).toEqual(["D0003"]);
    });

    it("담보 삭제: 문면 문서 자체와 탑재한 상품담보가 사용처", async () => {
      const u = await src().findUsages({ kind: "deleteNode", coverageId: surgery.id, node: { level: "coverage", id: surgery.id } });
      expect(u).toEqual([
        { document: "special", ownerId: surgery.id, ownerName: "수술비 특별약관" },
        { document: "special", ownerId: pcId, ownerName: "갱신형 수술비" },
      ]);
    });

    describe("노드 한정자 `D@노드` (ADR-0066) — 가리킨 노드(와 하위)를 지울 때만 사용처다", () => {
      let fracture: Coverage;
      let sub: Id;
      let ben1: Id;
      let ben2: Id;

      beforeAll(async () => {
        const db = contextualDb(t.db);
        const coverage = createCoverageService(db);
        fracture = unwrap(await coverage.create(editor, { name: "골절", subCoverageName: "골절진단", benefitName: "진단비" }));
        sub = fracture.subCoverages[0].id;
        ben1 = fracture.subCoverages[0].benefits[0].id;
        fracture = unwrap(await coverage.addBenefit(editor, sub, "수술비"));
        ben2 = fracture.subCoverages[0].benefits[1].id;
        // 진단비(ben1) 한정 조건 + 한정 없는 급부 슬롯
        const art = b.article("지급", [b.paragraph([b.inlineCond([b.inlineBranch(`D0003@${ben1} > 0`, [b.text("진단비 지급")])]), b.slot("D0003")])]);
        const doc = await insertDocument(db, { kind: "special", ownerId: fracture.id, title: "골절 특별약관", generalDocumentId: general.id, tree: b.document("골절 특별약관", [art]) }, editor.userId);
        unwrap(await coverage.setDocument(editor, fracture.id, doc.id));
      });

      it("가리킨 급부를 지우면 한정 참조와 한정 없는 급부 참조가 모두 사용처", async () => {
        const u = await src().findUsages({ kind: "deleteNode", coverageId: fracture.id, node: { level: "benefit", id: ben1 } });
        expect(u.map((c) => c.refPath).sort()).toEqual(["D0003", `D0003@${ben1}`]);
      });

      it("다른 급부를 지우면 한정 참조는 사용처가 아니다 — 한정 없는 급부 참조만", async () => {
        const u = await src().findUsages({ kind: "deleteNode", coverageId: fracture.id, node: { level: "benefit", id: ben2 } });
        expect(u.map((c) => c.refPath).sort()).toEqual(["D0003"]);
      });

      it("한정 노드의 상위 세부보장을 지우면 한정 참조도 사용처", async () => {
        const u = await src().findUsages({ kind: "deleteNode", coverageId: fracture.id, node: { level: "subCoverage", id: sub } });
        expect(u.map((c) => c.refPath).sort()).toEqual(["D0003", `D0003@${ben1}`]);
      });

      it("무결성 보고: 한정 노드가 사라지면 nodeQualifier 간선이 깨진 참조로 잡힌다", async () => {
        const before = await refs.integrity();
        expect(before.broken.filter((e) => e.via === "nodeQualifier")).toEqual([]);
        unwrap(await createCoverageService(contextualDb(t.db)).removeBenefit(admin, ben1, { confirm: true }));
        const after = await refs.integrity();
        expect(after.broken.filter((e) => e.via === "nodeQualifier").map((e) => e.at.refPath)).toEqual([`D0003@${ben1}`]);
      });
    });
  });

  describe("clauseUsageSource — 참조 문서(ownerKind coverage/general) + 옵션 선택", () => {
    it("C001 은 담보약관 1건이 참조하고 옵션 O01=death 를 골랐다", async () => {
      const u = await clauseUsageSource(contextualDb(t.db)).documentsReferencing("C001");
      expect(u).toEqual([{ documentId: special.id, ownerKind: "coverage", ownerId: surgery.id, ownerName: "수술비 특별약관", refNodeId: clauseBlock.id, selection: { O01: "death" } }]);
      expect((await clauseUsageSource(contextualDb(t.db)).documentsReferencing("C002"))[0].selection).toEqual({});
      expect(await clauseUsageSource(contextualDb(t.db)).documentsReferencing("C999")).toEqual([]);
    });
  });

  describe("documentUsageSource — 문서 서비스가 못 보는 외부 사용처", () => {
    it("보통약관: 상품 템플릿 선택 · 담보약관: 담보 문서 연결 + 옵션 오버라이드 · 별표: 공용조항 본문 참조", async () => {
      const src = documentUsageSource();
      expect(await src.documentUsages(t.db, general.id)).toEqual([{ document: "product", ownerId: productId, ownerName: "알파Plus" }]);
      expect(await src.documentUsages(t.db, special.id)).toEqual([
        { document: "coverageMaster", ownerId: surgery.id, ownerName: "수술비" },
        expect.objectContaining({ document: "product", ownerId: productId, ownerName: "알파Plus", nodePath: [clauseBlock.id], refPath: "C001.O01" }),
      ]);
      expect(await src.appendixUsages(t.db, "APX_BURN")).toEqual([{ document: "clause", ownerId: "C002", ownerName: "준용규정", nodePath: ["c2-a"] }]);
      expect(await src.appendixUsages(t.db, "APX_DISABILITY")).toEqual([]);
    });
  });

  describe("attributeRefSource — 식이 읽는 담보속성 사용처 (조합 사용처는 상품 서비스가 따로 센다)", () => {
    it("종류 → 식 참조 좌표(중복 없이) · 유효값 → 그 값을 리터럴로 비교하는 식만", async () => {
      const src = attributeRefSource(contextualDb(t.db));
      const kind = await src.findExpressionRefs("A0001");
      expect(kind).toEqual([expect.objectContaining({ document: "special", articleTitle: "보험금의 지급사유", refPath: "attr.A0001" })]);
      expect(await src.findExpressionRefs("A0001", "1")).toHaveLength(1);
      expect(await src.findExpressionRefs("A0001", "2")).toEqual([]);
    });
  });
});
