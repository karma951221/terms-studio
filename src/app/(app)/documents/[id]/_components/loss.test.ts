import { describe, expect, it } from "vitest";

import { nodeBuilders, sequentialIds } from "@/domain/document/builders";

import { cascadeOf, internalReferrers, subtreeIds } from "./loss";

/** 삭제 영향 — 반복의 「비었을 때」 칸 안도 센다 (ADR-0088 결정 3 · 4). */
describe("삭제 영향 — 「비었을 때」 칸 안까지", () => {
  const b = nodeBuilders(sequentialIds("n"));
  const inFallback = b.paragraph([b.text("해당 없음")], [b.item([b.text("호")])]);
  inFallback.code = "P0900";
  const loop = b.forBlock({ kind: "planOptions", form: "waiver" }, [b.paragraph([b.text("본문")])], undefined, [inFallback]);
  const article = b.article("조", [loop]);
  const ref = b.articleRef({ articleId: article.id, code: "P0900" });
  const other = b.article("참조", [b.paragraph([ref])]);
  const doc = b.document("d", [article, other]);

  it("블록 반복을 지우면 칸 안 항 · 호도 함께 사라지는 것으로 센다", () => {
    expect(cascadeOf(loop)).toEqual(expect.arrayContaining(["항 2", "호 1"]));
    expect(subtreeIds(loop).has(inFallback.id)).toBe(true);
  });

  it("칸 안 항을 가리키는 참조가 있으면 삭제를 막는다", () => {
    expect(internalReferrers(doc, subtreeIds(loop))).toEqual([{ articleId: other.id, what: "조 참조 슬롯" }]);
  });

  it("칸 안의 참조도 참조처로 센다", () => {
    const c = nodeBuilders(sequentialIds("m"));
    const target = c.paragraph([c.text("대상")]);
    target.code = "P0100";
    const a1 = c.article("대상 조", [target]);
    const r = c.articleRef({ articleId: a1.id, code: "P0100" });
    const l = c.forBlock({ kind: "planOptions", form: "waiver" }, [c.paragraph([c.text("본문")])], undefined, [c.paragraph([r])]);
    const a2 = c.article("반복 조", [l]);
    const tree = c.document("d", [a1, a2]);
    expect(internalReferrers(tree, subtreeIds(target))).toEqual([{ articleId: a2.id, what: "조 참조 슬롯" }]);
  });
});
