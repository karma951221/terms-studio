import { describe, expect, it } from "vitest";

import type { ArticleNode, ParagraphNode } from "../../src/domain/document/nodes";

import { buildStructure } from "./convert";
import { parseTerms } from "./parse";

describe("buildStructure — 원문 구조 노드", () => {
  it("항 글과 첫 호 사이의 표는 호 목록 맨 앞에 선다 — 렌더 순서(항 → 표 → 호)가 원문과 같다", () => {
    const md = ["# 시험 특별약관", "", "## 제1조(정의)", "", "@ 다음 각 호의 사항을 말합니다.", "", "```표", "제목: (없음)", "|항목|", "|---|", "|검사|", "```", "", "  - 첫째", "  - 둘째", "", "@ 둘째 항", ""].join("\n");
    const built = buildStructure(parseTerms(md), "t", "시험");
    const article = built.tree.children[0] as ArticleNode;
    expect(article.children.map((c) => c.kind)).toEqual(["paragraph", "paragraph"]);
    expect((article.children[0] as ParagraphNode).items?.map((i) => i.kind)).toEqual(["table", "item", "item"]);
  });

  it("호가 없는 항 뒤의 표는 조 직속 그대로", () => {
    const md = ["# 시험 특별약관", "", "## 제1조(정의)", "", "@ 표를 봅니다.", "", "```표", "제목: (없음)", "|항목|", "|---|", "|검사|", "```", "", "@ 둘째 항", ""].join("\n");
    const article = buildStructure(parseTerms(md), "t", "시험").tree.children[0] as ArticleNode;
    expect(article.children.map((c) => c.kind)).toEqual(["paragraph", "table", "paragraph"]);
  });
});
