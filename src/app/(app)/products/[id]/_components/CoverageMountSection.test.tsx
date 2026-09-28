/**
 * 탑재 표 — 보통약관 기본계약 · 특별약관 두 절, 둘 다 상품담보 탭 (기능/상품 §4.5, 2026-09-28).
 * 한 행 = 상품담보 하나: 담보코드 · 담보명 · 담보속성 · 상품담보명. 담보 : 상품담보 = 1 : N — 같은 담보는 이어 놓고
 * 코드 · 담보명은 묶음 첫 행에만. 「담보 검색」(특약 `?mq=` · 기본계약 `?bq=`)은 코드 · 이름 · 속성 값을 거른다.
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
}));

import type { AttributeKind, ProductCoverage } from "@/domain/product";

import { CoverageMountSection } from "./CoverageMountSection";

const kinds: AttributeKind[] = [
  { code: "A0001", label: "갱신유형", order: 0, values: [{ code: "1", label: "비갱신형", fragment: "" }, { code: "2", label: "갱신형", fragment: "갱신형" }] },
  { code: "A0002", label: "부가유형", order: 1, values: [{ code: "1", label: "기본", fragment: "" }, { code: "2", label: "추가", fragment: "추가" }] },
] as AttributeKind[];

const coverages = [
  { id: "c-death", code: "COV000002", name: "일반상해사망보장" },
  { id: "c-surgery", code: "COV000008", name: "수술비" },
];
const items: ProductCoverage[] = [
  { id: "pc1", productId: "p1", coverageId: "c-death", name: "일반상해사망보장", attributes: [{ kindCode: "A0002", valueCode: "1" }] },
  // 저장 순서가 종류 order 와 달라도 표시는 종류 순
  { id: "pc2", productId: "p1", coverageId: "c-death", name: "일반상해사망보장 추가", attributes: [{ kindCode: "A0002", valueCode: "2" }, { kindCode: "A0001", valueCode: "2" }] },
  { id: "pc3", productId: "p1", coverageId: "c-surgery", name: "수술비", attributes: [] },
];

function render(query?: string, section: "base" | "special" = "special") {
  return renderToStaticMarkup(
    <CoverageMountSection
      productId="p1"
      section={section}
      items={items}
      coverages={coverages}
      attributeKinds={kinds}
      plans={[]}
      wouldBeName={(pc) => pc.name}
      query={query}
      confirm={undefined}
      confirmNode={null}
    />,
  );
}

const rowsOf = (html: string) => html.match(/<tr(?: [^>]*)?>(?!<th)[\s\S]*?<\/tr>/g)?.filter((r) => !r.includes("<th")) ?? [];

describe("CoverageMountSection — 상품담보 한 건 = 한 행", () => {
  it("열 — 담보코드 · 담보명 · 담보속성 · 상품담보명 · 세목 부착 · 조작", () => {
    const html = render();
    const headers = [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    expect(headers).toEqual(["담보코드", "담보명", "담보속성", "상품담보명", "세목 부착", "조작"]);
  });

  it("행 수 = 상품담보 수 · 코드(담보 마스터 링크) · 담보명은 같은 담보 묶음의 첫 행에만", () => {
    const rows = rowsOf(render());
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('href="/coverages/c-death"');
    expect(rows[0]).toContain("<code>COV000002</code>");
    expect(rows[0]).toContain(">일반상해사망보장</td>");
    expect(rows[0]).toContain("부가유형=기본");
    // 같은 담보의 둘째 상품담보 — 코드 · 담보명 칸이 비었다
    expect(rows[1]).not.toContain("COV000002");
    expect(rows[1]).not.toContain(">일반상해사망보장</td>");
    expect(rows[1]).toContain("is-group-cont");
    expect(rows[1]).toContain("갱신유형=갱신형 · 부가유형=추가");
    expect(rows[1]).toContain('value="일반상해사망보장 추가"');
    expect(rows[2]).toContain("<code>COV000008</code>");
    expect(rows[2]).toContain(">수술비</td>");
    expect(rows[2]).toContain('<span class="ts-muted">—</span>');
  });

  it("기존 행 조작은 그대로 — 값 화면 · 이름 저장 · 작명 · 탑재 해제", () => {
    const html = render();
    expect(html).toContain('href="/products/p1/coverages/pc2"');
    expect(html).toContain("이름 저장 · 일반상해사망보장 추가");
    expect(html).toContain("작명 규칙으로 다시 짓기 · 수술비");
    expect(html).toContain('href="?tab=coverages&amp;confirm=pc:pc3"');
  });

  it("제목은 옛 화면의 말 — 보통약관 기본계약 · 특별약관, 검색창 · 페이저 「총 N건」", () => {
    expect(render(undefined, "base")).toContain(">보통약관 기본계약</h2>");
    const html = render();
    expect(html).toContain(">특별약관</h2>");
    expect(html).toContain('placeholder="담보 검색 — 코드 · 담보명 · 상품담보명 · 담보속성"');
    expect(html).toContain("총 <b>3</b>건");
    expect(html).toContain(">특별약관에 탑재<");
  });

  it("담보 검색 — 코드로", () => {
    const rows = rowsOf(render("cov000008"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("수술비");
  });

  it("담보 검색 — 상품담보명으로 · 걸러져 묶음 둘째 행만 남아도 그 행이 코드 · 담보명을 찍는다", () => {
    const rows = rowsOf(render("추가"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("pc2");
    expect(rows[0]).toContain("<code>COV000002</code>");
  });

  it("담보 검색 — 속성 값으로 (「갱신형」은 비갱신형 · 갱신형 둘 다가 아니라 붙인 것만)", () => {
    const rows = rowsOf(render("갱신유형=갱신형"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("pc2");
  });

  it("맞는 것이 없으면 한 줄 안내 · 총 0건", () => {
    const html = render("없는담보");
    expect(rowsOf(html)).toHaveLength(0);
    expect(html).toContain("「없는담보」에 맞는 상품담보가 없습니다.");
    expect(html).toContain("총 <b>0</b>건");
  });
});
