import { describe, expect, it } from "vitest";

import type { RArticle, RParagraph, SInline, SubstitutedDoc } from "./types";
import { replaceGeneralWithBase } from "./base";

const p = (id: string, text: string): RParagraph<SInline> => ({ kind: "paragraph", id, children: [{ kind: "text", id: `${id}-t`, text }] });
const a = (id: string, title: string, text: string, linkedArticleId?: string): RArticle<SInline> => ({
  kind: "article",
  id,
  title,
  children: [p(`${id}-p`, text)],
  ...(linkedArticleId ? { linkedArticleId } : {}),
});
const d = (id: string, children: RArticle<SInline>[]): SubstitutedDoc => ({ kind: "document", id, title: id, children });

describe("3차 S4 — 기본계약 1개 모드 대치", () => {
  it("조연결된 기본계약 조의 결과 본문을 대응 보통약관 조 자리에 대치한다", () => {
    const general = d("g", [a("g-pay", "보험금의 지급사유", "")]);
    const base = d("b", [a("b-pay", "기본계약 지급사유", "기본계약 본문", "g-pay")]);
    const out = replaceGeneralWithBase(general, base, { productCoverageId: "pc-base", productCoverageName: "상해사망(기본계약)" });
    expect(out.doc.children[0]).toMatchObject({ id: "g-pay", title: "보험금의 지급사유", children: [{ children: [{ text: "기본계약 본문" }] }] });
    expect(out.issues).toEqual([]);
  });

  it("조연결 없는 기본계약 조는 대치하지 않고 warning으로 남긴다", () => {
    const out = replaceGeneralWithBase(d("g", []), d("b", [a("b-extra", "독자 조", "본문")]), { productCoverageId: "pc-base", productCoverageName: "상해사망(기본계약)" });
    expect(out.doc.children).toEqual([]);
    expect(out.issues).toEqual([
      expect.objectContaining({ kind: "unlinkedBaseArticle", severity: "warning", at: expect.objectContaining({ document: "special", ownerId: "pc-base", articleId: "b-extra" }) }),
    ]);
  });
});

describe("기본계약 대치 조의 반복 묶음 — 원형 열쇠 · 묶음 열쇠 · 반복 코드도 기본계약 조 앞마디로 (기능/문면 §3.7)", () => {
  /** 기본계약 조: 반복 블록 P0100(종마다)이 낸 항 P0200@o1 · P0200@o2, 그 뒤 항 P0300. */
  const build = () => {
    const loop = (element: string) => [{ loop: "f", element, kind: "planOption" as const }];
    const para = (id: string, key: string, extra: Partial<RParagraph<SInline>> = {}): RParagraph<SInline> => ({ kind: "paragraph", id, key, children: [{ kind: "text", id: `${id}-t`, text: id }], ...extra });
    const baseArticle: RArticle<SInline> = {
      kind: "article",
      id: "b-pay",
      title: "기본계약 지급사유",
      linkedArticleId: "g-pay",
      children: [para("p@o1", "P0200@o1", { loops: loop("o1"), groups: ["P0100"] }), para("p@o2", "P0200@o2", { loops: loop("o2"), groups: ["P0100"] }), para("q", "P0300")],
      repeatKeys: ["P0100", "P0200"],
    };
    const general = d("g", [{ kind: "article", id: "g-pay", title: "보험금의 지급사유", children: [p("g-p", "보통약관"), { ...p("g-p2", "x"), key: "P0100" }], repeatKeys: ["P0900"] }]);
    return replaceGeneralWithBase(general, d("b", [baseArticle]), { productCoverageId: "pc-base", productCoverageName: "상해사망(기본계약)" });
  };

  it("원형 열쇠(복제 접미사 뗀 것)와 반복 묶음 열쇠에도 별칭을 만든다 — 기본계약 문면의 반복 안 대상 · 반복 블록 참조가 풀린다", () => {
    const { aliases } = build();
    expect(aliases.get("b-pay#P0200@o1")).toBe("g-pay#b-pay:P0200@o1");
    expect(aliases.get("b-pay#P0200")).toBe("g-pay#b-pay:P0200");
    expect(aliases.get("b-pay#P0100")).toBe("g-pay#b-pay:P0100");
    expect(aliases.get("b-pay#P0300")).toBe("g-pay#b-pay:P0300");
  });

  it("대치된 본문의 묶음 열쇠 · 반복 코드도 앞마디를 붙인다 — 보통약관 쪽 같은 코드(P0100)와 섞이지 않고, 원소 0개 판정이 기본계약 반복을 안다", () => {
    const { doc } = build();
    const art = doc.children[0] as RArticle<SInline>;
    expect(art.children.map((c) => (c as RParagraph<SInline>).groups)).toEqual([["b-pay:P0100"], ["b-pay:P0100"], undefined]);
    expect(art.repeatKeys).toEqual(["b-pay:P0100", "b-pay:P0200"]);
  });
});
