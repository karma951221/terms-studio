/**
 * 상품담보 탭 — 읽기 / 편집 · 저장 하나 (기능/상품 §3.8 · §4.5, 2026-10-04).
 * 읽기는 글자만(입력 · 아이콘 없음), 편집은 탭 첫 줄 `[취소] [저장]` · 행 안 입력 · 🗑 · 표 아래 「+ 담보 추가」 줄.
 * 오른쪽에 떠 있던 탑재 폼(「…에 탑재」)은 없다. 특약 그룹 섹션도 없다 — 특별약관 표의 읽기 전용 「그룹」 열(ADR-0080).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/products/p1",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../../actions", () => ({ saveProductCoveragesAction: async () => ({ ok: true }) }));

import type { AttributeKind, ProductCoverage, ProductPlan } from "@/domain/product";

import { CoveragesTab, type CoveragesTabProps } from "./CoveragesTab";
import { ProductEditProvider } from "./ProductEdit";

const kinds: AttributeKind[] = [{ code: "A0001", label: "부가유형", order: 0, values: [{ code: "1", label: "기본", fragment: "" }, { code: "2", label: "추가", fragment: "추가" }] }] as AttributeKind[];
const pc = (id: string, coverageId: string, name: string, attributes: ProductCoverage["attributes"] = []): ProductCoverage => ({ id, productId: "p1", coverageId, name, attributes });
const plans: ProductPlan[] = [
  { id: "plan-1", productId: "p1", options: [{ id: "o1", productId: "p1", axis: "type", number: 1, name: "1종", planTypeCode: "waiver" }] },
  { id: "plan-2", productId: "p1", options: [{ id: "o2", productId: "p1", axis: "type", number: 2, name: "2종", planTypeCode: "waiver" }] },
];

const props = (over: Partial<CoveragesTabProps> = {}): CoveragesTabProps => ({
  productId: "p1",
  baseCoverages: [pc("b1", "c-base", "일반상해80%이상후유장해")],
  specialCoverages: [pc("s1", "c-death", "일반상해사망", [{ kindCode: "A0001", valueCode: "1" }]), pc("s2", "c-death", "일반상해사망 추가", [{ kindCode: "A0001", valueCode: "2" }])],
  coverages: [
    { id: "c-base", code: "COV000001", name: "일반상해80%이상후유장해" },
    { id: "c-death", code: "COV000002", name: "일반상해사망", group: "상해 관련 특별약관" },
  ],
  attributeKinds: kinds,
  plans,
  attachedPlans: { s1: ["plan-1"] },
  namingTemplate: "[담보명] [A0001]",
  suggestedNames: { b1: "일반상해80%이상후유장해", s1: "일반상해사망", s2: "일반상해사망 추가" },
  mountSearch: { base: {}, special: {} },
  baseCheck: { ok: true, value: [] },
  ...over,
});

function render(editing: boolean, over: Partial<CoveragesTabProps> = {}) {
  return renderToStaticMarkup(
    <ProductEditProvider canEdit initialEditing={editing}>
      <CoveragesTab {...props(over)} />
    </ProductEditProvider>,
  );
}
const section = (html: string, title: string) => html.slice(html.indexOf(`aria-label="${title}"`), html.indexOf("</section>", html.indexOf(`aria-label="${title}"`)));

describe("상품담보 탭 — 읽기", () => {
  const html = render(false);

  it("탭 첫 줄 오른쪽에 `편집` 하나 — 저장 · 취소는 없다", () => {
    expect(html).toMatch(/<div class="ts-tab-head">[\s\S]*?>편집<\/button>/);
    expect(html).not.toContain(">저장</button>");
  });

  it("글자만 — 입력 · select · 아이콘 버튼 · 「+ 담보 추가」가 없다", () => {
    for (const title of ["기본계약", "특별약관"]) {
      const s = section(html, title);
      expect(s).not.toContain("<input type=\"text\"");
      expect(s).not.toContain("<select");
      expect(s).not.toContain("ts-iconbtn");
      expect(s).not.toContain("담보 추가");
    }
    expect(html).toContain(">일반상해사망 추가<");
  });

  it("떠 있던 탑재 폼(「…에 탑재」) · 특약 그룹 섹션이 없다", () => {
    expect(html).not.toContain("에 탑재");
    expect(html).not.toContain("새 그룹 제목");
    expect(html).not.toContain("특약 그룹");
  });

  it("세목 부착은 조합 글자, 없으면 「—」 · 특별약관 표에만 읽기 전용 「그룹」 열", () => {
    const s = section(html, "특별약관");
    expect(s).toContain("(제1종)");
    expect([...s.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1])).toEqual(["담보코드", "담보명", "담보속성", "상품담보명", "그룹", "세목 부착"]);
    expect(s).toContain("상해 관련 특별약관");
    expect([...section(html, "기본계약").matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1])).toEqual(["담보코드", "담보명", "담보속성", "상품담보명", "세목 부착"]);
  });

  it("담보 검색 · 페이저는 읽기에만", () => {
    expect(section(html, "특별약관")).toContain("담보 검색");
  });
});

describe("상품담보 탭 — 편집", () => {
  const html = render(true);

  it("탭 첫 줄은 `[취소] [저장]`", () => {
    expect(html).toMatch(/<div class="ts-tab-head">[\s\S]*?>취소<\/button>[\s\S]*?>저장<\/button>/);
  });

  it("행 안에서 상품담보명 입력(✓ 저장 버튼 없음) · 세목 부착(칩 ✕ + select ＋) · 🗑 탑재 해제", () => {
    const s = section(html, "특별약관");
    expect(s).toContain('aria-label="상품담보명 · 일반상해사망 추가"');
    expect(s).not.toContain("이름 저장");
    expect(s).toContain('aria-label="세목 부착 해제 · 일반상해사망 · (제1종)"');
    expect(s).toContain('aria-label="세목 조합 · 일반상해사망"');
    expect(s).toContain('aria-label="탑재 해제 · 일반상해사망 추가"');
    expect(s).toContain("조작");
  });

  it("두 표 아래 모두 「+ 담보 추가」 줄 — 떠 있는 탑재 폼은 없다 · 검색은 편집 중에 없다", () => {
    expect(section(html, "기본계약")).not.toContain("담보 추가"); // 기본계약이 이미 있다 — 대신 안내
    expect(section(html, "기본계약")).toContain("기본계약은 하나만");
    expect(section(html, "특별약관")).toMatch(/ 담보 추가<\/button>/);
    expect(html).not.toContain("에 탑재");
    expect(section(html, "특별약관")).not.toContain("담보 검색");
    const empty = render(true, { baseCoverages: [] });
    expect(section(empty, "기본계약")).toMatch(/ 담보 추가<\/button>/);
  });

  it("독립특약 상품 — 기본계약 표에는 「+ 담보 추가」 대신 「독립특약 상품은 기본계약을 두지 않습니다」", () => {
    const s = section(render(true, { baseCoverages: [], standalone: true }), "기본계약");
    expect(s).not.toMatch(/ 담보 추가<\/button>/);
    expect(s).toContain("독립특약 상품은 기본계약을 두지 않습니다");
  });

  it("「+ 담보 추가」를 펼친 줄 — 담보 찾기 · 담보속성 select · 추가 · 닫기", () => {
    const s = section(render(true, { initialAddOpen: "special" }), "특별약관");
    expect(s).toContain('role="combobox"');
    expect(s).toContain('aria-label="담보 · 특별약관에 추가"');
    expect(s).toContain('aria-label="부가유형 · 특별약관에 추가"');
    expect(s).toMatch(/>추가<\/button>/);
    expect(s).toMatch(/>닫기<\/button>/);
  });
});
