import { describe, expect, it } from "vitest";

import type { BoxNode, DocumentNode, Node } from "../../src/domain/document/nodes";

import { boxSites, diffRegion, planBoxClauses, replaceBox, type BoxSite } from "./boxes";

const box = (id: string, title: string, lines: string[]): BoxNode => ({ id, kind: "box", title, lines });

function doc(id: string, boxes: BoxNode[]): DocumentNode {
  return {
    id,
    kind: "document",
    title: id,
    children: [{ id: `${id}-a1`, kind: "article", title: "조", children: [{ id: `${id}-p1`, kind: "paragraph", children: [], items: [{ id: `${id}-i1`, kind: "item", children: [] }, ...boxes] }] }],
  };
}

const sitesOf = (d: DocumentNode, product: string, general = false): BoxSite[] => boxSites(d, { doc: d.id, product, general });

describe("박스 → 「박스」 공용조항 (기능/공용조항 §3.1 · §6.2)", () => {
  it("낱말 경계로 넓힌 다른 구간 — 모두 같으면 없다", () => {
    expect(diffRegion(["회사가 청약서에서 질문한", "회사가 서면으로 질문한"])?.regions).toEqual(["청약서에서", "서면으로"]);
    expect(diffRegion(["같다", "같다"])).toBeUndefined();
  });

  it("같은 박스는 하나 · 낱말만 다르면 옵션 · 띄어쓰기만 다르면 따로 · 한 곳만 써도 공용조항", () => {
    const a = doc("a", [box("a-b1", "계약 전 알릴 의무", ["회사가 청약서에서 질문한 사항"]), box("a-b2", "보장개시일", ["보장을 개시하는 날"]), box("a-b3", "예금자보호", ["1 인당 1억원"])]);
    const m = doc("m", [box("m-b1", "계약 전 알릴 의무", ["회사가 서면으로 질문한 사항"]), box("m-b2", "보장개시일", ["보장을 개시하는 날"]), box("m-b3", "예금자보호", ["1인당 1억원"])]);
    const plans = planBoxClauses([...sitesOf(a, "alpha", true), ...sitesOf(m, "meritz")]);
    expect(plans.map((p) => p.label)).toEqual(["【계약 전 알릴 의무】", "【보장개시일】", "【예금자보호】(알파Plus)", "【예금자보호】(메리츠)"]);
    const [disclosure, start] = plans;
    expect(disclosure.record.options.map((o) => o.values.map((v) => v.label))).toEqual([["청약서에서", "서면으로"]]);
    expect(disclosure.uses.map((u) => u.selection)).toEqual([{ O01: "V01" }, { O01: "V02" }]);
    expect(start.record.options).toEqual([]);
    expect(start.uses).toHaveLength(2);
  });

  it("박스 자리는 같은 목록 자리의 참조가 된다 (항의 호 목록 뒤)", () => {
    const a = doc("a", [box("a-b1", "용어풀이", ["줄"])]);
    const [site] = sitesOf(a, "alpha");
    replaceBox(site, "C0100", {});
    const p = (a.children[0] as { children: Node[] }).children[0] as { items: Node[] };
    expect(p.items[1]).toEqual({ id: "a-b1-k", kind: "clauseBlockRef", clauseCode: "C0100", options: {} });
  });
});
