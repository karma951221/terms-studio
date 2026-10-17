/**
 * 동적표 저장 검사 — 기능/동적표 §3.6 「저장 검사(동적표 정의)」.
 */
import { describe, expect, it } from "vitest";

import type { Inline } from "../clause/nodes";
import { checkDynTable } from "./check";
import { dynTableFixtureA, dynTableFixtureAPrime, dynTableFixtureR } from "./fixture";
import { DYN_TABLE_SLOTS, type NewDynTable } from "./types";

const text = (id: string, t: string): Inline => ({ id, kind: "text", text: t });
const slot = (id: string, ref: string): Inline => ({ id, kind: "slot", ref });

function withHeaders(base: NewDynTable, over: Partial<NewDynTable["headers"]>): NewDynTable {
  return { ...base, headers: { ...base.headers, ...over } };
}

describe("checkDynTable", () => {
  it("표본 정의 A · A′ · R 은 통과한다", () => {
    expect(checkDynTable(dynTableFixtureA())).toEqual([]);
    expect(checkDynTable(dynTableFixtureAPrime())).toEqual([]);
    expect(checkDynTable(dynTableFixtureR())).toEqual([]);
  });

  it("이름이 비면 structure", () => {
    expect(checkDynTable({ ...dynTableFixtureA(), label: " " })).toEqual([expect.objectContaining({ kind: "structure", at: expect.objectContaining({ refPath: "label" }) })]);
  });

  it("선언되지 않은 인자를 읽으면 brokenRef — 조건 · 슬롯 모두", () => {
    const noParams = { ...dynTableFixtureAPrime(), params: [] };
    const issues = checkDynTable(noParams);
    expect(issues.length).toBeGreaterThan(0);
    for (const i of issues) expect(i.kind).toBe("brokenRef");
    expect(issues.map((i) => i.at.refPath)).toEqual(expect.arrayContaining(["headers.first", "headers.middle", "headers.last"]));
    expect(issues.some((i) => i.message.includes("arg.갱신형"))).toBe(true);
    expect(issues.some((i) => i.message.includes("arg.단서"))).toBe(true);
  });

  it("인자 표 검사 — 이름 규칙 · 조 참조 인자 불가", () => {
    const bad: NewDynTable = { ...dynTableFixtureA(), params: [{ name: "갱신 형", type: { kind: "boolean" } }] };
    expect(checkDynTable(bad)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "structure", at: expect.objectContaining({ refPath: "arg.갱신 형" }) })]));
    const articleRef: NewDynTable = { ...dynTableFixtureA(), params: [{ name: "갱신형", type: { kind: "boolean" } }, { name: "지급사유 조", type: { kind: "articleRef" } }] };
    expect(checkDynTable(articleRef)).toEqual([expect.objectContaining({ kind: "structure", at: expect.objectContaining({ refPath: "arg.지급사유 조" }) })]);
  });

  it("템플릿마다 쓸 수 있는 표 슬롯 — 단일 열에 경계 · 첫 열에 앞경계 · 셀에 경계 · 머리글에 비율은 structure", () => {
    const a = dynTableFixtureA();
    const single = withHeaders(a, { single: [text("s1", "지급금액 "), slot("s2", DYN_TABLE_SLOTS.boundary)] });
    expect(checkDynTable(single)).toEqual([expect.objectContaining({ kind: "structure", at: expect.objectContaining({ refPath: "headers.single", nodePath: ["s2"] }) })]);
    const first = withHeaders(a, { first: [slot("f1", DYN_TABLE_SLOTS.prevBoundary)] });
    expect(checkDynTable(first)).toEqual([expect.objectContaining({ kind: "structure", at: expect.objectContaining({ refPath: "headers.first" }) })]);
    const cell = { ...a, cell: [slot("c1", DYN_TABLE_SLOTS.boundary)] };
    expect(checkDynTable(cell)).toEqual([expect.objectContaining({ kind: "structure", at: expect.objectContaining({ refPath: "cell" }) })]);
    const last = withHeaders(a, { last: [slot("l1", DYN_TABLE_SLOTS.rate)] });
    expect(checkDynTable(last)).toEqual([expect.objectContaining({ kind: "structure", at: expect.objectContaining({ refPath: "headers.last" }) })]);
    // 가운데 열은 경계 · 앞경계 둘 다 된다
    const middle = withHeaders(a, { middle: [slot("m1", DYN_TABLE_SLOTS.prevBoundary), slot("m2", DYN_TABLE_SLOTS.boundary)] });
    expect(checkDynTable(middle)).toEqual([]);
  });

  it("동적표 템플릿은 인자와 표 슬롯만 읽는다 — 구분자 · 세목 필드 · 담보속성 슬롯 · 조건은 structure", () => {
    const a = dynTableFixtureA();
    const disc = { ...a, cell: [slot("c1", "D0001")] };
    const issues = checkDynTable(disc);
    expect(issues).toEqual([expect.objectContaining({ kind: "structure", at: expect.objectContaining({ refPath: "cell", nodePath: ["c1"] }) })]);
    expect(issues[0].message).toContain("동적표 템플릿은 인자와 표 슬롯만 읽는다");
    const master = withHeaders(a, { single: [slot("s1", "pay.rate")] });
    expect(checkDynTable(master)).toEqual([expect.objectContaining({ kind: "structure" })]);
    const cond = withHeaders(a, { single: [{ id: "s1", kind: "inlineCond", branches: [{ id: "s1-b", when: "D0001 and exist(attr.X)", children: [] }] }] });
    const condIssues = checkDynTable(cond);
    expect(condIssues).toHaveLength(2); // D0001 · attr.X 하나씩
    for (const i of condIssues) expect(i).toEqual(expect.objectContaining({ kind: "structure", at: expect.objectContaining({ refPath: "headers.single", nodePath: ["s1", "s1-b"] }) }));
  });

  it("허용 노드 종류 밖(조 참조 · 별표 · 옵션 자리)은 structure", () => {
    const a = dynTableFixtureA();
    const bad = { ...a, cell: [...a.cell, { id: "x1", kind: "appendixRef", appendixCode: "A01" } as Inline] };
    expect(checkDynTable(bad)).toEqual([expect.objectContaining({ kind: "structure", at: expect.objectContaining({ refPath: "cell", nodePath: ["x1"] }) })]);
    const bad2 = withHeaders(a, { single: [{ id: "x2", kind: "optionSlot", optionCode: "O01" }] });
    expect(checkDynTable(bad2)).toEqual([expect.objectContaining({ kind: "structure" })]);
    // 글 · 조사 · 조건 · 값별 분기는 된다
    const ok = withHeaders(a, { single: [text("t", "지급"), { id: "p", kind: "particle", preset: "eun-neun" } as Inline] });
    expect(checkDynTable(ok)).toEqual([]);
  });

  it("조건 · 슬롯 식의 문법 오류는 syntax", () => {
    const a = dynTableFixtureA();
    const bad = withHeaders(a, { single: [{ id: "s1", kind: "inlineCond", branches: [{ id: "s1-b", when: "arg.갱신형 and", children: [] }] }] });
    expect(checkDynTable(bad)).toEqual([expect.objectContaining({ kind: "syntax", at: expect.objectContaining({ refPath: "headers.single" }) })]);
    const badSlot = { ...a, cell: [slot("c1", "arg.")] };
    expect(checkDynTable(badSlot)).toEqual([expect.objectContaining({ kind: "syntax", at: expect.objectContaining({ refPath: "cell" }) })]);
  });

  it("인라인 조건 안의 조건 · else 가지 위치는 함수조항과 같은 규칙", () => {
    const a = dynTableFixtureA();
    const nested = withHeaders(a, {
      single: [{ id: "s1", kind: "inlineCond", branches: [{ id: "s1-b", when: "arg.갱신형", children: [{ id: "s2", kind: "inlineCond", branches: [{ id: "s2-b", children: [] }] }] }] }],
    });
    expect(checkDynTable(nested)).toEqual([expect.objectContaining({ kind: "structure", at: expect.objectContaining({ nodePath: ["s1", "s1-b", "s2"] }) })]);
    const elseFirst = withHeaders(a, { single: [{ id: "s1", kind: "inlineCond", branches: [{ id: "s1-b1", children: [] }, { id: "s1-b2", when: "arg.갱신형", children: [] }] }] });
    expect(checkDynTable(elseFirst)).toEqual([expect.objectContaining({ kind: "structure", at: expect.objectContaining({ nodePath: ["s1", "s1-b1"] }) })]);
  });

  it("값별 분기 — 대상은 열거형 인자, 칸 값은 그 열거형의 값(enumValues 를 주면)", () => {
    const a = dynTableFixtureA();
    const withEnum: NewDynTable = {
      ...a,
      params: [...a.params, { name: "사유", type: { kind: "enum", enumCode: "E1" } }],
      cell: [{ id: "sw", kind: "inlineSwitch", on: "arg.사유", cases: [{ id: "k1", values: ["V1"], children: [text("k1-t", "하나")] }, { id: "k2", values: ["V9"], children: [] }] }],
    };
    const env = { enumValues: (code: string) => (code === "E1" ? ["V1", "V2"] : undefined) };
    const issues = checkDynTable(withEnum, env);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "brokenRef", at: expect.objectContaining({ refPath: "V9", nodePath: ["sw", "k2"] }) }),
        expect.objectContaining({ kind: "unassignedValue", at: expect.objectContaining({ refPath: "V2" }) }),
      ]),
    );
    // 열거형 값 조회가 없으면 칸 값은 보지 않는다
    expect(checkDynTable(withEnum)).toEqual([]);
    // 대상이 열거형 인자가 아니면 typeMismatch
    const onBool = { ...withEnum, cell: [{ id: "sw", kind: "inlineSwitch", on: "arg.갱신형", cases: [{ id: "k1", values: ["V1"], children: [] }] } as Inline] };
    expect(checkDynTable(onBool)).toEqual([expect.objectContaining({ kind: "typeMismatch", at: expect.objectContaining({ refPath: "cell", nodePath: ["sw"] }) })]);
  });

  it("노드 id 는 정의 전체(머리글 네 벌 + 셀)에서 유일", () => {
    const a = dynTableFixtureA();
    const dup = withHeaders(a, { single: [text("cell-t1", "지급금액")] });
    expect(checkDynTable(dup)).toEqual([expect.objectContaining({ kind: "structure", at: expect.objectContaining({ nodePath: ["cell-t1"] }) })]);
  });
});
