import { describe, expect, it } from "vitest";

import { clauseDefaultPlace, clausePlaceMenu, withClauseRefusals, type ClauseMenuEnv } from "@/app/(app)/clauses/_components/clauseMenus";
import { CLAUSE_LINE_ID, clauseBodyToTree, indexTree, nodeBuilders, replayEdits, sequentialIds, type DocumentNode, type EditOp } from "@/domain/document";

import { forContextMenu, inlineCondItem, placeMenu, type MenuEnv, type MenuItem, type MenuSections, type Place } from "./menus";
import { CLAUSE_LINE_TOOLS, CLAUSE_TOOLS, DOCUMENT_TOOLS, allTools, condItem, itemsFor, toolFor, toolState } from "./tools";

function env(tree: DocumentNode, docKind: "special" | "general" = "special"): MenuEnv {
  return { tree, ix: indexTree(tree), docKind, newId: sequentialIds("m") };
}

function run(tree: DocumentNode, ops: readonly EditOp[]): DocumentNode {
  const r = replayEdits({ tree }, ops, { env: {}, generalRefs: () => undefined });
  if (!r.ok) throw new Error(`거부: ${JSON.stringify(r.rejection)}`);
  return r.value.tree;
}

/** 관 › 조(항 › 호 › 목, 조건 블록 › 항, 반복 표, 문장 안 조건 칩) + 문서 자리 조 하나 — 모든 자리의 목록을 모은다. */
function sample() {
  const b = nodeBuilders(sequentialIds("n"));
  const slot = b.slot("D0002");
  const subitem = b.subitem([]);
  const item = b.item([], [subitem]);
  const paragraph = b.paragraph([b.text("앞 "), slot], [item]);
  const inner = b.paragraph([]);
  const cond = b.condBlock([b.branch("D0001 = true", [inner])]);
  const table = b.table({ columns: [{}], rows: [{ header: true, cells: [[b.text("머리")]] }, { cells: [[b.text("행")]] }], repeat: { depth: 1 } });
  const article = b.article("가", [paragraph, cond, table, b.box("박스", ["줄"])]);
  const section = b.section("관", [article]);
  const top = b.article("나", [b.paragraph([])]);
  const tree = b.document("D", [section, top]);
  return { tree, slot, subitem, item, paragraph, inner, cond, table, article, section, top };
}

function everyPlace(s: ReturnType<typeof sample>): Place[] {
  return [
    { kind: "document" },
    { kind: "article", id: s.article.id },
    { kind: "article", id: s.top.id },
    { kind: "articleTitle", id: s.article.id },
    { kind: "sectionTitle", id: s.section.id },
    { kind: "block", id: s.paragraph.id },
    { kind: "block", id: s.item.id },
    { kind: "block", id: s.subitem.id },
    { kind: "block", id: s.table.id },
    { kind: "block", id: s.inner.id },
    { kind: "head", id: s.cond.branches[0].id },
    { kind: "chip", id: s.slot.id },
    { kind: "inline", at: { parentId: s.paragraph.id } },
    { kind: "inline", at: { tableId: s.table.id, row: 1, col: 0 } },
  ];
}

const labels = (sections: MenuSections) => sections.flat().map((i) => i.label);

/** 목록 항목의 명령을 편집본에 돌린다 — 팝업 항목이면 실패(조건식은 팝업이 없어야 한다). */
function runItem(tree: DocumentNode, item: MenuItem): { tree: DocumentNode; focus?: string; openChip?: string } {
  const a = item.action;
  if (a.do !== "ops") throw new Error(`명령이 아니다: ${a.do}`);
  const ops = typeof a.ops === "function" ? a.ops(tree) : a.ops;
  return { tree: run(tree, ops), ...(a.focus ? { focus: a.focus } : {}), ...(a.openChip ? { openChip: a.openChip } : {}) };
}

describe("약관 에디터 툴바 (기능/문면 §4.3)", () => {
  it("툴바는 모든 조작을 버튼으로 싣는다 — 어느 자리의 목록 항목이든 맡는 버튼이 있다", () => {
    const s = sample();
    for (const place of everyPlace(s)) {
      for (const label of labels(placeMenu(env(s.tree), place))) expect(toolFor(DOCUMENT_TOOLS, label), `${place.kind} › ${label}`).toBeDefined();
    }
  });

  it("버튼 구성 — 구조 넣기 · 문장에 넣기 · 조건(조건식) · 속성 · 배치, id 는 겹치지 않는다", () => {
    expect(DOCUMENT_TOOLS.map((g) => g.name)).toEqual(["구조 넣기", "문장에 넣기", "조건", "속성", "배치"]);
    const ids = allTools(DOCUMENT_TOOLS).map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(allTools(DOCUMENT_TOOLS).map((t) => t.label)).toEqual(
      expect.arrayContaining(["조", "관", "항", "호", "목", "표", "박스", "공용조항", "슬롯", "조 참조", "별표 참조", "조건식", "위로", "아래로", "복제", "삭제"]),
    );
    expect(ids).not.toContain("optionSlot");
  });

  it("버튼 켜짐은 자리를 따른다 — 항이면 항 · 호 · 조건식이 켜지고 조건 가지 조작은 잠긴다", () => {
    const s = sample();
    const sections = placeMenu(env(s.tree), { kind: "block", id: s.paragraph.id });
    const on = allTools(DOCUMENT_TOOLS)
      .filter((t) => !toolState(t, sections).disabled)
      .map((t) => t.id);
    expect(on).toEqual(expect.arrayContaining(["paragraph", "item", "table", "box", "clauseBlock", "cond", "duplicate", "remove"]));
    expect(on).not.toContain("elif");
    expect(on).not.toContain("up"); // 맨 위 항
    const head = placeMenu(env(s.tree), { kind: "head", id: s.cond.branches[0].id });
    expect(itemsFor(allTools(DOCUMENT_TOOLS).find((t) => t.id === "elif")!, head).map((i) => i.label)).toEqual(["가지 추가(ELIF)"]);
  });

  it("「조건식」 — 글을 골랐으면 문장 안 조건, 아니면 지금 블록을 감싼다 · 조 본문이면 새 조건 블록 · 감쌀 블록이 없으면 문장 안 조건", () => {
    const s = sample();
    const inline = placeMenu(env(s.tree), { kind: "inline", at: { parentId: s.paragraph.id } }, [{ text: "앞 " }, { caret: true }]);
    expect(condItem(inline, true)?.label).toBe("문장 안 조건");
    expect(condItem(inline, false)).toMatchObject({ label: "조건으로 감싸기", wrapTarget: s.paragraph.id, action: { do: "ops" } });
    const cell = placeMenu(env(s.tree), { kind: "inline", at: { tableId: s.table.id, row: 1, col: 0 } });
    // 표 셀 — 감싸기는 표 블록(항 목록 자리)이 받는다
    expect(condItem(cell, false)).toMatchObject({ wrapTarget: s.table.id });
    expect(condItem(placeMenu(env(s.tree), { kind: "article", id: s.top.id }), false)?.label).toBe("조건 블록 넣기");
    const branchLine = placeMenu(env(s.tree), { kind: "inline", at: { parentId: s.cond.branches[0].id } });
    expect(labels(branchLine)).not.toContain("조건으로 감싸기");
    // 어느 쪽이든 팝업이 아니다 — 곧바로 명령
    for (const sections of [inline, cell, branchLine]) expect(condItem(sections, false)?.action.do).toBe("ops");
  });

  it("「조건식」 누르면 팝업 없이 조건 블록이 선다 — 빈 IF 줄(식 \"\") 하나, 항은 그 가지 안, 초점은 새 가지의 머리 줄", () => {
    const s = sample();
    const target = s.top.children[0].id;
    const out = runItem(s.tree, condItem(placeMenu(env(s.tree), { kind: "block", id: target }), false)!);
    const ix = indexTree(out.tree);
    const owner = ix.branches.get(ix.nodes.get(target)!.parentId!)!;
    expect(ix.nodes.get(owner.ownerId)?.node.kind).toBe("condBlock");
    expect(owner.branch.when).toBe("");
    expect(out.focus).toBe(owner.branch.id);
  });

  it("조 본문의 「조건식」 — 빈 IF 줄 + 빈 항 하나를 든 조건 블록을 조 끝에 넣는다", () => {
    const s = sample();
    const out = runItem(s.tree, condItem(placeMenu(env(s.tree), { kind: "article", id: s.top.id }), false)!);
    const top = indexTree(out.tree).nodes.get(s.top.id)!.node as { children: { kind: string; branches?: { id: string; when?: string; children: { kind: string }[] }[] }[] };
    const cond = top.children.at(-1)!;
    expect(cond.kind).toBe("condBlock");
    expect(cond.branches).toHaveLength(1);
    expect(cond.branches![0].when).toBe("");
    expect(cond.branches![0].children.map((c) => c.kind)).toEqual(["paragraph"]);
    expect(out.focus).toBe(cond.branches![0].id);
  });

  it("문장 안 조건 — 커서 자리에 칩(빈 IF + ELSE)이 서고 그 칩의 팝업을 연다 · 고른 글은 IF 가지 문장", () => {
    const s = sample();
    const at = { parentId: s.paragraph.id };
    const out = runItem(s.tree, inlineCondItem(at, [{ text: "앞 " }, { chip: s.slot.id }, { caret: true }], sequentialIds("q"), "고른 글"));
    const chip = indexTree(out.tree).nodes.get(out.openChip!)!.node;
    expect(chip.kind).toBe("inlineCond");
    if (chip.kind !== "inlineCond") return;
    expect(chip.branches.map((b) => b.when)).toEqual(["", undefined]);
    expect(chip.branches[0].children).toMatchObject([{ kind: "text", text: "고른 글" }]);
  });

  it("가지 추가(ELIF) · ELSE — 팝업 없이 빈 가지(빈 IF 줄 · 빈 항)가 ELSE 앞에 선다", () => {
    const s = sample();
    const head = placeMenu(env(s.tree), { kind: "head", id: s.cond.branches[0].id });
    const withElse = runItem(s.tree, head.flat().find((i) => i.label === "ELSE 가지 추가")!).tree;
    const head2 = placeMenu(env(withElse), { kind: "head", id: s.cond.branches[0].id });
    const out = runItem(withElse, head2.flat().find((i) => i.label === "가지 추가(ELIF)")!);
    const cond = indexTree(out.tree).nodes.get(s.cond.id)!.node;
    if (cond.kind !== "condBlock") throw new Error("조건 블록이 아니다");
    expect(cond.branches.map((b) => b.when)).toEqual(["D0001 = true", "", undefined]);
    expect(cond.branches[1].children.map((c) => c.kind)).toEqual(["paragraph"]);
    expect(out.focus).toBe(cond.branches[1].id);
  });

  it("오른쪽 클릭 메뉴에는 조건 넣기가 없다 — 조건으로 감싸기 · 조건 블록 넣기 · 문장 안 조건은 툴바에만", () => {
    const s = sample();
    for (const place of everyPlace(s)) {
      const menu = labels(forContextMenu(placeMenu(env(s.tree), place, [{ caret: true }])));
      for (const label of ["조건으로 감싸기", "조건 블록 넣기", "문장 안 조건"]) expect(menu).not.toContain(label);
    }
    // 가지 조작은 메뉴에 남는다 — 식 고치기 항목은 없다(머리 줄에서 고친다)
    const head = labels(forContextMenu(placeMenu(env(s.tree), { kind: "head", id: s.cond.branches[0].id })));
    expect(head).toContain("가지 추가(ELIF)");
    expect(head.some((l) => l.startsWith("조건 고치기"))).toBe(false);
  });
});

describe("공용조항 툴바 (기능/공용조항 §4.3)", () => {
  function clauseEnv(mode: "inline" | "block"): ClauseMenuEnv {
    const tree =
      mode === "block"
        ? clauseBodyToTree("block", [{ id: "p1", kind: "paragraph", children: [{ id: "t", kind: "text", text: "항" }], items: [{ id: "i1", kind: "item", children: [] }] }])
        : clauseBodyToTree("inline", [{ id: "t", kind: "text", text: "문구" }]);
    return { tree, ix: indexTree(tree), docKind: "special", newId: sequentialIds("c"), mode, options: [{ code: "O01", label: "기일" }, { code: "O02", label: "사유" }], onRefuse: () => undefined };
  }

  it("모든 목록 항목에 버튼이 있다 — 옵션 자리는 한 버튼(▾)이 옵션마다 한 줄", () => {
    const e = clauseEnv("block");
    const places: Place[] = [{ kind: "document" }, { kind: "block", id: "p1" }, { kind: "block", id: "i1" }, { kind: "inline", at: { parentId: "p1" } }];
    for (const place of places) {
      for (const label of labels(withClauseRefusals(e, clausePlaceMenu(e, place)))) expect(toolFor(CLAUSE_TOOLS, label), label).toBeDefined();
    }
    const option = allTools(CLAUSE_TOOLS).find((t) => t.id === "optionSlot")!;
    expect(itemsFor(option, clausePlaceMenu(e, { kind: "inline", at: { parentId: "p1" } })).map((i) => i.label)).toEqual(["옵션 자리 — 기일", "옵션 자리 — 사유"]);
    expect(allTools(CLAUSE_TOOLS).map((t) => t.id)).not.toContain("table");
  });

  it("조 · 관 · 공용조항 참조는 어느 자리에서든 잠기고 사유를 보인다", () => {
    const e = clauseEnv("block");
    const sections = withClauseRefusals(e, clausePlaceMenu(e, { kind: "inline", at: { parentId: "p1" } }));
    for (const id of ["article", "section", "clauseBlock", "clauseInline"] as const) {
      const state = toolState(allTools(CLAUSE_TOOLS).find((t) => t.id === id)!, sections);
      expect(state.disabled, id).toBe(true);
      expect(state.title).toMatch(/잠김 — 공용조항/);
    }
    expect(toolState(allTools(CLAUSE_TOOLS).find((t) => t.id === "cond")!, sections).disabled).toBe(false);
  });

  it("「문구」 유형 — 구조 넣기 묶음이 없고, 기본 자리는 그 한 줄(조건식 = 문장 안 조건)", () => {
    expect(CLAUSE_LINE_TOOLS.map((g) => g.name)).not.toContain("구조 넣기");
    const e = clauseEnv("inline");
    const place = clauseDefaultPlace("inline");
    expect(place).toEqual({ kind: "inline", at: { parentId: CLAUSE_LINE_ID } });
    expect(condItem(clausePlaceMenu(e, place), false)?.label).toBe("문장 안 조건");
  });

  it("「항」 유형 본문 빈 자리 — 「조건식」이 켜지고 빈 항을 든 조건 블록을 넣는다 · 호 자리는 감싸지 않는다", () => {
    const e = clauseEnv("block");
    const body = withClauseRefusals(e, clausePlaceMenu(e, { kind: "document" }));
    expect(toolState(allTools(CLAUSE_TOOLS).find((t) => t.id === "cond")!, body).disabled).toBe(false);
    const out = runItem(e.tree, condItem(body, false)!);
    const article = out.tree.children[0] as { children: { kind: string }[] };
    expect(article.children.map((c) => c.kind)).toEqual(["paragraph", "condBlock"]);
    expect(labels(clausePlaceMenu(e, { kind: "block", id: "p1" }))).toContain("조건으로 감싸기");
    expect(labels(clausePlaceMenu(e, { kind: "block", id: "i1" }))).not.toContain("조건으로 감싸기");
  });
});
