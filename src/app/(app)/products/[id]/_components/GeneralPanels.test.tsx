/**
 * 보통약관 세 패널의 목차 — 누르면 **서버를 다시 부르지 않고** 관을 바꾼다 (2026-09-28 사용자 QA:
 * 목차 클릭이 `?tab=…&art=` 로 페이지를 새로 받아 화면이 번쩍였다).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { GeneralPanels, paneOf, type GeneralPane } from "./GeneralPanels";
import type { TocSection } from "./GeneralToc";
import { selectArticleOnClick, type TocClickEvent } from "./tocNav";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));
vi.mock("../../actions", () => ({ setArticleHiddenAction: async () => ({ ok: true }) }));

const click = (over: Partial<TocClickEvent> = {}): TocClickEvent & { prevented: boolean } => {
  const e: TocClickEvent & { prevented: boolean } = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    prevented: false,
    preventDefault: () => {
      e.prevented = true;
    },
    ...over,
  };
  return e;
};

describe("selectArticleOnClick — 목차 누름은 이동이 아니라 고르기", () => {
  it("보통 누름 — 브라우저 이동을 막고, 조를 고르고, 주소만 replaceState 로 맞춘다", () => {
    const e = click();
    const select = vi.fn();
    const history = { replaceState: vi.fn() };
    expect(selectArticleOnClick(e, "/products/p1?tab=terms&art=A2", select, history)).toBe(true);
    expect(e.prevented).toBe(true);
    expect(select).toHaveBeenCalledOnce();
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/products/p1?tab=terms&art=A2");
  });

  it("새 탭 · 새 창(수정키 · 가운데 단추)은 브라우저에 맡긴다", () => {
    for (const over of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      const e = click(over);
      const select = vi.fn();
      const history = { replaceState: vi.fn() };
      expect(selectArticleOnClick(e, "/x", select, history)).toBe(false);
      expect(e.prevented).toBe(false);
      expect(select).not.toHaveBeenCalled();
      expect(history.replaceState).not.toHaveBeenCalled();
    }
  });
});

const toc: TocSection[] = [
  { key: "S1", label: "제1관 목적", articles: [{ id: "A1", label: "제1조(목적)", hidden: false }] },
  { key: "S2", label: "제2관 보험금", articles: [{ id: "A2", label: "제2조(지급사유)", hidden: true }, { id: "A3", label: "제3조(지급제한)", hidden: false }] },
];
const panes: GeneralPane[] = [
  { key: "S1", label: "제1관 목적", articleIds: ["A1"], center: <p>원문-관1</p>, right: <p>결과-관1</p> },
  { key: "S2", label: "제2관 보험금", articleIds: ["A2", "A3"], center: <p>원문-관2</p>, right: <p>결과-관2</p> },
];

describe("GeneralPanels — 관은 미리 그려 두고 고른 조의 관만 붙인다", () => {
  it("고른 조의 관 하나만 가운데 · 오른쪽에 — 다른 관은 DOM 에 없다", () => {
    const html = renderToStaticMarkup(<GeneralPanels productId="p1" toc={toc} panes={panes} initialArticleId="A3" />);
    expect(html).toContain("원문-관2");
    expect(html).toContain("결과-관2");
    expect(html).not.toContain("원문-관1");
    expect(html).toContain("약관 — 제2관 보험금 (원문)");
    expect(html).toContain("미리보기 — 제2관 보험금 (평가)");
  });

  it("목차 조 제목은 진짜 주소를 가진 평범한 링크(서버 이동 없이 가로챈다) · 고른 조에 aria-current", () => {
    const html = renderToStaticMarkup(<GeneralPanels productId="p1" toc={toc} panes={panes} initialArticleId="A3" />);
    expect(html).toMatch(/<a href="\/products\/p1\?tab=[^"]*art=A3"[^>]*aria-current="true"/);
    expect(html).toMatch(/<a href="\/products\/p1\?tab=[^"]*art=A1"/);
    expect(html).toContain("is-hidden-article");
  });

  it("paneOf — 없는 조 · 좌표 없음은 조가 있는 첫 관", () => {
    expect(paneOf(panes, "A2")?.key).toBe("S2");
    expect(paneOf(panes, "없는조")?.key).toBe("S1");
    expect(paneOf(panes, undefined)?.key).toBe("S1");
  });
});
