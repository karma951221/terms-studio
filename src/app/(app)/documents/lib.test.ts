import { describe, expect, it } from "vitest";

import { nodeBuilders } from "@/domain/document";

import { moveTarget, parseLines, str } from "./lib";

describe("documents lib — 순수 파싱", () => {
  it("str — trim", () => {
    const fd = new FormData();
    fd.set("a", " hi ");
    expect(str(fd, "a")).toBe("hi");
  });

  it("moveTarget — 형제 안에서 위/아래로, 경계는 undefined", () => {
    const b = nodeBuilders();
    const p1 = b.paragraph([b.text("a")]);
    const p2 = b.paragraph([b.text("b")]);
    const article = b.article("조1", [p1, p2]);
    const doc = b.document("문서", [article]);

    expect(moveTarget(doc, p2.id, -1)).toEqual({ parentId: article.id, slot: "children", index: 0 });
    expect(moveTarget(doc, p1.id, -1)).toBeUndefined();
    expect(moveTarget(doc, p2.id, 1)).toBeUndefined();
    expect(moveTarget(doc, article.id, -1)).toBeUndefined(); // 문서 루트 바로 아래는 형제가 하나뿐
  });

  it("moveTarget — 존재하지 않는 노드는 undefined", () => {
    const b = nodeBuilders();
    const doc = b.document("문서", []);
    expect(moveTarget(doc, "no-such-id", 1)).toBeUndefined();
  });
});

describe("parseLines — 박스 줄 (기능/문면 §3.2)", () => {
  it("parseLines — 줄마다 하나, 빈 줄은 버린다", () => {
    expect(parseLines(" 첫 줄 \n\n둘째 줄\n")).toEqual(["첫 줄", "둘째 줄"]);
  });
});
