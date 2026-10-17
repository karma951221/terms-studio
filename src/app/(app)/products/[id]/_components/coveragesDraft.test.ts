import { describe, expect, it } from "vitest";

import type { AttributeKind, ProductCoverage, ProductGroupSetting } from "@/domain/product";
import type { Issue } from "@/domain/types";

import {
  addRowProblem,
  coveragesDraftDirty,
  coveragesDraftReducer,
  displayGroups,
  freeCoverages,
  groupCoverages,
  groupOfCoverage,
  initCoveragesDraft,
  issuesByRow,
  rowStatus,
  toCoveragesInput,
  type CoveragesDraft,
  type GroupContext,
  type NewRowInput,
} from "./coveragesDraft";

/**
 * 상품담보 탭의 편집 초안 (기능/상품 §3.8 · §4.5, 2026-10-04) — 추가 · 상품담보명 · 세목 부착/해제 · 탑재 해제(되돌리기)를 초안에만 쌓고
 * `저장` 한 번이 바뀐 것만 `saveCoverages` 입력으로 보낸다. 순수.
 */

const kinds: AttributeKind[] = [{ code: "A0001", label: "부가유형", order: 0, values: [{ code: "1", label: "기본", fragment: "" }, { code: "2", label: "추가", fragment: "추가" }] }] as AttributeKind[];
const pc = (id: string, coverageId: string, name: string, attributes: ProductCoverage["attributes"] = []): ProductCoverage => ({ id, productId: "p", coverageId, name, attributes });

const base = [pc("b1", "c-base", "기본계약")];
const special = [pc("s1", "c-death", "사망", [{ kindCode: "A0001", valueCode: "1" }]), pc("s2", "c-surgery", "수술비")];
const saved = (): CoveragesDraft => initCoveragesDraft(base, special, { s1: ["plan-1"] });
const newRow = (over: Partial<NewRowInput> = {}): NewRowInput => ({ section: "special", coverageId: "c-death", coverageCode: "COV000002", coverageName: "사망", attributes: [{ kindCode: "A0001", valueCode: "2" }], name: "사망 추가", ...over });

describe("coveragesDraft — 초안 만들기 · 고치기", () => {
  it("저장본으로 시작한다 — 절 · 이름 · 부착 그대로, 바뀐 것 없음", () => {
    const d = saved();
    expect(d.rows.map((r) => [r.key, r.section, r.name, r.plans, r.status])).toEqual([
      ["b1", "base", "기본계약", [], "saved"],
      ["s1", "special", "사망", ["plan-1"], "saved"],
      ["s2", "special", "수술비", [], "saved"],
    ]);
    expect(coveragesDraftDirty(saved(), d)).toBe(false);
    expect(toCoveragesInput(saved(), d)).toEqual({ added: [], updated: [], removed: [] });
  });

  it("추가 — 행 열쇠 new:N 으로 그 절 끝에 「추가」 행, 저장 입력의 added", () => {
    let d = coveragesDraftReducer(saved(), { type: "add", row: newRow() });
    d = coveragesDraftReducer(d, { type: "add", row: newRow({ section: "base", coverageId: "c-x", coverageName: "X", attributes: [], name: "X" }) });
    expect(d.rows.map((r) => [r.key, r.status])).toEqual([
      ["b1", "saved"],
      ["s1", "saved"],
      ["s2", "saved"],
      ["new:1", "added"],
      ["new:2", "added"],
    ]);
    expect(toCoveragesInput(saved(), d).added).toEqual([
      { key: "new:1", coverageId: "c-death", attributes: [{ kindCode: "A0001", valueCode: "2" }], section: "special", name: "사망 추가", plans: [] },
      { key: "new:2", coverageId: "c-x", attributes: [], section: "base", name: "X", plans: [] },
    ]);
    expect(coveragesDraftDirty(saved(), d)).toBe(true);
  });

  it("이름 · 세목 부착 · 해제 — 기존 행은 「변경」, 저장 입력의 updated(최종 이름 · 최종 부착 목록). 되돌려 같아지면 변경이 아니다", () => {
    let d = coveragesDraftReducer(saved(), { type: "rename", key: "s2", name: "수술비 Ⅱ" });
    d = coveragesDraftReducer(d, { type: "attach", key: "s2", planId: "plan-2" });
    d = coveragesDraftReducer(d, { type: "attach", key: "s2", planId: "plan-2" }); // 같은 조합 두 번은 한 번
    d = coveragesDraftReducer(d, { type: "detach", key: "s1", planId: "plan-1" });
    expect(rowStatus(saved(), d, "s2")).toBe("changed");
    expect(rowStatus(saved(), d, "s1")).toBe("changed");
    expect(toCoveragesInput(saved(), d).updated).toEqual([
      { id: "s1", name: "사망", plans: [] },
      { id: "s2", name: "수술비 Ⅱ", plans: ["plan-2"] },
    ]);
    d = coveragesDraftReducer(d, { type: "rename", key: "s2", name: "수술비" });
    d = coveragesDraftReducer(d, { type: "detach", key: "s2", planId: "plan-2" });
    d = coveragesDraftReducer(d, { type: "attach", key: "s1", planId: "plan-1" });
    expect(coveragesDraftDirty(saved(), d)).toBe(false);
    expect(toCoveragesInput(saved(), d)).toEqual({ added: [], updated: [], removed: [] });
  });

  it("탑재 해제 — 기존 행은 「삭제」 표시(되돌리기 가능), 추가 행은 초안에서 빠진다", () => {
    let d = coveragesDraftReducer(saved(), { type: "remove", key: "s1" });
    expect(rowStatus(saved(), d, "s1")).toBe("removed");
    expect(toCoveragesInput(saved(), d).removed).toEqual(["s1"]);
    // 지우는 행의 이름 · 부착은 보내지 않는다
    d = coveragesDraftReducer(d, { type: "rename", key: "s1", name: "x" });
    expect(toCoveragesInput(saved(), d).updated).toEqual([]);
    d = coveragesDraftReducer(d, { type: "restore", key: "s1" });
    expect(rowStatus(saved(), d, "s1")).toBe("changed"); // 이름은 x 로 남는다
    d = coveragesDraftReducer(d, { type: "rename", key: "s1", name: "사망" });
    expect(coveragesDraftDirty(saved(), d)).toBe(false);

    d = coveragesDraftReducer(d, { type: "add", row: newRow() });
    d = coveragesDraftReducer(d, { type: "remove", key: "new:1" });
    expect(d.rows.some((r) => r.key === "new:1")).toBe(false);
    expect(coveragesDraftDirty(saved(), d)).toBe(false);
  });

  it("reset — 편집 시작마다 저장본으로", () => {
    const d = coveragesDraftReducer(coveragesDraftReducer(saved(), { type: "remove", key: "b1" }), { type: "reset", draft: saved() });
    expect(d).toEqual(saved());
  });
});

describe("addRowProblem — 「+ 담보 추가」 줄의 화면 검사(서버가 다시 본다)", () => {
  const opts = { kinds, standalone: false };

  it("담보를 안 골랐으면 추가하지 않는다", () => {
    expect(addRowProblem(saved(), newRow({ coverageId: "" }), opts)).toBe("담보를 고르세요");
  });

  it("남는 행 · 추가 행과 같은 담보 × 담보속성 조합이면 거부 — 지울 행의 조합은 비어 있다", () => {
    expect(addRowProblem(saved(), newRow({ attributes: [{ kindCode: "A0001", valueCode: "1" }] }), opts)).toBe("이미 탑재한 조합입니다 — 「사망」");
    const removed = coveragesDraftReducer(saved(), { type: "remove", key: "s1" });
    expect(addRowProblem(removed, newRow({ attributes: [{ kindCode: "A0001", valueCode: "1" }] }), opts)).toBeUndefined();
    const added = coveragesDraftReducer(saved(), { type: "add", row: newRow() });
    expect(addRowProblem(added, newRow(), opts)).toBe("이미 탑재한 조합입니다 — 「사망 추가」");
  });

  it("주계약은 기본계약을 더 둘 수 있다(2개 이상 = 절 형태) · 독립특약은 기본계약 없음", () => {
    const row = newRow({ section: "base", coverageId: "c-x", attributes: [] });
    expect(addRowProblem(saved(), row, opts)).toBeUndefined();
    expect(addRowProblem(initCoveragesDraft([], special, {}), row, { kinds, standalone: true })).toBe("독립특약 상품은 기본계약을 두지 않습니다");
  });
});

describe("issuesByRow — 저장 거부 이슈를 그 행으로", () => {
  it("ownerId = 상품담보 id · 추가 행 key 로 모으고, 좌표 없는 것은 따로", () => {
    const issues: Issue[] = [
      { kind: "typeMismatch", message: "상품담보명은 비울 수 없습니다", at: { document: "special", ownerId: "s1", refPath: "name" } },
      { kind: "typeMismatch", message: "이미 탑재한 조합입니다", at: { document: "special", ownerId: "new:1", refPath: "attributes" } },
      { kind: "brokenRef", message: "그 밖", at: {} },
    ];
    const byRow = issuesByRow(issues);
    expect(byRow.rows.get("s1")).toEqual(["상품담보명은 비울 수 없습니다"]);
    expect(byRow.rows.get("new:1")).toEqual(["이미 탑재한 조합입니다"]);
    expect(byRow.other).toEqual(["그 밖"]);
  });
});

describe("coveragesDraft — 특약 그룹 섹션 (ADR-0090 · 기능/상품 §3.7 · §4.5)", () => {
  // 사망 · 기본계약 = 상해, 수술비 = 질병. 기본계약은 특약 그룹에 들지 않는다
  const category: Record<string, string> = { "c-death": "V01", "c-surgery": "V02", "c-base": "V01" };
  const ctx: GroupContext = { categoryOf: (id) => category[id], categoryOrder: ["V01", "V02", "V03"] };
  const keys = (d: CoveragesDraft) => displayGroups(d, ctx).map((g) => g.key);

  it("저장한 적 없으면 이 상품 특약 담보의 기본 그룹만 열거값 순서 — 그룹을 고치지 않으면 저장 입력에 groups 가 없다", () => {
    const d = saved();
    expect(keys(d)).toEqual(["category:V01", "category:V02"]);
    expect(groupCoverages(d, ctx, displayGroups(d, ctx)[1]!)).toEqual(["c-surgery"]);
    expect(coveragesDraftDirty(saved(), d, ctx)).toBe(false);
    expect(toCoveragesInput(saved(), d, ctx)).toEqual({ added: [], updated: [], removed: [] });
  });

  it("「+ 그룹」은 목록 끝 · 담보를 넣으면 그 담보의 상품담보 전부가 그 그룹 · 표의 그룹 열도 초안을 따른다 → 저장 입력의 groups", () => {
    let d = coveragesDraftReducer(saved(), { type: "addGroup", ctx });
    d = coveragesDraftReducer(d, { type: "renameGroup", key: "newgroup:1", name: "수술 관련 특별약관" });
    d = coveragesDraftReducer(d, { type: "joinGroup", key: "newgroup:1", coverageId: "c-surgery" });
    expect(keys(d)).toEqual(["category:V01", "category:V02", "newgroup:1"]);
    expect(groupOfCoverage(d, ctx, "c-surgery")?.key).toBe("newgroup:1");
    expect(groupOfCoverage(d, ctx, "c-death")?.key).toBe("category:V01");
    expect(freeCoverages(d)).toEqual(["c-death"]);
    expect(coveragesDraftDirty(saved(), d, ctx)).toBe(true);
    expect(toCoveragesInput(saved(), d, ctx).groups).toEqual({
      list: [{ kind: "category", code: "V01" }, { kind: "category", code: "V02" }, { kind: "user", key: "newgroup:1", name: "수술 관련 특별약관" }],
      memberships: [{ coverageId: "c-surgery", group: "newgroup:1" }],
    });
  });

  it("▲▼ — 기본 · 사용자 그룹을 섞어 전체 순서 · 빼면 든 담보는 기본 그룹으로 · 칩 ✕ 도 기본 그룹으로", () => {
    let d = coveragesDraftReducer(saved(), { type: "addGroup", ctx });
    d = coveragesDraftReducer(d, { type: "moveGroup", key: "newgroup:1", dir: -1, ctx });
    expect(keys(d)).toEqual(["category:V01", "newgroup:1", "category:V02"]);
    d = coveragesDraftReducer(d, { type: "moveGroup", key: "category:V01", dir: 1, ctx });
    expect(keys(d)).toEqual(["newgroup:1", "category:V01", "category:V02"]);
    d = coveragesDraftReducer(d, { type: "joinGroup", key: "newgroup:1", coverageId: "c-death" });
    d = coveragesDraftReducer(d, { type: "leaveGroup", coverageId: "c-death" });
    expect(groupOfCoverage(d, ctx, "c-death")?.key).toBe("category:V01");
    d = coveragesDraftReducer(d, { type: "joinGroup", key: "newgroup:1", coverageId: "c-death" });
    d = coveragesDraftReducer(d, { type: "removeGroup", key: "newgroup:1" });
    expect(keys(d)).toEqual(["category:V01", "category:V02"]);
    expect(d.members).toEqual({});
  });

  it("저장된 그룹으로 시작 — 사용자 그룹 열쇠는 그 id · 탑재 해제로 담보가 빠지면 소속과 비게 된 기본 그룹이 목록에서 빠지고, 되돌리면 제자리", () => {
    const groups: ProductGroupSetting = { groups: [{ kind: "category", code: "V02" }, { kind: "user", id: "g1", name: "사망" }, { kind: "category", code: "V01" }], memberships: [{ coverageId: "c-death", groupId: "g1" }] };
    const start = () => initCoveragesDraft(base, special, {}, groups);
    expect(keys(start())).toEqual(["category:V02", "g1", "category:V01"]);
    expect(toCoveragesInput(start(), start(), ctx)).toEqual({ added: [], updated: [], removed: [] });
    let d = coveragesDraftReducer(start(), { type: "remove", key: "s2" }); // 수술비(질병) 탑재 해제
    expect(keys(d)).toEqual(["g1", "category:V01"]);
    d = coveragesDraftReducer(d, { type: "remove", key: "s1" }); // 사망 탑재 해제 — 소속도 빠진다
    expect(groupCoverages(d, ctx, displayGroups(d, ctx)[0]!)).toEqual([]);
    expect(toCoveragesInput(start(), d, ctx).groups?.memberships).toEqual([]);
    d = coveragesDraftReducer(coveragesDraftReducer(d, { type: "restore", key: "s2" }), { type: "restore", key: "s1" });
    expect(keys(d)).toEqual(["category:V02", "g1", "category:V01"]);
    expect(coveragesDraftDirty(start(), d, ctx)).toBe(false);
  });

  it("탑재로 새로 생긴 기본 그룹은 목록 끝", () => {
    const groups: ProductGroupSetting = { groups: [{ kind: "category", code: "V02" }, { kind: "user", id: "g1", name: "사망" }], memberships: [] };
    const d = coveragesDraftReducer(initCoveragesDraft([], [pc("s2", "c-surgery", "수술비")], {}, groups), { type: "add", row: newRow({ coverageId: "c-death" }) });
    expect(keys(d)).toEqual(["category:V02", "g1", "category:V01"]);
  });
});
