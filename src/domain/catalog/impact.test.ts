import { describe, expect, it } from "vitest";

import type { Coordinate } from "../types";
import { cascadeOf, computeImpact, enumReferences, NO_VALUE_STORE, type ImpactSource } from "./impact";
import type { EnumDef } from "./types";

const 납입면제사유: EnumDef = {
  code: "E0001",
  label: "납입면제사유",
  values: [
    { code: "V01", label: "질병", order: 0 },
    { code: "V02", label: "상해", order: 1 },
  ],
};

describe("구분자정의 S6 · 역할권한 S3 — 영향(Impact) 계산", () => {
  it("기본 ImpactSource(NO_VALUE_STORE) 는 값 행 0 · 참조 없음", async () => {
    const impact = await computeImpact({ kind: "discriminator", code: "D0002" }, NO_VALUE_STORE);
    expect(impact).toEqual({ valueRowsLost: 0, brokenRefs: [], cascade: [] });
  });

  it("주입된 ImpactSource 가 준 값 행 수·참조 목록이 Impact 에 실린다", async () => {
    const ref: Coordinate = { document: "special", ownerName: "일반상해사망", refPath: "D0001" };
    const source: ImpactSource = {
      countValueRows: async () => 7,
      findBrokenRefs: async () => [ref],
      purgeValueRows: async () => {},
    };
    const impact = await computeImpact({ kind: "enumValue", enumCode: "E0001", valueCode: "V01" }, source);
    expect(impact).toEqual({ valueRowsLost: 7, brokenRefs: [ref], cascade: [] });
  });

  it("enum 삭제의 cascade 는 값들이다 — 구분자는 하위 실체가 없다 (식 하나라서)", () => {
    expect(cascadeOf(납입면제사유)).toEqual(["값 질병(V01)", "값 상해(V02)"]);
    expect(cascadeOf({ code: "D0001" })).toEqual([]);
  });

  it("enum 을 타입으로 쓰는 마스터 필드가 깨질 참조다 — 마스터는 코드라 삭제로 끊을 수 없다", () => {
    expect(enumReferences("E0001")).toEqual([
      { refPath: "waiver.reasons", ownerName: "세목 · 납입면제 › 납입면제사유" },
    ]);
    expect(enumReferences("E0002")).toEqual([
      { refPath: "no_surrender.type", ownerName: "세목 · 무저해지 › 유형" },
    ]);
    expect(enumReferences("E0009")).toEqual([]);
  });

  it("추가 cascade·참조를 합쳐 Impact 를 만든다", async () => {
    const source: ImpactSource = {
      countValueRows: async () => 2,
      findBrokenRefs: async () => [{ refPath: "D0009", document: "clause" }],
      purgeValueRows: async () => {},
    };
    const impact = await computeImpact({ kind: "enum", enumCode: "E0001" }, source, {
      cascade: cascadeOf(납입면제사유),
      brokenRefs: enumReferences("E0001"),
    });
    expect(impact.valueRowsLost).toBe(2);
    expect(impact.brokenRefs).toHaveLength(2);
    expect(impact.cascade).toEqual(["값 질병(V01)", "값 상해(V02)"]);
  });
});
