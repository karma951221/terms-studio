import { describe, expect, it } from "vitest";

import type { EnumDef } from "@/domain/catalog";
import { indexTree, nodeBuilders, sequentialIds, type ForBlockNode } from "@/domain/document";

import { currentPlanOf, currentValueOf, loopChoices, loopsAround, repeatChoices, sourceOfValue, sourceValue } from "./repeatSources";

const E0001: EnumDef = {
  code: "E0001",
  label: "납입면제사유",
  fields: [{ key: "F03", label: "정의조대상", type: "boolean", order: 1 }],
  values: [{ code: "V01", label: "암", order: 0 }],
};
const enumOf = (c: string) => (c === "E0001" ? E0001 : undefined);

describe("반복 원천 고르기 (ADR-0077 · 기능/문면 §4.3)", () => {
  it("반복 밖 — 「납입면제종마다」(적용여부 = 예) · 합집합(정의조대상 = 예) 후보가 선다, 칸 값은 원천으로 되돌아온다", () => {
    const choices = repeatChoices({ depth: 0, enumOf });
    const labels = choices.map((c) => c.label);
    expect(labels).toContain("납입면제종마다 — 적용여부 = 예인 선택지");
    expect(labels).toContain("납입면제사유 합집합(정의조대상 = 예)마다");
    const waiver = choices.find((c) => c.label === "납입면제종마다 — 적용여부 = 예인 선택지")!;
    expect(sourceOfValue(waiver.value)).toEqual({ kind: "planOptions", form: "waiver", filter: "waiver.applies = true" });
    expect(sourceOfValue("엉터리")).toBeUndefined();
  });

  it("종 반복 안 — 바깥 종의 목록값 필드마다 「사유마다」만, 두 단계 안이면 후보 없음", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const outer = b.forBlock({ kind: "planOptions", form: "waiver", filter: "waiver.applies = true" }, []);
    expect(repeatChoices({ outer, depth: 1 }).map((c) => [c.label, c.source])).toEqual([["납입면제사유마다 — 현재 종의 목록", { kind: "listOfCurrent", loop: outer.id, field: "reasons" }]]);
    expect(repeatChoices({ outer, depth: 2 })).toEqual([]);
  });

  it("감싼 반복 · 인자 연결의 현재 원소 후보 — 바깥 → 안쪽, 종 · 열거값 타입", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const item = b.item([b.text("호")]);
    const inner = b.forBlock({ kind: "listOfCurrent", loop: "?", field: "reasons" }, [item]);
    const outer = b.forBlock({ kind: "planOptions", form: "waiver", filter: "waiver.applies = true" }, [b.paragraph([b.text("항")], [inner])]);
    inner.source = { kind: "listOfCurrent", loop: outer.id, field: "reasons" };
    const doc = b.document("d", [b.article("a", [outer])]);
    const loops = loopsAround(indexTree(doc), item.id);
    expect(loops.map((l) => l.id)).toEqual([outer.id, inner.id]);
    expect(loopChoices(loops)).toEqual([
      { id: outer.id, label: "현재 종 — 납입면제종마다", type: { kind: "planOptions", form: "waiver" } },
      { id: inner.id, label: "현재 원소 — 납입면제사유마다", type: { kind: "enum", enumCode: "E0001" } },
    ]);
    expect(sourceValue(outer.source)).toBe(JSON.stringify(outer.source));
  });

  it("「현재 종」 — 감싼 반복 중 세목 선택지 반복(안쪽 사유 반복 안에서도 바깥 종), 합집합 · 반복 밖이면 없음 (ADR-0077 결정 3)", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const item = b.item([b.text("호")]);
    const inner = b.forBlock({ kind: "listOfCurrent", loop: "?", field: "reasons" }, [item]);
    const head = b.paragraph([b.text("항")], [inner]);
    const outer = b.forBlock({ kind: "planOptions", form: "waiver", filter: "waiver.applies = true" }, [head]);
    inner.source = { kind: "listOfCurrent", loop: outer.id, field: "reasons" };
    const defItem = b.item([b.text("정의")]);
    const union = b.forBlock({ kind: "union", form: "waiver", field: "reasons", filter: "waiver.applies = true" }, [b.paragraph([b.text("정의")], [defItem])]);
    const plain = b.paragraph([b.text("밖")]);
    const doc = b.document("d", [b.article("a", [outer]), b.article("c", [union, plain])]);
    const ix = indexTree(doc);
    expect(currentPlanOf(loopsAround(ix, item.id))).toEqual({ name: "납입면제종마다" });
    expect(currentPlanOf(loopsAround(ix, head.id))).toEqual({ name: "납입면제종마다" });
    expect(currentPlanOf(loopsAround(ix, defItem.id))).toBeUndefined();
    expect(currentPlanOf(loopsAround(ix, plain.id))).toBeUndefined();
    outer.alias = "적용종마다";
    expect(currentPlanOf(loopsAround(ix, item.id))).toEqual({ name: "적용종마다" });
  });
});

describe("문장 안 반복도 감싼 반복이다 (ADR-0088 결정 1 · 3)", () => {
  const E9: EnumDef = {
    code: "E0001",
    label: "납입면제사유",
    fields: [
      { key: "F01", label: "약관표시명", type: "string", order: 1 },
      { key: "F03", label: "정의조대상", type: "boolean", order: 2 },
    ],
    values: [],
  };
  it("본문 자리는 그 반복을 감싼 반복으로 센다 — 「비었을 때」 칸 자리(slot fallback)와 칸 안 노드는 빼고 센다", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const fb = b.text("없음");
    const inline = b.inlineFor({ kind: "planOptions", form: "waiver" }, [b.slot("builtin.plan.name")], { connector: "및", fallback: [fb] });
    const doc = b.document("d", [b.article("a", [b.paragraph([inline])])]);
    const ix = indexTree(doc);
    expect(loopsAround(ix, inline.id).map((l) => l.id)).toEqual([inline.id]);
    expect(loopsAround(ix, inline.id, "fallback")).toEqual([]);
    expect(loopsAround(ix, fb.id)).toEqual([]);
    expect(currentPlanOf(loopsAround(ix, inline.id))).toEqual({ name: "납입면제종마다" });
    expect(currentPlanOf(loopsAround(ix, inline.id, "fallback"))).toBeUndefined();
  });

  it("「현재 값」 — 감싼 반복 중 원소가 열거값인 가장 안쪽 반복의 이름 · 열거형의 글 필드", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const inline = b.inlineFor({ kind: "listOfCurrent", loop: "?", field: "reasons" }, [b.text("x")], { connector: "및" });
    const outer = b.forBlock({ kind: "planOptions", form: "waiver" }, [b.paragraph([inline])]);
    inline.source = { kind: "listOfCurrent", loop: outer.id, field: "reasons" };
    const doc = b.document("d", [b.article("a", [outer])]);
    const ix = indexTree(doc);
    const enumOf9 = (c: string) => (c === "E0001" ? E9 : undefined);
    expect(currentValueOf(loopsAround(ix, inline.id), { enumOf: enumOf9 })).toEqual({ name: "납입면제사유마다", fields: [{ key: "F01", label: "약관표시명" }] });
    expect(currentValueOf(loopsAround(ix, outer.id), { enumOf: enumOf9 })).toBeUndefined();
    expect(currentPlanOf(loopsAround(ix, inline.id))).toEqual({ name: "납입면제종마다" });
  });
});

describe("담보 트리 원천 고르기 (ADR-0087 결정 5)", () => {
  it("담보약관 반복 밖이면 트리 원천 둘이 맨 앞, 보통약관에는 없다", () => {
    const special = repeatChoices({ depth: 0, hasCoverage: true }).map((c) => c.label);
    expect(special.slice(0, 2)).toEqual(["세부보장마다", "세부보장 › 급부마다"]);
    expect(repeatChoices({ depth: 0 }).some((c) => c.label === "세부보장마다")).toBe(false);
  });

  it("세부보장마다 안에는 「현재 세부보장의 급부마다」만 · 종 반복 안에는 트리 원천이 없다", () => {
    const outer = { kind: "forBlock", id: "o", source: { kind: "subCoverages" }, children: [] } as unknown as ForBlockNode;
    expect(repeatChoices({ outer, depth: 1, hasCoverage: true }).map((c) => c.label)).toEqual(["현재 세부보장의 급부마다"]);
    const plan = { kind: "forBlock", id: "p", source: { kind: "planOptions", form: "waiver" }, children: [] } as unknown as ForBlockNode;
    expect(repeatChoices({ outer: plan, depth: 1, hasCoverage: true }).some((c) => c.source.kind === "benefitsOfCurrent")).toBe(false);
  });
});
