import { describe, expect, it } from "vitest";

import type { Discriminator } from "@/domain/catalog";
import { surgery } from "@/domain/coverage";
import { emptyRows } from "@/domain/document";

import { buildConditionContext } from "./conditionContext";
import { addRow, compact, headOf, pickerGroups, refKey, refOfKey, removeRow, setLeft, sourceOf } from "./rows";

const defs: Discriminator[] = [
  { code: "D0002", label: "감액여부", level: "benefit", expression: "exist(reduction.periods)", description: "" },
  { code: "D0007", label: "감액여부", level: "subCoverage", expression: "any(D0002)", description: "" },
  { code: "D0009", label: "감액여부", level: "coverage", expression: "any(D0002)", description: "" },
  { code: "D0001", label: "담보명", level: "coverage", expression: "coverage_basic.claim_name", description: "" },
];

describe("조건 머리 줄 — 줄 ⇄ 식 (기능/문면 §4.3, 2026-09-28)", () => {
  it("빈 식은 빈 줄 하나, 빈 줄은 빈 식 — 새 조건 블록의 IF 줄", () => {
    expect(headOf("")).toEqual({ kind: "rows", rows: emptyRows() });
    expect(headOf(undefined)).toEqual({ kind: "rows", rows: emptyRows() });
    expect(sourceOf({ kind: "rows", rows: emptyRows() })).toBe("");
  });

  it("줄로 풀고 다시 묶으면 같은 식 — AND · OR · 노드 한정자 · 문자열", () => {
    for (const source of ["D0009 = true", "D0009 = true and D0001 = '수술비'", "D0007@n1 = true or D0009 = false", "D0001 ≠ '암'"]) {
      const head = headOf(source);
      expect(head.kind).toBe("rows");
      expect(sourceOf(head)).toBe(source);
    }
  });

  it("⊕ 줄 추가 · ⊖ 줄 빼기 — 빈 줄은 식을 바꾸지 않고, 채우면 AND 로 붙고, 빼면 그 결합도 사라진다", () => {
    const head = headOf("D0009 = true");
    if (head.kind !== "rows") throw new Error("rows");
    const added = addRow(head.rows, 0);
    expect(added.rows).toHaveLength(2);
    expect(added.joins).toEqual(["and"]);
    // 막 더한 빈 줄은 식에 없다
    expect(sourceOf({ kind: "rows", rows: added })).toBe("D0009 = true");
    const filled = { ...added, rows: added.rows.map((r, i) => (i === 1 ? { left: { kind: "discriminator" as const, code: "D0001" }, op: "=" as const, right: { kind: "literal" as const, literal: { type: "string" as const, value: "수술비" } } } : r)) };
    expect(sourceOf({ kind: "rows", rows: filled })).toBe("D0009 = true and D0001 = '수술비'");
    const orJoined = { ...filled, joins: ["or" as const] };
    expect(sourceOf({ kind: "rows", rows: orJoined })).toBe("D0009 = true or D0001 = '수술비'");
    // 첫 줄을 빼면 둘째 줄이 IF 줄이 된다
    expect(sourceOf({ kind: "rows", rows: removeRow(orJoined, 0) })).toBe("D0001 = '수술비'");
    expect(removeRow(removeRow(orJoined, 0), 0).rows).toHaveLength(1);
  });

  it("반쯤 찬 줄이 있으면 빈 식 — 저장 검증이 그 가지를 오류로 잡는다", () => {
    const rows = { rows: [{ left: { kind: "discriminator" as const, code: "D0009" }, op: "=" as const }], joins: [] };
    expect(sourceOf({ kind: "rows", rows })).toBe("");
    expect(compact({ rows: [{}, ...rows.rows], joins: ["or"] }).joins).toEqual([]);
  });

  it("줄로 풀 수 없는 식(not · 괄호 중첩)은 원문 그대로 — 머리 줄은 읽기 전용으로 보이고 식을 바꾸지 않는다", () => {
    expect(headOf("not D0009 = true")).toEqual({ kind: "raw", source: "not D0009 = true" });
    expect(headOf("D0009 = (")).toEqual({ kind: "raw", source: "D0009 = (" });
    expect(sourceOf({ kind: "raw", source: " not D0009 = false " })).toBe("not D0009 = false");
  });

  it("좌변을 바꾸면 타입이 같을 때만 연산자 · 값을 남긴다", () => {
    const ctx = buildConditionContext({ discriminators: defs, enums: [] });
    const typeOf = (ref: { code: string }) => ctx.discriminators.find((d) => d.code === ref.code)?.type;
    const head = headOf("D0009 = true");
    if (head.kind !== "rows") throw new Error("rows");
    const same = setLeft(head.rows, 0, { kind: "discriminator", code: "D0007", node: { id: "x" } }, typeOf);
    expect(same.rows[0].right).toEqual(head.rows.rows[0].right);
    const other = setLeft(head.rows, 0, { kind: "discriminator", code: "D0001" }, typeOf);
    expect(other.rows[0]).toEqual({ left: { kind: "discriminator", code: "D0001" }, op: "=" });
  });

  it("변수 목록 — 담보 뿌리 잎은 한정자 없음, 세부보장 · 급부 잎은 `코드@노드`, 반복 표 셀이면 맨 위 「현재 행」", () => {
    const { tree } = surgery();
    const ctx = buildConditionContext({ coverage: tree, discriminators: defs, enums: [] });
    const groups = pickerGroups(ctx);
    expect(groups[0].label).toMatch(/^담보 — /);
    expect(groups[0].options.map((o) => o.key)).toEqual(["D0009", "D0001"]);
    const sub = groups.find((g) => g.label.startsWith("세부보장 — "))!;
    expect(sub.options[0].key).toBe(`D0007@${tree.subCoverages[0].id}`);
    expect(sub.options[0].label).toMatch(/^감액여부 @/);
    const inRow = pickerGroups({ ...ctx, row: { levels: ["subCoverage"], readable: ["product", "plan", "coverage", "subCoverage"] } });
    expect(inRow[0].label).toBe("현재 행 — 세부보장마다");
    expect(inRow[0].options.map((o) => o.key)).toEqual(["D0007", "D0009", "D0001"]);
    // 보통약관 · 공용조항(담보 문맥 없음) — 레벨별로 한정자 없이
    const plain = pickerGroups(buildConditionContext({ discriminators: defs, enums: [] }));
    expect(plain.map((g) => g.label)).toEqual(["담보", "세부보장", "급부"]);
    expect(plain[0].options.map((o) => o.key)).toEqual(["D0009", "D0001"]);
  });

  it("목록 값 ⇄ 참조", () => {
    expect(refOfKey("D0007@n9")).toEqual({ kind: "discriminator", code: "D0007", node: { id: "n9" } });
    expect(refKey({ kind: "discriminator", code: "D0007", node: { id: "n9" } })).toBe("D0007@n9");
    expect(refOfKey("")).toBeUndefined();
  });
});

describe("담보속성 줄 (2026-09-28) — 목록 끝 「담보속성」 묶음 · attr. 키 · 있음/= 두 줄", () => {
  const ctx = buildConditionContext({ discriminators: defs, enums: [], attributes: [{ code: "A0001", label: "갱신유형", values: [{ code: "1", label: "비갱신형" }, { code: "2", label: "갱신형" }] }] });
  it("변수 목록 끝에 담보속성 묶음", () => {
    const groups = pickerGroups(ctx);
    expect(groups.at(-1)).toEqual({ label: "담보속성", options: [{ key: "attr.A0001", label: "갱신유형" }] });
  });
  it("attr. 키 왕복 · 담보속성을 고르면 연산자는 = 부터", () => {
    expect(refOfKey("attr.A0001")).toEqual({ kind: "attr", code: "A0001" });
    expect(refKey({ kind: "attr", code: "A0001" })).toBe("attr.A0001");
    const rows = setLeft(emptyRows(), 0, refOfKey("attr.A0001"), () => undefined);
    expect(rows.rows[0]).toEqual({ left: { kind: "attr", code: "A0001" }, op: "=" });
  });
  it("「갱신형이면」 식이 줄로 풀려 그대로 묶인다", () => {
    const source = "exist(attr.A0001) and attr.A0001 = '2'";
    const head = headOf(source);
    expect(head.kind).toBe("rows");
    expect(sourceOf(head)).toBe(source);
  });
});
