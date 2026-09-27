import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { indexTree, nodeBuilders, sequentialIds } from "@/domain/document";

import { EditorToolbar } from "./EditorToolbar";
import { placeMenu } from "./menus";
import { DOCUMENT_TOOLS, allTools } from "./tools";

function sections() {
  const b = nodeBuilders(sequentialIds("n"));
  const p = b.paragraph([b.text("항")]);
  const tree = b.document("D", [b.article("가", [p])]);
  return { sections: placeMenu({ tree, ix: indexTree(tree), docKind: "general", newId: sequentialIds("m") }, { kind: "block", id: p.id }), p };
}

const buttons = (html: string) => [...html.matchAll(/<button[^>]*data-tool="([^"]+)"[^>]*>/g)].map((m) => ({ id: m[1], disabled: / disabled=""/.test(m[0]) }));

describe("EditorToolbar — 본문 위 버튼 줄 (기능/문면 §4.3)", () => {
  it("모든 도구를 버튼으로 그린다 — 묶음마다 role=group, 툴바는 role=toolbar", () => {
    const html = renderToStaticMarkup(<EditorToolbar groups={DOCUMENT_TOOLS} sections={sections().sections} editing onRun={() => undefined} where="항" />);
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('aria-label="약관 편집 도구"');
    expect(buttons(html).map((b) => b.id)).toEqual(allTools(DOCUMENT_TOOLS).map((t) => t.id));
    for (const g of DOCUMENT_TOOLS) expect(html).toContain(`role="group" aria-label="${g.name}"`);
    expect(html).toContain("자리 — 항");
  });

  it("켜짐은 자리대로 — 항이면 조건식 · 항 · 호가 켜지고 가지 추가는 잠긴다", () => {
    const html = renderToStaticMarkup(<EditorToolbar groups={DOCUMENT_TOOLS} sections={sections().sections} editing onRun={() => undefined} />);
    const state = Object.fromEntries(buttons(html).map((b) => [b.id, b.disabled]));
    expect(state).toMatchObject({ cond: false, paragraph: false, item: false, elif: true, else: true, article: true });
    expect(html).toMatch(/class="ts-tool is-cond"[^>]*data-tool="cond"/);
  });

  it("편집 중이 아니면 전부 잠긴다", () => {
    const html = renderToStaticMarkup(<EditorToolbar groups={DOCUMENT_TOOLS} sections={sections().sections} editing={false} onRun={() => undefined} />);
    expect(buttons(html).every((b) => b.disabled)).toBe(true);
  });
});
