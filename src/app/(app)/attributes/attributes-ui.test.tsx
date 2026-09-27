/**
 * 담보속성 화면 (기능/담보속성 §4, 2026-09-28).
 *
 * - 조회: 한 행 = 유효값 하나(갱신유형의 비갱신형 · 갱신형이 각각 한 행) · 「수」 컬럼 없음 · 검색은 유형 · 값 어느 쪽으로도.
 * - 상세 값 표: 코드 · 값 이름 · 「상품담보명 표기」ⓘ — 순서 · 사용 수 컬럼 없음, 「명명 조각」이라는 말 없음.
 * - 편집 모드: 표 끝 「+ 값 추가」 한 줄 · 행마다 ⊖. 읽기 모드에는 둘 다 없다.
 *
 * 조회 페이지는 서비스를 바꿔 끼워 서버 컴포넌트를 그대로 그리고, 상세 표는 `EditShell.initialMode` 로 모드를 고정해 본다
 * (같은 패턴: `EditShell.test.tsx` · `CoverageCards.test.tsx`).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/attributes",
  useSearchParams: () => new URLSearchParams(),
}));

import { EditShell } from "@/app/_components/EditShell";
import type { AttributeKind } from "@/domain/product";

const KINDS: AttributeKind[] = [
  { code: "A0001", label: "갱신유형", order: 0, values: [{ code: "1", label: "비갱신형", fragment: "" }, { code: "2", label: "갱신형", fragment: "갱신형" }] },
  { code: "A0002", label: "부가유형", order: 1, values: [{ code: "1", label: "기본", fragment: "" }, { code: "2", label: "추가", fragment: "추가" }] },
  { code: "A0003", label: "심사유형", order: 2, values: [] },
];

vi.mock("@/lib/services", () => ({
  getServices: () => ({ product: { listAttributeKinds: async () => KINDS }, auth: { listUsers: async () => [] } }),
  currentActor: async () => ({ userId: "u", role: "admin" }),
}));
vi.mock("./ui-data", () => ({ attributeAudits: async () => new Map() }));
vi.mock("./edit-actions", () => ({ saveAttributeEditAction: async () => ({ ok: true }), removeAttributeEditAction: async () => ({ ok: true }) }));

const { default: AttributesPage } = await import("./page");
const { attributeValueRows, matchesAttributeRow } = await import("./list-rows");
const { ValuesEditor } = await import("./[code]/AttributeEditor");

async function listHtml(q?: string) {
  return renderToStaticMarkup(await AttributesPage({ searchParams: Promise.resolve(q ? { q } : {}) }));
}

const headers = (html: string) => [...html.matchAll(/<th[^>]*>(.*?)<\/th>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, "").trim());
const bodyRows = (html: string) => [...(html.match(/<tbody>(.*?)<\/tbody>/)?.[1] ?? "").matchAll(/<tr>(.*?)<\/tr>/g)].map((m) => [...m[1]!.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((c) => c[1]!.replace(/<[^>]+>/g, "")));

describe("담보속성 조회 — 한 행 = 유효값 하나", () => {
  it("유형마다 값 수만큼 행, 값 없는 유형은 한 행 · 유형 순 → 코드 순", () => {
    expect(attributeValueRows(KINDS).map((r) => `${r.kind.code}/${r.value?.code ?? "-"}`)).toEqual(["A0001/1", "A0001/2", "A0002/1", "A0002/2", "A0003/-"]);
  });

  it("컬럼 — 담보속성 코드 · 담보속성명 · 값 코드 · 값 이름 · 상품담보명 표기 · 최종수정 · 수정자 (「수」 · 「값」 미리보기 없음)", async () => {
    const html = await listHtml();
    expect(headers(html)).toEqual(["담보속성 코드", "담보속성명", "값 코드", "값 이름", "상품담보명 표기", "최종수정", "수정자"]);
    expect(headers(html)).not.toContain("수");
    expect(html).not.toContain("명명");
    const rows = bodyRows(html);
    expect(rows.map((r) => r.slice(0, 5))).toEqual([
      ["A0001", "갱신유형", "1", "비갱신형", "—"],
      ["A0001", "갱신유형", "2", "갱신형", "갱신형"],
      ["A0002", "부가유형", "1", "기본", "—"],
      ["A0002", "부가유형", "2", "추가", "추가"],
      ["A0003", "심사유형", "—", "값 없음", "—"],
    ]);
    // 행의 담보속성명은 유형 상세로 간다
    expect(html).toContain('href="/attributes/A0001"');
  });

  it("검색 — 유형 이름이면 그 유형의 값 행 전부, 값 이름이면 그 값 행만", async () => {
    expect(bodyRows(await listHtml("갱신유형")).map((r) => r[3])).toEqual(["비갱신형", "갱신형"]);
    expect(bodyRows(await listHtml("비갱신")).map((r) => r[3])).toEqual(["비갱신형"]);
    expect(matchesAttributeRow("A0002", { kind: KINDS[1]!, value: KINDS[1]!.values[0] })).toBe(true);
  });
});

function detailHtml(mode: "read" | "edit") {
  const kind = KINDS[0]!;
  return renderToStaticMarkup(
    <EditShell initial={{ label: kind.label, values: kind.values.map(({ code, label, fragment }) => ({ code, label, fragment })) }} title={kind.label} path={[{ label: "담보속성", href: "/attributes" }]} saveAction={async () => ({ ok: true })} initialMode={mode}>
      <ValuesEditor />
    </EditShell>,
  );
}

describe("담보속성 상세 — 유효값 표", () => {
  it("읽기: 코드 · 값 이름 · 상품담보명 표기(ⓘ) — 순서 · 사용 수 없음 · 「+ 값 추가」 · ⊖ 없음", () => {
    const html = detailHtml("read");
    expect(headers(html)).toEqual(["코드", "값 이름", "상품담보명 표기"]);
    expect(html).toContain('title="상품담보명에 이 값 대신 들어갈 말 — 비우면 붙지 않는다"');
    expect(html).not.toMatch(/사용 수|순서|명명/);
    expect(html).not.toContain("값 추가");
    expect(html).not.toContain("빼기");
    expect(bodyRows(html)).toEqual([
      ["1", "비갱신형", "—"],
      ["2", "갱신형", "갱신형"],
    ]);
  });

  it("편집: 값 이름 · 표기가 입력칸, 행마다 ⊖(저장할 때 삭제), 표 끝(tfoot) 한 줄 「+ 값 추가」 — 옛 값 추가 입력 줄 · ↑↓ 없음", () => {
    const html = detailHtml("edit");
    expect(html).toMatch(/<tfoot><tr class="ts-table-add"><td colSpan="4"><button type="button" class="ts-linklike ts-cov-add"[^>]*>.*값 추가<\/button><\/td><\/tr><\/tfoot>/);
    expect(html).toContain('aria-label="비갱신형(1) 빼기 — 저장할 때 삭제"');
    expect(html).toContain('aria-label="값 이름 2"');
    expect(html).toContain('aria-label="상품담보명 표기 — 갱신형"');
    expect(html).not.toMatch(/위로|아래로|ts-add-row/);
  });
});
