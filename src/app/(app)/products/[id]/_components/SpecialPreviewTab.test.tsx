/**
 * 약관 › 담보별 미리보기 — 담보 단위 세 패널 (기능/상품 §4.7, 2026-10-03 사용자 결정).
 * 왼쪽 담보 목록 · 가운데 담보약관 템플릿 원문 모델(읽기 전용) · 오른쪽 상품담보 선택기 + 조립 결과.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { SpecialPreview } from "@/domain/assembly";
import type { Clause } from "@/domain/clause";
import type { DocumentNode } from "@/domain/document";
import type { ProductCoverage } from "@/domain/product";
import type { Result } from "@/domain/types";

import { resolveSpecialSelection, specialCoverageGroups } from "../../lib";
import { SpecialPreviewTab } from "./SpecialPreviewTab";

vi.mock("../../actions", () => ({ setOptionOverrideAction: () => {}, removeOptionOverrideAction: () => {} }));

const pc = (id: string, coverageId: string, name: string): ProductCoverage => ({ id, productId: "p1", coverageId, name, attributes: [] });
const specials = [pc("s1", "c2", "일반상해사망보장"), pc("s2", "c3", "질병사망보장"), pc("s3", "c2", "일반상해사망보장 추가")];
const names = new Map([
  ["c2", "일반상해사망"],
  ["c3", "질병사망"],
]);
const groups = specialCoverageGroups(specials, (id) => names.get(id));

const clause: Clause = {
  mode: "block",
  code: "C0002",
  label: "대표자의 지정",
  required: { discriminators: [], attributes: [] },
  options: [{ code: "O01", label: "지정 주체", order: 0, values: [{ code: "V01", label: "계약자", body: [], order: 0 }] }],
  body: [{ id: "cp1", kind: "paragraph", children: [{ id: "ct", kind: "text", text: "대표자를 지정합니다" }] }],
};

const tree: DocumentNode = {
  id: "D1",
  kind: "document",
  title: "일반상해사망 특별약관",
  children: [
    {
      id: "A1",
      kind: "article",
      title: "보험금의 지급사유",
      children: [
        { id: "P1", kind: "paragraph", children: [{ id: "t1", kind: "text", text: "회사는 상해로 사망한 경우" }] },
        { id: "R1", kind: "clauseBlockRef", clauseCode: "C0002", options: { O01: "V01" } },
      ],
    },
  ],
} as DocumentNode;

const preview = (title: string): Result<SpecialPreview> => ({
  ok: true,
  value: {
    doc: { kind: "document", id: "D1", document: "special", ownerId: "x", title, children: [{ kind: "article", id: `art-${title}`, label: "제1조", title: `${title} 지급사유`, children: [] }] },
    general: undefined,
    appendices: [],
    issues: [],
    complete: true,
    omitted: [],
    trace: [],
  } as unknown as SpecialPreview,
});

function render(params: { cov?: string; pc?: string }, template: { id: string; tree: DocumentNode } | null = { id: "D1", tree }) {
  const selected = resolveSpecialSelection(groups, params);
  const previews = new Map((selected?.group.productCoverages ?? []).map((p) => [p.id, preview(p.name)] as const));
  return renderToStaticMarkup(
    <SpecialPreviewTab
      productId="p1"
      groups={groups}
      selected={selected}
      template={template ?? undefined}
      previews={previews}
      clauses={[clause]}
      appendices={[]}
      boxes={[]}
      discriminators={[]}
    />,
  );
}

describe("SpecialPreviewTab — 담보 단위 세 패널", () => {
  it("세 패널 — 왼쪽은 담보 한 행씩(상품담보가 둘 이상이면 수), 고른 담보 강조 · `&cov=` 링크", () => {
    const html = render({});
    expect(html.match(/class="ts-terms-panel[ "]/g)).toHaveLength(3);
    expect(html).toContain('href="/products/p1?tab=terms&amp;sub=special&amp;cov=c2"');
    expect(html).toContain('href="/products/p1?tab=terms&amp;sub=special&amp;cov=c3"');
    expect(html).toMatch(/<a(?=[^>]*cov=c2")(?=[^>]*aria-current="page")[^>]*>일반상해사망/);
    expect(html).toMatch(/일반상해사망<!-- -->\s*<span class="ts-count">2<\/span>|일반상해사망 <span class="ts-count">2<\/span>/);
    // 다른 담보의 상품담보는 어디에도 없다 — 선택기는 고른 담보의 것만
    expect(html).not.toContain("질병사망보장");
  });

  it("가운데는 「모델링 — 담보명」 머리 + 담보약관 템플릿 원문 모델 — 읽기 전용(폼 · 체크박스 · 선택 없음), 템플릿 링크도 없다", () => {
    const page = render({});
    const html = page.slice(page.indexOf('aria-label="모델링"'), page.indexOf('aria-label="미리보기"'));
    expect(html).toContain("모델링 — 일반상해사망");
    expect(page).not.toContain('href="/documents/');
    expect(html).toContain("회사는 상해로 사망한 경우");
    expect(html).toContain("data-clause-box=");
    expect(html).toContain("대표자를 지정합니다");
    expect(html).not.toContain("<form");
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain("<select");
  });

  it("오른쪽 머리는 상품담보 드롭다운 + 개수 — 고른 담보의 상품담보만, 고른 건 선택됨, 미리보기는 그 한 건", () => {
    const html = render({ pc: "s3" });
    expect(html).toMatch(/<select[^>]*aria-label="상품담보"/);
    expect(html).toMatch(/<option value="s1"[^>]*>일반상해사망보장<\/option>/);
    expect(html).toMatch(/<option value="s3" selected="">일반상해사망보장 추가<\/option>/);
    expect(html).toMatch(/상품담보 (<!-- -->)?2/);
    expect(html).not.toContain("ts-special-pcs");
    expect(html).not.toContain("pc=s2");
    expect(html).toContain("일반상해사망보장 추가 지급사유");
    expect(html).not.toContain("일반상해사망보장 지급사유");
    expect(html).toContain("오류 <b>0</b> / 조 1");
  });

  it("담보약관 템플릿이 없는 담보 — 가운데에 한 줄 안내", () => {
    const html = render({ cov: "c3" }, null);
    expect(html).toContain("이 담보에는 담보약관 템플릿이 없다");
    expect(html).not.toContain('href="/documents/');
  });

  it("특약 상품담보가 없으면 한 줄 안내", () => {
    const html = renderToStaticMarkup(
      <SpecialPreviewTab productId="p1" groups={[]} selected={undefined} template={undefined} previews={new Map()} clauses={[]} appendices={[]} boxes={[]} discriminators={[]} />,
    );
    expect(html).toContain("특약 상품담보가 없다 — 상품담보 탭에서 탑재한다.");
  });
});
