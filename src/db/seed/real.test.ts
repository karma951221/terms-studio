import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Booklet } from "@/domain/assembly";
import { articleTitles, diffArticlesUnordered, normalizeLine, referenceNumberIssues, renderedToLines, sourceToLines, type UnorderedDiff } from "@/domain/assembly/compare";
import type { Actor, Value } from "@/domain/types";

import { createTestDb, type TestDb } from "@/db/test-utils";
import { createServices } from "@/services/container";

import { expectedLines, KNOWN_DIFFERENCES } from "./knownDifferences";
import { loadAlphaPlus } from "./load";

/**
 * ★ 실물 재현 — 실물 시드(알파Plus · 메리츠 두 상품)가 원문(`tests/fixtures/terms` · `tests/fixtures/terms/메리츠`)과 같은 약관을 조립한다.
 * 대조 기준 (QA/인수기준 실물 재현 · compare.ts):
 * - 조는 (조 명 + 본문) 다중집합으로 본다 — **조 순서는 달라도 된다**(허용 차이 ⑥). 관 제목 순서는 같아야 한다.
 * - 대신 조립 결과의 조 번호는 1부터 잇고, 본문의 조 참조 번호는 조립 순서의 그 조(또는 보통약관 조)를 가리켜야 한다.
 * - 조 번호 참조는 조 명으로 정규화, 별표 번호는 지운다(허용 차이 ④), 공백 무시.
 * 책자는 상품 하나 = 세목 조합 전부를 담는다 — 보통약관 · 특약 문면은 세목 값을 읽지 않아 조합별로 갈리지 않는다.
 * 두 상품이 함수조항을 함께 쓴다(보통약관 조째 같은 조 · 담보약관 문구) — 펼친 결과가 두 원문과 다 같아야 한다.
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
/** 원문 → 기대 줄 — 인수기준 알려진 차이(`knownDifferences.ts`)를 얹는다. 대조기는 완화하지 않는다. */
const source = (dir: string, file: string) => expectedLines(dir, file, sourceToLines(readFileSync(path.join(FIXTURES, dir, file), "utf8")));

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

    it("알려진 차이는 원문과 정말 다르다 — 차이마다 조립에 그 줄이 있고 원문에는 없다(목록이 낡으면 지운다)", () => {
      const lines = renderedToLines(booklet().general!).map(normalizeLine);
      const raw = sourceToLines(readFileSync(path.join(FIXTURES, product.dir, "보통약관.md"), "utf8")).map(normalizeLine);
      for (const d of KNOWN_DIFFERENCES.filter((x) => x.dir === product.dir && x.file === "보통약관.md")) {
        for (const l of d.lines) {
          expect(lines, d.why).toContain(normalizeLine(l));
          expect(raw, d.why).not.toContain(normalizeLine(l));
        }
      }
    });

    it("별표 — 문면이 참조한 것만 등장 순으로 실린다 (별표 마스터는 두 상품이 이름으로 함께 쓴다)", () => {
      expect(booklet().appendices.map((a) => a.code)).toEqual(product.appendices);
    });

    it("책자의 특약은 표본 전부다 — 빠지거나 더한 것이 없다", () => {
      expect(booklet().specials.flatMap((g) => g.docs.map((d) => d.title)).sort()).toEqual(product.specials.map(([title]) => title).sort());
    });
  });
});

/**
 * 대표 변형 — 납입면제(QA/인수기준 보통약관 행 · 알파플러스_모델명세 §6). 같은 템플릿 · 같은 역할 함수조항에 세목 사유만 바꿔 넣는다.
 * 2종 사유 = 암·무면책 · 뇌졸중 · 상해80% → 호 셋(암 호에 암보장개시일 없음) · 면책 사유가 없어 부가항 · 무효 · 부활 문구가 빠진다 ·
 * 세부규정은 장해 · 상해장해 항만, 값 한정 참조는 장해 값이 낸 호(제3호) 하나로 좁혀진다 · 정의 조는 암 · 뇌졸중만.
 */
describe("★ 실물 재현 변형 — 알파Plus 납입면제 사유를 바꾸면 템플릿이 따라온다", () => {
  let db: TestDb;
  let lines: string[] = [];
  let issues: unknown[] = [];

  beforeAll(async () => {
    db = await createTestDb();
    const services = createServices(db.db);
    const admin = await services.auth.ensureSeedAdmin();
    const actor: Actor = { userId: admin.id, role: admin.role };
    await loadAlphaPlus(services, actor);
    const product = (await services.product.listProducts()).find((p) => p.name === "알파Plus보장보험")!;
    const type2 = (await services.product.listPlanOptions(product.id)).find((o) => o.axis === "type" && o.number === 2)!;
    const saved = await services.product.setPlanOptionValues(actor, type2.id, [{ path: "waiver.reasons", value: ["V02", "V03", "V12"] }]);
    if (!saved.ok) throw new Error(JSON.stringify(saved.rejection));
    const r = await services.assembly.preview(product.id);
    if (!r.ok) throw new Error(JSON.stringify(r.rejection));
    lines = renderedToLines(r.value.general!);
    issues = r.value.issues;
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  const article = (title: string) => {
    const at = lines.findIndex((l) => l.startsWith("## ") && l.endsWith(`(${title})`));
    const end = lines.findIndex((l, i) => i > at && /^##? /.test(l));
    return lines.slice(at, end < 0 ? undefined : end);
  };

  it("오류 0 — 참조 · 반복 · 값별 분기가 모두 풀린다", () => {
    expect(issues).toEqual([]);
  });

  it("납입면제 조 — 2종 항 하나에 사유 호 셋, 부가항(암보장개시일)이 빠져 ③ ④ 가 당겨진다", () => {
    expect(article("보험료의 납입면제")).toEqual([
      "## 제28조(보험료의 납입면제)",
      "@ 회사는 피보험자가 2종(보험료 납입면제형) 가입시 보험료 납입기간 중에 다음 중 어느 하나의 사유에 해당되고 계약이 소멸되지 않은 경우에는 차회 이후 보장보험료의 납입을 면제합니다.",
      "  - 피보험자가「암(유사암제외)」으로 진단확정되었을 경우",
      "  - 피보험자가「뇌졸중」으로 진단확정되었을 경우",
      "  - 피보험자가 상해로【별표1(장해분류표)】에서 정한 장해지급률이 80% 이상에 해당하는 장해상태가 되었을 경우",
      "@ 제1항에도 불구하고 아래의 보험료 납입면제 제외대상 특별약관 및「자동갱신 특별약관」에서 정한「자동갱신 적용대상 특별약관」은 보장보험료의 납입을 면제하지 않습니다.",
      "```용어풀이",
      "【보험료 납입면제 제외대상 특별약관】",
      "･보험료납입지원(유사암진단)보장특약",
      "```",
      "@ 1형(해약환급금 지급형)의 경우 회사는 제1항에 따라 보장보험료 납입면제가 된 경우에 차회 이후의 적립보험료 납입을 중지합니다.",
      "@ 제1항부터 제3항까지의 규정에도 불구하고 보장보험료의 납입이 면제되기 이전에 보험료 납입 연체가 있는 경우에는 연체된 보험료를 납입하여야 하며, 납입하지 않은 경우 제32조(보험료의 납입이 연체되는 경우 납입최고(독촉)와 계약의 해지)에 따라 해지될 수 있습니다.",
    ]);
  });

  it("세부규정 — 면책 ①~③ 이 빠지고, 값 한정 참조(장해 값이 낸 호)는 제3호 하나 · ⑫ 상해 관련은 남는다", () => {
    const detail = article("납입면제에 관한 세부규정");
    expect(detail).toHaveLength(1 + 9 + 8);
    expect(detail[1]).toMatch(/^@ 제28조\(보험료의 납입면제\) 제1항 제3호에서 장해지급률이/);
    expect(detail.find((l) => l.includes("합의하지 못할 때"))).toMatch(/^@ 보험수익자와 회사가 제28조\(보험료의 납입면제\) 제1항의/);
    expect(detail.find((l) => l.startsWith("@ 회사는 다음 중 어느 한 가지로"))).toContain("제28조(보험료의 납입면제) 제1항 제3호의 후유장해");
    expect(detail.find((l) => l.startsWith("@ 회사는 다른 약정이 없으면"))).toBeDefined();
  });

  it("정의 조 — 사유 합집합 ∩ 정의조대상 = 암 · 뇌졸중만(제목은 고정 글 — 알려진 차이)", () => {
    const definition = article("암(유사암제외), 뇌졸중, 급성심근경색증, 말기폐질환, 말기간경화, 말기신부전증, 양성뇌종양, 중대한재생불량성빈혈, 만성당뇨합병증의 정의 및 진단확정");
    expect(definition.filter((l) => l.startsWith("@ "))).toHaveLength(6);
    expect(definition.some((l) => l.includes("「급성심근경색증」"))).toBe(false);
  });

  it("무효 · 부활 — 면책 사유가 없어 암보장개시일 항이 없다", () => {
    expect(article("계약의 무효").filter((l) => l.startsWith("@ "))).toHaveLength(2);
    expect(article("보험료의 납입을 연체하여 해지된 계약의 부활(효력회복)").some((l) => l.includes("암보장개시일"))).toBe(false);
  });
});

const MERITZ = "메리츠 통합간편건강보험(연만기형)";

/** 변형 한 벌 — 실물 시드를 넣고 세목 선택지 값을 바꾼 뒤 상품마다 조립한다. */
async function previewVariant(changes: { product: string; axis: "type" | "form"; number: number; entries: { path: string; value: Value }[] }[]) {
  const db = await createTestDb();
  const services = createServices(db.db);
  const admin = await services.auth.ensureSeedAdmin();
  const actor: Actor = { userId: admin.id, role: admin.role };
  await loadAlphaPlus(services, actor);
  const products = await services.product.listProducts();
  for (const c of changes) {
    const product = products.find((p) => p.name === c.product)!;
    const option = (await services.product.listPlanOptions(product.id)).find((o) => o.axis === c.axis && o.number === c.number)!;
    const saved = await services.product.setPlanOptionValues(actor, option.id, c.entries);
    if (!saved.ok) throw new Error(JSON.stringify(saved.rejection));
  }
  const out = new Map<string, Booklet>();
  for (const product of products) {
    const r = await services.assembly.preview(product.id);
    if (!r.ok) throw new Error(JSON.stringify(r.rejection));
    out.set(product.name, r.value);
  }
  return { db, booklets: out };
}

/** 조립 줄에서 조 하나(헤딩 줄 포함) — 조 명으로. */
function articleLines(lines: readonly string[], title: string): string[] {
  const at = lines.findIndex((l) => l.startsWith("## ") && l.endsWith(`(${title})`));
  if (at < 0) return [];
  const end = lines.findIndex((l, i) => i > at && /^##? /.test(l));
  return lines.slice(at, end < 0 ? undefined : end);
}

/**
 * 대표 변형 — 1형 적립 중지(최종 결정 24 「상품 범위 조건」). 알파Plus 제27조의1 ④ 「1형(해약환급금 지급형)의 경우 … 적립보험료 납입을 중지합니다」는
 * 상품에 해약환급금 지급형(무저해지 유형 = 해약환급금지급형)인 형이 있을 때만 선다. 뒤 항의 「제1항부터 제4항까지」는 한 참조(대상 넷)라 「제1항부터 제3항까지」로 따라온다.
 */
describe("★ 실물 재현 변형 — 해약환급금 지급형이 없으면 1형 적립 중지 항이 빠진다", () => {
  let db: TestDb;
  let booklet: Booklet;

  beforeAll(async () => {
    const v = await previewVariant([{ product: "알파Plus보장보험", axis: "form", number: 1, entries: [{ path: "no_surrender.type", value: "V02" }] }]);
    db = v.db;
    booklet = v.booklets.get("알파Plus보장보험")!;
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("오류 0 · ④ 가 없고 ⑤ 의 범위 참조가 「제1항부터 제3항까지」", () => {
    expect(booklet.issues).toEqual([]);
    const waiver = articleLines(renderedToLines(booklet.general!), "보험료의 납입면제");
    expect(waiver.some((l) => l.includes("적립보험료 납입을 중지"))).toBe(false);
    expect(waiver.at(-1)).toMatch(/^@ 제1항부터 제3항까지의 규정에도 불구하고/);
  });
});

/**
 * 대표 변형 — 메리츠 납입면제종 하나(3종 · 2형을 미적용으로). [납입면제종마다] 항이 하나라 「제1항 또는 제2항」 · 「제1항 제1호 및 제2항 제1호」가
 * 「제1항」 · 「제1항 제1호」로, 「제1항부터 제4항까지」가 「제1항부터 제3항까지」로 좁혀지고, 중증화상및부식이 빠져 정의 · 세부규정 ⑪ ⑫ 가 따라온다.
 */
describe("★ 실물 재현 변형 — 메리츠 납입면제종이 하나면 종마다 항 · 값 한정 참조가 따라온다", () => {
  let db: TestDb;
  let booklet: Booklet;
  let lines: string[] = [];

  beforeAll(async () => {
    const v = await previewVariant([{ product: MERITZ, axis: "type", number: 3, entries: [{ path: "waiver.applies", value: false }, { path: "waiver.reasons", value: [] }] }]);
    db = v.db;
    booklet = v.booklets.get(MERITZ)!;
    lines = renderedToLines(booklet.general!);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("오류 0 · 제29조 = 2종 항 하나 · 부가항 · ④ ⑤ 「제1항」 · ⑥ ⑦ 「제1항부터 제3항까지」", () => {
    expect(booklet.issues).toEqual([]);
    const waiver = articleLines(lines, "보험료의 납입면제").filter((l) => l.startsWith("@ "));
    const prefixes = [
      "@ 회사는 2종(보험료 납입면제 1형)을 가입한 피보험자가 보험료 납입기간 중",
      "@ 제1항 제1호의 암보장개시일이라 함은 최초계약일부터 그날을 포함하여 90일",
      "@ 제1항에도 불구하고 아래의 보험료 납입면제 제외대상 특별약관은 보장보험료의",
      "@ 회사는 제1항에 따라 보장보험료 납입면제가 된 경우에 차회 이후의 적립보험",
      "@ 제1항부터 제3항까지의 규정에도 불구하고 보장보험료의 납입이 면제되기 이전",
      "@ 제1항부터 제3항까지의 규정에도 불구하고 제25조(계약의 자동갱신)에 의하여",
    ];
    expect(waiver).toHaveLength(prefixes.length);
    prefixes.forEach((prefix, i) => expect(waiver[i].startsWith(prefix), waiver[i]).toBe(true));
  });

  it("세부규정 — 「제1항 제1호」, 장해 「제1항 제4호 또는 제5호」, 상해관련 「제1항 제4호」", () => {
    const detail = articleLines(lines, "납입면제에 관한 세부규정");
    expect(detail[1]).toMatch(/^@ 제29조\(보험료의 납입면제\) 제1항 제1호에도 불구하고/);
    expect(detail.find((l) => l.startsWith("@ 회사는 다음 중 어느 한 가지로"))).toContain("제29조(보험료의 납입면제) 제1항 제4호 또는 제5호의 보험료");
    expect(detail.find((l) => l.startsWith("@ 회사는 다른 약정이 없으면"))).toContain("제29조(보험료의 납입면제) 제1항 제4호의 상해관련");
  });

  it("정의 조 — 중증화상및부식이 빠진다(암 · 뇌졸중 · 급성심근경색증)", () => {
    const definition = articleLines(lines, "암(유사암제외), 뇌졸중, 급성심근경색증, 중증화상및부식의 정의 및 진단확정");
    expect(definition.filter((l) => l.startsWith("@ "))).toHaveLength(8);
    expect(definition.some((l) => l.includes("중증화상및부식(화학약품"))).toBe(false);
  });
});
