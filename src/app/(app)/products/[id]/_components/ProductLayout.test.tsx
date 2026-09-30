/**
 * 상품 상세 「안 2」 (2026-09-28) — 기본정보(상품정보 · 세목) · 상품담보(기본계약 · 특별약관 표 · 그룹) · 약관(보통약관 작성 · 담보별 미리보기).
 * 탭마다 제 일만 선다 — 특히 보통약관 작성에는 템플릿 한 줄과 세 패널 말고는 아무것도 없다(사용자 QA: 템플릿 · 기본계약이 집중을 흐린다).
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
  setArticleHiddenAction: async () => ({ ok: true }),
  setOptionOverrideAction: () => {},
  removeOptionOverrideAction: () => {},
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
];
const lookup = (code: string) => enums.find((e) => e.code === code) as never;

describe("기본정보 — 상품정보(상품명 · 평균공시이율 · 상품특성) + 세목", () => {
  const values = new Map([
    ["disclosure.avg_rate", { entered: true as const, value: 2.5 }],
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

  it("상품정보 표 — 상품명 · 평균공시이율, 폼 이름 줄 「상품특성」 아래 여섯 칸 (고지유형 = 간편심사라 건강고지유형은 없다)", () => {
    const html = render();
    expect(html).toContain("<h3>상품정보</h3>");
    const rows = [...html.matchAll(/<th scope="row">(?:<label[^>]*>)?([^<]+)/g)].map((m) => m[1]);
    expect(rows).toEqual(["상품명", "평균공시이율", "갱신형여부", "태아보장여부", "단체계약여부", "고지유형", "간편심사구분", "간편심사유형"]);
    expect(html).toContain(">상품특성</th>");
  });

  it("읽기 — 저장된 값(2.5% · 예 · 통합간편심사), 없는 값은 「—」, 상품명은 읽기 전용", () => {
    const html = render();
    expect(html).toMatch(/data-path="disclosure.avg_rate"[^>]*><th scope="row">평균공시이율<\/th><td class="col-flex">2.5%</);
    expect(html).toMatch(/data-path="feature.renewable"[\s\S]*?>예</);
    expect(html).toMatch(/data-path="feature.review_scope"[\s\S]*?>통합간편심사</);
    expect(html).toMatch(/data-path="feature.review_type"[\s\S]*?>3.0.5/);
    expect(html).toMatch(/data-path="feature.fetal"[\s\S]*?>—</);
    expect(html).toMatch(/<input[^>]*aria-label="상품명"[^>]*readOnly=""/);
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
  it("두 표(각자 검색 쿼리) · 기본계약 · 그룹, 특약 행의 미리보기는 약관 › 담보별 미리보기로", () => {
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
    expect(html).toContain('href="/products/p1?tab=terms&amp;sub=special&amp;pc=s1"');
    // 담보 : 상품담보 = 1 : N — 특별약관 표에서 COV000002 는 한 번만
    expect(html.split("<code>COV000002</code>").length - 1).toBe(1);
    expect(html).not.toContain("보통약관 템플릿");
  });
});

describe("약관 › 보통약관 작성 — 템플릿 한 줄 + 세 패널, 다른 것은 없다", () => {
  const tree: DocumentNode = {
    id: "doc",
    kind: "document",
    title: "보통약관",
    children: [{ id: "A1", kind: "article", title: "목적", children: [{ id: "P1", kind: "paragraph", children: [{ id: "t", kind: "text", text: "이 계약은" }] }] }],
  };
  it("템플릿 select + 저장 · 목차 · 원문 · 미리보기 — 탑재 표 · 기본계약은 여기 없다", () => {
    const html = renderToStaticMarkup(
      <GeneralTab
        productId="p1"
        generalDocumentId="doc"
        generals={[{ id: "doc", title: "보통약관" }]}
        baseCoverages={[]}
        overrides={[]}
        overrideTargets={[]}
        clauses={[]}
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
      />,
    );
    expect(html).toContain("보통약관 템플릿");
    expect(html).toContain(">템플릿 저장<");
    expect(html).toContain(">목차<");
    expect(html).toContain("약관 — 전체 (원문)");
    expect(html).toContain("미리보기 — 전체 (평가)");
    expect(html).toContain("이 계약은");
    for (const absent of ["기본계약", "특별약관", "담보 검색"]) expect(html).not.toContain(absent);
  });
});
