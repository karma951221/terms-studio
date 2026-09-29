import { describe, expect, it } from "vitest";

import { parse } from "../expression/parser";
import { entered, type ValueSlot } from "../types";
import { MASTER, allMasterFields, findForm, formRuleIssues } from "./index";

/**
 * 카탈로그 불변식 — 마스터의 모든 `폼키.필드키` 가 식 파서를 지나 **정확히 그 마스터 참조**가 된다.
 *
 * 파서는 `attr` · `builtin` 네임스페이스와 `and` · `or` · `any` 같은 예약어를 먼저 가른다 — 폼키 `attr` 은
 * 담보속성으로 파싱되고, 폼키 `builtin` 은 두 토막이라 문법 오류가 되며, 필드키 `and` 는 예약어라 참조할 수 없다.
 * 그런 폼 · 필드는 구분자 식에서 읽을 길이 없으니 카탈로그에 올라와서는 안 된다 (코덱스 리뷰 Minor 2).
 */
describe("마스터 카탈로그 불변식 — 파서와 충돌하지 않는다", () => {
  it("모든 필드 경로가 파서를 지나 같은 master ref 가 된다", () => {
    const fields = allMasterFields();
    expect(fields.length).toBeGreaterThan(0);
    for (const ref of fields) {
      const r = parse(ref.path);
      expect(r.ok, `${ref.path} 파싱 실패`).toBe(true);
      if (!r.ok) continue;
      expect(r.value, ref.path).toEqual({ kind: "ref", ref: { kind: "master", form: ref.form.key, field: ref.field.key } });
    }
  });

  it("폼키 · 필드키 는 예약 네임스페이스 · 예약어와 겹치지 않는다 (불변식이 잡아낼 사례)", () => {
    // 불변식 테스트가 실제로 충돌을 잡는지 — 가짜 카탈로그로 반례를 확인한다
    for (const bad of ["attr.x", "builtin.x", "form.and", "any.x"]) {
      const r = parse(bad);
      const same = r.ok && r.value.kind === "ref" && r.value.ref.kind === "master";
      expect(same, `${bad} 는 마스터 참조가 되면 안 된다`).toBe(false);
    }
    expect(MASTER.every((f) => !["attr", "builtin"].includes(f.key))).toBe(true);
  });
});

describe("폼 교차 규칙 — 납입면제(waiver) 「적용여부 = 예면 사유 1개 이상」 (결정 16 · 기능/상품 §3.9)", () => {
  const waiver = findForm("waiver")!;
  const reader = (slots: Record<string, ValueSlot>) => (path: string) => slots[path];

  it("적용여부 예 + 사유 0개(빈 목록)면 사유 자리에 오류", () => {
    const issues = formRuleIssues(waiver, reader({ "waiver.applies": entered(true), "waiver.reasons": entered([]) }));
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("typeMismatch");
    expect(issues[0].message).toContain("납입면제사유");
    expect(issues[0].at.refPath).toBe("waiver.reasons");
  });

  it("적용여부 예 + 사유 미입력도 0개 — 오류", () => {
    expect(formRuleIssues(waiver, reader({ "waiver.applies": entered(true) }))).toHaveLength(1);
  });

  it("적용여부 예 + 사유 1개 이상이면 통과", () => {
    expect(formRuleIssues(waiver, reader({ "waiver.applies": entered(true), "waiver.reasons": entered(["V01"]) }))).toEqual([]);
  });

  it("적용여부 아니오 + 사유 0개는 통과", () => {
    expect(formRuleIssues(waiver, reader({ "waiver.applies": entered(false), "waiver.reasons": entered([]) }))).toEqual([]);
    expect(formRuleIssues(waiver, reader({ "waiver.applies": entered(false) }))).toEqual([]);
  });

  it("적용여부 미입력이면 규칙이 서지 않는다 — 미입력은 상태다 (ADR-0004)", () => {
    expect(formRuleIssues(waiver, reader({}))).toEqual([]);
  });

  it("좌표를 넘기면 오류 좌표에 싣는다 (refPath 는 규칙이 가리키는 필드)", () => {
    const [issue] = formRuleIssues(waiver, reader({ "waiver.applies": entered(true) }), { ownerId: "opt-1" });
    expect(issue.at).toEqual({ ownerId: "opt-1", refPath: "waiver.reasons" });
  });

  it("규칙이 없는 폼은 늘 통과", () => {
    expect(formRuleIssues(findForm("no_surrender")!, reader({}))).toEqual([]);
  });
});
