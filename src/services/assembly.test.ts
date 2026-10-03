import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { RenderedDoc, RenderedInline } from "@/domain/assembly";
import type { Command, DocumentNode } from "@/domain/document";
import type { Actor, Id, Result } from "@/domain/types";

import * as previewRepo from "@/db/repo/preview";
import { createTestDb, type TestDb } from "@/db/test-utils";
import { createAssemblyService, executionBasedFilter, type AssemblyService } from "./assembly";
import { createCatalogService, type CatalogService } from "./catalog";
import { createClauseService, type ClauseService } from "./clause";
import { createCoverageService, type CoverageService } from "./coverage";
import { createDocumentService, type DocumentService } from "./document";
import { createProductService, type ProductService } from "./product";
import { contextualDb } from "./txContext";

const editor: Actor = { userId: "00000000-0000-4000-8000-000000000002", role: "editor" };
const admin: Actor = { userId: "00000000-0000-4000-8000-000000000001", role: "admin" };

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

function lines(doc: RenderedDoc): string[] {
  const inline = (list: RenderedInline[]) => list.map((n) => (n.kind === "text" ? n.text : n.kind === "error" ? `⟦${n.issue.kind}⟧` : n.label)).join("");
  const out: string[] = [];
  for (const a of doc.children) {
    if (a.kind === "error") continue;
    out.push(`${a.label}(${a.title})`);
    for (const p of a.children) if (p.kind === "paragraph") out.push(`  ${p.label} ${inline(p.children)}`);
  }
  return out;
}

/**
 * 관통 1 축약 픽스처를 **실제 서비스**로 DB 에 만든다 (도메인 픽스처 `alphaPlusFixture` 와 같은 모양 —
 * 카탈로그 · 담보 · 함수조항 · 문서 · 별표 · 상품 · 탑재 · 그룹 · 기본계약).
 */
describe("assembly 서비스 (PGlite) — 관통 1 통합", () => {
  let t: TestDb;
  let svc: AssemblyService;
  let catalog: CatalogService;
  let clause: ClauseService;
  let coverage: CoverageService;
  let documents: DocumentService;
  let product: ProductService;
  let productId: Id;
  let covBase: Id;
  let covDeath: Id;
  let pcBase: Id;
  let pcBasic: Id;
  let pcAddon: Id;
  /** product.mount 가 트랜잭션 안에서 읽는 담보 트리 — 메모리로 답한다 (아래 주석). */
  const trees = new Map<Id, Awaited<ReturnType<CoverageService["get"]>>>();

  const insertAll = (root: Id, nodes: DocumentNode["children"]): Command[] => nodes.map((node) => ({ type: "insert", node, at: { parentId: root } }));

  beforeAll(async () => {
    t = await createTestDb();
    // 조립 루트(container)와 같은 **문맥 DB** 로 모든 서비스를 만든다 — 주입 소스가 트랜잭션 안에서
    // 불려도 열린 tx 를 그대로 타므로 PGlite 단일 연결에서 교착하지 않는다 (txContext).
    const db = contextualDb(t.db);
    catalog = createCatalogService(db);
    coverage = createCoverageService(db);
    clause = createClauseService(db);
    documents = createDocumentService(db);
    // ⚠ product.mount 는 트랜잭션 안에서 coverageMaster.tree 를 부른다 — 여기서는 트리를 미리 읽어 메모리로 답한다.
    product = createProductService(db, {
      coverageMaster: { tree: async (id) => trees.get(id) },
      generalDocuments: {
        exists: async () => true,
        articleIds: async (id) => ((await documents.get(id))?.tree.children ?? []).flatMap((c) => (c.kind === "article" ? [c.id] : [])),
        clauseRef: async () => undefined, // 이 테스트는 옵션 오버라이드를 쓰지 않는다
        template: async (id) => {
          const d = await documents.get(id);
          return d ? { tree: d.tree, version: d.version } : undefined;
        },
      },
    });
    svc = createAssemblyService(db, { catalog, coverage, clause, document: documents, product });

    // 카탈로그 — 구분자는 전부 식 하나다 (ADR-0037). 값 자리는 MVP 마스터가 정한다.
    // D0001 갱신여부(담보 boolean) · D0002 고지유형(상품 리터럴) · D0003 지급률(급부) ·
    // D0004 평균공시이율(상품 리터럴) · D0005 면책여부합(담보 집계) · D0006 감액기간문구(담보 투영)
    unwrap(await catalog.createEnum(editor, { label: "고지유형", values: [{ label: "일반심사" }, { label: "간편심사" }] }));
    unwrap(await catalog.createEnum(editor, { label: "무저해지유형", values: [{ label: "지급형" }, { label: "무저해지형" }] })); // E0002 — 세목 no_surrender.type
    unwrap(await catalog.create(editor, { label: "갱신여부", level: "coverage", expression: "coverage_basic.claim_name = '갱신'" }));
    unwrap(await catalog.create(editor, { label: "고지유형", level: "product", expression: "'간편심사'" }));
    unwrap(await catalog.create(editor, { label: "지급률", level: "benefit", expression: "pay.rate" }));
    unwrap(await catalog.create(editor, { label: "평균공시이율", level: "product", expression: "'2.5%'" }));
    unwrap(await catalog.create(editor, { label: "면책여부합", level: "coverage", expression: "any(pay.exempt)" }));
    unwrap(await catalog.create(editor, { label: "감액기간문구", level: "coverage", expression: "coverage_basic.claim_name" }));

    // 담보 마스터 — 일반상해사망 (세부보장 1 · 급부 1) + 값
    const tree = unwrap(await coverage.create(editor, { name: "일반상해사망", benefitName: "사망보험금" }));
    covDeath = tree.id;
    trees.set(covDeath, tree);
    const ben = tree.subCoverages[0].benefits[0];
    unwrap(await coverage.writeValue(editor, { level: "coverage", id: covDeath }, "coverage_basic.claim_name", "24개월"));
    unwrap(await coverage.writeValue(editor, { level: "benefit", id: ben.id }, "pay.exempt", true));
    unwrap(await coverage.writeValue(editor, { level: "benefit", id: ben.id }, "pay.rate", 100));

    const baseTree = unwrap(await coverage.create(editor, { name: "상해사망(기본계약)", benefitName: "사망보험금" }));
    covBase = baseTree.id;
    trees.set(covBase, baseTree);
    unwrap(await coverage.writeValue(editor, { level: "coverage", id: covBase }, "coverage_basic.claim_name", "기본"));

    // 별표 · 함수조항 (C0001 소멸 block + 옵션 O01{V01 일반, V02 사망} · C0002 준용 inline)
    unwrap(await documents.createAppendix(editor, { name: "장해분류표" }));
    unwrap(await documents.createAppendix(editor, { name: "화상 분류표" }));
    unwrap(
      await clause.create(editor, {
        label: "특별약관의 소멸",
        mode: "block",
        body: [{ id: "c1-par", kind: "paragraph", children: [{ id: "c1-t1", kind: "text", text: "이 특별약관은 " }, { id: "c1-opt", kind: "optionSlot", optionCode: "O01" }, { id: "c1-t2", kind: "text", text: " 소멸합니다." }] }],
        options: [{ label: "소멸 사유", values: [{ label: "일반", body: [{ id: "c1-o-gen", kind: "text", text: "보험기간이 끝난 때" }] }, { label: "사망", body: [{ id: "c1-o-death", kind: "text", text: "피보험자가 사망한 때" }] }] }],
      }),
    );

    // 보통약관 — 4개 조 (제2조 갱신여부 인라인 조건 + 고지유형 슬롯 · 제3조 별표 · 제4조 준용 = 함수조항)
    const g = unwrap(await documents.createGeneral(editor, "알파Plus 보통약관"));
    unwrap(
      await documents.apply(
        editor,
        g.id,
        insertAll(g.tree.id, [
          { id: "g-art-def", kind: "article", title: "용어의 정의", children: [{ id: "g-par-def", kind: "paragraph", children: [{ id: "g-txt-def", kind: "text", text: "이 계약에서 사용하는 용어의 정의는 다음과 같습니다." }] }] },
          {
            id: "g-art-pay",
            kind: "article",
            title: "보험금의 지급사유",
            children: [
              {
                id: "g-par-pay-1",
                kind: "paragraph",
                children: [
                  { id: "g-txt-pay-1", kind: "text", text: "회사는 피보험자가 " },
                  { id: "g-inl-renew", kind: "inlineCond", branches: [{ id: "g-inl-renew-if", when: "D0001 = true", children: [{ id: "g-txt-pay-2", kind: "text", text: "최초계약일" }] }, { id: "g-inl-renew-else", children: [{ id: "g-txt-pay-3", kind: "text", text: "계약일" }] }] },
                  { id: "g-txt-pay-4", kind: "text", text: " 이후 기본계약의 보험금 지급사유가 발생한 때 보험금을 지급합니다." },
                ],
              },
              { id: "g-par-pay-2", kind: "paragraph", children: [{ id: "g-txt-pay-5", kind: "text", text: "이 계약은 " }, { id: "g-slot-notice", kind: "slot", ref: "D0002" }, { id: "g-txt-pay-6", kind: "text", text: " 계약입니다." }] },
            ],
          },
          { id: "g-art-detail", kind: "article", title: "보험금 지급에 관한 세부규정", children: [] },
          { id: "g-art-disability", kind: "article", title: "장해의 분류", children: [{ id: "g-par-dis", kind: "paragraph", children: [{ id: "g-txt-dis-1", kind: "text", text: "장해의 분류는 " }, { id: "g-apx-disability", kind: "appendixRef", appendixCode: "AX000001" }, { id: "g-txt-dis-2", kind: "text", text: " 에 따릅니다." }] }] },
          { id: "g-art-apply", kind: "article", title: "준용규정", children: [{ id: "g-par-apply", kind: "paragraph", children: [{ id: "g-clause-apply", kind: "clauseInlineRef", clauseCode: "C0002", options: {} }] }] },
        ]),
      ),
    );
    // 함수조항 C0002 준용 inline — 조 참조(g-art-def)는 보통약관 마스터에 있어야 저장된다 (기능/함수조항 §3.5) → 트리 적재 뒤에 만든다
    unwrap(
      await clause.create(editor, {
        label: "준용 문구",
        mode: "inline",
        body: [{ id: "c2-t1", kind: "text", text: "이 약관에서 정하지 않은 사항은 " }, { id: "c2-ref", kind: "articleRef", targets: [{ articleId: "g-art-def" }], connector: "및" }, { id: "c2-t2", kind: "text", text: " 및 관계 법령을 따릅니다." }],
      }),
    );

    const baseDocument = unwrap(await documents.createSpecial(editor, covBase, "상해사망 기본계약 문면"));
    unwrap(await documents.setGeneralDocument(editor, baseDocument.id, g.id));
    unwrap(
      await documents.apply(
        editor,
        baseDocument.id,
        insertAll(baseDocument.tree.id, [
          {
            id: "b-art-pay",
            kind: "article",
            title: "보험금의 지급사유",
            linkedArticleId: "g-art-pay",
            children: [
              { id: "b-par-pay-1", kind: "paragraph", children: [{ id: "b-txt-pay-1", kind: "text", text: "회사는 피보험자가 계약일 이후 기본계약의 보험금 지급사유가 발생한 때 보험금을 지급합니다." }] },
              { id: "b-par-pay-2", kind: "paragraph", children: [{ id: "b-txt-pay-2", kind: "text", text: "이 계약은 간편심사 계약입니다." }] },
            ],
          },
          {
            id: "b-art-detail",
            kind: "article",
            title: "보험금 지급에 관한 세부규정",
            linkedArticleId: "g-art-detail",
            children: [{ id: "b-par-detail", kind: "paragraph", children: [{ id: "b-txt-detail", kind: "text", text: "보험금 지급에 관한 세부사항은 산출방법서에 따릅니다." }] }],
          },
        ]),
      ),
    );

    // 담보약관 — 일반상해사망 (대응 보통약관 지정 → 조연결 · 보통약관 조 참조 가능)
    const s = unwrap(await documents.createSpecial(editor, covDeath, "일반상해사망 특별약관"));
    unwrap(await documents.setGeneralDocument(editor, s.id, g.id));
    unwrap(
      await documents.apply(
        editor,
        s.id,
        insertAll(s.tree.id, [
          {
            id: "s-art-pay",
            kind: "article",
            title: "보험금의 지급사유",
            children: [
              {
                id: "s-par-pay-1",
                kind: "paragraph",
                children: [
                  { id: "s-txt-pay-1", kind: "text", text: "회사는 피보험자가 " },
                  { id: "s-inl-renew", kind: "inlineCond", branches: [{ id: "s-inl-renew-if", when: "exist(attr.A0001) and attr.A0001 = '2'", children: [{ id: "s-txt-pay-2", kind: "text", text: "최초계약일" }] }, { id: "s-inl-renew-else", children: [{ id: "s-txt-pay-3", kind: "text", text: "계약일" }] }] },
                  { id: "s-txt-pay-4", kind: "text", text: " 이후 상해로 사망한 경우 사망보험금을 지급합니다." },
                ],
              },
              { id: "s-par-pay-2", kind: "paragraph", children: [{ id: "s-txt-pay-5", kind: "text", text: "사망보험금은 보험가입금액에 평균공시이율 " }, { id: "s-slot-rate", kind: "slot", ref: "D0004" }, { id: "s-txt-pay-6", kind: "text", text: " 을 적용하여 계산합니다." }] },
            ],
          },
          {
            id: "s-cond-exempt",
            kind: "condBlock",
            branches: [{ id: "s-cond-exempt-if", when: "D0005 = true", children: [{ id: "s-art-exempt", kind: "article", title: "보험금을 지급하지 않는 사유", children: [{ id: "s-par-exempt", kind: "paragraph", children: [{ id: "s-txt-exempt", kind: "text", text: "고의 사고에는 지급하지 않습니다." }] }] }] }],
          },
          { id: "s-art-reduce", kind: "article", title: "보험금의 감액지급", children: [{ id: "s-par-reduce", kind: "paragraph", children: [{ id: "s-txt-reduce-1", kind: "text", text: "계약일부터 " }, { id: "s-slot-reduce", kind: "slot", ref: "D0006" }, { id: "s-txt-reduce-2", kind: "text", text: " 이내의 사망은 감액 지급합니다." }] }] },
          { id: "s-art-lapse", kind: "article", title: "특별약관의 소멸", children: [{ id: "s-par-lapse", kind: "paragraph", children: [{ id: "s-txt-lapse", kind: "text", text: "이 특별약관은 다음의 경우 소멸합니다." }] }, { id: "s-clause-lapse", kind: "clauseBlockRef", clauseCode: "C0001", options: { O01: "V02" } }] },
          { id: "s-art-apply", kind: "article", title: "준용규정", linkedArticleId: "g-art-apply", children: [{ id: "s-par-apply", kind: "paragraph", children: [{ id: "s-clause-apply", kind: "clauseInlineRef", clauseCode: "C0002", options: {} }] }] },
        ]),
      ),
    );

    // 상품 — 담보속성 · 상품 · 값 · 기본계약 1 + 특약 2 · 그룹
    unwrap(await product.createAttributeKind(editor, { label: "갱신유형" })); // A0001
    unwrap(await product.addAttributeValue(editor, "A0001", { label: "비갱신형" }));
    unwrap(await product.addAttributeValue(editor, "A0001", { label: "갱신형", fragment: "갱신형" }));
    unwrap(await product.createAttributeKind(editor, { label: "부가유형" })); // A0002
    unwrap(await product.addAttributeValue(editor, "A0002", { label: "기본" }));
    unwrap(await product.addAttributeValue(editor, "A0002", { label: "추가", fragment: "추가" }));
    unwrap(await product.setNamingTemplate(editor, "[A0001] [담보명] [A0002]"));
    productId = unwrap(await product.createProduct(editor, { name: "알파Plus(축약)", generalDocumentId: g.id })).id;
    pcBase = unwrap(await product.mount(editor, productId, covBase, [], "base")).id;
    pcBasic = unwrap(await product.mount(editor, productId, covDeath, [{ kindCode: "A0002", valueCode: "1" }])).id;
    pcAddon = unwrap(await product.mount(editor, productId, covDeath, [{ kindCode: "A0002", valueCode: "2" }])).id;
    const group = unwrap(await product.createGroup(editor, productId, { title: "상해 관련 특별약관" }));
    unwrap(await product.placeInGroup(editor, group.id, pcBasic));
    unwrap(await product.placeInGroup(editor, group.id, pcAddon));
  });
  afterAll(async () => {
    await t.close();
  });

  it("★ 관통 1 — preview: 보통약관 + 특약 2벌(본문 동일 · 제목만 다름) · 준용규정은 조 참조를 품어 통째 + warning · 별표 1 · complete=true", async () => {
    const b = unwrap(await svc.preview(productId));
    // 조연결된 준용규정 조는 리터럴 동일하지만 항 안에 보통약관 조 참조 슬롯이 있어 자동 판정을 보류한다 (기능/조립산출 §3.5 미합의 넷째 줄).
    // warning 이라 완성본은 깨지지 않는다. 좌표는 담보 조.
    expect(b.issues.map((i) => [i.kind, i.severity, i.message, i.at.ownerId, i.at.articleId, i.at.articleNumber])).toEqual([
      ["omissionUndecided", "warning", "참조 · 표를 품은 항은 자동 판정하지 않았습니다", pcBasic, "s-art-apply", 5],
      ["omissionUndecided", "warning", "참조 · 표를 품은 항은 자동 판정하지 않았습니다", pcAddon, "s-art-apply", 5],
    ]);
    expect(b.complete).toBe(true);
    expect(lines(b.general!)).toEqual([
      "제1조(용어의 정의)",
      "   이 계약에서 사용하는 용어의 정의는 다음과 같습니다.",
      "제2조(보험금의 지급사유)",
      "  ① 회사는 피보험자가 계약일 이후 기본계약의 보험금 지급사유가 발생한 때 보험금을 지급합니다.",
      "  ② 이 계약은 간편심사 계약입니다.",
      "제3조(보험금 지급에 관한 세부규정)",
      "   보험금 지급에 관한 세부사항은 산출방법서에 따릅니다.",
      "제4조(장해의 분류)",
      "   장해의 분류는 【별표1(장해분류표)】 에 따릅니다.",
      "제5조(준용규정)",
      // 보통약관이 넣은 함수조항의 보통약관 참조는 제 문서 참조 — 「보통약관」 머리가 없다(특약 쪽은 「보통약관 제1조」 그대로)
      "   이 약관에서 정하지 않은 사항은 제1조(용어의 정의) 및 관계 법령을 따릅니다.",
    ]);
    expect(b.specials.map((g) => [g.title, g.docs.map((d) => d.title)])).toEqual([["상해 관련 특별약관", ["일반상해사망 특별약관", "일반상해사망 추가 특별약관"]]]);
    const [basic, addon] = b.specials[0].docs;
    expect(lines(basic)).toEqual([
      "제1조(보험금의 지급사유)",
      "  ① 회사는 피보험자가 계약일 이후 상해로 사망한 경우 사망보험금을 지급합니다.",
      "  ② 사망보험금은 보험가입금액에 평균공시이율 2.5% 을 적용하여 계산합니다.",
      "제2조(보험금을 지급하지 않는 사유)",
      "   고의 사고에는 지급하지 않습니다.",
      "제3조(보험금의 감액지급)",
      "   계약일부터 24개월 이내의 사망은 감액 지급합니다.",
      "제4조(특별약관의 소멸)",
      "  ① 이 특별약관은 다음의 경우 소멸합니다.",
      "  ② 이 특별약관은 피보험자가 사망한 때 소멸합니다.",
      "제5조(준용규정)",
      "   이 약관에서 정하지 않은 사항은 보통약관 제1조(용어의 정의) 및 관계 법령을 따릅니다.",
    ]);
    expect(lines(addon)).toEqual(lines(basic));
    expect(b.omitted.map((o) => [o.productCoverageId, o.articleTitle, o.disposition, o.reason, o.pairs])).toEqual([
      [pcBasic, "준용규정", "full", "참조 · 표를 품은 항은 자동 판정하지 않았습니다", [{ special: 1, general: 1, matched: true }]],
      [pcAddon, "준용규정", "full", "참조 · 표를 품은 항은 자동 판정하지 않았습니다", [{ special: 1, general: 1, matched: true }]],
    ]);
    expect(b.appendices.map((a) => [a.code, a.number])).toEqual([["AX000001", 1]]);
    expect(b.undocumented).toEqual([]);
  });

  it("previewSpecial — 「일반상해사망 추가」 하나만 · 실행 기반 완결성 필터가 B1 completeness 에 꽂힌다", async () => {
    const r = unwrap(await svc.previewSpecial(productId, pcAddon));
    expect(r.complete).toBe(true);
    expect(r.doc.title).toBe("일반상해사망 추가 특별약관");
    expect(r.omitted).toHaveLength(1);
    // 실행 기반 필터: 면책 폼(exemption)은 어떤 문서도 읽지 않으므로 마스터에서 열고 비워 둬도 이 상품의 미입력이 아니다
    // (pay.rate · pay.exempt 는 선택 필드라 비우면 아예 세지 않는다 — 2026-09-27)
    const booklet = unwrap(await svc.preview(productId));
    const ben = (await coverage.get(covDeath))!.subCoverages[0].benefits[0];
    unwrap(await coverage.writeValue(editor, { level: "benefit", id: ben.id }, "exemption.new_only", true));
    const filtered = createCoverageService(t.db, { completenessFilter: executionBasedFilter(booklet) });
    expect(unwrap(await filtered.completeness(covDeath))).toEqual([]);
    expect(unwrap(await coverage.completeness(covDeath)).map((m) => m.path)).toEqual(["exemption.months", "exemption.age15_only"]);
  });

  it("기본계약 미지정 → noBaseContract 오류를 남기고 특약은 그대로 부분 조립", async () => {
    unwrap(await product.releaseBaseContract(editor, productId, pcBase));
    const b = unwrap(await svc.preview(productId));
    expect(b.complete).toBe(false);
    expect(b.issues.map((issue) => issue.kind)).toEqual(["noBaseContract", "noBaseContract", "omissionUndecided", "omissionUndecided", "unplaced"]);
    expect(b.issues[0]).toMatchObject({ kind: "noBaseContract", at: { document: "product", ownerId: productId } });
    expect(b.specials[0].docs).toHaveLength(2);
    expect(lines(b.specials[0].docs[0])).toHaveLength(12);
    unwrap(await product.designateBaseContract(editor, productId, pcBase));
    expect(unwrap(await svc.preview(productId)).complete).toBe(true);
  });

  it("세목 선택지 — 유효 조합에 등장하는 선택지 합집합을 값과 함께 싣는다 (조합에 안 든 선택지는 밖)", async () => {
    const type1 = unwrap(await product.addPlanOption(editor, productId, { axis: "type", number: 1, name: "1종", planTypeCode: "waiver" }));
    const type2 = unwrap(await product.addPlanOption(editor, productId, { axis: "type", number: 2, name: "2종", planTypeCode: "waiver" }));
    const form1 = unwrap(await product.addPlanOption(editor, productId, { axis: "form", number: 1, name: "1형", planTypeCode: "no_surrender" }));
    const form2 = unwrap(await product.addPlanOption(editor, productId, { axis: "form", number: 2, name: "2형", planTypeCode: "no_surrender" }));
    unwrap(await product.setPlanOptionValues(editor, type1.id, [{ path: "waiver.applies", value: true }, { path: "waiver.reasons", value: ["V01"] }])); // 예면 사유 1개 이상 (결정 16)
    unwrap(await product.setPlanOptionValue(editor, type2.id, "waiver.applies", false));
    unwrap(await product.setPlanOptionValue(editor, form1.id, "no_surrender.type", "V01"));
    unwrap(await product.setPlanOptionValue(editor, form2.id, "no_surrender.type", "V02"));
    // 유효 조합 (1종,1형) · (2종,1형) — 2형은 어느 조합에도 없다
    unwrap(await product.registerPlan(editor, productId, [type1.id, form1.id]));
    unwrap(await product.registerPlan(editor, productId, [type2.id, form1.id]));

    const input = unwrap(await svc.loadAssemblyInput(productId));
    expect(input.product.planOptions.map((o) => [o.id, o.axis, o.number, o.name, o.planTypeCode])).toEqual([
      [type1.id, "type", 1, "1종", "waiver"],
      [type2.id, "type", 2, "2종", "waiver"],
      [form1.id, "form", 1, "1형", "no_surrender"],
    ]);
    expect(input.product.planOptions.map((o) => [...o.values.entries()])).toEqual([
      [["waiver.applies", { entered: true, value: true }], ["waiver.reasons", { entered: true, value: ["V01"] }]],
      [["waiver.applies", { entered: true, value: false }]],
      [["no_surrender.type", { entered: true, value: "V01" }]],
    ]);
    // 조립은 여전히 완성본 — 문서가 세목을 읽지 않으므로 세목 값이 좌표에 오르지 않는다
    expect(unwrap(await svc.preview(productId)).complete).toBe(true);
    expect(input.product.planOptionCount).toBe(4);
    // 조합을 전부 지우면 — 선택지 4개는 남아 있으므로 noPlan 오류로 완성본이 아니다 (코덱스 리뷰 2026-09-14 Important-3)
    for (const plan of await product.listPlans(productId)) unwrap(await product.removePlan(admin, plan.id, { confirm: true })); // 조합 제거는 파괴 액션 — 관리자
    const unplanned = unwrap(await svc.preview(productId));
    expect(unplanned.complete).toBe(false);
    expect(unplanned.issues.some((i) => i.kind === "noPlan")).toBe(true);
  });

  it("숨긴 보통약관 조가 조립 재료의 hiddenArticleIds 로 실린다 (기능/상품 §3.6)", async () => {
    unwrap(await product.setArticleHidden(editor, productId, "g-art-def", true));
    expect([...unwrap(await svc.loadAssemblyInput(productId)).product.hiddenArticleIds]).toEqual(["g-art-def"]);
    unwrap(await product.setArticleHidden(editor, productId, "g-art-def", false));
    expect([...unwrap(await svc.loadAssemblyInput(productId)).product.hiddenArticleIds]).toEqual([]);
  });

  it("조 사본이 조립 재료의 articleCopies 로 실리고 preview 의 보통약관이 사본 본문을 쓴다 (ADR-0079)", async () => {
    const p = (await product.getProduct(productId))!;
    const template = (await documents.get(p.generalDocumentId!))!.tree;
    const def = template.children.find((c) => c.kind === "article" && c.id === "g-art-def");
    if (def?.kind !== "article") throw new Error("g-art-def");
    const copy = { ...def, children: [{ id: "copy-par", kind: "paragraph" as const, children: [{ id: "copy-txt", kind: "text" as const, text: "이 상품에서 쓰는 용어는 다음과 같습니다." }] }] };
    unwrap(await product.saveGeneralSettings(editor, productId, { generalDocumentId: p.generalDocumentId!, hiddenArticles: [], overrides: [], copies: [{ articleId: "g-art-def", article: copy, templateHash: "h" }] }));
    expect([...(unwrap(await svc.loadAssemblyInput(productId)).product.articleCopies ?? new Map()).keys()]).toEqual(["g-art-def"]);
    expect(lines(unwrap(await svc.preview(productId)).general!).slice(0, 2)).toEqual(["제1조(용어의 정의)", "   이 상품에서 쓰는 용어는 다음과 같습니다."]);
    unwrap(await product.saveGeneralSettings(editor, productId, { generalDocumentId: p.generalDocumentId!, hiddenArticles: [], overrides: [], copies: [] }));
    expect(lines(unwrap(await svc.preview(productId)).general!)[1]).toBe("   이 계약에서 사용하는 용어의 정의는 다음과 같습니다.");
  });

  it("없는 상품은 notFound", async () => {
    const r = await svc.preview("00000000-0000-4000-8000-0000000000ff");
    expect(!r.ok && r.rejection.reason).toBe("notFound");
  });

  describe("run / latest — 산출본 저장 · 입력 스탬프로 오래됨 판정 (기능/조립산출 §3.6)", () => {
    it("실행 전에는 저장본이 없다", async () => {
      expect(await svc.latest(productId)).toBeUndefined();
    });

    it("run 은 조립 결과를 저장하고, latest 는 같은 booklet · stale:false · grade · 생성 시각 · 실행자를 준다", async () => {
      const before = new Date();
      const ran = unwrap(await svc.run(editor, productId));
      const rec = await svc.latest(productId);
      expect(rec).toBeDefined();
      expect(rec!.booklet).toEqual(ran.booklet);
      expect(rec!.booklet).toEqual(unwrap(await svc.preview(productId)));
      expect(rec!.stale).toBe(false);
      expect(ran.stale).toBe(false);
      // 이 시점의 픽스처는 조합이 없어 noPlan 오류 — 「오류포함」
      expect(rec!.booklet.complete).toBe(false);
      expect(rec!.grade).toBe("withErrors");
      expect(rec!.generatedAt).toBeInstanceOf(Date);
      expect(rec!.generatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1);
      expect(rec!.generatedBy).toBe(editor.userId);
    });

    it("상품 고유분(세목 선택지 값)을 바꾸면 stale:true — 다시 run 하면 false", async () => {
      const opt = (await product.listPlanOptions(productId)).find((o) => o.axis === "type")!;
      unwrap(await product.setPlanOptionValue(editor, opt.id, "waiver.applies", false));
      expect((await svc.latest(productId))!.stale).toBe(true);
      unwrap(await svc.run(editor, productId));
      expect((await svc.latest(productId))!.stale).toBe(false);
    });

    it("공유 마스터 변경(함수조항 이름 · 구분자 설명)도 stale:true — 어느 마스터든 바뀌면 전 상품 오래됨", async () => {
      unwrap(await clause.rename(editor, "C0002", "준용 문구(개정)"));
      expect((await svc.latest(productId))!.stale).toBe(true);
      unwrap(await svc.run(editor, productId));
      expect((await svc.latest(productId))!.stale).toBe(false);
      unwrap(await catalog.setDescription(editor, "D0002", "고지유형 — 설명"));
      expect((await svc.latest(productId))!.stale).toBe(true);
      unwrap(await svc.run(editor, productId));
    });

    it("상품 값 행 삭제만으로도 stale:true — 최신 행이 아닌 것을 지워도 count 가 잡는다", async () => {
      const [newest, older] = (await product.listPlanOptions(productId)).filter((o) => o.axis === "type");
      // newest 의 값을 마지막으로 써 max(updated_at) 을 그 행에 둔다 → older 의 값 삭제는 max 를 바꾸지 않는다
      unwrap(await product.setPlanOptionValues(editor, newest.id, [{ path: "waiver.applies", value: true }, { path: "waiver.reasons", value: ["V01"] }]));
      unwrap(await svc.run(editor, productId));
      expect((await svc.latest(productId))!.stale).toBe(false);
      unwrap(await product.setPlanOptionValue(editor, older.id, "waiver.applies", undefined));
      expect((await svc.latest(productId))!.stale).toBe(true);
      unwrap(await svc.run(editor, productId));
    });

    it("행 수가 그대로인 관계 변경(상품담보의 그룹 이동)도 stale:true — updated_at 없는 테이블은 키 다이제스트가 잡는다", async () => {
      unwrap(await svc.run(editor, productId));
      const group2 = unwrap(await product.createGroup(editor, productId, { title: "기타 특별약관" }));
      unwrap(await svc.run(editor, productId)); // 그룹 행 추가분은 반영해 두고
      unwrap(await product.placeInGroup(editor, group2.id, pcAddon)); // 멤버 행 수는 2 그대로
      expect((await svc.latest(productId))!.stale).toBe(true);
      unwrap(await svc.run(editor, productId));
      expect((await svc.latest(productId))!.stale).toBe(false);
    });

    it("다른 상품의 고유분 변경은 이 상품을 오래되게 하지 않는다", async () => {
      const other = unwrap(await product.createProduct(editor, { name: "다른 상품" }));
      const opt = unwrap(await product.addPlanOption(editor, other.id, { axis: "type", number: 1, name: "1종", planTypeCode: "waiver" }));
      unwrap(await product.setPlanOptionValues(editor, opt.id, [{ path: "waiver.applies", value: true }, { path: "waiver.reasons", value: ["V01"] }]));
      unwrap(await product.setArticleHidden(editor, productId, "g-art-def", false)); // 멱등 — 아무것도 안 바뀐다
      expect((await svc.latest(productId))!.stale).toBe(false);
      expect(await svc.latest(other.id)).toBeUndefined();
    });

    it("없는 상품의 run 은 notFound 이고 아무것도 저장하지 않는다", async () => {
      const missing = "00000000-0000-4000-8000-0000000000ff";
      const r = await svc.run(editor, missing);
      expect(!r.ok && r.rejection.reason).toBe("notFound");
      expect(await svc.latest(missing)).toBeUndefined();
    });
  });

  describe("재료 분리 · 상수 쿼리 · 결정성 (ADR-0034 결정 2·3·4)", () => {
    const count = async (fn: () => Promise<unknown>) => {
      t.resetQueryCount();
      await fn();
      return t.queryCount();
    };

    it("loadMaster + loadProduct 를 합치면 loadAssemblyInput 과 같은 재료다", async () => {
      const master = await svc.loadMaster();
      const product = unwrap(await svc.loadProduct(productId, master));
      expect({ ...master, ...product }).toEqual(unwrap(await svc.loadAssemblyInput(productId)));
      expect([...master.generalDocuments.keys()]).toEqual([product.product.generalDocumentId]);
      expect([...master.specialDocuments.keys()].sort()).toEqual([covBase, covDeath].sort());
    });

    it("결정성 — 같은 상품을 두 번 preview 하면 같은 Booklet · run 의 저장 booklet 도 같다", async () => {
      expect(unwrap(await svc.preview(productId))).toEqual(unwrap(await svc.preview(productId)));
      const first = unwrap(await svc.run(editor, productId)).booklet;
      const second = unwrap(await svc.run(editor, productId)).booklet;
      expect(second).toEqual(first);
      expect((await svc.latest(productId))!.booklet).toEqual(first);
    });

    it("상수 쿼리 — 상품담보 하나(급부 2개짜리 담보)를 더 탑재해도 loadProduct 의 쿼리 수가 같다 · loadMaster 도 상수", async () => {
      const master = await svc.loadMaster();
      const m1 = await count(() => svc.loadMaster());
      const before = await count(() => svc.loadProduct(productId, master));
      // 급부가 둘인 새 담보 마스터 + 문면 없이 탑재 (문면 없는 탑재분은 undocumented — 오류 아님)
      const burn = unwrap(await coverage.create(editor, { name: "화상", benefitName: "화상보험금" }));
      trees.set(burn.id, unwrap(await coverage.addBenefit(editor, burn.subCoverages[0].id, "화상수술비")));
      const pcBurn = unwrap(await product.mount(editor, productId, burn.id, [])).id;
      const pcs = await product.listProductCoverages(productId);
      expect(pcs.map((pc) => pc.id)).toContain(pcBurn);
      const after = await count(() => svc.loadProduct(productId, master));
      expect(after).toBe(before);
      const m2 = await count(() => svc.loadMaster());
      expect(m2).toBe(m1);
      // 탑재분은 재료에 실린다 (스냅샷 급부 2 · 값 자리 빈 Map · 부착 세목 없음)
      const loaded = unwrap(await svc.loadProduct(productId, master));
      const c = loaded.coverages.find((x) => x.snapshot.id === pcBurn)!;
      expect(c.snapshot.subCoverages[0].benefits.map((b) => b.name)).toEqual(["화상보험금", "화상수술비"]);
      expect(c.plans).toEqual([]);
      expect(unwrap(await svc.preview(productId)).undocumented.map((u) => u.productCoverageId)).toEqual([pcBurn]);
    });

    it("재료 재사용 — assembleMany 로 상품 2개를 돌리면 마스터 적재 쿼리는 한 번만 (≈ m + 2p)", async () => {
      const other = unwrap(await product.createProduct(editor, { name: "베타", generalDocumentId: (await product.getProduct(productId))!.generalDocumentId })).id;
      unwrap(await product.mount(editor, other, covBase, [], "base"));
      unwrap(await product.mount(editor, other, covDeath, [{ kindCode: "A0002", valueCode: "1" }]));
      const m = await count(() => svc.loadMaster());
      const runA = await count(() => svc.run(editor, productId));
      const runB = await count(() => svc.run(editor, other));
      const many = await count(async () => {
        const results = await svc.assembleMany(editor, [productId, other]);
        expect([...results.keys()]).toEqual([productId, other]);
        expect(unwrap(results.get(productId)!).booklet).toEqual((await svc.latest(productId))!.booklet);
        expect(unwrap(results.get(other)!).booklet).toEqual((await svc.latest(other))!.booklet);
      });
      // latest 두 번(각 스탬프 + 저장본 읽기)은 빼고 비교한다
      const latestCost = await count(() => svc.latest(productId)) + (await count(() => svc.latest(other)));
      expect(many - latestCost).toBe(runA + runB - m);
      // 한 건 거부(없는 상품)는 그 건만 거부 — 나머지는 저장된다 (ADR-0034 결정 7 의 자리). 중복 id 는 한 번.
      const missing = "00000000-0000-4000-8000-0000000000ff";
      const mixed = await svc.assembleMany(editor, [missing, other, other]);
      expect([...mixed.keys()]).toEqual([missing, other]);
      expect(mixed.get(missing)!.ok).toBe(false);
      expect(mixed.get(other)!.ok).toBe(true);
    });

    it("건별 격리 — 한 건의 저장이 throw 해도 그 건만 failed 거부, 나머지는 조립·저장된다 (ADR-0034 결정 7)", async () => {
      const other = (await product.listProducts()).find((p) => p.name === "베타")!.id;
      const before = (await svc.latest(other))!.generatedAt;
      // 첫 저장(productId)만 터뜨린다 — 두 번째(other)는 그대로
      const spy = vi.spyOn(previewRepo, "savePreview").mockImplementationOnce(async () => {
        throw new Error("디스크가 가득 찼습니다");
      });
      try {
        const results = await svc.assembleMany(editor, [productId, other]);
        expect([...results.keys()]).toEqual([productId, other]);
        const failed = results.get(productId)!;
        expect(!failed.ok && failed.rejection).toEqual({ reason: "failed", message: "디스크가 가득 찼습니다" });
        expect(results.get(other)!.ok).toBe(true);
        expect((await svc.latest(other))!.generatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect((await svc.latest(other))!.stale).toBe(false);
        expect(spy).toHaveBeenCalledTimes(2);
      } finally {
        spy.mockRestore();
      }
      // 복구 뒤 같은 상품은 다시 저장된다
      expect(unwrap(await svc.run(editor, productId)).stale).toBe(false);
    });

    it("건별 격리 — 스탬프 조회가 throw 하는 건(uuid 가 아닌 id)도 그 건만 failed 거부, 나머지는 조립·저장된다", async () => {
      const other = (await product.listProducts()).find((p) => p.name === "베타")!.id;
      const before = (await svc.latest(other))!.generatedAt;
      const results = await svc.assembleMany(editor, [other, "malformed-id"]);
      expect([...results.keys()]).toEqual([other, "malformed-id"]); // 입력 순서 그대로
      const failed = results.get("malformed-id")!;
      expect(!failed.ok && failed.rejection.reason).toBe("failed");
      expect(results.get(other)!.ok).toBe(true);
      expect((await svc.latest(other))!.generatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      // run 도 같은 경로 — 예외가 아니라 거부로 돌아온다
      const single = await svc.run(editor, "malformed-id");
      expect(!single.ok && single.rejection.reason).toBe("failed");
    });
  });
});
