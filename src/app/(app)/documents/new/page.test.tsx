/**
 * 담보약관 템플릿 만들기 입구 (2026-09-27) — 목록 `+` → `/documents/new?kind=coverage` → 템플릿 없는 담보만 고른다.
 * 서버 컴포넌트를 서비스 흉내로 그려 문자열로 본다. 생성 → 편집기 이동은 E2E(repeat-table 반복표#3) 몫.
 */
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  coverages: [
    { id: "c3", code: "COV000003", name: "골절진단비", updatedAt: new Date() },
    { id: "c1", code: "COV000001", name: "일반상해사망보장", updatedAt: new Date() },
    { id: "c2", code: "COV000002", name: "수술비", updatedAt: new Date(), documentId: "d2" },
  ],
  specials: [{ id: "d2", ownerId: "c2", title: "수술비 특별약관" }] as { id: string; ownerId?: string; title: string }[],
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }), redirect: () => {} }));
vi.mock("../actions", () => ({ createGeneralAction: () => {}, createSpecialAction: () => {} }));
vi.mock("@/lib/services", () => ({
  getServices: () => ({
    coverage: { listSummaries: async () => state.coverages },
    document: { list: async (kind: string) => (kind === "special" ? state.specials : []) },
  }),
}));

import { Combobox, type ComboOption } from "@/app/_components/Combobox";

import { coveragesWithoutTemplate, defaultSpecialTitle } from "../lib";
import NewDocumentPage from "./page";

async function render(sp: Record<string, string>) {
  return renderToStaticMarkup(await NewDocumentPage({ searchParams: Promise.resolve(sp) }));
}

/** 담보 검색 입력의 후보 — 목록은 열려야 그려지므로 요소 트리에서 props 를 읽는다. */
async function coverageOptions(sp: Record<string, string>): Promise<readonly ComboOption[]> {
  const find = (node: ReactNode): readonly ComboOption[] | undefined => {
    if (Array.isArray(node)) return node.map(find).find(Boolean);
    if (!isValidElement<{ children?: ReactNode; options?: readonly ComboOption[] }>(node)) return undefined;
    if (node.type === Combobox) return node.props.options;
    return find(node.props.children);
  };
  return find(await NewDocumentPage({ searchParams: Promise.resolve(sp) })) ?? [];
}

describe("coveragesWithoutTemplate", () => {
  it("제 담보약관 템플릿이 없는 담보만 · 코드 순", () => {
    expect(coveragesWithoutTemplate(state.coverages, state.specials).map((c) => c.code)).toEqual(["COV000001", "COV000003"]);
    expect(defaultSpecialTitle("수술비")).toBe("수술비 특별약관");
  });
});

describe("새 담보약관 템플릿 화면", () => {
  it("경로 「담보약관 템플릿 › 새 담보약관 템플릿」 · 템플릿 없는 담보만 검색 입력으로(이름 + 코드) · 제목 칸 · 생성", async () => {
    const html = await render({ kind: "coverage" });
    expect(html).toContain('href="/documents?kind=coverage"');
    expect(html).toContain("새 담보약관 템플릿");
    expect(html).toMatch(/<input[^>]*id="doc-coverage"[^>]*role="combobox"[^>]*required=""/);
    expect(await coverageOptions({ kind: "coverage" })).toEqual([
      { value: "c1", label: "일반상해사망보장", hint: "COV000001" },
      { value: "c3", label: "골절진단비", hint: "COV000003" },
    ]);
    expect(html).toContain('name="title"');
    expect(html).toContain('form="create-special"');
  });

  it("`?coverage=` 로 오면 그 담보를 미리 고른다 (템플릿 없는 담보일 때만)", async () => {
    const picked = await render({ kind: "coverage", coverage: "c3" });
    expect(picked).toContain('<input type="hidden" name="coverageId" value="c3"/>');
    expect(picked).toContain('value="골절진단비"');
    expect(await render({ kind: "coverage", coverage: "c2" })).toContain('<input type="hidden" name="coverageId" value=""/>');
  });

  it("고를 담보가 없으면 생성 버튼 없이 안내 + 새 담보 링크", async () => {
    const saved = state.specials;
    state.specials = state.coverages.map((c) => ({ id: `d-${c.id}`, ownerId: c.id, title: "" }));
    const html = await render({ kind: "coverage" });
    state.specials = saved;
    expect(html).toContain("담보약관 템플릿이 없는 담보가 없다");
    expect(html).toContain('href="/coverages/new"');
    expect(html).not.toContain(">생성<");
  });

  it("kind 가 없으면 보통약관 템플릿 생성 그대로", async () => {
    const html = await render({});
    expect(html).toContain("새 보통약관 템플릿");
    expect(html).toContain('form="create-general"');
  });
});
