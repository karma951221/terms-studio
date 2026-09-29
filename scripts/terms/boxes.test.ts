import { describe, expect, it } from "vitest";

import type { BoxNode, DocumentNode, Node } from "../../src/domain/document/nodes";

import { boxSites, diffRegion, planBoxes, replaceBox, type BoxSite } from "./boxes";

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

describe("원문 박스 → 정적 마스터 박스 (기능/박스 §3.1 · 최종 결정 9)", () => {
  it("낱말 경계로 넓힌 다른 구간 — 모두 같으면 없다", () => {
    expect(diffRegion(["회사가 청약서에서 질문한", "회사가 서면으로 질문한"])?.regions).toEqual(["청약서에서", "서면으로"]);
    expect(diffRegion(["같다", "같다"])).toBeUndefined();
  });

  it("같은 박스는 하나 · 한 곳만 써도 박스 · 띄어쓰기만 달라도 따로 — 이름이 겹치면 상품 이름", () => {
    const a = doc("a", [box("a-b2", "보장개시일", ["보장을 개시하는 날"]), box("a-b3", "예금자보호", ["1 인당 1억원"])]);
    const m = doc("m", [box("m-b2", "보장개시일", ["보장을 개시하는 날"]), box("m-b3", "예금자보호", ["1인당 1억원"])]);
    const plans = planBoxes([...sitesOf(a, "alpha", true), ...sitesOf(m, "meritz")]);
    expect(plans.map((p) => p.record.name)).toEqual(["【보장개시일】", "【예금자보호】(알파Plus)", "【예금자보호】(메리츠)"]);
    expect(plans[0].sites).toHaveLength(2);
    expect(plans[0].record).toEqual({ code: "", name: "【보장개시일】", title: "보장개시일", lines: ["보장을 개시하는 날"] });
  });

  it("낱말만 달라도 박스를 따로 만든다 — 이름에 선택지(다른 낱말)를 붙이고, 각 자리는 제 글의 박스를 놓는다", () => {
    const a = doc("a", [box("a-b1", "계약 전 알릴 의무", ["회사가 청약서에서 질문한 사항"])]);
    const m = doc("m", [box("m-b1", "계약 전 알릴 의무", ["회사가 서면으로 질문한 사항"])]);
    const plans = planBoxes([...sitesOf(a, "alpha", true), ...sitesOf(m, "meritz")]);
    expect(plans.map((p) => p.record.name)).toEqual(["【계약 전 알릴 의무】 — 청약서에서", "【계약 전 알릴 의무】 — 서면으로"]);
    expect(plans.map((p) => p.record.lines)).toEqual([["회사가 청약서에서 질문한 사항"], ["회사가 서면으로 질문한 사항"]]);
    expect(plans.map((p) => p.sites.map((s) => s.node.id))).toEqual([["a-b1"], ["m-b1"]]);
  });

  it("박스 자리는 같은 목록 자리의 박스 참조가 된다 (항의 호 목록 뒤)", () => {
    const a = doc("a", [box("a-b1", "용어풀이", ["줄"])]);
    const [site] = sitesOf(a, "alpha");
    replaceBox(site, "BX000007");
    const p = (a.children[0] as { children: Node[] }).children[0] as { items: Node[] };
    expect(p.items[1]).toEqual({ id: "a-b1-k", kind: "boxRef", boxCode: "BX000007" });
  });
});
