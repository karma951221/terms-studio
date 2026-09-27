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
 * ★ 실물 재현 — 알파Plus 시드가 원문(`tests/fixtures/terms`)과 같은 약관을 조립한다.
 * 대조 기준 (QA/인수기준 실물 재현 · compare.ts):
 * - 조는 (조 명 + 본문) 다중집합으로 본다 — **조 순서는 달라도 된다**(허용 차이 ⑥). 관 제목 순서는 같아야 한다.
 * - 대신 조립 결과의 조 번호는 1부터 잇고, 본문의 조 참조 번호는 조립 순서의 그 조(또는 보통약관 조)를 가리켜야 한다.
 * - 조 번호 참조는 조 명으로 정규화, 별표 번호는 지운다(허용 차이 ④), 공백 무시.
 * 책자는 상품 하나 = 세목 조합 4(종 2 × 형 2)를 모두 담는다 — 보통약관 · 특약 문면은 세목 값을 읽지 않아 조합별로 갈리지 않는다.
 */

const FIXTURES = path.join(process.cwd(), "tests/fixtures/terms");
const source = (file: string) => sourceToLines(readFileSync(path.join(FIXTURES, file), "utf8"));

/** 다른 조를 사람이 읽을 수 있게 — 실패 메시지용. */
function describeDiff(d: UnorderedDiff): string {
  const show = (label: string, cs: UnorderedDiff["missing"]) =>
    cs.slice(0, 3).map((c) => `\n── ${label} 「${c.title}」\n${c.lines.map((l) => `    ${l}`).join("\n")}`).join("");
  return `${show("원문에만", d.missing)}${show("조립에만", d.extra)}${d.sections ? `\n── 관 순서: ${JSON.stringify(d.sections)}` : ""}`;
}

const clean: UnorderedDiff = { missing: [], extra: [] };

describe("★ 실물 재현 — 알파Plus 시드 → 조립 → 원문 대조", () => {
  let db: TestDb;
  let booklet: Booklet;
  let plans = 0;

  beforeAll(async () => {
    db = await createTestDb();
    const services = createServices(db.db);
    const admin = await services.auth.ensureSeedAdmin();
    const actor: Actor = { userId: admin.id, role: admin.role };
    const { productId } = await loadAlphaPlus(services, actor);
    plans = (await services.product.listPlans(productId)).length;
    const r = await services.assembly.preview(productId);
    if (!r.ok) throw new Error(JSON.stringify(r.rejection));
    booklet = r.value;
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  it("완성본이다 — 오류 0", () => {
    expect(booklet.issues).toEqual([]);
    expect(booklet.complete).toBe(true);
  });

  it("세목 — 조합 4(종 2 × 형 2)가 한 책자에 등록돼 있다", async () => {
    expect(plans).toBe(4);
  });

  it("보통약관 52조(관 7)가 원문과 같다 — 기본계약 대치 포함 · 조 참조 번호가 조립 순서와 맞다", () => {
    const lines = renderedToLines(booklet.general!);
    const diff = diffArticlesUnordered(source("보통약관.md"), lines);
    expect(diff, describeDiff(diff)).toEqual(clean);
    expect(referenceNumberIssues(lines)).toEqual([]);
  });

  it.each([
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
  ])("특약 「%s」이 원문과 같다", (title, file) => {
    const docs = booklet.specials.flatMap((g) => g.docs);
    const doc = docs.find((d) => d.title === title);
    expect(doc, `특약 「${title}」 없음 — 있는 것: ${docs.map((d) => d.title).join(" · ")}`).toBeDefined();
    const lines = renderedToLines(doc!);
    const diff = diffArticlesUnordered(source(file), lines);
    expect(diff, describeDiff(diff)).toEqual(clean);
    expect(referenceNumberIssues(lines, articleTitles(renderedToLines(booklet.general!)))).toEqual([]);
  });
});
