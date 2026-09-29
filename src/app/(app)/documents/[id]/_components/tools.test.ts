import { describe, expect, it } from "vitest";

import { clauseCanHold, clauseDefaultPlace, clausePlaceMenu, withClauseRefusals, type ClauseMenuEnv } from "@/app/(app)/clauses/_components/clauseMenus";
import { CLAUSE_LINE_ID, clauseBodyToTree, indexTree, nodeBuilders, replayEdits, sequentialIds, type DocumentNode, type EditOp } from "@/domain/document";

import { condInsertItem, forContextMenu, inlineCondItem, placeMenu, type MenuEnv, type MenuItem, type MenuSections, type Place } from "./menus";
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
      expect.arrayContaining(["조", "관", "항", "호", "목", "표", "글머리 목록", "함수조항", "슬롯", "조 참조", "별표 참조", "조건식", "위로", "아래로", "복제", "삭제"]),
    );
    expect(ids).not.toContain("optionSlot");
    // 박스는 정적 마스터 박스를 고른다 — 「박스」 버튼 (기능/박스 §4.4). 옛 문면 박스(사본)를 넣는 길은 없다
    expect(allTools(DOCUMENT_TOOLS).find((t) => t.id === "box")?.label).toBe("박스");
  });

  it("버튼 켜짐은 자리를 따른다 — 항이면 항 · 호 · 조건식이 켜지고 조건 가지 조작은 잠긴다", () => {
    const s = sample();
    const sections = placeMenu(env(s.tree), { kind: "block", id: s.paragraph.id });
    const on = allTools(DOCUMENT_TOOLS)
      .filter((t) => !toolState(t, sections).disabled)
      .map((t) => t.id);
    expect(on).toEqual(expect.arrayContaining(["paragraph", "item", "table", "clauseBlock", "cond", "duplicate", "remove"]));
    expect(on).not.toContain("elif");
    expect(on).not.toContain("up"); // 맨 위 항
    const head = placeMenu(env(s.tree), { kind: "head", id: s.cond.branches[0].id });
    expect(itemsFor(allTools(DOCUMENT_TOOLS).find((t) => t.id === "elif")!, head).map((i) => i.label)).toEqual(["가지 추가(ELIF)"]);
  });

  it("「조건식」 버튼 켜짐 — 지금 블록 감싸기 · 조 본문이면 새 조건 블록 · 감쌀 블록이 없으면 문장 안 조건", () => {
    const s = sample();
    const inline = placeMenu(env(s.tree), { kind: "inline", at: { parentId: s.paragraph.id } }, [{ text: "앞 " }, { caret: true }]);
    expect(condItem(inline)).toMatchObject({ label: "조건으로 감싸기", wrapTarget: s.paragraph.id, action: { do: "ops" } });
    const cell = placeMenu(env(s.tree), { kind: "inline", at: { tableId: s.table.id, row: 1, col: 0 } });
    // 표 셀 — 감싸기는 표 블록(항 목록 자리)이 받는다
    expect(condItem(cell)).toMatchObject({ wrapTarget: s.table.id });
    expect(condItem(placeMenu(env(s.tree), { kind: "article", id: s.top.id }))?.label).toBe("조건 블록 넣기");
    const branchLine = placeMenu(env(s.tree), { kind: "inline", at: { parentId: s.cond.branches[0].id } });
    expect(labels(branchLine)).not.toContain("조건으로 감싸기");
    // 어느 쪽이든 팝업이 아니다 — 곧바로 명령
    for (const sections of [inline, cell, branchLine]) expect(condItem(sections)?.action.do).toBe("ops");
  });

  it("「조건식」 누르면 팝업 없이 조건 블록이 선다 — 빈 IF 줄(식 \"\") 하나, 항은 그 가지 안, 초점은 새 가지의 머리 줄", () => {
    const s = sample();
    const target = s.top.children[0].id;
    const out = runItem(s.tree, condItem(placeMenu(env(s.tree), { kind: "block", id: target }))!);
    const ix = indexTree(out.tree);
    const owner = ix.branches.get(ix.nodes.get(target)!.parentId!)!;
    expect(ix.nodes.get(owner.ownerId)?.node.kind).toBe("condBlock");
    expect(owner.branch.when).toBe("");
    expect(out.focus).toBe(owner.branch.id);
  });

  it("조 본문의 「조건식」 — 빈 IF 줄 + 빈 항 하나를 든 조건 블록을 조 끝에 넣는다", () => {
    const s = sample();
    const out = runItem(s.tree, condItem(placeMenu(env(s.tree), { kind: "article", id: s.top.id }))!);
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

  describe("「조건식」 = 블록 조건 — 선택이 걸친 블록을 감싸고, 선택이 없으면 커서 자리 뒤에 빈 조건 블록 (기능/문면 §4.3, 2026-09-28)", () => {
    const canHold = (tree: DocumentNode) => (id: string) => indexTree(tree).nodes.get(id)?.allowed.includes("condBlock") ?? false;
    const plan = (s: ReturnType<typeof sample>, place: Place, input: Parameters<typeof condInsertItem>[2]) =>
      condInsertItem(env(s.tree), placeMenu(env(s.tree), place, [{ caret: true }]), input, canHold(s.tree));
    const parentKind = (tree: DocumentNode, id: string) => {
      const ix = indexTree(tree);
      const br = ix.branches.get(ix.nodes.get(id)!.parentId!);
      return br ? ix.nodes.get(br.ownerId)!.node.kind : undefined;
    };

    it("항 문장 일부를 고르면 그 항이 조건 블록 안으로 — 문장 안 조건이 아니다, 팝업(칩 팝업)도 없다", () => {
      const s = sample();
      const item = plan(s, { kind: "inline", at: { parentId: s.paragraph.id } }, { selection: { start: s.paragraph.id, end: s.paragraph.id }, inline: { at: { parentId: s.paragraph.id }, tokens: [], cut: "앞" } })!;
      expect(item.label).toBe("조건으로 감싸기");
      const out = runItem(s.tree, item);
      expect(out.openChip).toBeUndefined();
      expect(parentKind(out.tree, s.paragraph.id)).toBe("condBlock");
      expect(out.focus).toBe(indexTree(out.tree).nodes.get(s.paragraph.id)!.parentId);
    });

    it("항과 그 호에 걸친 선택 → 호를 품은 항 하나를 감싼다", () => {
      const s = sample();
      const out = runItem(s.tree, plan(s, { kind: "inline", at: { parentId: s.item.id } }, { selection: { start: s.paragraph.id, end: s.subitem.id } })!);
      expect(parentKind(out.tree, s.paragraph.id)).toBe("condBlock");
      expect(indexTree(out.tree).nodes.get(s.item.id)!.parentId).toBe(s.paragraph.id);
    });

    it("항에서 조건 블록 · 표까지 걸친 선택 → 잇닿은 셋이 한 조건 블록의 한 가지에, 순서 그대로", () => {
      const s = sample();
      const out = runItem(s.tree, plan(s, { kind: "block", id: s.table.id }, { selection: { start: s.paragraph.id, end: s.table.id } })!);
      const ix = indexTree(out.tree);
      const branchId = ix.nodes.get(s.paragraph.id)!.parentId!;
      expect((ix.branches.get(branchId)!.branch.children as { id: string }[]).map((c) => c.id)).toEqual([s.paragraph.id, s.cond.id, s.table.id]);
    });

    it("조 제목의 글을 고르면 그 조를 감싼다(조 자리 켜고 끄기)", () => {
      const s = sample();
      const out = runItem(s.tree, plan(s, { kind: "articleTitle", id: s.top.id }, { selection: { start: s.top.id, end: s.top.id } })!);
      expect(parentKind(out.tree, s.top.id)).toBe("condBlock");
    });

    it("고른 글 없이 커서만 — 그 항 바로 뒤에 빈 조건 블록(빈 IF 줄 + 빈 항), 항은 제자리", () => {
      const s = sample();
      const target = s.top.children[0].id;
      const out = runItem(s.tree, plan(s, { kind: "inline", at: { parentId: target } }, { caret: target })!);
      const top = indexTree(out.tree).nodes.get(s.top.id)!.node as { children: { id: string; kind: string; branches?: { id: string; when?: string; children: { kind: string }[] }[] }[] };
      expect(top.children.map((c) => c.kind)).toEqual(["paragraph", "condBlock"]);
      expect(top.children[0].id).toBe(target);
      expect(top.children[1].branches![0]).toMatchObject({ when: "", children: [{ kind: "paragraph" }] });
      expect(out.focus).toBe(top.children[1].branches![0].id);
    });

    it("호 · 목 문장의 커서 — 그 자리 바로 뒤, 같은 단계의 빈 호 · 목", () => {
      const s = sample();
      const out = runItem(s.tree, plan(s, { kind: "inline", at: { parentId: s.subitem.id } }, { caret: s.subitem.id })!);
      const item = indexTree(out.tree).nodes.get(s.item.id)!.node as { subitems: { kind: string; branches?: { children: { kind: string }[] }[] }[] };
      expect(item.subitems.map((c) => c.kind)).toEqual(["subitem", "condBlock"]);
      expect(item.subitems[1].branches![0].children.map((c) => c.kind)).toEqual(["subitem"]);
    });

    it("조 제목에 커서만 — 그 조 맨 앞에 빈 조건 블록", () => {
      const s = sample();
      const out = runItem(s.tree, plan(s, { kind: "articleTitle", id: s.top.id }, { caret: s.top.id })!);
      const top = indexTree(out.tree).nodes.get(s.top.id)!.node as { children: { kind: string }[] };
      expect(top.children.map((c) => c.kind)).toEqual(["condBlock", "paragraph"]);
    });

    it("함수조항 「항」 — 호의 선택 · 커서는 항 단위로 올라간다(호 목록에는 조건 블록이 없다), 「문구」는 문장 안 조건", () => {
      const tree = clauseBodyToTree("block", [{ id: "p1", kind: "paragraph", children: [{ id: "t", kind: "text", text: "항" }], items: [{ id: "i1", kind: "item", children: [] }] }]);
      const ce: MenuEnv = { tree, ix: indexTree(tree), docKind: "special", newId: sequentialIds("c") };
      const wrap = condInsertItem(ce, [], { selection: { start: "i1", end: "i1" } }, clauseCanHold(ce.ix, "block"))!;
      expect(parentKind(runItem(tree, wrap).tree, "p1")).toBe("condBlock");
      const line = clauseBodyToTree("inline", [{ id: "t", kind: "text", text: "문구" }]);
      const le: MenuEnv = { tree: line, ix: indexTree(line), docKind: "special", newId: sequentialIds("c") };
      const at = { parentId: CLAUSE_LINE_ID };
      const sections = placeMenu(le, { kind: "inline", at }, [{ text: "문구" }, { caret: true }]);
      expect(condInsertItem(le, sections, { caret: CLAUSE_LINE_ID, inline: { at, tokens: [{ text: "문구" }, { caret: true }] } }, clauseCanHold(le.ix, "inline"))?.label).toBe("문장 안 조건");
    });
  });

  it("「문장 안 조건」 버튼 — 문장 자리에서만 켜진다", () => {
    const s = sample();
    const tool = allTools(DOCUMENT_TOOLS).find((t) => t.id === "inlineCond")!;
    expect(toolState(tool, placeMenu(env(s.tree), { kind: "inline", at: { parentId: s.paragraph.id } }, [{ caret: true }])).disabled).toBe(false);
    expect(toolState(tool, placeMenu(env(s.tree), { kind: "block", id: s.table.id })).disabled).toBe(true);
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

describe("함수조항 툴바 (기능/함수조항 §4.3)", () => {
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

  it("조 · 관 · 함수조항 참조는 어느 자리에서든 잠기고 사유를 보인다", () => {
    const e = clauseEnv("block");
    const sections = withClauseRefusals(e, clausePlaceMenu(e, { kind: "inline", at: { parentId: "p1" } }));
    for (const id of ["article", "section", "clauseBlock", "clauseInline"] as const) {
      const state = toolState(allTools(CLAUSE_TOOLS).find((t) => t.id === id)!, sections);
      expect(state.disabled, id).toBe(true);
      expect(state.title).toMatch(/잠김 — 함수조항/);
    }
    expect(toolState(allTools(CLAUSE_TOOLS).find((t) => t.id === "cond")!, sections).disabled).toBe(false);
  });

  it("「문구」 유형 — 구조 넣기 묶음이 없고, 기본 자리는 그 한 줄(조건식 = 문장 안 조건)", () => {
    expect(CLAUSE_LINE_TOOLS.map((g) => g.name)).not.toContain("구조 넣기");
    const e = clauseEnv("inline");
    const place = clauseDefaultPlace("inline");
    expect(place).toEqual({ kind: "inline", at: { parentId: CLAUSE_LINE_ID } });
    expect(condItem(clausePlaceMenu(e, place))?.label).toBe("문장 안 조건");
  });

  it("「항」 유형 본문 빈 자리 — 「조건식」이 켜지고 빈 항을 든 조건 블록을 넣는다 · 호 자리는 감싸지 않는다", () => {
    const e = clauseEnv("block");
    const body = withClauseRefusals(e, clausePlaceMenu(e, { kind: "document" }));
    expect(toolState(allTools(CLAUSE_TOOLS).find((t) => t.id === "cond")!, body).disabled).toBe(false);
    const out = runItem(e.tree, condItem(body)!);
    const article = out.tree.children[0] as { children: { kind: string }[] };
    expect(article.children.map((c) => c.kind)).toEqual(["paragraph", "condBlock"]);
    expect(labels(clausePlaceMenu(e, { kind: "block", id: "p1" }))).toContain("조건으로 감싸기");
    expect(labels(clausePlaceMenu(e, { kind: "block", id: "i1" }))).not.toContain("조건으로 감싸기");
  });
});
