import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { indexTree, nodeBuilders, sequentialIds } from "@/domain/document";

import { EditorToolbar } from "./EditorToolbar";
import { placeMenu } from "./menus";
import { DOCUMENT_TOOLS, allTools, onBar, toolState } from "./tools";

function sections() {
  const b = nodeBuilders(sequentialIds("n"));
  const p = b.paragraph([b.text("항")]);
  const tree = b.document("D", [b.article("가", [p])]);
  return { sections: placeMenu({ tree, ix: indexTree(tree), docKind: "general", newId: sequentialIds("m") }, { kind: "block", id: p.id }), p };
}

const buttons = (html: string) => [...html.matchAll(/<button[^>]*data-tool="([^"]+)"[^>]*>/g)].map((m) => ({ id: m[1], disabled: / disabled=""/.test(m[0]) }));

describe("EditorToolbar — 본문 위 버튼 줄 (기능/문면 §4.3, 2026-10-01 정리)", () => {
  it("툴바에 서는 도구만 그린다 — 묶음마다 role=group, 툴바는 role=toolbar, 끝에 더보기", () => {
    const html = renderToStaticMarkup(<EditorToolbar groups={DOCUMENT_TOOLS} sections={sections().sections} editing onRun={() => undefined} where="항" />);
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('aria-label="약관 편집 도구"');
    const ids = buttons(html).map((b) => b.id);
    const expected = allTools(DOCUMENT_TOOLS)
      .filter((t) => onBar(t, toolState(t, sections().sections)))
      .map((t) => t.id);
    expect(ids).toEqual([...expected, "more"]);
    // 복제 · 삭제 · 위로 · 아래로는 툴바에 없다(블록 곁 · 오른쪽 클릭 메뉴), 관은 더보기 안(닫혀 있으면 그리지 않는다)
    for (const id of ["up", "down", "duplicate", "remove", "section", "clauseInline"]) expect(ids).not.toContain(id);
    for (const g of ["구조 넣기", "문장에 넣기", "조건 넣기"]) expect(html).toContain(`role="group" aria-label="${g}"`);
    // 조건 편집 · 고른 것 속성은 항 자리에서 켜질 것이 없으니 묶음째 없다
    expect(html).not.toContain('aria-label="조건 편집"');
    expect(html).not.toContain('aria-label="고른 것 속성"');
    expect(html).toContain('aria-haspopup="menu" aria-expanded="false"');
    expect(html).toContain("자리 — 항");
  });

  it("누구나 아는 모양은 아이콘만, 이 시스템 도구는 아이콘 + 짧은 글자 — 이름은 aria-label · 설명은 tooltip", () => {
    const html = renderToStaticMarkup(<EditorToolbar groups={DOCUMENT_TOOLS} sections={sections().sections} editing onRun={() => undefined} />);
    const table = html.match(/<button[^>]*data-tool="table"[^>]*>(.*?)<\/button>/)!;
    expect(table[0]).toContain('aria-label="표"');
    expect(table[0]).toMatch(/title="표 넣기 — /);
    expect(table[1]).toContain("<svg");
    expect(table[1]).not.toContain("표");
    // 이 시스템에만 있는 넣기는 아이콘 + 짧은 글자 — 온전한 이름은 aria-label, 설명은 tooltip
    const ref = html.match(/<button[^>]*data-tool="articleRef"[^>]*>(.*?)<\/button>/)!;
    expect(ref[0]).toContain('aria-label="조 참조"');
    expect(ref[0]).toMatch(/title="조 참조 넣기 — /);
    expect(ref[1]).toContain("<svg");
    expect(ref[1]).toContain('<span class="ts-tool-short">참조</span>');
    // 조 · 항 · 호 · 목은 한 글자 버튼
    expect(html).toMatch(/data-tool="paragraph"[^>]*>항<\/button>/);
  });

  it("켜짐은 자리대로 — 항이면 조건식 · 항 · 호가 켜지고 조는 잠긴다", () => {
    const html = renderToStaticMarkup(<EditorToolbar groups={DOCUMENT_TOOLS} sections={sections().sections} editing onRun={() => undefined} />);
    const state = Object.fromEntries(buttons(html).map((b) => [b.id, b.disabled]));
    expect(state).toMatchObject({ cond: false, paragraph: false, item: false, article: true });
    expect(state).not.toHaveProperty("elif");
    expect(html).toMatch(/class="ts-tool is-cond"[^>]*data-tool="cond"/);
  });

  it("조건 머리를 고르면 「조건 편집」 묶음이 선다 — 다른 조건 추가 · 그 밖의 경우 추가 · 조건 없애기", () => {
    const b = nodeBuilders(sequentialIds("c"));
    const cond = b.condBlock([b.branch("D0001 = true", [b.paragraph([])])]);
    const tree = b.document("D", [b.article("가", [b.paragraph([]), cond])]);
    const head = placeMenu({ tree, ix: indexTree(tree), docKind: "general", newId: sequentialIds("m") }, { kind: "head", id: cond.branches[0].id });
    const html = renderToStaticMarkup(<EditorToolbar groups={DOCUMENT_TOOLS} sections={head} editing onRun={() => undefined} />);
    expect(html).toContain('role="group" aria-label="조건 편집"');
    for (const name of ["다른 조건 추가", "그 밖의 경우 추가", "조건 없애기"]) expect(html).toContain(`aria-label="${name}"`);
  });

  it("편집 중이 아니면 전부 잠긴다", () => {
    const html = renderToStaticMarkup(<EditorToolbar groups={DOCUMENT_TOOLS} sections={sections().sections} editing={false} onRun={() => undefined} />);
    expect(buttons(html).filter((b) => b.id !== "more").every((b) => b.disabled)).toBe(true);
  });
});
