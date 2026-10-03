/**
 * 원문 패널의 서버 렌더 검사 — 시드에 함수조항 참조·조상 조건 블록이 없어 브라우저로는 못 보는 자리다
 * (코덱스 리뷰 2026-09-15 Important-2 · Important-3). `MasterTree.test.tsx` 와 같은 방식으로 문자열을 본다.
 */
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }) }));
vi.mock("../../actions", () => ({ saveProductGeneralAction: async () => ({ ok: true }) }));

import type { Clause } from "@/domain/clause";
import { clauseSpanBy, numberTree, type ArticleNode, type CondBlockNode, type DocumentNode, type InlineNode, type NodeNumber } from "@/domain/document";
import type { Id } from "@/domain/types";

import { GeneralEditProvider, type OverrideTarget } from "./GeneralEdit";
import { ProductEditProvider } from "./ProductEdit";
import { TemplateSource } from "./TemplateSource";

/** 보통약관 탭의 편집 상태 안에서 — `editing` 이면 편집 모드로 시작한다. */
function inTab(editing: boolean, node: ReactNode, overrides: Parameters<typeof GeneralEditProvider>[0]["overrides"] = [], hidden: string[] = []) {
  return (
    <ProductEditProvider canEdit initialEditing={editing}>
      <GeneralEditProvider productId="p1" generalDocumentId="doc" hiddenArticles={hidden} overrides={overrides}>
        {node}
      </GeneralEditProvider>
    </ProductEditProvider>
  );
}

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

/** 네 자리(항·호·목·표 셀)에 함수조항 참조를 하나씩 둔 조. */
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
  label: `제1조(지급사유) › 함수조항 소멸(C0001)`,
  options: [{ code: "O01", label: "어조", values: [{ code: "V01", label: "일반" }, { code: "V02", label: "사망" }] }],
}));

const numbers = new Map<Id, NodeNumber>([
  ["A1", { n: 1, label: "제1조" } as NodeNumber],
  ["A2", { n: 2, label: "제2조" } as NodeNumber],
]);

function boxCount(html: string): number {
  return html.split("data-clause-box=").length - 1;
}

describe("TemplateSource — 함수조항 옵션 박스 (Important-2)", () => {
  const source = (
    <TemplateSource productId="p1" nodes={[article]} numbers={numbers} hidden={new Set()} references={new Map()} clauses={clauses} overrides={[]} overrideTargets={targets} />
  );

  it("편집 — 항·호·목·표 셀의 참조 넷 모두 상자 안에 옵션 고르기(같은 자리를 두 번 그리지 않는다)", () => {
    const html = renderToStaticMarkup(inTab(true, source));
    expect(boxCount(html)).toBe(4);
    expect(html.split("<select").length - 1).toBe(4);
    expect(html).toContain("— 마스터 기본(일반) —");
    expect(html).not.toContain("이 자리는 고를 옵션이 없다");
    // 저장은 탭 첫 줄의 저장 한 번 — 상자마다의 폼 · 저장 버튼은 없다 (기능/상품 §3.8)
    expect(html).not.toContain("<form");
    expect(html).not.toContain("오버라이드 저장");
  });

  it("읽기 — 고르기 · 되돌리기 없이 선택을 글로만 (마스터 기본 · 이 상품)", () => {
    const html = renderToStaticMarkup(inTab(false, source, [{ id: "o", scope: { kind: "product", id: "p1" }, nodeId: "R-para", clauseCode: "C0001", options: { O01: "V02" } }]));
    expect(boxCount(html)).toBe(4);
    expect(html).not.toContain("<select");
    expect(html).not.toContain("<button");
    expect(html).toContain("마스터 기본 — 어조: 일반");
    expect(html).toContain("이 상품 — 어조: 사망");
  });

  it("편집 — 오버라이드가 있는 자리에만 ↺ 되돌리기(버튼, 폼 아님)", () => {
    const html = renderToStaticMarkup(inTab(true, source, [{ id: "o", scope: { kind: "product", id: "p1" }, nodeId: "R-item", clauseCode: "C0001", options: { O01: "V02" } }]));
    expect(html.match(/aria-label="마스터 기본으로 되돌리기 · 소멸"/g)).toHaveLength(1);
    expect(html).toMatch(/<option value="V02" selected="">사망<\/option>/);
  });
});

describe("TemplateSource — 함수조항 상자 안에 모델을 편다 (2026-09-28)", () => {
  const blockClause: Clause = {
    mode: "block",
    code: "C0002",
    label: "대표자의 지정",
    required: { discriminators: [], attributes: [] },
    options: [
      {
        code: "O01",
        label: "지정 주체",
        order: 0,
        values: [
          { code: "V01", label: "계약자", body: [], order: 0 },
          { code: "V02", label: "피보험자", body: [], order: 1 },
        ],
      },
    ],
    body: [
      { id: "cp1", kind: "paragraph", children: [{ id: "o", kind: "optionSlot", optionCode: "O01" }, { id: "ct", kind: "text", text: " 대표자를 지정합니다 " }, { id: "s", kind: "slot", ref: "D0001" }] },
      { id: "cc", kind: "condBlock", branches: [{ id: "cb", when: "D0001 = '입원'", children: [{ id: "cp2", kind: "paragraph", children: [{ id: "ct2", kind: "text", text: "입원 조건 항" }] }] }] },
    ],
  };
  const host: ArticleNode = { id: "A1", kind: "article", title: "대표자", children: [{ id: "R1", kind: "clauseBlockRef", clauseCode: "C0002", options: { O01: "V01" } }] };

  it("머리 띠 「[코드] 이름」(함수조항 화면 링크 없음) · 슬롯 · 옵션 자리(고른 것 ✓) · 조건 · 오버라이드가 모델에 반영", () => {
    const html = renderToStaticMarkup(
      <TemplateSource
        productId="p1"
        nodes={[host]}
        numbers={numbers}
        hidden={new Set()}
        references={new Map()}
        clauses={[blockClause]}
        overrides={[{ id: "ov1", scope: { kind: "product", id: "p1" }, nodeId: "R1", clauseCode: "C0002", options: { O01: "V02" } }]}
        overrideTargets={[]}
        discriminators={[{ code: "D0001", label: "담보명" }]}
      />,
    );
    expect(html).toContain('class="ts-doc-clause-head"');
    expect(html).toContain('<span class="ts-doc-clause-code">[C0002]</span> 대표자의 지정');
    expect(html).not.toContain('href="/functions/C0002"');
    expect(html).not.toContain("함수조항에서 고치기");
    expect(html).toContain("대표자를 지정합니다");
    expect(html).toContain("〔담보명〕");
    expect(html).toContain('<span class="ts-cond-badge">IF</span> 담보명 = &#x27;입원&#x27;');
    // 이 상품의 오버라이드(피보험자)가 모델의 고른 선택지다
    expect(html).toContain("✓피보험자");
    expect(html).toContain("오버라이드");
    expect(html).toContain("마스터 기본 — 지정 주체: 계약자");
  });
});

describe("TemplateSource — 읽기 전용 (특별약관 탭 가운데, 2026-10-03)", () => {
  it("모델은 그대로, 옵션 선택 · 되돌리기 · 오버라이드 배지는 없다", () => {
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
        readOnly
      />,
    );
    expect(boxCount(html)).toBe(4);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("마스터 기본");
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

describe("TemplateSource — 인자 있는 함수조항 상자는 접힌다 (최종 결정 8)", () => {
  const waiver: Clause = {
    mode: "block",
    code: "C0200",
    label: "납입면제 사유",
    required: { discriminators: [], attributes: [] },
    options: [],
    params: [{ name: "사유", type: { kind: "enum", enumCode: "E0001" }, default: { kind: "discriminator", code: "D0009" } }],
    body: [
      {
        id: "sw",
        kind: "switchBlock",
        on: "arg.사유",
        cases: [
          { id: "k1", values: ["V01"], children: [{ id: "p1", kind: "paragraph", children: [{ id: "t1", kind: "text", text: "질병 항" }] }] },
          { id: "k2", values: ["V02"], children: [{ id: "p2", kind: "paragraph", children: [{ id: "t2", kind: "text", text: "상해 항" }] }] },
        ],
      },
    ],
  };
  const host: ArticleNode = { id: "A9", kind: "article", title: "납입면제", children: [{ id: "CB1", kind: "clauseBlockRef", clauseCode: "C0200", options: {} }] };

  it("머리 줄 「인자 ← 연결(기본)」 · 칸 머리 = 값 이름 · 칸은 접힌 <details> (묶음 = 상자 id)", () => {
    const html = renderToStaticMarkup(
      <TemplateSource
        productId="p1"
        nodes={[host]}
        numbers={numbers}
        hidden={new Set()}
        references={new Map()}
        clauses={[waiver]}
        overrides={[]}
        overrideTargets={[]}
        discriminators={[{ code: "D0009", label: "납입면제사유" }]}
        enums={[{ code: "E0001", label: "납입면제사유", values: [{ code: "V01", label: "질병", order: 0 }, { code: "V02", label: "상해", order: 1 }] }]}
      />,
    );
    expect(html).toContain("인자: 사유 ← 납입면제사유(기본)");
    expect(html).toMatch(/<summary[^>]*>.*질병.*<\/summary>/);
    expect(html).toContain('name="CB1:sw"');
  });
});

describe("TemplateSource — 함수조항 자리의 번호 (2026-10-03 사용자 QA)", () => {
  const base = { required: { discriminators: [], attributes: [] }, options: [] };
  const para = (id: string, t: string) => ({ id, kind: "paragraph" as const, children: [{ id: `${id}t`, kind: "text" as const, text: t }] });
  const item = (id: string) => ({ id, kind: "item" as const, children: [] });
  const sub = (id: string) => ({ id, kind: "subitem" as const, children: [] });
  const twoParas: Clause = { ...base, code: "C0013", label: "약관의 해석", mode: "block", body: [para("q1", "회사는 약관의 뜻이"), para("q2", "회사는 보험금을")] };
  const twoItems: Clause = { ...base, code: "C0200", label: "사유 호", mode: "item", body: [item("ci1"), item("ci2")] };
  const twoSubs: Clause = { ...base, code: "C0300", label: "사유 목", mode: "subitem", body: [sub("cs1"), sub("cs2")] };
  const all = [twoParas, twoItems, twoSubs];
  const render = (article: ArticleNode) => {
    const tree: DocumentNode = { id: "d", kind: "document", title: "", children: [article] };
    const numbers = numberTree(tree, { clauseSpan: clauseSpanBy((code) => all.find((c) => c.code === code)) });
    return renderToStaticMarkup(<TemplateSource productId="p1" nodes={[article]} numbers={numbers} hidden={new Set()} references={new Map()} clauses={all} overrides={[]} overrideTargets={[]} />);
  };
  const nums = (html: string) => [...html.matchAll(/<span class="ts-doc-num">([^<]*?) ?<\/span>/g)].map((m) => m[1]);

  it("항 — 자리 번호 ②는 찍지 않고, 함수조항 안이 ②③, 뒤 항이 ④", () => {
    const html = render({ id: "A1", kind: "article", title: "약관의 해석", children: [para("h1", "앞 항"), { id: "K", kind: "clauseBlockRef", clauseCode: "C0013", options: {} }, para("h2", "뒤 항")] });
    expect(nums(html)).toEqual(["①", "②", "③", "④"]);
  });

  it("호 — 함수조항 자리 <li> 가 호 2개만큼 세고, 안 목록은 2.부터", () => {
    const html = render({ id: "A1", kind: "article", title: "조", children: [{ id: "P", kind: "paragraph", children: [], items: [item("h1"), { id: "K", kind: "clauseBlockRef", clauseCode: "C0200", options: {} }, item("h2")] }] });
    expect(html).toContain('<li class="ts-doc-static-item" style="counter-increment:ts-doc-item 2">');
    expect(html).toContain('<ol class="ts-doc-items" style="counter-reset:ts-doc-item 1">');
  });

  it("목 — 함수조항 자리 <li> 가 목 2개만큼 세고, 안 목록은 나.부터", () => {
    const html = render({ id: "A1", kind: "article", title: "조", children: [{ id: "P", kind: "paragraph", children: [], items: [{ id: "I", kind: "item", children: [], subitems: [sub("s1"), { id: "K", kind: "clauseBlockRef", clauseCode: "C0300", options: {} } as unknown as ReturnType<typeof sub>, sub("s2")] }] }] });
    expect(html).toContain('<li class="ts-doc-static-item" style="counter-increment:ts-doc-subitem 2">');
    expect(html).toContain('<ol class="ts-doc-subitems" style="counter-reset:ts-doc-subitem 1">');
  });
});
