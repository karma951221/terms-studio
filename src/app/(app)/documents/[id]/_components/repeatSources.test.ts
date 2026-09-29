import { describe, expect, it } from "vitest";

import type { EnumDef } from "@/domain/catalog";
import { indexTree, nodeBuilders, sequentialIds } from "@/domain/document";

import { loopChoices, loopsAround, repeatChoices, sourceOfValue, sourceValue } from "./repeatSources";

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
});
