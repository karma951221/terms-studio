/**
 * 알파Plus 2607 fixture(`tests/fixtures/terms/알파2607`, `npm run terms:pdfmd -- --preset 알파2607` 산출물) 검증.
 *
 * 1. 모두 `parseTerms` 로 읽히고, 통계 줄의 조 수와 맞고, 본문에 원문 마커([N] · ①)가 남지 않았다.
 * 2. 2604 fixture 와 같은 이름의 특약은 구조가 같다 — 조 번호 · 제목, 조마다 항 · 호 · 목 수.
 *    항 · 호 · 목 글은 빈칸을 빼고 모두 같다(2026-10-13 확인 — 2604 와 2607 의 차이는 띄어쓰기뿐). 박스 · 표 · 그림은 비교하지 않는다 —
 *    2604 는 그림을 사람이 표로 다시 그렸고 단 경계 줄바꿈이 남아 있다.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseTerms, type ParsedDoc } from "../parse";

const ROOT = path.resolve(import.meta.dirname, "../../../tests/fixtures/terms");
const DIR = path.join(ROOT, "알파2607");
const files = readdirSync(DIR).filter((f) => f.endsWith(".md"));
const read = (p: string) => readFileSync(p, "utf8");

const articles = (doc: ParsedDoc) => doc.sections.flatMap((s) => s.articles);
const shape = (doc: ParsedDoc) =>
  articles(doc).map((a) => {
    const n = (k: string) => a.body.filter((l) => l.kind === k).length;
    return `${a.number}(${a.title}) 항${n("paragraph")} 호${n("item")} 목${n("subitem")}`;
  });
const texts = (doc: ParsedDoc) =>
  articles(doc).flatMap((a) => a.body.flatMap((l) => ("text" in l ? [l.text.replace(/\s+/g, "")] : [])));

describe("알파2607 fixture", () => {
  it("보통약관 + 상해 10 + 질병 5", () => {
    expect(files).toHaveLength(16);
    expect(files).toContain("보통약관.md");
  });

  it.each(files)("%s — parseTerms 로 읽히고 통계 · 마커가 맞다", (f) => {
    const md = read(path.join(DIR, f));
    const doc = parseTerms(md);
    const stat = /^> 통계: 관 (\d+) · 조 (\d+)/m.exec(md);
    expect(stat).not.toBeNull();
    expect(articles(doc).length).toBe(Number(stat![2]));
    expect(articles(doc).length).toBeGreaterThan(0);
    expect(md).toMatch(/^> 출처: 무배당 알파Plus보장보험2607약관\.pdf PDF \d+(–\d+)?쪽\(인쇄 \d+(–\d+)?쪽\) · 추출일: \d{4}-\d{2}-\d{2}$/m);
    expect(md).toMatch(/^> 상품: 무배당 알파Plus보장보험2607 · 문서종류: (보통약관|특별약관)$/m);
    expect(md).not.toMatch(/^(@|=| {2}-| {4}-) (\[\d+\]|[①-⑳])\s/m);
    expect(md).not.toMatch(/<!-- p\.\d+ -->/);
  });

  const common = files.filter((f) => readdirSync(ROOT).includes(f));

  it("2604 와 같은 이름 11개(보통약관 + 상해 10)", () => {
    expect(common).toHaveLength(11);
  });

  it.each(common)("%s — 2604 와 구조(조 · 항 · 호 · 목)와 글이 같다", (f) => {
    const old = parseTerms(read(path.join(ROOT, f)));
    const cur = parseTerms(read(path.join(DIR, f)));
    expect(shape(cur)).toEqual(shape(old));
    const a = texts(old);
    const b = new Set(texts(cur));
    const same = a.filter((t) => b.has(t)).length;
    expect(same).toBe(a.length);
  });
});
