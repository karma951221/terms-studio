/**
 * 작성위치 줄 · 범위 낱말 슬롯 — 담보약관 템플릿 · 함수조항에서만 (ADR-0089 · 기능/문면 §3.3 · §3.4).
 */
import { describe, expect, it } from "vitest";

import { rowIssues, toRows } from "@/domain/document";
import { parse } from "@/domain/expression";

import { buildConditionContext } from "./conditionContext";
import { chipDisplay } from "./display";
import { headOf, opsOf, pickerGroups, refKey, refOfKey, setLeft, sourceOf } from "./rows";
import { slotOptions, slotPathLabel } from "./SlotRefInput";

const withOutput = buildConditionContext({ discriminators: [], enums: [], output: true });
const without = buildConditionContext({ discriminators: [], enums: [] });

describe("조건 머리 줄 — 작성위치 줄", () => {
  it("변수 목록 끝에 「작성위치」 묶음 — 작성위치를 아는 문서만", () => {
    expect(pickerGroups(withOutput).at(-1)).toEqual({ label: "작성위치", options: [{ key: "builtin.output", label: "작성위치" }] });
    expect(pickerGroups(without).map((g) => g.label)).not.toContain("작성위치");
  });

  it("줄로 풀고 다시 묶으면 같은 식 — = · ≠ 와 세 값", () => {
    for (const source of ["builtin.output ≠ 'replace'", "builtin.output = 'special' and builtin.output ≠ 'block'"]) {
      const head = headOf(source);
      expect(head.kind).toBe("rows");
      expect(sourceOf(head)).toBe(source);
    }
  });

  it("목록 값 ⇄ 참조 · 연산자는 = · ≠ · 좌변을 고르면 첫 연산자", () => {
    expect(refKey({ kind: "output" })).toBe("builtin.output");
    expect(refOfKey("builtin.output")).toEqual({ kind: "output" });
    expect(opsOf({ kind: "output" }, () => undefined)).toEqual(["=", "≠"]);
    expect(setLeft({ rows: [{}], joins: [] }, 0, { kind: "output" }, () => undefined).rows[0]).toEqual({ left: { kind: "output" }, op: "=" });
  });

  it("줄 검사 — 우변이 비었거나 세 값 밖이면 문구", () => {
    const rows = (src: string) => toRows((parse(src) as { ok: true; value: never }).value)!;
    expect(rowIssues(rows("builtin.output = 'replace'"), () => undefined)).toEqual([]);
    expect(rowIssues(rows("builtin.output = 'base'"), () => undefined)).toEqual(["1번 줄: 'base' 는 작성위치 값이 아니다 (대치 · 블록 · 특약)"]);
    expect(rowIssues({ rows: [{ left: { kind: "output" }, op: "=" }], joins: [] }, () => undefined)).toEqual(["1번 줄: 우변이 비어 있다"]);
  });

  it("칩 표시 — 「작성위치」", () => {
    expect(chipDisplay("builtin.output ≠ 'replace'", withOutput)).toBe("작성위치 ≠ 'replace'");
  });
});

describe("슬롯 고르기 — 범위 낱말", () => {
  it("작성위치를 아는 문서만 맨 앞 「범위 낱말」 묶음 — 칩 〔이 약관의〕", () => {
    expect(slotOptions(withOutput)[0]).toEqual({ value: "builtin.output.scope", label: "이 약관의", hint: "특약 「이 특별약관의」 · 대치 빈 글", group: "범위 낱말" });
    expect(slotOptions(without).map((o) => o.value)).not.toContain("builtin.output.scope");
    expect(slotPathLabel(withOutput, "builtin.output.scope")).toBe("범위 낱말 › 이 약관의");
    expect(chipDisplay("builtin.output.scope", withOutput)).toBe("이 약관의");
  });
});
