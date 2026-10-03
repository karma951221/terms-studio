import { describe, expect, it } from "vitest";

import { sortInGroup } from "./groups";
import type { AttributeKind, ProductCoverage } from "./types";

const renewal: AttributeKind = {
  code: "A0001",
  label: "갱신유형",
  order: 1,
  values: [
    { code: "1", label: "비갱신형", fragment: "" },
    { code: "2", label: "갱신형", fragment: "갱신형" },
  ],
};
const addon: AttributeKind = {
  code: "A0002",
  label: "부가유형",
  order: 0,
  values: [
    { code: "1", label: "기본", fragment: "" },
    { code: "2", label: "추가", fragment: "추가" },
  ],
};
const kinds = [renewal, addon];

function pc(id: string, coverageId: string, name: string, attributes: ProductCoverage["attributes"]): ProductCoverage {
  return { id, productId: "p1", coverageId, name, attributes };
}

describe("기능/상품 §3.7 특약 그룹 — 그룹 안 자동 정렬", () => {
  it("담보 → 담보속성 종류(order) → 유효값(order) 오름차순. 같은 담보의 탑재분은 뭉친다", () => {
    const members = [
      pc("c", "cov-surgery", "갱신형 수술비", [{ kindCode: "A0001", valueCode: "2" }]),
      pc("b", "cov-death", "일반상해사망 추가", [{ kindCode: "A0002", valueCode: "2" }]),
      pc("d", "cov-death", "갱신형 일반상해사망", [{ kindCode: "A0001", valueCode: "2" }]),
      pc("a", "cov-death", "일반상해사망", []),
      pc("e", "cov-surgery", "수술비", []),
    ];
    const coverageOrder = new Map([
      ["cov-death", 0],
      ["cov-surgery", 1],
    ]);
    const sorted = sortInGroup(members, kinds, (id) => coverageOrder.get(id) ?? Number.MAX_SAFE_INTEGER);
    // 담보 death 먼저. 종류 order 0 = 부가유형: 미사용 < 기본 < 추가. 그 다음 갱신유형.
    expect(sorted.map((m) => m.name)).toEqual(["일반상해사망", "갱신형 일반상해사망", "일반상해사망 추가", "수술비", "갱신형 수술비"]);
  });

  it("담보 순서 함수가 없으면 담보 id 문자열 순 — 입력 배열은 바꾸지 않는다", () => {
    const members = [pc("x", "cov-b", "B", []), pc("y", "cov-a", "A", [])];
    const sorted = sortInGroup(members, kinds);
    expect(sorted.map((m) => m.name)).toEqual(["A", "B"]);
    expect(members[0].name).toBe("B");
  });

  it("미사용 속성은 사용한 것보다 앞 — 「일반상해사망」이 「일반상해사망 추가」보다 먼저", () => {
    const members = [pc("b", "cov", "일반상해사망 추가", [{ kindCode: "A0002", valueCode: "2" }]), pc("a", "cov", "일반상해사망", [])];
    expect(sortInGroup(members, kinds).map((m) => m.id)).toEqual(["a", "b"]);
  });
});
