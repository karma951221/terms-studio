/**
 * 깨지는 참조 (ADR-0081 결정 2 · 기능/상품 §4.6) — 사본 편집 · 노출 끔으로 다른 조의 참조가 깨지면 조 편집 패널 위에 목록 ·
 * 〔고치러 가기〕, 가리키는 조의 목차 줄 아래에도 붙는다(읽기 · 편집 모두). 하나라도 남으면 `저장`은 서버에 가지 않고 거부된다.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ArticleNode, DocumentNode } from "@/domain/document";
import { articleHash, type ArticleCopy, type GeneralDependents } from "@/domain/product";

import type { CopyEditorData } from "./ArticleCopyEditor";
import { GeneralEditProvider } from "./GeneralEdit";
import { GeneralPanels, type GeneralPane } from "./GeneralPanels";
import type { TocSection } from "./GeneralToc";
import { refBreakRefusal } from "./generalDraft";
import { ProductEditProvider } from "./ProductEdit";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined }) }));
vi.mock("../../actions", () => ({ saveProductGeneralAction: async () => ({ ok: true }), setProductGeneralDocumentAction: async () => undefined }));

const text = (id: string, t: string) => ({ id, kind: "text" as const, text: t });
/** 제1조(A1) ① ② · 제2조(A2)가 제1조 ①을 가리킨다. */
const template: DocumentNode = {
  id: "g",
  kind: "document",
  title: "보통약관",
  children: [
    {
      id: "S1",
      kind: "section",
      title: "보험금",
      children: [
        { id: "A1", kind: "article", title: "지급사유", children: [{ id: "A1-1", kind: "paragraph", code: "P0100", children: [text("A1-1t", "첫 항")] }, { id: "A1-2", kind: "paragraph", code: "P0200", children: [text("A1-2t", "둘째 항")] }] },
        { id: "A2", kind: "article", title: "지급제한", children: [{ id: "A2-1", kind: "paragraph", code: "P0100", children: [text("A2-t", "제1조 제1항에 따라"), { id: "R2", kind: "articleRef", scope: "self", targets: [{ articleId: "A1", code: "P0100" }] }] }] },
      ],
    },
  ],
};
const a1 = (template.children[0] as { children: ArticleNode[] }).children[0];
/** 제1조 사본 — ①을 지웠다. */
const copies: ArticleCopy[] = [{ articleId: "A1", article: { ...a1, children: [a1.children[1]] }, templateHash: articleHash(a1) }];
const toc: TocSection[] = [
  {
    key: "S1",
    label: "제1관 보험금",
    articles: [
      { id: "A1", label: "제1조(지급사유)", number: "제1조", templateTitle: "지급사유", hidden: false, templateHash: articleHash(a1) },
      { id: "A2", label: "제2조(지급제한)", number: "제2조", templateTitle: "지급제한", hidden: false, templateHash: "x" },
    ],
  },
];
const panes: GeneralPane[] = [{ key: "S1", label: "제1관 보험금", articleIds: ["A1", "A2"], center: <p>원문</p>, right: <p>결과</p> }];
const data: CopyEditorData = { templateId: "g", template, appendices: [], boxes: [], clauses: [], discriminators: [], enums: [], condition: { discriminators: [], openedForms: {}, quick: [] } };

function render(editing: boolean, opts: { copies?: ArticleCopy[]; hidden?: string[]; dependents?: GeneralDependents } = {}) {
  return renderToStaticMarkup(
    <ProductEditProvider canEdit initialEditing={editing}>
      <GeneralEditProvider productId="p1" generalDocumentId="g" hiddenArticles={opts.hidden ?? []} overrides={[]} copies={opts.copies ?? []} template={template} {...(opts.dependents ? { dependents: opts.dependents } : {})}>
        <GeneralPanels productId="p1" toc={toc} panes={panes} initialArticleId="A1" copyEditor={data} />
      </GeneralEditProvider>
    </ProductEditProvider>,
  );
}

describe("조 편집 패널 위 「깨지는 참조」 목록", () => {
  it("사본에서 지운 항을 가리키는 조 — 문구 · 〔고치러 가기〕(가리키는 조로)", () => {
    const html = render(true, { copies });
    expect(html).toContain('aria-label="깨지는 참조"');
    expect(html).toContain("제2조 — 지운 제1조 ①을 가리킴");
    expect(html).toMatch(/<a[^>]*href="\/products\/p1\?tab=general&amp;art=A2"[^>]*>고치러 가기<\/a>/);
  });

  it("노출 끈 조를 가리키는 참조도 같은 목록", () => {
    expect(render(true, { hidden: ["A1"] })).toContain("제2조 — 노출 끈 제1조 ①을 가리킴");
  });

  it("담보약관의 참조는 원인 조로 안내한다", () => {
    const dependents: GeneralDependents = { documents: [{ coverageId: "c", clauseCodes: [], refs: [{ key: "A1#P0100", articleId: "A1", at: { document: "special" }, where: "담보약관 「암」 보험금" }] }], clauses: [] };
    const html = render(true, { copies, dependents });
    expect(html).toContain("담보약관 「암」 보험금 — 지운 제1조 ①을 가리킴");
    expect(html).toMatch(/href="\/products\/p1\?tab=general&amp;art=A1"[^>]*>고치러 가기/);
  });

  it("깨짐이 없으면 목록이 없다", () => {
    expect(render(true)).not.toContain('aria-label="깨지는 참조"');
  });
});

describe("가리키는 조의 목차 줄 — 읽기 · 편집 모두 (템플릿이 바뀌어 깨진 상품도 읽기에서 보인다)", () => {
  for (const editing of [false, true]) {
    it(editing ? "편집" : "읽기", () => {
      const html = render(editing, { copies });
      const row = html.match(/<div id="toc-A2"[\s\S]*?<\/div>/)?.[0] ?? "";
      expect(row).toContain("ts-toc-error");
      expect(row).toContain("지운 제1조 ①을 가리킴");
    });
  }
});

describe("refBreakRefusal — 깨짐이 남으면 저장을 서버에 보내지 않는다", () => {
  it("남은 수와 고칠 곳을 말한다 · 없으면 undefined", () => {
    expect(refBreakRefusal([])).toBeUndefined();
    expect(refBreakRefusal([{ kind: "brokenRef", message: "m", at: {} }, { kind: "brokenRef", message: "n", at: {} }])).toBe("참조가 깨진 곳 2 — 조 편집 위 「깨지는 참조」 목록에서 고친 뒤 저장한다.");
  });
});
