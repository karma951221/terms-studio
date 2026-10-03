/**
 * 상품 상세 한 줄 탭 넷 (2026-10-03) — 기본정보(상품정보 · 세목) · 상품담보(기본계약 · 특별약관 표 · 그룹) · 보통약관 · 특별약관.
 * 탭마다 제 일만 선다 — 특히 보통약관 탭에는 템플릿 한 줄과 세 패널 말고는 아무것도 없다(사용자 QA: 템플릿 · 기본계약이 집중을 흐린다).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/products/p1",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../../actions", () => ({
  attachPlanAction: () => {},
  mountAction: () => {},
  regenerateNameAction: () => {},
  renameProductCoverageAction: () => {},
  createGroupAction: () => {},
  designateBaseContractAction: () => {},
  placeInGroupAction: () => {},
  releaseBaseContractAction: () => {},
  removeFromGroupAction: () => {},
  renameGroupAction: () => {},
  setProductGeneralDocumentAction: () => {},
  saveProductGeneralAction: async () => ({ ok: true }),
  saveProductBasicAction: async () => ({ ok: true }),
}));

import type { DocumentNode, NodeNumber } from "@/domain/document";
import type { ProductCoverage } from "@/domain/product";
import { buildForm } from "@/forms";

import { BasicTab } from "./BasicTab";
import { CoveragesTab } from "./CoveragesTab";
import { GeneralTab } from "./GeneralTab";
import { ProductEditProvider } from "./ProductEdit";

const enums = [
  { code: "E0003", label: "간편심사유형", values: [{ code: "V01", label: "3.0.5", order: 0 }, { code: "V02", label: "3.5.5", order: 1 }] },
  { code: "E0004", label: "건강고지유형", values: [{ code: "V01", label: "6년 건강고지형", order: 0 }] },
  { code: "E0005", label: "고지유형", values: [{ code: "V01", label: "일반심사", order: 0 }, { code: "V02", label: "간편심사", order: 1 }, { code: "V03", label: "건강고지", order: 2 }] },
  { code: "E0006", label: "간편심사구분", values: [{ code: "V01", label: "단일심사", order: 0 }, { code: "V02", label: "통합간편심사", order: 1 }] },
  { code: "E0007", label: "계약형태", values: [{ code: "V01", label: "주계약", order: 0 }, { code: "V02", label: "독립특약", order: 1 }] },
];
const lookup = (code: string) => enums.find((e) => e.code === code) as never;

describe("기본정보 — 상품정보(상품명 · 평균공시이율 · 상품특성) + 세목", () => {
  const values = new Map([
    ["disclosure.avg_rate", { entered: true as const, value: 2.5 }],
    ["feature.contract_kind", { entered: true as const, value: "V01" }],
    ["feature.renewable", { entered: true as const, value: true }],
    ["feature.notice_kind", { entered: true as const, value: "V02" }],
    ["feature.review_scope", { entered: true as const, value: "V02" }],
    ["feature.review_type", { entered: true as const, value: ["V01", "V02"] }],
  ]);
  const render = () =>
    renderToStaticMarkup(
      <ProductEditProvider canEdit>
        <BasicTab productId="p1" productName="메리츠" productForm={buildForm("product", lookup, values)} planOptions={[]} plans={[]} planOptionForms={[]} planTypeForms={[{ code: "waiver", label: "납입면제", model: buildForm("plan", lookup, new Map()) }]} />
      </ProductEditProvider>,
    );

  it("상품정보 표 — 상품명 · 평균공시이율, 폼 이름 줄 「상품특성」 아래 일곱 칸 — 계약형태가 맨 앞 (고지유형 = 간편심사라 건강고지유형은 없다)", () => {
    const html = render();
    expect(html).toContain("<h3>상품정보</h3>");
    const rows = [...html.matchAll(/<th scope="row">(?:<label[^>]*>)?([^<]+)/g)].map((m) => m[1]);
    expect(rows).toEqual(["상품명", "평균공시이율", "계약형태", "갱신형여부", "태아보장여부", "단체계약여부", "고지유형", "간편심사구분", "간편심사유형"]);
    expect(html).toContain(">상품특성</th>");
  });

  it("읽기 — 저장된 값(2.5% · 예 · 통합간편심사), 없는 값은 「—」, 상품명은 읽기 전용", () => {
    const html = render();
    expect(html).toMatch(/data-path="disclosure.avg_rate"[^>]*><th scope="row">평균공시이율<\/th><td class="col-flex">2.5%</);
    expect(html).toMatch(/data-path="feature.renewable"[\s\S]*?>예</);
    expect(html).toMatch(/data-path="feature.review_scope"[\s\S]*?>통합간편심사</);
    expect(html).toMatch(/data-path="feature.review_type"[\s\S]*?>3.0.5/);
    expect(html).toMatch(/data-path="feature.fetal"[\s\S]*?>—</);
    expect(html).toMatch(/data-path="feature.contract_kind"[\s\S]*?>주계약</);
    expect(html).toMatch(/<input[^>]*aria-label="상품명"[^>]*readOnly=""/);
  });

  it("편집은 헤더가 아니라 이 탭 첫 줄 오른쪽에 — 상품정보보다 위 (2026-10-03 사용자 QA)", () => {
    const html = render();
    expect(html).toMatch(/<div class="ts-tab-head"><div class="ts-product-actions"><button type="button">편집<\/button>/);
    expect(html.indexOf("ts-tab-head")).toBeLessThan(html.indexOf("<h3>상품정보</h3>"));
  });

  it("세목(보험종목 정의 · 종·형 조합)이 같은 탭 아래에 선다 — 저장은 하나", () => {
    const html = render();
    expect(html).toContain("<h3>세목</h3>");
    expect(html).toContain("보험종목 정의");
    expect(html).toContain("종·형 조합");
  });
});

const pc = (id: string, coverageId: string, name: string): ProductCoverage => ({ id, productId: "p1", coverageId, name, attributes: [] });

describe("상품담보 — 기본계약 · 특별약관 표 · 기본계약 지정 · 특약 그룹이 한 탭에", () => {
  it("두 표(각자 검색 쿼리) · 기본계약 · 그룹 — 상품담보 행에 미리보기 링크는 없다", () => {
    const html = renderToStaticMarkup(
      <CoveragesTab
        productId="p1"
        baseCoverages={[pc("b1", "c1", "기본")]}
        specialCoverages={[pc("s1", "c2", "특약 A"), pc("s2", "c2", "특약 A 추가")]}
        coverages={[
          { id: "c1", code: "COV000001", name: "일반상해사망" },
          { id: "c2", code: "COV000002", name: "수술비" },
        ]}
        attributeKinds={[]}
        plans={[]}
        mountSearch={{ base: {}, special: {} }}
        wouldBeName={(p) => p.name}
        baseCheck={{ ok: true, value: [] }}
        groups={[]}
        unplaced={[]}
        confirm={undefined}
        confirmNode={null}
      />,
    );
    expect(html).toContain(">기본계약</h2>");
    expect(html).toContain('id="base-contract"');
    expect(html).toContain(">특별약관</h2>");
    expect(html).toContain("특약 그룹");
    expect(html).not.toContain("tab=special&amp;pc=s1");
    // 담보 : 상품담보 = 1 : N — 특별약관 표에서 COV000002 는 한 번만
    expect(html.split("<code>COV000002</code>").length - 1).toBe(1);
    expect(html).not.toContain("보통약관 템플릿");
  });

  it("독립특약 상품 — 기본계약 표의 탑재 폼 대신 「독립특약 상품은 기본계약을 두지 않습니다」, 특별약관 표는 그대로 탑재한다 (기능/상품 §3.1)", () => {
    const html = renderToStaticMarkup(
      <CoveragesTab
        productId="p1"
        baseCoverages={[]}
        specialCoverages={[]}
        coverages={[]}
        attributeKinds={[]}
        plans={[]}
        mountSearch={{ base: {}, special: {} }}
        wouldBeName={(p) => p.name}
        baseCheck={{ ok: true, value: [] }}
        standalone
        groups={[]}
        unplaced={[]}
        confirm={undefined}
        confirmNode={null}
      />,
    );
    expect(html).toContain("독립특약 상품은 기본계약을 두지 않습니다");
    // 탑재 폼(hidden section)은 특별약관 절에만
    expect(html).not.toContain('name="section" value="base"');
    expect(html).toContain('name="section" value="special"');
  });
});

describe("보통약관 탭 — 템플릿 한 줄 + 세 패널, 다른 것은 없다 (기능/상품 §4.6)", () => {
  const tree: DocumentNode = {
    id: "doc",
    kind: "document",
    title: "보통약관",
    children: [
      {
        id: "A1",
        kind: "article",
        title: "목적",
        children: [{ id: "P1", kind: "paragraph", children: [{ id: "t", kind: "text", text: "이 계약은" }, { id: "R1", kind: "clauseInlineRef", clauseCode: "C0001", options: { O01: "V01" } }] }],
      },
    ],
  };
  const clauses = [
    {
      mode: "inline" as const,
      code: "C0001",
      label: "소멸",
      body: [],
      required: { discriminators: [], attributes: [] },
      options: [{ code: "O01", label: "어조", order: 0, values: [{ code: "V01", label: "일반", body: [], order: 0 }, { code: "V02", label: "사망", body: [], order: 1 }] }],
    },
  ];
  const tab = (props: Partial<Parameters<typeof GeneralTab>[0]> = {}) => (
    <GeneralTab
      productId="p1"
      generalDocumentId="doc"
      generals={[{ id: "doc", title: "알파 보통약관" }, { id: "doc2", title: "베타 보통약관" }]}
      baseCoverages={[]}
      overrides={[]}
      overrideTargets={[{ nodeId: "R1", clauseCode: "C0001", label: "제1조(목적) › 함수조항 소멸(C0001)", options: [{ code: "O01", label: "어조", values: [{ code: "V01", label: "일반" }, { code: "V02", label: "사망" }] }] }]}
      clauses={clauses}
      appendices={[]}
      boxes={[]}
      discriminators={[]}
      generalTree={tree}
      generalNumbers={new Map<string, NodeNumber>([["A1", { n: 1, label: "제1조" } as NodeNumber]])}
      hiddenArticles={[]}
      booklet={undefined}
      bookletNote={undefined}
      articleId={undefined}
      confirm={undefined}
      confirmNode={null}
      {...props}
    />
  );
  const render = (editing: boolean, props: Partial<Parameters<typeof GeneralTab>[0]> = {}) =>
    renderToStaticMarkup(
      <ProductEditProvider canEdit initialEditing={editing}>
        {tab(props)}
      </ProductEditProvider>,
    );

  it("템플릿 이름(글) · 집계 · 목차 · 모델링 · 미리보기 — 탑재 표 · 기본계약은 여기 없다", () => {
    const html = render(false);
    expect(html).toContain('<span class="ts-terms-template-label">보통약관 템플릿</span><span class="ts-terms-template-name">알파 보통약관</span>');
    expect(html).toContain("조 중 <b>1</b> 노출");
    expect(html).toContain(">목차</h3>");
    expect(html).toContain(">모델링 — 전체</h3>");
    expect(html).toContain(">미리보기 — 전체</h3>");
    expect(html.match(/class="ts-terms-panel-head"/g)).toHaveLength(3);
    expect(html).toContain("이 계약은");
    for (const absent of ["기본계약", "특별약관", "담보 검색", "템플릿 저장"]) expect(html).not.toContain(absent);
  });

  it("읽기 — 입력이 없다(체크박스 · 선택 · 콤보박스 없음), 탭 첫 줄 오른쪽에 [편집]", () => {
    const html = render(false);
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain("<select");
    expect(html).not.toContain('role="combobox"');
    expect(html).not.toContain("템플릿 바꾸기");
    expect(html).toContain('aria-label="노출 · 제1조(목적)"');
    expect(html).toMatch(/ts-terms-template-end[\s\S]*<button type="button">편집<\/button>/);
    expect(html).not.toContain("저장하면 미리보기에 반영됩니다");
  });

  it("편집 — [취소] [저장] · 목차 체크박스 · 상자 안 옵션 고르기 · 안내 한 줄 · 「템플릿 바꾸기…」", () => {
    const html = render(true);
    expect(html).toMatch(/ts-terms-template-end[\s\S]*>취소<[\s\S]*>저장</);
    expect(html).not.toContain(">편집<");
    expect(html).toMatch(/<input type="checkbox" aria-label="노출 · 제1조\(목적\)"[^>]*checked=""/);
    expect(html).toContain("<select");
    expect(html).toContain("저장하면 미리보기에 반영됩니다");
    expect(html).toContain(">템플릿 바꾸기…</button>");
  });

  it("템플릿 미지정 — 이 줄이 곧 고르기(편집 없이), 한 줄 안내", () => {
    const html = render(false, { generalDocumentId: undefined, generalTree: undefined });
    expect(html).toContain('role="combobox"');
    expect(html).toContain(">템플릿 지정</button>");
    expect(html).toContain("보통약관 템플릿을 지정하면");
    expect(html).not.toContain(">편집<");
  });
});
