import { describe, expect, it } from "vitest";

import { effectiveGroups, groupedCoverageIds, groupKey, planProductGroups, sortInGroup, type GroupPlanContext, type ProductGroup } from "./groups";
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

describe("상품 그룹 목록 (ADR-0090 결정 5) — 기본 그룹(담보분류) · 사용자 그룹이 한 목록", () => {
  const order = ["V01", "V02", "V03"];
  it("아무것도 저장하지 않은 상품은 이 상품에 있는 기본 그룹만 열거형 값 순서", () => {
    expect(effectiveGroups([], new Set(["V02", "V01"]), order)).toEqual([{ kind: "category", code: "V01" }, { kind: "category", code: "V02" }]);
  });

  it("저장된 순서를 따르고, 목록에 자리가 없는 기본 그룹은 그 뒤 열거형 값 순서 · 이 상품에 없는 기본 그룹은 빠진다", () => {
    const saved: ProductGroup[] = [{ kind: "category", code: "V02" }, { kind: "user", id: "g1", name: "뇌 관련 특별약관" }, { kind: "category", code: "V03" }];
    expect(effectiveGroups(saved, new Set(["V01", "V02"]), order).map(groupKey)).toEqual(["category:V02", "g1", "category:V01"]);
  });

  it("열거형에 없는 담보분류(지운 값)는 기본 그룹이 되지 않는다", () => {
    expect(effectiveGroups([{ kind: "category", code: "V09" }], new Set(["V09", "V01"]), order).map(groupKey)).toEqual(["category:V01"]);
  });
});

describe("그룹을 읽는 담보 (ADR-0090 결정 7) — 특약 담보 + 기본계약 2+ 의 기본계약 담보", () => {
  it("기본계약 하나(대치 형태)의 기본계약은 보통약관 조 자리라 그룹을 읽지 않는다 — 특약 담보만, 처음 나온 순 · 중복 없음", () => {
    expect(groupedCoverageIds([{ coverageId: "c-base", base: true }, { coverageId: "c1", base: false }, { coverageId: "c2", base: false }, { coverageId: "c1", base: false }])).toEqual(["c1", "c2"]);
  });
  it("기본계약이 둘 이상(케이스 2 — 제2절 블록)이면 기본계약 담보도 — 같은 그룹 목록이 블록과 특약 그룹 둘 다의 순서다", () => {
    expect(groupedCoverageIds([{ coverageId: "c-b1", base: true }, { coverageId: "c1", base: false }, { coverageId: "c-b2", base: true }])).toEqual(["c-b1", "c1", "c-b2"]);
  });
});

describe("상품 그룹 저장 계획 (ADR-0090 결정 4 · 5 · 기능/상품 §4.5) — 검사 · 정리", () => {
  let n = 0;
  const ctx = (over: Partial<GroupPlanContext> = {}): GroupPlanContext => ({
    saved: { groups: [{ kind: "user", id: "g1", name: "뇌 관련 특별약관" }], memberships: [{ coverageId: "cov-stroke", groupId: "g1" }] },
    mountedBefore: new Set(["cov-stroke", "cov-heart", "cov-death"]),
    mountedAfter: new Set(["cov-stroke", "cov-heart", "cov-death"]),
    present: new Set(["V01", "V02"]),
    categoryOrder: ["V01", "V02"],
    categoryTitle: (code) => ({ V01: "상해 관련 특별약관", V02: "질병 관련 특별약관" } as Record<string, string>)[code],
    newId: () => `new-id-${++n}`,
    ...over,
  });

  it("입력이 없으면 저장본 — 탑재 해제로 빠진 담보의 소속 · 이 상품에 없는 기본 그룹을 지운다", () => {
    const r = planProductGroups(undefined, ctx({ saved: { groups: [{ kind: "category", code: "V03" }, { kind: "user", id: "g1", name: "뇌" }], memberships: [{ coverageId: "cov-stroke", groupId: "g1" }] }, mountedAfter: new Set(["cov-heart"]) }));
    expect(r).toEqual({ ok: true, value: { groups: [{ kind: "user", id: "g1", name: "뇌" }], memberships: [] } });
  });

  it("새 사용자 그룹은 id 를 받고, 소속은 그 그룹 열쇠로 가리킨다 · 이름은 앞뒤 공백을 지운다", () => {
    const r = planProductGroups(
      {
        list: [{ kind: "category", code: "V01" }, { kind: "user", key: "g1", id: "g1", name: "뇌 관련 특별약관" }, { kind: "user", key: "newgroup:1", name: " 심장 관련 특별약관 " }, { kind: "category", code: "V02" }],
        memberships: [{ coverageId: "cov-stroke", group: "g1" }, { coverageId: "cov-heart", group: "newgroup:1" }],
      },
      ctx(),
    );
    if (!r.ok) throw new Error(JSON.stringify(r.rejection));
    const heart = r.value.groups[2];
    expect(heart).toMatchObject({ kind: "user", name: "심장 관련 특별약관" });
    expect(r.value.groups.map((g) => (g.kind === "category" ? g.code : g.name))).toEqual(["V01", "뇌 관련 특별약관", "심장 관련 특별약관", "V02"]);
    expect(r.value.memberships).toEqual([{ coverageId: "cov-stroke", groupId: "g1" }, { coverageId: "cov-heart", groupId: (heart as { id: string }).id }]);
  });

  it("빈 이름 · 다른 그룹 제목(기본 그룹의 「그룹 제목」 포함)과 같은 이름은 거부 — 좌표는 그 그룹 줄", () => {
    const r = planProductGroups(
      {
        list: [{ kind: "category", code: "V01" }, { kind: "user", key: "newgroup:1", name: "  " }, { kind: "user", key: "newgroup:2", name: "상해 관련 특별약관" }, { kind: "user", key: "g1", id: "g1", name: "뇌" }, { kind: "user", key: "newgroup:3", name: "뇌" }],
        memberships: [],
      },
      ctx(),
    );
    if (r.ok || r.rejection.reason !== "invalid") throw new Error("기대: invalid");
    expect(r.rejection.issues.map((i) => [i.at.ownerId, i.message])).toEqual([
      ["newgroup:1", "그룹 이름은 비울 수 없습니다"],
      ["newgroup:2", "이 상품의 다른 그룹 제목과 같습니다 — 「상해 관련 특별약관」"],
      ["newgroup:3", "이 상품의 다른 그룹 제목과 같습니다 — 「뇌」"],
    ]);
  });

  it("담보 하나는 사용자 그룹 하나에만 · 없는 그룹 · 이 상품 특약이 아닌 담보 · 다른 상품의 그룹 id 는 거부", () => {
    const r = planProductGroups(
      {
        list: [{ kind: "user", key: "g1", id: "g1", name: "뇌" }, { kind: "user", key: "g9", id: "g9", name: "남의 그룹" }],
        memberships: [{ coverageId: "cov-stroke", group: "g1" }, { coverageId: "cov-stroke", group: "g1" }, { coverageId: "cov-heart", group: "newgroup:7" }, { coverageId: "cov-other", group: "g1" }],
      },
      ctx(),
    );
    if (r.ok || r.rejection.reason !== "invalid") throw new Error("기대: invalid");
    expect(r.rejection.issues.map((i) => [i.at.ownerId, i.kind])).toEqual([
      ["g9", "brokenRef"],
      ["g1", "typeMismatch"],
      ["newgroup:7", "brokenRef"],
      ["g1", "brokenRef"],
    ]);
  });

  it("같은 저장에서 탑재 해제한 담보의 소속 · 이 상품에 없게 된 기본 그룹은 조용히 빠진다", () => {
    const r = planProductGroups(
      { list: [{ kind: "category", code: "V02" }, { kind: "user", key: "g1", id: "g1", name: "뇌" }, { kind: "category", code: "V01" }], memberships: [{ coverageId: "cov-stroke", group: "g1" }] },
      ctx({ mountedAfter: new Set(["cov-heart"]), present: new Set(["V01"]) }),
    );
    expect(r).toEqual({ ok: true, value: { groups: [{ kind: "user", id: "g1", name: "뇌" }, { kind: "category", code: "V01" }], memberships: [] } });
  });
});
