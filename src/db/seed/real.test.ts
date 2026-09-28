import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Booklet } from "@/domain/assembly";
import { articleTitles, diffArticlesUnordered, referenceNumberIssues, renderedToLines, sourceToLines, type UnorderedDiff } from "@/domain/assembly/compare";
import type { Actor } from "@/domain/types";

import { createTestDb, type TestDb } from "@/db/test-utils";
import { createServices } from "@/services/container";

import { loadAlphaPlus } from "./load";

/**
 * ★ 실물 재현 — 실물 시드(알파Plus · 메리츠 두 상품)가 원문(`tests/fixtures/terms` · `tests/fixtures/terms/메리츠`)과 같은 약관을 조립한다.
 * 대조 기준 (QA/인수기준 실물 재현 · compare.ts):
 * - 조는 (조 명 + 본문) 다중집합으로 본다 — **조 순서는 달라도 된다**(허용 차이 ⑥). 관 제목 순서는 같아야 한다.
 * - 대신 조립 결과의 조 번호는 1부터 잇고, 본문의 조 참조 번호는 조립 순서의 그 조(또는 보통약관 조)를 가리켜야 한다.
 * - 조 번호 참조는 조 명으로 정규화, 별표 번호는 지운다(허용 차이 ④), 공백 무시.
 * 책자는 상품 하나 = 세목 조합 전부를 담는다 — 보통약관 · 특약 문면은 세목 값을 읽지 않아 조합별로 갈리지 않는다.
 * 두 상품이 공용조항을 함께 쓴다(보통약관 조째 같은 조 · 담보약관 문구) — 펼친 결과가 두 원문과 다 같아야 한다.
 */

/** 상품마다 — 상품명 · 세목 조합 수 · 보통약관(픽스처 · 조 수) · 특약 (책자 제목 · 픽스처). */
const PRODUCTS: { name: string; dir: string; plans: number; general: string; appendices: string[]; specials: [string, string][] }[] = [
  {
    name: "알파Plus보장보험",
    dir: "",
    plans: 4,
    general: "보통약관 52조(관 7)",
    // 장해 · 적립이율 · 암 · 뇌졸중 · 급성심근경색 · 말기폐질환 · 말기간경화 · 양성뇌종양 · 만성당뇨합병증 · 골절(치아파절 제외)Ⅱ · 골절Ⅱ · 1-7종 수술 · 화상 · 중대한 특정상해
    appendices: ["AX000002", "AX000001", "AX000004", "AX000007", "AX000008", "AX000010", "AX000011", "AX000020", "AX000012", "AX000014", "AX000021", "AX000003", "AX000013", "AX000015"],
    specials: [
      ["일반상해사망보장 특별약관", "일반상해사망보장.md"],
      ["일반상해사망보장 추가 특별약관", "일반상해사망보장_추가.md"],
      ["일반상해80%이상후유장해 생활자금보장 특별약관", "일반상해80%이상후유장해_생활자금보장.md"],
      ["골절(치아파절 제외)진단비Ⅱ보장 특별약관", "골절(치아파절_제외)진단비Ⅱ보장.md"],
      ["일반상해50%이상후유장해 생활자금보장 특별약관", "일반상해50%이상후유장해_생활자금보장.md"],
      ["골절수술비Ⅱ보장 특별약관", "골절수술비Ⅱ보장.md"],
      ["중대한특정상해수술비보장 특별약관", "중대한특정상해수술비보장.md"],
      ["수술비(1-7종, 연간3회한)[상해]보장 특별약관", "수술비(1-7종,_연간3회한)[상해]보장.md"],
      ["갱신형 수술비(1-7종, 연간3회한)[상해]보장 특별약관", "갱신형_수술비(1-7종,_연간3회한)[상해]보장.md"],
      ["신화상치료비보장 특별약관", "신화상치료비보장.md"],
    ],
  },
  {
    name: "메리츠 통합간편건강보험(연만기형)",
    dir: "메리츠",
    plans: 6,
    general: "보통약관 54조(관 7)",
    // 장해 · 적립이율 · 암 · 뇌졸중 · 급성심근경색 · 골절(치아파절 제외)Ⅱ · 골절Ⅱ · 1-7종 수술 · 화상 — 메리츠 원문 번호(14 · 1 · 3 · 16 · 7 · 26 · 27 · 29 · 28)와 다르다
    appendices: ["AX000002", "AX000001", "AX000004", "AX000007", "AX000008", "AX000014", "AX000021", "AX000003", "AX000013"],
    specials: [
      ["갱신형 일반상해80%이상후유장해(통합간편가입)보장 특별약관", "갱신형_일반상해80%이상후유장해(통합간편가입)보장.md"],
      ["갱신형 수술비(1-7종, 연간3회한)[상해](통합간편가입)보장 특별약관", "갱신형_수술비(1-7종,_연간3회한)[상해](통합간편가입)보장.md"],
      ["갱신형 골절(치아파절 제외)진단비Ⅱ(통합간편가입)보장 특별약관", "갱신형_골절(치아파절_제외)진단비Ⅱ(통합간편가입)보장.md"],
      ["갱신형 신화상치료비(통합간편가입)보장 특별약관", "갱신형_신화상치료비(통합간편가입)보장.md"],
      ["갱신형 골절수술비Ⅱ(통합간편가입)보장 특별약관", "갱신형_골절수술비Ⅱ(통합간편가입)보장.md"],
      ["갱신형 질병사망(통합간편가입)보장 특별약관", "갱신형_질병사망(통합간편가입)보장.md"],
      ["갱신형 질병80%이상후유장해(통합간편가입)보장 특별약관", "갱신형_질병80%이상후유장해(통합간편가입)보장.md"],
      ["갱신형 수술비(1-7종, 연간3회한)[질병](통합간편가입)보장 특별약관", "갱신형_수술비(1-7종,_연간3회한)[질병](통합간편가입)보장.md"],
    ],
  },
];

const FIXTURES = path.join(process.cwd(), "tests/fixtures/terms");
const source = (dir: string, file: string) => sourceToLines(readFileSync(path.join(FIXTURES, dir, file), "utf8"));

/** 다른 조를 사람이 읽을 수 있게 — 실패 메시지용. */
function describeDiff(d: UnorderedDiff): string {
  const show = (label: string, cs: UnorderedDiff["missing"]) =>
    cs.slice(0, 3).map((c) => `\n── ${label} 「${c.title}」\n${c.lines.map((l) => `    ${l}`).join("\n")}`).join("");
  return `${show("원문에만", d.missing)}${show("조립에만", d.extra)}${d.sections ? `\n── 관 순서: ${JSON.stringify(d.sections)}` : ""}`;
}

const clean: UnorderedDiff = { missing: [], extra: [] };

describe("★ 실물 재현 — 실물 시드 → 조립 → 원문 대조", () => {
  let db: TestDb;
  const booklets = new Map<string, Booklet>();
  const plans = new Map<string, number>();

  beforeAll(async () => {
    db = await createTestDb();
    const services = createServices(db.db);
    const admin = await services.auth.ensureSeedAdmin();
    const actor: Actor = { userId: admin.id, role: admin.role };
    await loadAlphaPlus(services, actor);
    for (const product of await services.product.listProducts()) {
      plans.set(product.name, (await services.product.listPlans(product.id)).length);
      const r = await services.assembly.preview(product.id);
      if (!r.ok) throw new Error(JSON.stringify(r.rejection));
      booklets.set(product.name, r.value);
    }
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  describe.each(PRODUCTS)("$name", (product) => {
    const booklet = () => {
      const b = booklets.get(product.name);
      if (!b) throw new Error(`상품 「${product.name}」 없음 — 있는 것: ${[...booklets.keys()].join(" · ")}`);
      return b;
    };

    it("완성본이다 — 오류 0", () => {
      expect(booklet().issues).toEqual([]);
      expect(booklet().complete).toBe(true);
    });

    it(`세목 — 조합 ${product.plans}개가 한 책자에 등록돼 있다`, () => {
      expect(plans.get(product.name)).toBe(product.plans);
    });

    it(`${product.general}가 원문과 같다 — 기본계약 대치 포함 · 조 참조 번호가 조립 순서와 맞다`, () => {
      const lines = renderedToLines(booklet().general!);
      const diff = diffArticlesUnordered(source(product.dir, "보통약관.md"), lines);
      expect(diff, describeDiff(diff)).toEqual(clean);
      expect(referenceNumberIssues(lines)).toEqual([]);
    });

    it.each(product.specials)("특약 「%s」이 원문과 같다", (title, file) => {
      const docs = booklet().specials.flatMap((g) => g.docs);
      const doc = docs.find((d) => d.title === title);
      expect(doc, `특약 「${title}」 없음 — 있는 것: ${docs.map((d) => d.title).join(" · ")}`).toBeDefined();
      const lines = renderedToLines(doc!);
      const diff = diffArticlesUnordered(source(product.dir, file), lines);
      expect(diff, describeDiff(diff)).toEqual(clean);
      expect(referenceNumberIssues(lines, articleTitles(renderedToLines(booklet().general!)))).toEqual([]);
    });

    it("별표 — 문면이 참조한 것만 등장 순으로 실린다 (별표 마스터는 두 상품이 이름으로 함께 쓴다)", () => {
      expect(booklet().appendices.map((a) => a.code)).toEqual(product.appendices);
    });

    it("책자의 특약은 표본 전부다 — 빠지거나 더한 것이 없다", () => {
      expect(booklet().specials.flatMap((g) => g.docs.map((d) => d.title)).sort()).toEqual(product.specials.map(([title]) => title).sort());
    });
  });
});
