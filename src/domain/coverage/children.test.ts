import { describe, expect, it } from "vitest";

import { enumerateRows } from "../structure";
import { coverageChildrenProviders, coverageStructNode } from "./children";
import { surgery } from "./fixture";

describe("자식 제공자 — 담보 트리에서 coverage → 세부보장 · subCoverage → 급부 (ADR-0070 결정 2)", () => {
  it("담보 노드의 자식 = 세부보장(order 순), 세부보장의 자식 = 급부", () => {
    const { tree, b21, b22 } = surgery();
    const p = coverageChildrenProviders(tree);
    const subs = p.coverage!.children({ level: "coverage", id: tree.id });
    expect(subs.map((n) => [n.level, n.name, n.order])).toEqual([
      ["subCoverage", "1종수술", 0],
      ["subCoverage", "2종수술", 1],
    ]);
    expect(p.subCoverage!.children(subs[1]).map((n) => n.id)).toEqual([b21, b22]);
  });

  it("plan · product 제공자는 없다 — 열거가 「제공자 없음」으로 떨어진다", () => {
    const { tree } = surgery();
    const p = coverageChildrenProviders(tree);
    expect(p.plan).toBeUndefined();
    expect(p.product).toBeUndefined();
  });

  it("트리에 없는 노드의 자식은 빈 목록", () => {
    const { tree } = surgery();
    expect(coverageChildrenProviders(tree).subCoverage!.children({ level: "subCoverage", id: "nope" })).toEqual([]);
  });

  it("뿌리 = 담보 노드 — 급부 깊이(2)까지 열거하면 급부 수만큼", () => {
    const { tree } = surgery();
    expect(coverageStructNode(tree)).toEqual({ level: "coverage", id: tree.id, name: tree.name, order: 0 });
    const rows = enumerateRows(coverageStructNode(tree), 2, coverageChildrenProviders(tree));
    expect(rows.ok && rows.value.length).toBe(3);
  });
});
