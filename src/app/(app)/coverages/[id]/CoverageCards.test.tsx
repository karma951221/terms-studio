/**
 * CoverageCards — 중첩 카드 그리드 (기능/담보 §3.6, 2026-09-27 aaf753c · 07b93ba).
 *
 * - 담보약관 템플릿 띠 · 옵션 미결정 배지가 없다 (07b93ba).
 * - 카드는 접지 않는다 — 형제가 3개 이상이어도 모두 늘 보인다 (aaf753c).
 * - 세부보장 카드는 그리드(`.ts-cov-grid`) 안에, 급부 카드는 제 세부보장 카드 안(`.ts-cov-benefits`)에 선다.
 * - 편집 모드에만 구조 조작(⊖ · ↑↓ · 「+ 세부보장」 점선 타일 · 「+ 급부」)이 있다. 읽기 모드에는 하나도 없다.
 *
 * `EditShell.initialMode` 로 편집/읽기를 정적으로 고정해 `renderToStaticMarkup` 으로 본다
 * (같은 패턴: `EditShell.test.tsx`).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }) }));

import { EditShell } from "@/app/_components/EditShell";
import { encodeNodeKey, type StructureDraftSub, type StructureSavedSub } from "@/domain/coverage";
import type { FormModel } from "@/forms";

import { CoverageCards, MIN_STRUCTURE } from "./CoverageCards";

const COVERAGE_KEY = encodeNodeKey("coverage", "cov-1");

/** 세부보장 `n`개 · 세부보장마다 급부 1개 — 모두 저장된 노드(id 있음). */
function subs(n: number): StructureDraftSub[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i + 1}`,
    key: encodeNodeKey("subCoverage", `s${i + 1}`),
    name: `세부보장${i + 1}`,
    benefits: [{ id: `b${i + 1}`, key: encodeNodeKey("benefit", `b${i + 1}`), name: `급부${i + 1}` }],
  }));
}

function savedOf(draft: StructureDraftSub[]): StructureSavedSub[] {
  return draft.map((s) => ({ ...s, id: s.id!, benefits: s.benefits.map((b) => ({ ...b, id: b.id! })) }));
}

function render(mode: "read" | "edit", n = 2, formByNode: Record<string, FormModel> = {}) {
  const structure = subs(n);
  return renderToStaticMarkup(
    <EditShell
      initial={{ label: "수술비", structure, values: {} }}
      title="수술비"
      path={[{ label: "담보", href: "/coverages" }]}
      saveAction={async () => ({ ok: true })}
      initialMode={mode}
    >
      <CoverageCards coverageKey={COVERAGE_KEY} formByNode={formByNode} original={savedOf(structure)} attributeValueLabels={[]} />
    </EditShell>,
  );
}

describe("CoverageCards — 담보약관 템플릿 띠 · 옵션 미결정 배지가 없다 (07b93ba)", () => {
  it("읽기 · 편집 모드 모두 ts-cov-band · 「담보약관」 · 「미결정」이 없다", () => {
    for (const mode of ["read", "edit"] as const) {
      const html = render(mode);
      expect(html).not.toContain("ts-cov-band");
      expect(html).not.toContain("담보약관");
      expect(html).not.toContain("미결정");
    }
  });
});

describe("CoverageCards — 접지 않는다 (aaf753c)", () => {
  it("펼치기/접기 버튼이 없다 — ▸ · ▾ 도 안 쓴다", () => {
    for (const mode of ["read", "edit"] as const) {
      const html = render(mode, 3);
      expect(html).not.toContain("펼치기");
      expect(html).not.toContain("접기");
      expect(html).not.toContain("▸");
      expect(html).not.toContain("▾");
      // aria-hidden="true" 는 아이콘 SVG 의 정상 속성이다 — 본문을 숨기는 hidden 속성만 본다.
      expect(html).not.toMatch(/<div class="ts-cov-card-body"[^>]*\shidden/);
      expect(html).not.toContain("ts-cov-card-body\" hidden");
    }
  });

  it("형제가 3개 이상이어도 모든 세부보장 · 급부 카드 본문이 늘 렌더된다", () => {
    const html = render("read", 3);
    for (let i = 1; i <= 3; i++) {
      expect(html).toContain(`세부보장${i}`);
      expect(html).toContain(`급부${i}`);
    }
    expect((html.match(/ts-cov-card-body/g) ?? []).length).toBe(1 /* coverage */ + 3 /* sub */ + 3 /* benefit */);
  });

  it("편집 모드에서도 3개 모두 본문이 렌더된다", () => {
    const html = render("edit", 3);
    for (let i = 1; i <= 3; i++) {
      expect(html).toContain(`세부보장${i}`);
      expect(html).toContain(`급부${i}`);
    }
  });
});

describe("CoverageCards — 중첩 카드 그리드 (기능/담보 §3.6)", () => {
  it("세부보장 카드는 ts-cov-grid 다음에, 급부 카드는 ts-cov-benefits 다음에 온다 (순서로 포함관계를 본다)", () => {
    const html = render("read", 2);
    const gridIndex = html.indexOf("ts-cov-grid");
    const sub1 = html.indexOf(`data-node="${encodeNodeKey("subCoverage", "s1")}"`);
    const benefitsIndex = html.indexOf("ts-cov-benefits", sub1);
    const ben1 = html.indexOf(`data-node="${encodeNodeKey("benefit", "b1")}"`);
    expect(gridIndex).toBeGreaterThan(0);
    expect(sub1).toBeGreaterThan(gridIndex);
    expect(benefitsIndex).toBeGreaterThan(sub1);
    expect(ben1).toBeGreaterThan(benefitsIndex);
    expect((html.match(/ts-cov-benefits/g) ?? []).length).toBe(2);
  });

  it("담보 카드(coverage) 는 그리드 바깥, 세부보장을 감싼다", () => {
    const html = render("read", 1);
    const coverageOpenIndex = html.indexOf('data-level="coverage"');
    const gridIndex = html.indexOf("ts-cov-grid");
    const subIndex = html.indexOf('data-level="subCoverage"');
    expect(coverageOpenIndex).toBeGreaterThanOrEqual(0);
    expect(coverageOpenIndex).toBeLessThan(gridIndex);
    expect(gridIndex).toBeLessThan(subIndex);
  });
});

describe("CoverageCards — 편집 모드 구조 조작 (aaf753c)", () => {
  it("편집 모드: 카드마다 ⊖ 빼기 버튼 — 형제가 1개뿐이면 잠기고 tooltip 은 MIN_STRUCTURE", () => {
    const html = render("edit", 1);
    expect(html).toContain(MIN_STRUCTURE);
    const removeButtons = html.match(/<button[^>]*class="ts-iconbtn danger[^>]*>/g) ?? [];
    // 세부보장 1개(마지막) · 그 급부 1개(마지막) — 둘 다 잠긴 ⊖
    const locked = removeButtons.filter((t) => t.includes(MIN_STRUCTURE));
    expect(locked.length).toBeGreaterThanOrEqual(2);
    for (const tag of locked) expect(tag).toMatch(/disabled=""/);
  });

  it("편집 모드: 형제가 여럿이면 각자의 ⊖ 는 잠기지 않는다", () => {
    const html = render("edit", 2);
    const removeButtons = html.match(/<button[^>]*class="ts-iconbtn danger[^>]*>/g) ?? [];
    const unlocked = removeButtons.filter((t) => !t.includes(MIN_STRUCTURE));
    expect(unlocked.length).toBeGreaterThan(0);
    for (const tag of unlocked) expect(tag).not.toMatch(/disabled=""/);
  });

  it("편집 모드: 점선 타일 「+ 세부보장」(aria-label=세부보장 추가) 이 그리드의 마지막 세부보장 카드 뒤에 온다", () => {
    const html = render("edit", 2);
    expect(html).toContain('class="ts-cov-add-tile" aria-label="세부보장 추가"');
    const lastSubIndex = html.lastIndexOf(`data-node="${encodeNodeKey("subCoverage", "s2")}"`);
    const tileIndex = html.indexOf("ts-cov-add-tile");
    expect(lastSubIndex).toBeGreaterThan(0);
    expect(tileIndex).toBeGreaterThan(lastSubIndex);
  });

  it("편집 모드: 세부보장마다 「+ 급부」 작은 버튼이 있다", () => {
    const html = render("edit", 2);
    const addBenefit = html.match(/aria-label="[^"]*에 급부 추가"/g) ?? [];
    expect(addBenefit.length).toBe(2);
  });

  it("읽기 모드: ⊖ · ↑↓ · 「+ 세부보장」 · 「+ 급부」 조작이 전혀 없다", () => {
    const html = render("read", 3);
    expect(html).not.toContain("ts-cov-remove");
    expect(html).not.toContain("ts-cov-add-tile");
    expect(html).not.toContain("세부보장 추가");
    expect(html).not.toContain("급부 추가");
    expect(html).not.toContain("ts-row-actions");
  });
});
