import { describe, expect, it } from "vitest";

import { indexTree, nodeBuilders, sequentialIds } from "@/domain/document";

import { restrictMode, restrictOfForm, treeLoopsAt } from "./restrict";

describe("키 한정 칸 (ADR-0087 결정 10)", () => {
  it("「해당 키들」 체크 → { keys }, 「현재 세부보장」 → { current }", () => {
    const fd = new FormData();
    fd.set("restrictMode", "keys");
    fd.append("restrictKey", "01");
    fd.append("restrictKey", "03");
    expect(restrictOfForm(fd, "")).toEqual({ keys: ["01", "03"] });
    const cur = new FormData();
    cur.set("restrictMode", "current:f");
    expect(restrictOfForm(cur, "")).toEqual({ current: "f" });
    expect(restrictMode({ keys: ["01"] })).toBe("keys");
  });

  it("값 한정 · 없음 · 인자 접두", () => {
    const fd = new FormData();
    fd.set("arg:x:restrictMode", "values");
    fd.append("arg:x:restrictValue", "D1");
    expect(restrictOfForm(fd, "arg:x:")).toEqual({ values: ["D1"] });
    expect(restrictOfForm(new FormData(), "")).toBeUndefined();
    expect(restrictMode(undefined)).toBe("");
    expect(restrictMode({ values: [] })).toBe("values");
    expect(restrictMode({ current: "f" })).toBe("current:f");
  });
});

describe("treeLoopsAt — 참조 자리를 감싼 담보 트리 반복", () => {
  const b = nodeBuilders(sequentialIds("n"));
  const para = b.paragraph([b.text("항")]);
  const br = b.branch("D0101", [b.paragraph([b.text("안")])]);
  const loop = b.forBlock({ kind: "subCoverages" }, [para, b.condBlock([br])]);
  const doc = b.document("d", [b.article("a", [loop])]);
  const ix = indexTree(doc);

  it("새로 넣는 자리가 반복 블록 자신(본문에 직접 넣기)이면 그 반복이 든다, 고칠 땐 자신을 뺀다", () => {
    expect(treeLoopsAt(ix, loop.id, true)).toEqual([{ id: loop.id, level: "subCoverage" }]);
    expect(treeLoopsAt(ix, loop.id, false)).toEqual([]);
    expect(treeLoopsAt(ix, para.id, false)).toEqual([{ id: loop.id, level: "subCoverage" }]);
  });

  it("부모가 반복 안의 조건 가지(ix.branches)여도 감싼 반복이 든다", () => {
    expect(treeLoopsAt(ix, br.id, true)).toEqual([{ id: loop.id, level: "subCoverage" }]);
  });

  it("트리에 없는 자리 · 자리 없음 → 빈 목록 (함수조항 편집기)", () => {
    expect(treeLoopsAt(ix, "없는-id", true)).toEqual([]);
    expect(treeLoopsAt(ix, undefined, true)).toEqual([]);
  });
});
