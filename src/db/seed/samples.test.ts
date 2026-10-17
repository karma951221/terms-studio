/**
 * 합성 표본 상품 (samples.json) — 절 형태 ① 뼈대의 세 모양 (2026-10-17 사용자 결정: 실물 원문이 없어 합성 표본).
 * 실물 대조 대상이 아니다(`real.test.ts` 와 분리). 이후 단계(② 판정 · 위임 · 일부 연결)를 칠 수 있게 조연결 구성을 갈랐다 —
 *   ⓐ 주계약 기본계약 2개 — 일반상해80%이상후유장해(지급사유 · 세부규정 조연결) + 일반상해사망보장(연결 없음) → 일부 연결 1/2
 *   ⓑ 독립특약 블록 2개 — 일반상해80%이상후유장해 (기본) · 추가(같은 담보약관 — 둘 다 연결) → 전부 연결 2/2 · 그룹 제목 표시 켬
 *   ⓒ 독립특약 블록 1개 — 일반상해80%이상후유장해 → 위임 1/1
 * ①은 판정 없이 연결 조를 모두 위임한다(잠정 — ② 판정에서 바뀜).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Booklet } from "@/domain/assembly";
import type { Actor } from "@/domain/types";

import { createTestDb, type TestDb } from "@/db/test-utils";
import { createServices, type Services } from "@/services/container";

import { seedAlphaPlus } from "./alphaPlus";

const admin: Actor = { userId: "00000000-0000-4000-8000-000000000001", role: "admin" };

describe("합성 표본 — 절 형태 세 상품 (PGlite)", () => {
  let t: TestDb;
  let services: Services;
  const booklets = new Map<string, Booklet>();

  beforeAll(async () => {
    t = await createTestDb();
    services = createServices(t.db);
    await seedAlphaPlus(services, admin);
    for (const p of await services.product.listProducts()) {
      if (!p.name.startsWith("표본")) continue;
      const r = await services.assembly.preview(p.id);
      if (!r.ok) throw new Error(JSON.stringify(r.rejection));
      booklets.set(p.name, r.value);
    }
  }, 300_000);
  afterAll(async () => {
    await t.close();
  });

  const blocks = (b: Booklet) => (b.blocks ?? []).flatMap((g) => g.blocks.map((x) => `${x.label} ${x.title}`));
  const delegated = (b: Booklet) =>
    (b.general?.children ?? [])
      .flatMap((c) => (c.kind === "section" ? c.children : [c]))
      .flatMap((a) => (a.kind === "article" && a.children.some((p) => p.kind === "paragraph" && p.children.some((n) => n.kind === "text" && n.text.endsWith("는 제2절 보장조항에서 정합니다."))) ? [a.title] : []));

  it("세 표본이 다 있고 절 형태로 완성본이다", () => {
    expect([...booklets.keys()].sort()).toEqual(["표본 — 기본계약 2개(주계약)", "표본 — 독립특약 블록 1개", "표본 — 독립특약 블록 2개"]);
    for (const [name, b] of booklets) {
      expect(b.form, name).toBe("sectioned");
      expect(b.issues.filter((i) => i.severity !== "warning"), name).toEqual([]);
    }
  });

  it("ⓐ 주계약 기본계약 2개 — 블록 = 기본계약 둘(담보코드 순) · 연결 조 위임 · 특약은 특약 그룹에", () => {
    const b = booklets.get("표본 — 기본계약 2개(주계약)")!;
    expect(b.title).toBe("무배당 알파Plus보장보험2604 보통약관");
    expect(blocks(b)).toEqual(["1. 일반상해80%이상후유장해", "2. 일반상해사망보장"]);
    expect(delegated(b)).toEqual(["보험금의 지급사유", "보험금 지급에 관한 세부규정"]);
    expect(b.specials.flatMap((g) => g.docs.map((d) => d.title))).toEqual(["골절(치아파절 제외)진단비Ⅱ보장 특별약관", "신화상치료비보장 특별약관"]);
  });

  it("ⓑ 독립특약 블록 2개 — 제목 = 상품명 · 그룹 제목 표시 「Ⅰ. 상해 관련 특별약관」 아래 「Ⅰ-1.」 「Ⅰ-2.」 · 특약 그룹 없음", () => {
    const b = booklets.get("표본 — 독립특약 블록 2개")!;
    expect(b.title).toBe("표본 — 독립특약 블록 2개");
    expect(b.blocks!.map((g) => [g.label, g.title])).toEqual([["Ⅰ.", "상해 관련 특별약관"]]);
    expect(blocks(b)).toEqual(["Ⅰ-1. 일반상해80%이상후유장해 특별약관", "Ⅰ-2. 일반상해80%이상후유장해 추가 특별약관"]);
    expect(delegated(b)).toEqual(["보험금의 지급사유", "보험금 지급에 관한 세부규정"]);
    expect(b.specials).toEqual([]);
  });

  it("ⓒ 독립특약 블록 1개 — 블록 하나도 절 형태 + 위임 「1.」", () => {
    const b = booklets.get("표본 — 독립특약 블록 1개")!;
    expect(blocks(b)).toEqual(["1. 일반상해80%이상후유장해 특별약관"]);
    expect(delegated(b)).toEqual(["보험금의 지급사유", "보험금 지급에 관한 세부규정"]);
  });
});
