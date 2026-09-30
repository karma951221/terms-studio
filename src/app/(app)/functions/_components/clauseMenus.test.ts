import { describe, expect, it, vi } from "vitest";

import type { MenuItem, MenuSections } from "@/app/(app)/documents/[id]/_components/menus";
import { CLAUSE_HOST_ITEM_ID, CLAUSE_HOST_PARAGRAPH_ID, CLAUSE_LINE_ID, clauseBodyToTree, indexTree, sequentialIds } from "@/domain/document";

import { REFUSE, clauseBlockMenu, clauseBodyMenu, clauseCanHold, clauseCondMenu, clauseInlineMenu, type ClauseMenuEnv } from "./clauseMenus";
import { applyEdit, treeToClauseBody } from "@/domain/document";

const labels = (sections: MenuSections) => sections.flat().map((item) => item.label);
const find = (sections: MenuSections, label: string): MenuItem | undefined => sections.flat().find((item) => item.label === label);

function env(mode: "inline" | "block", onRefuse = vi.fn()): ClauseMenuEnv {
  const tree =
    mode === "block"
      ? clauseBodyToTree("block", [{ id: "p1", kind: "paragraph", children: [{ id: "t", kind: "text", text: "항" }], items: [{ id: "i1", kind: "item", children: [] }] }])
      : clauseBodyToTree("inline", [{ id: "t", kind: "text", text: "문구" }]);
  return { tree, ix: indexTree(tree), docKind: "special", newId: sequentialIds("n"), mode, options: [{ code: "O01", label: "기일" }], onRefuse };
}

describe("함수조항 에디터 메뉴 — 문면 메뉴를 함수조항 자리로 거른다 (기능/함수조항 §4.3)", () => {
  it("문장 속: 문면의 넣기 도구 + 옵션 자리, 함수조항 참조는 누르면 거부 배너", () => {
    const onRefuse = vi.fn();
    const e = env("block", onRefuse);
    const sections = clauseInlineMenu(e, { parentId: "p1" }, [{ text: "항" }, { caret: true }]);
    expect(labels(sections)).toEqual(expect.arrayContaining(["치환 슬롯…", "조 참조…", "별표 참조…", "문장 안 조건", "옵션 자리 — 기일", "아래에 항 추가", "호 추가"]));
    const clauseRef = find(sections, "함수조항(문장 안)…")!;
    expect(clauseRef.refusal).toBe(REFUSE.clauseRef); // 툴바는 잠그고 이 사유를 tooltip 으로
    expect(clauseRef.action.do).toBe("ops");
    if (clauseRef.action.do === "ops" && typeof clauseRef.action.ops === "function") expect(clauseRef.action.ops(e.tree)).toEqual([]);
    expect(onRefuse).toHaveBeenCalledWith(REFUSE.clauseRef);
  });

  it("옵션 자리 넣기는 커서 자리에 옵션 운반체를 끼운다", () => {
    const e = env("inline");
    const item = find(clauseInlineMenu(e, { parentId: CLAUSE_LINE_ID }, [{ caret: true }, { text: "문구" }]), "옵션 자리 — 기일")!;
    const ops = item.action.do === "ops" && typeof item.action.ops === "function" ? item.action.ops(e.tree) : [];
    expect(ops[0]).toMatchObject({ type: "setInlines", at: { parentId: CLAUSE_LINE_ID }, runs: [{ node: { kind: "clauseInlineRef", clauseCode: "option:O01" } }, { id: "t", text: "문구" }] });
  });

  it("「문구」 유형은 문장 한 줄 — 블록 조작이 없다", () => {
    const sections = clauseInlineMenu(env("inline"), { parentId: CLAUSE_LINE_ID }, [{ caret: true }]);
    expect(labels(sections)).not.toContain("아래에 항 추가");
    expect(clauseBodyMenu(env("inline"))).toEqual([]);
  });

  it("블록 메뉴: 표 · 함수조항(조 단위)은 싣지 않거나 거부, 정적 마스터 박스는 넣는다(잎), 호에는 조건으로 감싸기가 없다", () => {
    const e = env("block");
    const paragraph = labels(clauseBlockMenu(e, "p1"));
    expect(paragraph).toContain("조건으로 감싸기");
    expect(paragraph.some((l) => l.includes("표") || l.includes("박스 함수조항"))).toBe(false);
    expect(paragraph).toContain("아래에 박스 추가…");
    expect(labels(clauseBlockMenu(e, "i1"))).toContain("아래에 박스 추가…");
    expect(labels(clauseBlockMenu(e, "i1"))).not.toContain("조건으로 감싸기");
  });

  it("본문 빈 자리: 항 추가 · 조건 블록 넣기 + 조 · 관 추가는 거부 배너", () => {
    const onRefuse = vi.fn();
    const e = env("block", onRefuse);
    const sections = clauseBodyMenu(e);
    expect(labels(sections)).toEqual(["항 추가", "박스 추가…", "조건 블록 넣기", "값별 분기 넣기", "조 추가", "관 추가", "함수조항 참조 추가…"]);
    const article = find(sections, "조 추가")!;
    if (article.action.do === "ops" && typeof article.action.ops === "function") article.action.ops(e.tree);
    expect(onRefuse).toHaveBeenCalledWith(REFUSE.article);
  });
});

describe("호 · 목 유형 에디터 메뉴 — 유형의 목록 자리에 넣고 조건으로 감싼다 (최종 결정 4)", () => {
  function listEnv(mode: "item" | "subitem"): ClauseMenuEnv {
    const tree =
      mode === "item"
        ? clauseBodyToTree("item", [{ id: "i1", kind: "item", children: [], subitems: [{ id: "s1", kind: "subitem", children: [] }] }])
        : clauseBodyToTree("subitem", [{ id: "s1", kind: "subitem", children: [] }]);
    return { tree, ix: indexTree(tree), docKind: "special", newId: sequentialIds("n"), mode, options: [], onRefuse: vi.fn() };
  }

  it("본문 빈 자리 — 「호」는 호 · 박스 · 조건 블록, 「목」은 목 · 조건 블록을 자리 목록 끝에", () => {
    const item = clauseBodyMenu(listEnv("item"));
    expect(labels(item).slice(0, 3)).toEqual(["호 추가", "박스 추가…", "조건 블록 넣기"]);
    expect(find(item, "호 추가")?.action).toMatchObject({ do: "ops", ops: [{ type: "insert", at: { parentId: CLAUSE_HOST_PARAGRAPH_ID, slot: "items" } }] });
    const sub = clauseBodyMenu(listEnv("subitem"));
    expect(labels(sub).slice(0, 2)).toEqual(["목 추가", "조건 블록 넣기"]);
    expect(find(sub, "목 추가")?.action).toMatchObject({ do: "ops", ops: [{ type: "insert", at: { parentId: CLAUSE_HOST_ITEM_ID, slot: "subitems" } }] });
  });

  it("조건으로 감싸기 — 「호」의 호는 되고 그 호의 목은 안 된다, 「목」의 목은 된다", () => {
    const e = listEnv("item");
    expect(clauseCanHold(e.ix, "item")("i1")).toBe(true);
    expect(clauseCanHold(e.ix, "item")("s1")).toBe(false);
    expect(clauseCanHold(e.ix, "item")(CLAUSE_HOST_PARAGRAPH_ID)).toBe(false);
    const s = listEnv("subitem");
    expect(clauseCanHold(s.ix, "subitem")("s1")).toBe(true);
    expect(labels(clauseBlockMenu(e, "i1"))).toContain("조건으로 감싸기");
    expect(labels(clauseBlockMenu(e, "s1"))).not.toContain("조건으로 감싸기");
  });

  it("호 · 목 자리의 함수조항 넣기는 거부 자리 하나로 — 같은 도구가 둘로 늘지 않는다", () => {
    const e = listEnv("item");
    expect(labels(clauseBlockMenu(e, "i1")).filter((l) => l.includes("함수조항"))).toEqual([]);
  });
});

describe("값별 분기 메뉴 — 넣기 · 칸 머리 (최종 결정 5)", () => {
  const 사유 = { code: "arg.사유", label: "사유(인자)", values: [{ code: "V01", label: "암" }, { code: "V02", label: "뇌졸중" }] };
  const itemsOf = (sections: MenuSections, label: string) => {
    const item = find(sections, label);
    if (!item || item.action.do !== "ops") throw new Error(`${label} 없음`);
    return typeof item.action.ops === "function" ? item.action.ops(e0().tree) : item.action.ops;
  };
  const e0 = (): ClauseMenuEnv => ({ ...env("block"), switchSubjects: [사유] });
  const apply = (tree: ClauseMenuEnv["tree"], ops: ReturnType<typeof itemsOf>) => {
    let state = { tree };
    for (const op of ops) {
      const r = applyEdit(state, op, { env: { kind: "special", switches: true }, generalRefs: () => undefined });
      if (!r.ok) throw new Error(JSON.stringify(r.rejection));
      state = r.value.state;
    }
    return state.tree;
  };

  it("대상 후보가 없으면 거부 자리(사유 = 인자 표에 목록값 인자를 먼저)", () => {
    const item = find(clauseBodyMenu(env("block")), "값별 분기 넣기")!;
    expect(item.refusal).toBe(REFUSE.switchSubject);
  });

  it("본문 끝에 넣으면 대상 = 후보 첫째, 칸 = 값마다 하나(빈 항을 든) — 되돌리면 switchBlock", () => {
    const tree = apply(e0().tree, itemsOf(clauseBodyMenu(e0()), "값별 분기 넣기"));
    const back = treeToClauseBody("block", tree);
    expect(back.ok && back.value[1]).toMatchObject({ kind: "switchBlock", on: "arg.사유", cases: [{ values: ["V01"], children: [{ kind: "paragraph" }] }, { values: ["V02"], children: [{ kind: "paragraph" }] }] });
  });

  it("블록 뒤에도 넣는다 — 호 뒤(조건으로 감쌀 수 없는 자리)에는 없다", () => {
    expect(labels(clauseBlockMenu(e0(), "p1"))).toContain("값별 분기 넣기");
    expect(labels(clauseBlockMenu(e0(), "i1"))).not.toContain("값별 분기 넣기");
  });

  it("칸 머리 목록 — 칸 추가(칸 없는 값을 든) · 이 칸 삭제 · 이 칸에 넣기 · 분기 삭제, ELIF · ELSE · 풀기는 없다", () => {
    const e = e0();
    const tree = apply(e.tree, itemsOf(clauseBodyMenu(e), "값별 분기 넣기"));
    const ix = indexTree(tree);
    const sw = [...ix.nodes.values()].find((n) => n.node.kind === "condBlock")!.node as { id: string; branches: { id: string }[] };
    const env2: ClauseMenuEnv = { ...e, tree, ix };
    const menu = clauseCondMenu(env2, sw.branches[0].id);
    expect(labels(menu)).toEqual(["칸 추가", "이 칸 삭제", "이 가지에 항 추가", "이 가지에 글머리 목록 추가", "이 가지에 박스 추가…", "값별 분기 삭제"]);
    // 칸이 없는 값이 없으면 새 칸은 값 없이 선다
    const added = find(menu, "칸 추가")!;
    expect(added.action.do === "ops" && Array.isArray(added.action.ops) && added.action.ops[0]).toMatchObject({ type: "addBranch", branch: { values: [] } });
  });
});

describe("문장 안 값별 분기 메뉴 (최종 결정 5)", () => {
  const 사유 = { code: "arg.사유", label: "사유(인자)", values: [{ code: "V01", label: "암" }, { code: "V02", label: "뇌졸중" }] };
  it("커서 자리에 칩 — 칸 = 값마다 하나(빈 문구) · 되돌리면 inlineSwitch, 문장 안 조건 가지 안에서는 없다", () => {
    const e: ClauseMenuEnv = { ...env("inline"), switchSubjects: [사유] };
    const item = find(clauseInlineMenu(e, { parentId: CLAUSE_LINE_ID }, [{ text: "문구" }, { caret: true }]), "문장 안 값별 분기")!;
    const ops = item.action.do === "ops" && typeof item.action.ops === "function" ? item.action.ops(e.tree) : [];
    const r = applyEdit({ tree: e.tree }, ops[0], { env: { kind: "special", switches: true }, generalRefs: () => undefined });
    if (!r.ok) throw new Error(JSON.stringify(r.rejection));
    const back = treeToClauseBody("inline", r.value.state.tree);
    expect(back.ok && back.value[1]).toMatchObject({ kind: "inlineSwitch", on: "arg.사유", cases: [{ values: ["V01"], children: [] }, { values: ["V02"], children: [] }] });
    const ix = indexTree(r.value.state.tree);
    const caseId = [...ix.branches.keys()][0];
    expect(labels(clauseInlineMenu({ ...e, tree: r.value.state.tree, ix }, { parentId: caseId }, [{ caret: true }]))).not.toContain("문장 안 값별 분기");
  });
});
