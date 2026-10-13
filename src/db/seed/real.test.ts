import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Booklet } from "@/domain/assembly";
import { articleTitles, diffArticlesUnordered, normalizeLine, referenceNumberIssues, renderedToLines, sourceToLines, type UnorderedDiff } from "@/domain/assembly/compare";
import type { AttributeSelection, ProductCoverage } from "@/domain/product/types";
import type { Actor, Value } from "@/domain/types";

import { createTestDb, snapshotTestDb, type TestDb } from "@/db/test-utils";
import { createServices } from "@/services/container";

import { autoFixtures } from "../../../scripts/terms/auto";
import { ALPHA2607_AUTO } from "../../../scripts/terms/config";

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

const FIXTURES = path.join(process.cwd(), "tests/fixtures/terms");
/** 알파Plus2607 자동 탑재 특약 — 책자 제목(상품담보명 + 「 특별약관」) · 픽스처. */
const ALPHA2607_FIXTURES = autoFixtures(ALPHA2607_AUTO, (file) => readFileSync(path.join(FIXTURES, "알파2607", file), "utf8").split("\n")[0]);

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
    // 세 번째 상품 — 상해 특약 10 은 2604 템플릿을 그대로 탑재하고 2607 원문과 대조한다(띄어쓰기 · 예시 표기 차이는 알려진 차이), 질병 5 는 새 템플릿
    name: "알파Plus보장보험2607",
    dir: "알파2607",
    plans: 4,
    general: "보통약관 52조(관 7)",
    // 2604 와 같은 열 넷 + 5대고액치료비암(9) — 양성뇌종양 · 만성당뇨합병증은 보통약관이 먼저 참조한다
    // 보통약관이 먼저 참조하는 아홉 뒤로는 특약이 처음 참조한 별표가 책자 순서(특약 그룹 · 상품담보 순)대로 — 자동 탑재 특약이 수십 개를 더해
    // 목록 대신 「참조한 것만 · 겹치지 않게 · 보통약관 아홉이 먼저」를 본다(아래 it)
    appendices: ["AX000002", "AX000001", "AX000004", "AX000007", "AX000008", "AX000010", "AX000011", "AX000020", "AX000012"],
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
      // 2604 담보의 갱신형 탑재분 — 템플릿에 갱신형 조건 보험기간 조를 더했다(모델명세 §4)
      ["갱신형 일반상해사망보장 특별약관", "갱신형_일반상해사망보장.md"],
      ["갱신형 골절(치아파절 제외)진단비Ⅱ보장 특별약관", "갱신형_골절(치아파절_제외)진단비Ⅱ보장.md"],
      ["5대고액치료비암진단비보장 특별약관", "5대고액치료비암진단비보장.md"],
      ["양성뇌종양진단비Ⅱ보장 특별약관", "양성뇌종양진단비Ⅱ보장.md"],
      ["만성당뇨합병증진단비보장 특별약관", "만성당뇨합병증진단비보장.md"],
      ["중대한재생불량성빈혈진단비보장 특별약관", "중대한재생불량성빈혈진단비보장.md"],
      ["말기신부전증진단비보장 특별약관", "말기신부전증진단비보장.md"],
      // 자동 탑재 특약 — 원문 「특별약관 Ⅰ ~ Ⅴ」 의 나머지 전부(설정 `ALPHA2607_AUTO`, 갱신형 짝은 두 탑재분)
      ...ALPHA2607_FIXTURES,
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

/** 원문 → 기대 줄 — 인수기준 알려진 차이(`knownDifferences.ts`)를 얹는다. 대조기는 완화하지 않는다. */
const source = (dir: string, file: string) => expectedLines(dir, file, sourceToLines(readFileSync(path.join(FIXTURES, dir, file), "utf8")));

let snapshot: Promise<() => Promise<TestDb>> | undefined;
/**
 * 실물 시드를 넣은 새 DB — 시드는 파일에서 한 번만 적재하고 떠 둔 사본에서 연다(`snapshotTestDb`). 알파Plus2607 주계약 특약 전체로 시드가 커져
 * describe 마다 적재하면 변형 열 벌이 수 분이 걸린다. 사본은 서로 독립이라 변형이 바꾼 값이 다른 describe 로 새지 않는다.
 */
async function seededDb(): Promise<TestDb> {
  snapshot ??= (async () => {
    const db = await createTestDb();
    const services = createServices(db.db);
    const admin = await services.auth.ensureSeedAdmin();
    await loadAlphaPlus(services, { userId: admin.id, role: admin.role });
    const open = await snapshotTestDb(db);
    await db.close();
    return open;
  })();
  return (await snapshot)();
}

/** 상품이 참조하는 별표 — 보통약관 · 탑재 담보의 템플릿과 그것들이 쓰는 함수조항(두 겹까지)의 별표 참조 (시드 JSON 으로 센다). */
function referencedAppendices(productCode: string): Set<string> {
  const data = (file: string) => JSON.parse(readFileSync(path.join(process.cwd(), "src/db/seed/data", file), "utf8")) as Record<string, unknown>[];
  const product = data("products.json").find((p) => p.code === productCode) as { general: string; mounts: { coverage: string }[] };
  const docs = [...data("generals.json").filter((g) => g.code === product.general), ...data("documents.json").filter((d) => product.mounts.some((m) => m.coverage === d.ownerCoverage))];
  const clauses = data("clauses.json");
  const codesIn = (x: unknown, key: string) => new Set([...JSON.stringify(x).matchAll(new RegExp(`"${key}":"([A-Z]+\\d+)"`, "g"))].map((m) => m[1]));
  const used = codesIn(docs, "clauseCode");
  for (const c of clauses.filter((x) => used.has(x.code as string))) for (const k of codesIn(c, "clauseCode")) used.add(k);
  return codesIn([docs, clauses.filter((x) => used.has(x.code as string))], "appendixCode");
}

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
    db = await seededDb();
    const services = createServices(db.db);
    for (const product of await services.product.listProducts()) {
      plans.set(product.name, (await services.product.listPlans(product.id)).length);
      const r = await services.assembly.preview(product.id);
      if (!r.ok) throw new Error(JSON.stringify(r.rejection));
      booklets.set(product.name, r.value);
    }
  }, 300_000);

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
      const codes = booklet().appendices.map((a) => a.code);
      if (product.dir !== "알파2607") return expect(codes).toEqual(product.appendices);
      // 알파Plus2607 — 보통약관 아홉이 먼저, 겹치지 않고, 상품이 탑재한 문면(+ 그 문면 · 보통약관이 쓰는 함수조항)이 참조한 별표 전부
      expect(codes.slice(0, product.appendices.length)).toEqual(product.appendices);
      expect(new Set(codes).size).toBe(codes.length);
      expect([...codes].sort()).toEqual([...referencedAppendices("alpha2607")].sort());
    });

    it("책자의 특약은 표본 전부다 — 빠지거나 더한 것이 없다", () => {
      expect(booklet().specials.flatMap((g) => g.docs.map((d) => d.title)).sort()).toEqual(product.specials.map(([title]) => title).sort());
    });
  });
});

/**
 * 대표 변형 — 납입면제(QA/인수기준 보통약관 행 · 알파플러스_모델명세 §6). 같은 템플릿 · 같은 역할 함수조항에 세목 사유만 바꿔 넣는다.
 * 2종 사유 = 암·무면책 · 뇌졸중 · 상해및질병80% → 호 넷(암 호에 암보장개시일 없음 · 장해는 호 둘) · 면책 사유가 없어 부가항 · 무효 · 부활 문구가 빠진다 ·
 * 세부규정은 장해 · 상해장해 항만, 장해 호 함수조항을 가리키는 참조는 그 호 둘(제3호 · 제4호)로 따라온다 · 정의 조는 암 · 뇌졸중만(사유별 정의 함수조항이 스스로 켜진다 — ADR-0086).
 */
const ALPHA = "알파Plus보장보험";
/** 2607 — 보통약관은 2607 원문 한 벌이지만 납입면제 템플릿 · 함수조항은 2604 것을 함께 쓴다(알파플러스2607_모델명세 §2). 같은 변형이 같은 글을 내야 한다. */
const ALPHA2607 = "알파Plus보장보험2607";

describe.each([ALPHA, ALPHA2607])("★ 실물 재현 변형 — %s 납입면제 사유를 바꾸면 템플릿이 따라온다", (productName) => {
  let db: TestDb;
  let lines: string[] = [];
  let issues: unknown[] = [];

  beforeAll(async () => {
    db = await seededDb();
    const services = createServices(db.db);
    const admin = await services.auth.ensureSeedAdmin();
    const actor: Actor = { userId: admin.id, role: admin.role };
    const product = (await services.product.listProducts()).find((p) => p.name === productName)!;
    const type2 = (await services.product.listPlanOptions(product.id)).find((o) => o.axis === "type" && o.number === 2)!;
    const saved = await services.product.setPlanOptionValues(actor, type2.id, [{ path: "waiver.reasons", value: ["V02", "V03", "V11"] }]);
    if (!saved.ok) throw new Error(JSON.stringify(saved.rejection));
    const r = await services.assembly.preview(product.id);
    if (!r.ok) throw new Error(JSON.stringify(r.rejection));
    lines = renderedToLines(r.value.general!);
    issues = r.value.issues;
  }, 300_000);

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

  it("납입면제 조 — 2종 항 하나에 사유 호 넷, 부가항(암보장개시일)이 빠져 ③ ④ 가 당겨진다", () => {
    expect(article("보험료의 납입면제")).toEqual([
      "## 제28조(보험료의 납입면제)",
      "@ 회사는 피보험자가 2종(보험료 납입면제형) 가입시 보험료 납입기간 중에 다음 중 어느 하나의 사유에 해당되고 계약이 소멸되지 않은 경우에는 차회 이후 보장보험료의 납입을 면제합니다.",
      "  - 피보험자가「암(유사암제외)」으로 진단확정되었을 경우",
      "  - 피보험자가「뇌졸중」으로 진단확정되었을 경우",
      "  - 피보험자가 상해로【별표1(장해분류표)】에서 정한 장해지급률이 80% 이상에 해당하는 장해상태가 되었을 경우",
      "  - 피보험자가 진단 확정된 질병으로【별표1(장해분류표)】에서 정한 장해지급률이 80% 이상에 해당하는 장해상태가 되었을 경우",
      "@ 제1항에도 불구하고 아래의 보험료 납입면제 제외대상 특별약관 및「자동갱신 특별약관」에서 정한「자동갱신 적용대상 특별약관」은 보장보험료의 납입을 면제하지 않습니다.",
      "```용어풀이",
      "【보험료 납입면제 제외대상 특별약관】",
      "･보험료납입지원(유사암진단)보장특약",
      "```",
      "@ 1형(해약환급금 지급형)의 경우 회사는 제1항에 따라 보장보험료 납입면제가 된 경우에 차회 이후의 적립보험료 납입을 중지합니다.",
      "@ 제1항부터 제3항까지의 규정에도 불구하고 보장보험료의 납입이 면제되기 이전에 보험료 납입 연체가 있는 경우에는 연체된 보험료를 납입하여야 하며, 납입하지 않은 경우 제32조(보험료의 납입이 연체되는 경우 납입최고(독촉)와 계약의 해지)에 따라 해지될 수 있습니다.",
    ]);
  });

  it("세부규정 — 면책 ①~③ 이 빠지고, 장해 호 함수조항 참조는 제3호 · 제4호 · ⑫ 상해 관련은 남는다", () => {
    const detail = article("납입면제에 관한 세부규정");
    expect(detail).toHaveLength(1 + 9 + 8);
    expect(detail[1]).toMatch(/^@ 제28조\(보험료의 납입면제\) 제1항 제3호 및 제4호에서 장해지급률이/);
    expect(detail.find((l) => l.includes("합의하지 못할 때"))).toMatch(/^@ 보험수익자와 회사가 제28조\(보험료의 납입면제\) 제1항의/);
    expect(detail.find((l) => l.startsWith("@ 회사는 다음 중 어느 한 가지로"))).toContain("제28조(보험료의 납입면제) 제1항 제3호 또는 제4호의 후유장해");
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
/** 2607 질병 대표 5 — 특약 제목 · 「특별약관의 소멸」 조 번호(5대고액치료비암만 정의 · 무효가 앞에 있어 제5조). */
const DISEASE_2607: [string, number][] = [
  ["5대고액치료비암진단비보장 특별약관", 5],
  ["양성뇌종양진단비Ⅱ보장 특별약관", 4],
  ["만성당뇨합병증진단비보장 특별약관", 4],
  ["중대한재생불량성빈혈진단비보장 특별약관", 4],
  ["말기신부전증진단비보장 특별약관", 4],
];

/** 탑재분 담보속성 바꾸기 — 상품의 상품담보마다 새 선택(undefined 면 그대로). 상품담보명은 작명 규칙으로 다시 만든다(특약 제목이 따라온다). */
type AttributeChange = { product: string; select: (pc: ProductCoverage, all: readonly ProductCoverage[]) => AttributeSelection[] | undefined };

/** 변형 한 벌 — 실물 시드를 넣고 세목 선택지 값 · 탑재분 담보속성을 바꾼 뒤 상품마다 조립한다. */
async function previewVariant(changes: { product: string; axis: "type" | "form"; number: number; entries: { path: string; value: Value }[] }[], attributes: AttributeChange[] = []) {
  const db = await seededDb();
  const services = createServices(db.db);
  const admin = await services.auth.ensureSeedAdmin();
  const actor: Actor = { userId: admin.id, role: admin.role };
  const products = await services.product.listProducts();
  for (const c of changes) {
    const product = products.find((p) => p.name === c.product)!;
    const option = (await services.product.listPlanOptions(product.id)).find((o) => o.axis === c.axis && o.number === c.number)!;
    const saved = await services.product.setPlanOptionValues(actor, option.id, c.entries);
    if (!saved.ok) throw new Error(JSON.stringify(saved.rejection));
  }
  for (const c of attributes) {
    const product = products.find((p) => p.name === c.product)!;
    const all = await services.product.listProductCoverages(product.id);
    for (const pc of all) {
      const next = c.select(pc, all);
      if (!next) continue;
      const saved = await services.product.setAttributes(actor, pc.id, next, { regenerateName: true });
      if (!saved.ok) throw new Error(`${pc.name}: ${JSON.stringify(saved.rejection)}`);
    }
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
describe.each([ALPHA, ALPHA2607])("★ 실물 재현 변형 — %s 해약환급금 지급형이 없으면 1형 적립 중지 항이 빠진다", (productName) => {
  let db: TestDb;
  let booklet: Booklet;

  beforeAll(async () => {
    const v = await previewVariant([{ product: productName, axis: "form", number: 1, entries: [{ path: "no_surrender.type", value: "V02" }] }]);
    db = v.db;
    booklet = v.booklets.get(productName)!;
  }, 300_000);

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
  }, 300_000);

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

/**
 * 대표 변형 — 납입면제 없는 상품(W1 열린 문제 2). 두 상품 모두 납입면제종을 미적용으로 → 「납입면제 있음」 = 아니오라 세 조가 빠지고,
 * 그 조를 가리키던 문장(제2조 표 종 행의 정의 · 제6조 「또는 … 납입면제 사유의 발생을 알게된 경우」 · 준용규정 「1종 … 제외」)도 같은 조건으로 빠진다.
 */
describe("★ 실물 재현 변형 — 납입면제 없는 상품은 납입면제 조를 가리키던 문장도 빠진다", () => {
  let db: TestDb;
  let booklets: Map<string, Booklet>;
  const off = [{ path: "waiver.applies", value: false }, { path: "waiver.reasons", value: [] }];

  beforeAll(async () => {
    const v = await previewVariant([
      { product: ALPHA, axis: "type", number: 2, entries: off },
      { product: ALPHA2607, axis: "type", number: 2, entries: off },
      { product: MERITZ, axis: "type", number: 2, entries: off },
      { product: MERITZ, axis: "type", number: 3, entries: off },
    ]);
    db = v.db;
    booklets = v.booklets;
  }, 300_000);

  afterAll(async () => {
    await db.close();
  });

  it.each([ALPHA, ALPHA2607, MERITZ])("%s — 오류 0 · 납입면제 조가 없고 어느 문장도 납입면제를 말하지 않는다", (name) => {
    const b = booklets.get(name)!;
    expect(b.issues).toEqual([]);
    const general = renderedToLines(b.general!);
    expect(articleLines(general, "보험료의 납입면제")).toEqual([]);
    expect(articleLines(general, "납입면제에 관한 세부규정")).toEqual([]);
    expect(articleLines(general, "보험금 지급사유 등의 통지").join("\n")).not.toContain("납입면제");
    expect(articleLines(general, "보험금 지급사유 등의 통지")[1]).toMatch(/보험금 지급사유의 발생을 알게된 경우에는 지체없이/);
    for (const doc of b.specials.flatMap((g) => g.docs)) {
      const application = articleLines(renderedToLines(doc), "준용규정").join("\n");
      expect(application, doc.title).not.toContain("납입면제");
      // 원문이 마침표 · 「은」을 빠뜨린 준용규정이 있다(갱신형 2대질환 주요치료비 · 혈전용해치료비Ⅱ — 원문 그대로)
      // 제외 조가 없는 준용규정(자동갱신 · 피보험자추가 — 「보통약관 및 해당 특별약관을 따릅니다」)은 단서가 없다
      if (application.includes("다만,")) expect(application, doc.title).toContain("제외합니다");
    }
  });

  /**
   * 2607 특약 — 준용규정 두 함수조항(상해 C0068 · 질병 C0071)이 「1종 … 제27조의1 및 제27조의2도 제외」를 같은 조건으로 뺀다.
   * 질병 C0071 은 제외 목록에 제5조가 더 있다(조 참조 대상이 달라 C0068 의 옵션이 아니다 — 모델명세 §3). 남는 조 참조는 조립 순서의 그 조를 가리킨다.
   */
  it("알파Plus보장보험2607 특약 — 준용규정 단서가 「… 및 제38조(중도인출)은 제외합니다.」로 끝나고 조 참조 번호가 맞다", () => {
    const b = booklets.get(ALPHA2607)!;
    const general = articleTitles(renderedToLines(b.general!));
    const fixtureOf = new Map(PRODUCTS[1].specials);
    /** 준용규정 첫 항(박스 줄 빼고) — 조 번호는 납입면제 세 조가 빠져 당겨지므로 지운다. */
    const head = (lines: readonly string[]) => (articleLines(lines, "준용규정").find((l) => /^[=@] /.test(l)) ?? "").replace(/제\d+조/g, "제N조");
    /** 원문 준용규정에서 납입면제 두 조를 빼면 — 「…은 제외하며, 1종 … 도 제외합니다.」 → 「…은 제외합니다.」 · 「또한, 1종 …」 문장 삭제 · 갱신형 나열에서 두 조 삭제. */
    const withoutWaiver = (line: string) =>
      line
        .replace(/(은)? 제외하며, (?:보통약관 )?1종\(보험료 납입면제 미적용형\)으로 가입한 경우 보통약관 제N조의1\(보험료의 납입면제\) 및 제N조의2\(납입면제에 관한 세부규정\)도 제외합니다\./, (_, eun?: string) => `${eun ?? ""} 제외합니다.`)
        .replace(/ 또한, (?:보통약관 )?1종\(보험료 납입면제 미적용형\)으로 가입한 경우 보통약관 제N조의1\(보험료의 납입면제\) 및 제N조의2\(납입면제에 관한 세부규정\)도 제외합니다\./, "")
        .replace(/, 제N조의1\(보험료의 납입면제\), 제N조의2\(납입면제에 관한 세부규정\)(?=, )/, "")
        .replace(/, 제N조의1\(보험료의 납입면제\), 제N조의2\(납입면제에 관한 세부규정\) 및 /, " 및 ")
        .replace(/제N조의\d/g, "제N조");
    for (const doc of b.specials.flatMap((g) => g.docs)) {
      const lines = renderedToLines(doc);
      const file = fixtureOf.get(doc.title);
      expect(file, `${doc.title} 의 픽스처`).toBeDefined();
      // 나열의 연결어는 보지 않는다 — 원문이 연결어를 섞어 쓴 나열(「… 및 제38조, 제27조의1, 제27조의2 및 제38조」)은 참조 하나로 찍혀 쉼표 · 「및」이 달라진다
      const joint = (x: string) => x.replace(/, | 및 /g, "·");
      expect(joint(head(lines)), doc.title).toBe(joint(withoutWaiver(head(source("알파2607", file!)))));
      if (head(lines).includes("다만,")) expect(head(lines), doc.title).toMatch(/제외합니다\.?$/);
      expect(referenceNumberIssues(lines, general), doc.title).toEqual([]);
    }
  });

  /** 질병 5 제1조 ② 「제N조(특별약관의 소멸) 제3항」 — 소멸 함수조항(C0064) 블록 안쪽 셋째 항을 가리키는 참조가 변형에서도 그 조 · 그 항으로 찍힌다. */
  it.each(DISEASE_2607)("알파Plus보장보험2607 「%s」 — 제1조 ② 가 제%i조(특별약관의 소멸) 제3항을 가리키고 그 항은 계약자적립액 항이다", (title, n) => {
    const doc = booklets.get(ALPHA2607)!.specials.flatMap((g) => g.docs).find((d) => d.title === title)!;
    const lines = renderedToLines(doc);
    const payout = articleLines(lines, "보험금의 지급사유").filter((l) => l.startsWith("@ "));
    expect(payout[1]).toContain(`다만, 제${n}조(특별약관의 소멸) 제3항에 따라 이 특별약관의 계약자적립액 및 미경과보험료를 지급한 경우에는`);
    const lapse = lines.slice(lines.findIndex((l) => l === `## 제${n}조(특별약관의 소멸)`));
    expect(lapse[0]).toBe(`## 제${n}조(특별약관의 소멸)`);
    expect(lapse.filter((l) => l.startsWith("@ "))[2]).toContain("계약자적립액");
  });
});

/**
 * 대표 변형 — 형 축 「1형만」(QA/인수기준 보통약관 행 형 축 — 형 하나면 2형 문장 · 「1형(해약환급금 지급형)에 한하여」 어구가 없다).
 * 형 2 를 해약환급금 지급형으로 바꿔 상품에 미지급형인 형이 없게 한다(D0007 「해약환급금 미지급형 있음」 = 아니오).
 * 2형을 말하는 문장(제23조 ① 단서 · 해약환급금 조의 2형 박스, 메리츠는 제2조 표 해약환급금 정의 단서 · 해약환급금 ① 단서까지)과
 * 적립이율 · 만기환급금 · 중도인출 ① 의 첫 문장 「이 계약에서 … 1형(해약환급금 지급형)에 한하여 적용합니다.」가 빠지고, 나머지 조는 원문 그대로다.
 */
const SINGLE_FORM_CHANGED = ["적립부분 적립이율에 관한 사항", "만기환급금의 지급", "계약내용의 변경 등", "해약환급금", "중도인출"];
const SINGLE_FORM: { name: string; dir: string; changed: string[] }[] = [
  { name: ALPHA, dir: "", changed: SINGLE_FORM_CHANGED },
  { name: ALPHA2607, dir: "알파2607", changed: SINGLE_FORM_CHANGED },
  { name: MERITZ, dir: "메리츠", changed: ["용어의 정의", ...SINGLE_FORM_CHANGED] },
];

describe.each(SINGLE_FORM)("★ 실물 재현 변형 — $name 해약환급금 미지급형이 없으면(1형만) 2형 문장 · 「1형에 한하여」 어구가 빠진다", ({ name, dir, changed }) => {
  let db: TestDb;
  let booklet: Booklet;
  let lines: string[] = [];

  beforeAll(async () => {
    const v = await previewVariant([{ product: name, axis: "form", number: 2, entries: [{ path: "no_surrender.type", value: "V01" }] }]);
    db = v.db;
    booklet = v.booklets.get(name)!;
    lines = renderedToLines(booklet.general!);
  }, 300_000);

  afterAll(async () => {
    await db.close();
  });

  it("오류 0 · 어느 줄도 2형을 말하지 않고 「1형(해약환급금 지급형)에 한하여」가 없다 · 조 참조 번호가 맞다", () => {
    expect(booklet.issues).toEqual([]);
    // 알려진 한계 — 알파Plus 상해보험계약 후 알릴 의무의 박스 【위험변경시 해약환급금 정산】 한 줄에 섞인 2형 문장은 남는다
    // (박스는 정적 마스터라 안에 조건이 없고, 같은 박스의 다른 줄은 형과 무관해 박스째 감쌀 수 없다)
    const boxed = "제1항에 따라 위험이 증가⋅감소되는 경우 이후 기간 보장을 위한 재원인 계약자적립액";
    expect(lines.filter((l) => l.includes("2형(해약환급금") && !l.startsWith(boxed))).toEqual([]);
    expect(lines.filter((l) => l.includes("1형(해약환급금 지급형)에 한하여"))).toEqual([]);
    expect(referenceNumberIssues(lines)).toEqual([]);
  });

  it("적립이율 · 만기환급금 · 중도인출 ① 은 둘째 문장부터 · 계약내용의 변경 ① 은 단서 없이 끝난다 · 해약환급금 조에 박스가 없다", () => {
    expect(articleLines(lines, "적립부분 적립이율에 관한 사항")[1]).toMatch(/^@ 이 보험의 적립부분 순보험료/);
    expect(articleLines(lines, "만기환급금의 지급")[1]).toMatch(/^@ 회사는 보험기간이 끝난 때에 만기환급금/);
    expect(articleLines(lines, "중도인출")[1]).toMatch(/^@ 계약자는 보장개시일부터 2년 이상/);
    expect(articleLines(lines, "계약내용의 변경 등")[1]).toMatch(/보험증권의 뒷면에 기재하여 드립니다\.$/);
    const surrender = articleLines(lines, "해약환급금");
    expect(surrender[1]).toMatch(/산출방법서」에 따라 계산합니다\.$/);
    expect(surrender.some((l) => l.startsWith("```"))).toBe(false);
  });

  it(`바뀐 조는 ${changed.length}개뿐 — 나머지 조는 원문과 같다`, () => {
    const diff = diffArticlesUnordered(source(dir, "보통약관.md"), lines);
    const titles = (cs: UnorderedDiff["missing"]) => cs.map((c) => c.title.replace(/^제\d+조(의\d+)?\(|\)$/g, "")).sort();
    expect(titles(diff.missing)).toEqual([...changed].sort());
    expect(titles(diff.extra)).toEqual([...changed].sort());
  });
});

/**
 * 대표 변형 — 상해 특약의 갱신유형(QA/인수기준 상해 특약 행 · 알파Plus2607 특약 15 의 상해 10). 담보속성 A0001 을 갱신형으로 바꾸면
 * 같은 담보 문면 한 벌이 따라온다 — 제목 「갱신형 …」 · 준용규정(C0068)이 갱신형 가지(다섯 조 무조건 제외)로. 수술비는 제6조(보험기간) · 「최초계약일」
 * (기준일 문구 C0054 프리셋 ‘담보’ — D0005)까지 서서 갱신형 원문과 같다. 2604 · 2607 이 같은 담보 · 템플릿을 탑재해 두 상품 문맥에서 같이 돌린다.
 * 수술비 비갱신 탑재분은 부가유형 「추가」를 함께 줘 이미 있는 갱신형 탑재분과 조합 · 이름이 겹치지 않게 한다.
 */
const SURGERY = "수술비(1-7종, 연간3회한)[상해]보장 특별약관";
const SURGERY_RENEW_FILE = "갱신형_수술비(1-7종,_연간3회한)[상해]보장.md";
/** 비갱신 상해 특약 — 2604 탑재 그대로(갱신형 수술비는 이미 갱신형이라 뺀다). */
const INJURY = PRODUCTS[0].specials.filter(([title]) => !title.startsWith("갱신형 "));
/** 갱신형 탑재분이면 보험기간 조가 서는 2604 담보(템플릿의 갱신형 조건 조 — 2607 갱신형 원문). */
const RENEWAL_PERIOD = new Set(["일반상해사망보장 특별약관", "일반상해사망보장 추가 특별약관", "골절(치아파절 제외)진단비Ⅱ보장 특별약관"]);
const renewedTitle = (title: string) => (title === SURGERY ? "갱신형 수술비(1-7종, 연간3회한)[상해]보장 추가 특별약관" : `갱신형 ${title}`);
/**
 * 갱신유형이 없거나 비갱신형인 상해 탑재분을 갱신형으로(수술비 비갱신은 「추가」도) — 기본계약 · 질병 · 이미 갱신형인 것은 그대로.
 * 같은 이름의 갱신형 탑재분이 이미 있으면(알파Plus2607 의 갱신형 일반상해사망 · 골절 — 원문 대조는 위 describe 가 한다) 그대로 둔다.
 */
const renewInjury = (product: string): AttributeChange => ({
  product,
  select: (pc, all) => {
    if (pc.attributes.some((a) => a.kindCode === "A0001" && a.valueCode === "2")) return undefined;
    if (!INJURY.some(([title]) => title === `${pc.name} 특별약관`)) return undefined;
    if (`${pc.name} 특별약관` !== SURGERY && all.some((o) => o.name === `갱신형 ${pc.name}`)) return undefined;
    const surgery = `${pc.name} 특별약관` === SURGERY;
    const rest = pc.attributes.filter((a) => a.kindCode !== "A0001" && !(surgery && a.kindCode === "A0002"));
    return [{ kindCode: "A0001", valueCode: "2" }, ...rest, ...(surgery ? [{ kindCode: "A0002", valueCode: "2" }] : [])];
  },
});

describe.each([
  [ALPHA, ""],
  [ALPHA2607, "알파2607"],
])("★ 실물 재현 변형 — %s 상해 특약을 갱신형으로 바꾸면 제목 · 준용규정(수술비는 보험기간 · 최초계약일까지)이 따라온다", (name, dir) => {
  let db: TestDb;
  let booklet: Booklet;
  const doc = (title: string) => {
    const docs = booklet.specials.flatMap((g) => g.docs);
    const d = docs.find((x) => x.title === title);
    if (!d) throw new Error(`특약 「${title}」 없음 — 있는 것: ${docs.map((x) => x.title).join(" · ")}`);
    return renderedToLines(d);
  };

  beforeAll(async () => {
    const v = await previewVariant([], [renewInjury(name)]);
    db = v.db;
    booklet = v.booklets.get(name)!;
  }, 300_000);

  afterAll(async () => {
    await db.close();
  });

  it("오류 0", () => {
    expect(booklet.issues).toEqual([]);
  });

  it("수술비 비갱신 탑재분 — 갱신형 원문과 같다(제6조 보험기간 · 「최초계약일」 · 준용규정 다섯 조)", () => {
    const lines = doc(renewedTitle(SURGERY));
    const diff = diffArticlesUnordered(source(dir, SURGERY_RENEW_FILE), lines);
    expect(diff, describeDiff(diff)).toEqual(clean);
    expect(referenceNumberIssues(lines, articleTitles(renderedToLines(booklet.general!)))).toEqual([]);
  });

  it.each(INJURY.filter(([title]) => title !== SURGERY))("「%s」 — 「갱신형 …」 제목 · 준용규정(일반상해사망 · 골절은 보험기간 조까지)만 갱신형으로 바뀌고 나머지 조는 원문 그대로다", (title, file) => {
    const lines = doc(renewedTitle(title));
    const diff = diffArticlesUnordered(source(dir, file), lines);
    expect(diff.missing.map((c) => c.title)).toEqual(["준용규정"]);
    // 갱신형 원문에만 있는 보험기간 조 — 템플릿에 갱신형 조건으로 넣었다(2607 갱신형 원문 대조는 위 describe)
    expect(diff.extra.map((c) => c.title).sort()).toEqual(RENEWAL_PERIOD.has(title) ? ["보험기간", "준용규정"] : ["준용규정"]);
    // 준용규정 본문 = 갱신형 수술비(원문과 같다고 위에서 본) 준용규정 본문
    expect(articleLines(lines, "준용규정").slice(1)).toEqual(articleLines(doc(renewedTitle(SURGERY)), "준용규정").slice(1));
    expect(referenceNumberIssues(lines, articleTitles(renderedToLines(booklet.general!)))).toEqual([]);
  });
});

/**
 * 대표 변형 — 상해 특약 갱신형 × 종 축 1종만(납입면제 없음). 준용규정 갱신형 가지의 다섯 조 나열에서 납입면제 두 조만 빠져 남은 세 조로 찍힌다
 * (일부 대상이 사라진 참조는 남은 대상으로 — 기능/문면 §3.5). 수술비는 보험기간 · 「최초계약일」이 그대로 선다.
 */
describe.each([ALPHA, ALPHA2607])("★ 실물 재현 변형 — %s 상해 특약 갱신형 × 납입면제 없음이면 준용규정이 남은 세 조로 찍힌다", (name) => {
  let db: TestDb;
  let booklet: Booklet;
  const doc = (title: string) => renderedToLines(booklet.specials.flatMap((g) => g.docs).find((d) => d.title === title)!);

  beforeAll(async () => {
    const v = await previewVariant([{ product: name, axis: "type", number: 2, entries: [{ path: "waiver.applies", value: false }, { path: "waiver.reasons", value: [] }] }], [renewInjury(name)]);
    db = v.db;
    booklet = v.booklets.get(name)!;
  }, 300_000);

  afterAll(async () => {
    await db.close();
  });

  it("오류 0 · 상해 특약 전부 준용규정이 「… 제9조 · 제10조 및 제N조(중도인출)은 제외합니다.」 · 조 참조 번호가 맞다", () => {
    expect(booklet.issues).toEqual([]);
    const general = articleTitles(renderedToLines(booklet.general!));
    for (const [title] of INJURY) {
      const lines = doc(renewedTitle(title));
      expect(articleLines(lines, "준용규정")[1], title).toMatch(
        /^= 이 특별약관에서 정하지 않은 사항은 보통약관을 따릅니다\. 다만, 보통약관 제9조\(적립부분 적립이율에 관한 사항\), 제10조\(만기환급금의 지급\) 및 제\d+조\(중도인출\)은 제외합니다\.$/,
      );
      expect(referenceNumberIssues(lines, general), title).toEqual([]);
    }
  });

  it("수술비 — 보험기간 조 · 「최초계약일」이 선다", () => {
    const lines = doc(renewedTitle(SURGERY));
    expect(articleLines(lines, "보험기간")).not.toEqual([]);
    expect(lines.join("\n")).toContain("최초계약일");
    expect(lines.join("\n")).not.toContain("납입면제");
  });
});

/**
 * 대표 변형 — 메리츠 특약 8 의 종 축(납입면제 없음). 준용규정(C0069 · 질병사망은 문면)의 「또한, 1종(…)으로 가입한 경우 … 은 제외합니다.」가 빠지고
 * 앞 문장이 그대로 끝난다. 남는 조 참조는 납입면제 세 조가 빠진 조립 순서의 번호다.
 */
describe("★ 실물 재현 변형 — 메리츠 특약 8 은 납입면제가 없으면 준용규정의 「또한, 1종 …」 문장이 빠진다", () => {
  let db: TestDb;
  let booklet: Booklet;
  const off = [{ path: "waiver.applies", value: false }, { path: "waiver.reasons", value: [] }];

  beforeAll(async () => {
    const v = await previewVariant([
      { product: MERITZ, axis: "type", number: 2, entries: off },
      { product: MERITZ, axis: "type", number: 3, entries: off },
    ]);
    db = v.db;
    booklet = v.booklets.get(MERITZ)!;
  }, 300_000);

  afterAll(async () => {
    await db.close();
  });

  it.each(PRODUCTS[2].specials)("「%s」 — 오류 0 · 준용규정이 「… 및 제N조(중도인출)은 제외합니다.」로 끝난다 · 나머지 조는 원문 그대로 · 조 참조 번호가 맞다", (title, file) => {
    expect(booklet.issues).toEqual([]);
    const lines = renderedToLines(booklet.specials.flatMap((g) => g.docs).find((d) => d.title === title)!);
    const disease = title.startsWith("갱신형 질병사망");
    expect(articleLines(lines, "준용규정")[1]).toMatch(
      new RegExp(`^= 이 특별약관에서 정하지 않은 사항은 보통약관을 따릅니다\\. 다만, 보통약관 ${disease ? "제5조\\(보험금을 지급하지 않는 사유\\), " : ""}제9조\\(적립부분 적립이율에 관한 사항\\), 제10조\\(만기환급금의 지급\\) 및 제\\d+조\\(중도인출\\)은 제외합니다\\.$`),
    );
    const diff = diffArticlesUnordered(source("메리츠", file), lines);
    expect(diff.missing.map((c) => c.title)).toEqual(["준용규정"]);
    expect(diff.extra.map((c) => c.title)).toEqual(["준용규정"]);
    expect(referenceNumberIssues(lines, articleTitles(renderedToLines(booklet.general!)))).toEqual([]);
  });
});
