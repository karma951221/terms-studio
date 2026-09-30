/**
 * 조립 미리보기 화면(DOM) → 파싱양식 줄 — `src/domain/assembly/compare.ts` 의 `renderedToLines` 와 같은 모양으로 되돌린다.
 * 그래서 원문 대조는 Vitest 실물 재현(`src/db/seed/real.test.ts`)과 **같은 대조기**(`diffArticlesUnordered` · `referenceNumberIssues`)를 쓴다.
 *
 * 화면 모양 (`src/app/_components/RenderedDoc.tsx`):
 * - `article.ts-doc` > (`section.ts-doc-section` > `h2` + 조들) | `section.ts-doc-article`
 * - 조 = `h3`(「제N조(명)」) + 항들 — `.ts-doc-paragraph`(`span.ts-doc-num` 번호 + 글, 호가 있으면 `ol.ts-doc-items`) · 정적 표(`figure`) · 박스(`aside`)
 * - 호 `li.ts-doc-item`(목 `ol.ts-doc-subitems > li`) · 호 자리 정적 블록 `li.ts-doc-static-item`
 * 호 · 목 번호(1. 가.)는 CSS 카운터라 글에 없다 — 파싱양식도 `- ` 만 쓴다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import type { Locator } from "@playwright/test";

import { sourceToLines } from "../../../../src/domain/assembly/compare";
import { expectedLines } from "../../../../src/db/seed/knownDifferences";

const FIXTURES = path.join(process.cwd(), "tests/fixtures/terms");

/** 원문 픽스처 → 기대 줄(파싱양식) — `dir` 은 상품 폴더(알파Plus 는 뿌리 「」 · 메리츠 「메리츠」). 인수기준 알려진 차이(`knownDifferences.ts`)를 얹는다. */
export function sourceLines(file: string, dir = ""): string[] {
  return expectedLines(dir, file, sourceToLines(readFileSync(path.join(FIXTURES, dir, file), "utf8")));
}

/** 미리보기의 문서 하나(`article.ts-doc`) → 파싱양식 줄. 브라우저 안에서 DOM 을 걷는다. */
export async function renderedLines(doc: Locator): Promise<string[]> {
  return doc.evaluate((root) => {
    const out: string[] = [];
    const text = (el: Element, skip: string): string => {
      let s = "";
      el.childNodes.forEach((n) => {
        if (n.nodeType === 3) s += n.textContent ?? "";
        else if (n instanceof Element && !n.matches(skip)) s += text(n, skip);
      });
      return s;
    };
    const staticLines = (el: Element): string[] => {
      if (el.matches("aside.ts-doc-box")) {
        const title = el.querySelector(":scope > .ts-doc-box-title")?.textContent ?? "";
        const lines = [...el.querySelectorAll(":scope > .ts-doc-box-line")].map((l) => l.textContent ?? "");
        // 파싱양식 대칭 — 그림은 ```그림 + 「설명: 」 (renderedToLines 와 같다)
        if (title === "【그림】") return ["```그림", ...lines.map((l) => `설명: ${l}`), "```"];
        return ["```용어풀이", ...(title !== "【】" && title !== "" ? [title] : []), ...lines, "```"];
      }
      const figure = el.matches("figure") ? el : el.querySelector("figure.ts-doc-table-wrap");
      if (!figure) return [`⟦알 수 없는 블록 ${el.className}⟧`];
      const title = figure.querySelector(":scope > figcaption")?.textContent ?? "(없음)";
      const rows = [...figure.querySelectorAll("table > tbody > tr")];
      const cols = rows[0] ? rows[0].children.length : 0;
      const sep = `|${Array.from({ length: cols }, () => "---").join("|")}|`;
      const lines = ["```표", `제목: ${title}`];
      let separated = false;
      for (const tr of rows) {
        const cells = [...tr.children];
        lines.push(`|${cells.map((c) => c.textContent ?? "").join("|")}|`);
        if (!separated && cells.length > 0 && cells.every((c) => c.tagName === "TH")) {
          lines.push(sep);
          separated = true;
        }
      }
      if (!separated && rows.length > 0) lines.splice(3, 0, sep);
      lines.push("```");
      return lines;
    };
    const article = (a: Element) => {
      out.push(`## ${a.querySelector(":scope > h3")?.textContent ?? ""}`);
      const blocks = [...a.children].filter((c) => c.tagName !== "H3");
      const paragraphs = blocks.filter((b) => b.matches(".ts-doc-paragraph"));
      const marker = paragraphs.length === 1 ? "=" : "@";
      for (const b of blocks) {
        if (!b.matches(".ts-doc-paragraph")) {
          out.push(...staticLines(b));
          continue;
        }
        out.push(`${marker} ${text(b, "span.ts-doc-num, ol").trim()}`);
        for (const it of b.querySelectorAll(":scope > ol.ts-doc-items > li")) {
          if (it.matches(".ts-doc-static-item")) {
            out.push(...staticLines(it.firstElementChild ?? it));
            continue;
          }
          out.push(`  - ${text(it, "ol")}`);
          for (const s of it.querySelectorAll(":scope > ol.ts-doc-subitems > li")) out.push(`    - ${s.textContent ?? ""}`);
        }
      }
    };
    for (const c of root.children) {
      if (c.matches("section.ts-doc-section")) {
        out.push(`# ${c.querySelector(":scope > h2")?.textContent ?? ""}`);
        for (const a of c.querySelectorAll(":scope > section.ts-doc-article")) article(a);
      } else if (c.matches("section.ts-doc-article")) article(c);
    }
    return out;
  });
}
