/**
 * 원문 패널의 서버 렌더 검사 — 시드에 공용조항 참조·조상 조건 블록이 없어 브라우저로는 못 보는 자리다
 * (코덱스 리뷰 2026-09-15 Important-2 · Important-3). `MasterTree.test.tsx` 와 같은 방식으로 문자열을 본다.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Clause } from "@/domain/clause";
import type { ArticleNode, CondBlockNode, InlineNode, NodeNumber } from "@/domain/document";
import type { Id } from "@/domain/types";

import { TemplateSource } from "./TemplateSource";
import type { OverrideTarget } from "./OptionOverrideForm";

const ref = (id: string): InlineNode => ({ id, kind: "clauseInlineRef", clauseCode: "C0001", options: { O01: "V01" } });
const text = (id: string, t: string): InlineNode => ({ id, kind: "text", text: t });

const clauses: Clause[] = [
  {
    mode: "inline",
    code: "C0001",
    label: "소멸",
    body: [],
    required: { discriminators: [], attributes: [] },
    options: [
      {
        code: "O01",
        label: "어조",
        order: 0,
        values: [
          { code: "V01", label: "일반", body: [], order: 0 },
          { code: "V02", label: "사망", body: [], order: 1 },
        ],
      },
    ],
  },
];

/** 네 자리(항·호·목·표 셀)에 공용조항 참조를 하나씩 둔 조. */
const article: ArticleNode = {
  id: "A1",
  kind: "article",
  title: "지급사유",
  children: [
    {
      id: "P1",
      kind: "paragraph",
      children: [text("t1", "항 본문 "), ref("R-para")],
      items: [
        {
          id: "I1",
          kind: "item",
          children: [text("t2", "호 본문 "), ref("R-item")],
          subitems: [{ id: "S1", kind: "subitem", children: [text("t3", "목 본문 "), ref("R-subitem")] }],
        },
        {
          id: "T1",
          kind: "table",
          columns: [{}],
          rows: [{ cells: [[text("t4", "셀 "), ref("R-cell")]] }],
        },
      ],
    },
  ],
};

const targets: OverrideTarget[] = ["R-para", "R-item", "R-subitem", "R-cell"].map((nodeId) => ({
  nodeId,
  clauseCode: "C0001",
  label: `제1조(지급사유) › 공용조항 소멸(C0001)`,
  options: [{ code: "O01", label: "어조", values: [{ code: "V01", label: "일반" }, { code: "V02", label: "사망" }] }],
}));

const numbers = new Map<Id, NodeNumber>([
  ["A1", { n: 1, label: "제1조" } as NodeNumber],
  ["A2", { n: 2, label: "제2조" } as NodeNumber],
]);

function boxCount(html: string): number {
  return html.split('class="ts-doc-clause-box"').length - 1;
}

describe("TemplateSource — 공용조항 옵션 박스 (Important-2)", () => {
  it("항·호·목·표 셀의 참조 넷 모두 옵션 박스를 얻는다 (같은 자리를 두 번 그리지 않는다)", () => {
    const html = renderToStaticMarkup(
      <TemplateSource
        productId="p1"
        nodes={[article]}
        numbers={numbers}
        hidden={new Set()}
        references={new Map()}
        clauses={clauses}
        overrides={[]}
        overrideTargets={targets}
        articleId="A1"
      />,
    );
    expect(boxCount(html)).toBe(4);
    // 자리마다 제 노드 id 로 저장 폼이 선다 — 박스가 있어도 target 을 못 찾으면 고를 수 없다.
    for (const nodeId of ["R-para", "R-item", "R-subitem", "R-cell"]) expect(html).toContain(`value="${nodeId}"`);
    expect(html).not.toContain("이 자리는 고를 옵션이 없다");
  });
});

describe("TemplateSource — 조를 감싼 조건 블록 (Important-3)", () => {
  const plain = (id: string, title: string): ArticleNode => ({ id, kind: "article", title, children: [] });
  const cond: CondBlockNode = {
    id: "C1",
    kind: "condBlock",
    branches: [
      { id: "B1", when: "납입면제 = 적용", children: [plain("A1", "면제")] },
      { id: "B2", children: [plain("A2", "그 밖")] },
    ],
  };

  function render(nodes: (ArticleNode | CondBlockNode)[]) {
    return renderToStaticMarkup(
      <TemplateSource
        productId="p1"
        nodes={nodes}
        numbers={numbers}
        hidden={new Set(["A2"])}
        references={new Map()}
        clauses={clauses}
        overrides={[]}
        overrideTargets={[]}
        articleId="A1"
      />,
    );
  }

  it("조건식 칩과 가지 표기를 그대로 남긴다 — 안쪽 조는 여전히 조이고, 끈 조는 흐리다", () => {
    const html = render([cond]);
    expect(html).toContain("납입면제 = 적용");
    expect(html).toContain("그 밖의 경우 (else)");
    expect(html).toContain('class="ts-doc-cond"');
    expect(html).toContain('class="ts-doc-cond is-alt"');
    expect(html).toContain('id="art-A1"');
    expect(html).toContain('id="art-A2"');
    expect(html).toContain("노출 끔");
    expect(html).toContain("is-hidden-article");
  });

  it("조가 하나도 없는 관은 한 줄 안내", () => {
    expect(render([])).toContain("이 관에는 조가 없다");
  });
});
