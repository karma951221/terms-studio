import { describe, expect, it } from "vitest";

import type { ArticleNode, ParagraphNode } from "../../src/domain/document/nodes";

import { buildStructure, compactBoxes } from "./convert";
import { parseTerms } from "./parse";

describe("compactBoxes — 쓰지 않는 박스를 빼고 코드를 다시 매긴다", () => {
  it("보통약관 쪽(`front`)이 놓는 박스가 앞 코드 — 보통약관 자리는 사라지고 뒤 특약만 쓰는 박스는 뒤로 간다", () => {
    const records = ["BX000001", "BX000002", "BX000003", "BX000004"].map((code) => ({ code, name: code }));
    const general = { kind: "boxRef", boxCode: "BX000001" };
    const special = [{ kind: "boxRef", boxCode: "BX000002" }, { kind: "boxRef", boxCode: "BX000004" }];
    const out = compactBoxes(records, [general, special], [general]);
    expect(out.map((r) => [r.name, r.code])).toEqual([
      ["BX000001", "BX000001"],
      ["BX000002", "BX000002"],
      ["BX000004", "BX000003"],
    ]);
    expect(special.map((s) => s.boxCode)).toEqual(["BX000002", "BX000003"]);
    // 보통약관 몫으로 앞에 두었다가(`plannedFront`) 보통약관이 더 쓰지 않게 된 박스는 특약 박스 뒤 맨 끝으로 — 특약 박스 코드를 밀지 않는다
    const records2 = ["a", "b", "c", "d"].map((name, i) => ({ code: `BX00000${i + 1}`, name }));
    const again = compactBoxes(records2, [{ boxCode: "BX000001" }, { boxCode: "BX000002" }, { boxCode: "BX000004" }], [{ boxCode: "BX000001" }], new Set(["BX000001", "BX000002", "BX000003"]));
    expect(again.map((r) => [r.name, r.code])).toEqual([
      ["a", "BX000001"],
      ["d", "BX000002"],
      ["b", "BX000003"],
    ]);
  });
});

describe("buildStructure — 원문 구조 노드", () => {
  it("항 글과 첫 호 사이의 표는 호 목록 맨 앞에 선다 — 렌더 순서(항 → 표 → 호)가 원문과 같다", () => {
    const md = ["# 시험 특별약관", "", "## 제1조(정의)", "", "@ 다음 각 호의 사항을 말합니다.", "", "```표", "제목: (없음)", "|항목|", "|---|", "|검사|", "```", "", "  - 첫째", "  - 둘째", "", "@ 둘째 항", ""].join("\n");
    const built = buildStructure(parseTerms(md), "t", "시험");
    const article = built.tree.children[0] as ArticleNode;
    expect(article.children.map((c) => c.kind)).toEqual(["paragraph", "paragraph"]);
    expect((article.children[0] as ParagraphNode).items?.map((i) => i.kind)).toEqual(["table", "item", "item"]);
  });

  it("첫 항 앞의 박스(통합형 특약 「세부보장에 관한 사항」의 세부보장 머리)는 조 직속에 선다", () => {
    const md = ["# 시험 특별약관", "", "## 제3조(세부보장에 관한 사항)", "", "```용어풀이", "- 대장 양성종양진단비", "```", "", "@ 첫 항", ""].join("\n");
    const article = buildStructure(parseTerms(md), "t", "시험").tree.children[0] as ArticleNode;
    expect(article.children.map((c) => c.kind)).toEqual(["box", "paragraph"]);
  });

  it("제목만 있는 박스(줄 0)는 제목 「【…】」을 줄 하나로 — 박스 마스터는 줄이 하나 이상이다", () => {
    const md = ["# 시험 특별약관", "", "## 제1조(정의)", "", "@ 첫 항", "", "```용어풀이", "【보상기간 예시】", "```", ""].join("\n");
    const article = buildStructure(parseTerms(md), "t", "시험").tree.children[0] as ArticleNode;
    expect(article.children[1]).toMatchObject({ kind: "box", title: "", lines: ["【보상기간 예시】"] });
  });

  it("호가 없는 항 뒤의 표는 조 직속 그대로", () => {
    const md = ["# 시험 특별약관", "", "## 제1조(정의)", "", "@ 표를 봅니다.", "", "```표", "제목: (없음)", "|항목|", "|---|", "|검사|", "```", "", "@ 둘째 항", ""].join("\n");
    const article = buildStructure(parseTerms(md), "t", "시험").tree.children[0] as ArticleNode;
    expect(article.children.map((c) => c.kind)).toEqual(["paragraph", "table", "paragraph"]);
  });
});
