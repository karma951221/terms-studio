// @vitest-environment jsdom
/**
 * 문장 자리 편집기 — 칩을 넣은 직후(초점 요청 = 그 칩 id) 커서가 칩 바로 뒤에 선다. 커서 자리는 DOM 선택이라 jsdom.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { nodeBuilders, sequentialIds, type InlineNode } from "@/domain/document";

import type { DocCtx, EditHandlers } from "./ctx";
import { InlineSlot } from "./Inline";

afterEach(cleanup);

function ctxWith(edit: Partial<EditHandlers>): DocCtx {
  return {
    documentId: "d",
    docKind: "general",
    mode: "edit",
    appendixName: new Map(),
    clauseLabel: new Map(),
    optionText: () => "",
    references: { self: new Map(), general: new Map() },
    clauses: [],
    edit: { commitInline: () => undefined, focusInline: () => undefined, ...edit } as EditHandlers,
  } as unknown as DocCtx;
}

describe("칩 넣은 직후 커서", () => {
  const b = nodeBuilders(sequentialIds("n"));
  const nodes: InlineNode[] = [b.text("보험금"), b.particle("eul-reul"), b.text(" 지급")];
  const chipId = nodes[1].id;

  it("초점 요청이 이 자리의 칩이면 그 칩 바로 뒤에 커서를 두고 요청을 마친다", () => {
    const focusDone = vi.fn();
    const { container } = render(<InlineSlot at={{ parentId: "p" }} nodes={nodes} ctx={ctxWith({ focusRequest: chipId, focusDone })} owner="p" />);
    const editor = container.querySelector("[data-inline]")!;
    const sel = window.getSelection()!;
    expect(sel.rangeCount).toBe(1);
    const range = sel.getRangeAt(0);
    expect(range.collapsed).toBe(true);
    expect(range.startContainer).toBe(editor);
    expect(editor.childNodes[range.startOffset - 1]).toBe(editor.querySelector(`[data-chip="${chipId}"]`));
    expect(focusDone).toHaveBeenCalledOnce();
  });

  it("다른 자리의 칩이면 건드리지 않는다", () => {
    const focusDone = vi.fn();
    render(<InlineSlot at={{ parentId: "p" }} nodes={nodes} ctx={ctxWith({ focusRequest: "other", focusDone })} owner="p" />);
    expect(focusDone).not.toHaveBeenCalled();
  });
});
