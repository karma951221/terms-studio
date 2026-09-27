import { describe, expect, it } from "vitest";

import { nodeBuilders, sequentialIds } from "@/domain/document";

import { addBranchOps, articleRefOps, clauseOptionsOps, insertOps, linkOps, moveOps, tableOps, textOps, whenOps } from "./formOps";

function fd(entries: [string, string][]): FormData {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

describe("우측 패널 폼 → 편집 명령 (ADR-0074 「적용」)", () => {
  it("여기에 추가 — 종류별 새 노드, 모르는 종류는 사유", () => {
    const r = insertOps("doc", undefined, fd([["kind", "article"], ["title", "목적"]]), sequentialIds("x"));
    expect(r).toEqual({ ok: true, ops: [{ type: "insert", node: { id: "x1", kind: "article", title: "목적", children: [] }, at: { parentId: "doc" } }] });
    expect(insertOps("p", "items", fd([["kind", "item"]]), sequentialIds("x"))).toMatchObject({ ok: true, ops: [{ at: { parentId: "p", slot: "items" } }] });
    expect(insertOps("doc", undefined, fd([["kind", "zzz"]]))).toEqual({ ok: false, message: "지원하지 않는 노드 종류입니다: zzz" });
  });

  it("문장은 앞뒤 공백을 자르지 않는다", () => {
    expect(textOps("t1", fd([["text", "계약일부터 "]]))).toEqual([{ type: "setText", nodeId: "t1", text: "계약일부터 " }]);
  });

  it("표 — 행 반복 칸이 있으면 setTableRepeat 가 따라온다 (빈 값 = 반복 없음)", () => {
    const ops = tableOps("tb", fd([["widths", ""], ["headerRows", "1"], ["rows", "a|b"], ["repeat", "1"]]));
    expect(ops.map((o) => o.type)).toEqual(["setTable", "setTableRepeat"]);
    expect(ops[1]).toEqual({ type: "setTableRepeat", nodeId: "tb", repeat: { depth: 1 } });
    expect(tableOps("tb", fd([["repeat", ""]]))[1]).toEqual({ type: "setTableRepeat", nodeId: "tb" });
  });

  it("조 참조 — 대상 여럿 · 연결어 · 범위", () => {
    expect(articleRefOps("r", fd([["targets", "a"], ["targets", "b"], ["connector", "또는"], ["scope", "general"]]))).toEqual([
      { type: "setArticleRef", nodeId: "r", targets: [{ nodeId: "a" }, { nodeId: "b" }], connector: "또는", scope: "general" },
    ]);
  });

  it("공용조항 옵션 — 미선택(빈 값)은 싣지 않는다", () => {
    expect(clauseOptionsOps("c", fd([["option:O01", "V01"], ["option:O02", ""]]))).toEqual([{ type: "setClauseOptions", nodeId: "c", options: { O01: "V01" } }]);
  });

  it("조연결 — 빈 값이면 해제 · 조건식 — 빈 값이면 ELSE", () => {
    expect(linkOps("a", fd([["linkedArticleId", ""]]))).toEqual([{ type: "link", articleId: "a" }]);
    expect(whenOps("br", fd([["when", ""]]))).toEqual([{ type: "setWhen", branchId: "br" }]);
  });

  it("가지 추가 · 이동 — 편집본 트리를 보고 만든다", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const tree = b.document("D", [b.article("a", [b.paragraph([b.inlineCond([b.inlineBranch("D0001", []), b.inlineBranch(undefined, [])])])]), b.article("b", [])]);
    const cond = (tree.children[0] as { children: { children: { id: string }[] }[] }).children[0].children[0].id;
    const added = addBranchOps(tree, cond, fd([["when", ""], ["text", "첫 문장"]]), sequentialIds("x"));
    expect(added).toMatchObject({ ok: true, ops: [{ type: "addBranch", condId: cond, branch: { children: [{ kind: "text", text: "첫 문장" }] } }] });
    expect(moveOps(tree, tree.children[0].id, -1)).toEqual([]);
    expect(moveOps(tree, tree.children[0].id, 1)).toEqual([{ type: "move", nodeId: tree.children[0].id, to: { parentId: tree.id, slot: "children", index: 1 } }]);
  });
});
