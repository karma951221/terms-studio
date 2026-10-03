/**
 * 보통약관 탭의 조 사본 (ADR-0079 · 기능/상품 §4.6) — 편집은 목차 + 조 편집 두 패널(미리보기 없음), 목차의 빨강 · 노랑 점,
 * 템플릿이 바뀐 뒤의 경고 한 줄.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ArticleNode, DocumentNode } from "@/domain/document";
import { articleHash, type ArticleCopy } from "@/domain/product";

import type { CopyEditorData } from "./ArticleCopyEditor";
import { GeneralEditProvider } from "./GeneralEdit";
import { GeneralPanels, type GeneralPane } from "./GeneralPanels";
import { GeneralTemplateLine } from "./GeneralTemplateLine";
import type { TocSection } from "./GeneralToc";
import { ProductEditProvider } from "./ProductEdit";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined }) }));
vi.mock("../../actions", () => ({ saveProductGeneralAction: async () => ({ ok: true }), setProductGeneralDocumentAction: async () => undefined }));

const art = (id: string, title: string, body: string): ArticleNode => ({ id, kind: "article", title, children: [{ id: `${id}-p`, kind: "paragraph", children: [{ id: `${id}-t`, kind: "text", text: body }] }] });
const template: DocumentNode = {
  id: "g",
  kind: "document",
  title: "보통약관",
  children: [
    { id: "S1", kind: "section", title: "목적", children: [art("A1", "목적", "템플릿 A1")] },
    { id: "S2", kind: "section", title: "보험금", children: [art("A2", "지급사유", "템플릿 A2 본문"), art("A3", "지급제한", "템플릿 A3")] },
  ],
};
const hashOf = (id: string) => articleHash((template.children.flatMap((s) => (s.kind === "section" ? s.children : [])) as ArticleNode[]).find((a) => a.id === id)!);

const toc: TocSection[] = [
  { key: "S1", label: "제1관 목적", articles: [{ id: "A1", label: "제1조(목적)", number: "제1조", templateTitle: "목적", hidden: false, templateHash: hashOf("A1") }] },
  {
    key: "S2",
    label: "제2관 보험금",
    articles: [
      { id: "A2", label: "제2조(지급사유)", number: "제2조", templateTitle: "지급사유", hidden: false, templateHash: hashOf("A2") },
      { id: "A3", label: "제3조(지급제한)", number: "제3조", templateTitle: "지급제한", hidden: false, templateHash: hashOf("A3") },
    ],
  },
];
const panes: GeneralPane[] = [
  { key: "S1", label: "제1관 목적", articleIds: ["A1"], center: <p>원문-관1</p>, right: <p>결과-관1</p> },
  { key: "S2", label: "제2관 보험금", articleIds: ["A2", "A3"], center: <p>원문-관2</p>, right: <p>결과-관2</p> },
];
const data: CopyEditorData = {
  templateId: "g",
  template,
  appendices: [],
  boxes: [],
  clauses: [],
  discriminators: [],
  enums: [],
  condition: { discriminators: [], openedForms: {}, quick: [] },
};
/** A1 은 사본(템플릿 그대로의 지문), A2 는 템플릿이 바뀐 뒤의 사본(옛 지문). */
const copies: ArticleCopy[] = [
  { articleId: "A1", article: art("A1", "목적", "이 상품 A1"), templateHash: hashOf("A1") },
  { articleId: "A2", article: art("A2", "지급사유", "이 상품 A2 본문"), templateHash: "옛지문" },
];

function render(editing: boolean, articleId: string, editor: CopyEditorData = data) {
  return renderToStaticMarkup(
    <ProductEditProvider canEdit initialEditing={editing}>
      <GeneralEditProvider productId="p1" generalDocumentId="g" templateVersion={4} hiddenArticles={[]} overrides={[]} copies={copies}>
        <GeneralPanels productId="p1" toc={toc} panes={panes} initialArticleId={articleId} copyEditor={editor} />
      </GeneralEditProvider>
    </ProductEditProvider>,
  );
}

describe("편집 — 목차 + 조 편집 두 패널", () => {
  it("미리보기 · 모델링 패널이 없고, 고른 조 하나를 문면 편집기 툴바와 함께 연다", () => {
    const html = render(true, "A3");
    expect(html).not.toContain('aria-label="미리보기"');
    expect(html).not.toContain('aria-label="모델링"');
    expect(html).not.toContain("원문-관2");
    expect(html.match(/<section class="ts-terms-panel[^"]*" aria-label="[^"]+"/g)?.map((s) => s.replace(/.*aria-label="/, "").replace('"', ""))).toEqual(["목차", "조 편집"]);
    expect(html).toContain(">조 편집 — 제3조(지급제한)</h3>");
    expect(html).toContain("ts-doc-toolbar"); // 문면 편집기 툴바(항 · 호 · 목 · 조건 · 참조 …)
    expect(html).toContain(">항</button>");
    expect(html).toContain("템플릿 A3"); // 그 조 본문만
    expect(html).not.toContain("템플릿 A1");
    expect(html).toContain("ts-terms-panels is-editing");
  });

  it("템플릿이 바뀐 사본을 열면 「템플릿 현재 본문」 · 「이 상품 본문」을 나란히, 되돌리기 · 사본 유지 둘", () => {
    const html = render(true, "A2");
    expect(html).toContain('aria-label="템플릿 현재 본문"');
    expect(html).toContain('aria-label="이 상품 본문"');
    expect(html).toContain("템플릿 A2 본문");
    expect(html).toContain("이 상품 A2 본문");
    expect(html).toContain(">템플릿대로 되돌리기</button>");
    expect(html).toContain(">사본 유지</button>");
  });

  it("바뀌지 않은 사본은 나란히 보지 않고 「템플릿대로 되돌리기」만", () => {
    const html = render(true, "A1");
    expect(html).not.toContain('aria-label="템플릿 현재 본문"');
    expect(html).toContain(">템플릿대로 되돌리기</button>");
    expect(html).not.toContain(">사본 유지</button>");
    expect(html).toContain("이 상품 A1");
  });
});

describe("기본계약 대치 자리 (ADR-0021) — 조립에는 기본계약 조가 찍힌다", () => {
  it("기본계약 조가 조연결된 조를 열면 고친 본문이 조립에 나오지 않는다고 말한다", () => {
    const html = render(true, "A3", { ...data, replacedBy: { A3: "상해사망(기본계약)" } });
    expect(html).toContain("기본계약 「상해사망(기본계약)」의 조로 대치된다");
    expect(render(true, "A1", { ...data, replacedBy: { A3: "상해사망(기본계약)" } })).not.toContain("대치된다");
  });
});

describe("목차의 점 — 빨강 = 이 상품 사본 · 노랑 = 템플릿이 바뀜 (읽기 · 편집 모두)", () => {
  for (const editing of [false, true]) {
    it(editing ? "편집" : "읽기", () => {
      const html = render(editing, "A3");
      expect(html).toMatch(/<span class="ts-copy-dot" role="img" aria-label="이 상품 사본 · 제1조\(목적\)"/);
      expect(html).toMatch(/<span class="ts-copy-dot" role="img" aria-label="이 상품 사본 · 제2조\(지급사유\)"/);
      expect(html).toMatch(/<span class="ts-copy-dot is-stale" role="img" aria-label="템플릿이 바뀜 · 제2조\(지급사유\)"/);
      expect(html.match(/ts-copy-dot/g)).toHaveLength(3); // A3 은 템플릿 그대로 — 점 없음
    });
  }

  it("읽기는 세 패널 그대로", () => {
    const html = render(false, "A3");
    for (const label of ["목차", "모델링", "미리보기"]) expect(html).toContain(`aria-label="${label}"`);
  });
});

describe("템플릿이 바뀐 뒤 — 템플릿 줄 아래 경고 한 줄", () => {
  const line = (templateChanged: boolean) =>
    renderToStaticMarkup(
      <ProductEditProvider canEdit>
        <GeneralTemplateLine productId="p1" generalDocumentId="g" templateTitle="보통약관" generals={[{ id: "g", title: "보통약관" }]} templateChanged={templateChanged} />
      </ProductEditProvider>,
    );
  it("기준 판보다 템플릿 판이 크면 선다 · 아니면 없다", () => {
    expect(line(true)).toContain("보통약관 템플릿이 바뀌었습니다 — 새로 추가된 조 등을 확인하세요");
    expect(line(false)).not.toContain("템플릿이 바뀌었습니다");
  });
});
