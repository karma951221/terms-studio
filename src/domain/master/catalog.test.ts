import { describe, expect, it } from "vitest";

import { parse } from "../expression/parser";
import { NOT_ENTERED, entered, type ValueSlot } from "../types";
import { MASTER, allMasterFields, findForm, findMasterField, formRuleIssues, isFieldShown, isFieldSingle } from "./index";

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

describe("폼 교차 규칙 — 상품특성(feature) 고지유형에 딸린 칸 (2026-10-01)", () => {
  const feature = findForm("feature")!;
  const reader = (slots: Record<string, ValueSlot>) => (path: string) => slots[path];
  const review = (extra: Record<string, ValueSlot>) => reader({ "feature.notice_kind": entered("V02"), ...extra });

  it("간편심사 + 간편심사구분 미입력이면 간편심사구분 자리에 오류", () => {
    const issues = formRuleIssues(feature, review({ "feature.review_type": entered(["V01"]) }));
    expect(issues.map((i) => i.at.refPath)).toEqual(["feature.review_scope"]);
  });

  it("단일심사면 간편심사유형 정확히 1개 — 0개 · 2개는 오류, 1개는 통과", () => {
    const single = { "feature.review_scope": entered("V01") };
    expect(formRuleIssues(feature, review({ ...single, "feature.review_type": entered([]) })).map((i) => i.at.refPath)).toEqual(["feature.review_type"]);
    expect(formRuleIssues(feature, review({ ...single, "feature.review_type": entered(["V01", "V02"]) }))[0].message).toContain("1개");
    expect(formRuleIssues(feature, review({ ...single, "feature.review_type": entered(["V03"]) }))).toEqual([]);
  });

  it("통합간편심사면 간편심사유형 2개 이상 — 1개는 오류, 2개는 통과", () => {
    const combined = { "feature.review_scope": entered("V02") };
    expect(formRuleIssues(feature, review({ ...combined, "feature.review_type": entered(["V01"]) }))[0].message).toContain("2개 이상");
    expect(formRuleIssues(feature, review({ ...combined, "feature.review_type": entered(["V01", "V02"]) }))).toEqual([]);
  });

  it("건강고지면 건강고지유형 1개 이상 — 미입력 · 빈 목록은 오류", () => {
    const health = (extra: Record<string, ValueSlot>) => reader({ "feature.notice_kind": entered("V03"), ...extra });
    expect(formRuleIssues(feature, health({})).map((i) => i.at.refPath)).toEqual(["feature.notice_type"]);
    expect(formRuleIssues(feature, health({ "feature.notice_type": entered([]) }))).toHaveLength(1);
    expect(formRuleIssues(feature, health({ "feature.notice_type": entered(["V01"]) }))).toEqual([]);
  });

  it("일반심사 · 고지유형 미입력이면 딸린 칸 규칙이 서지 않는다", () => {
    expect(formRuleIssues(feature, reader({ "feature.notice_kind": entered("V01") }))).toEqual([]);
    expect(formRuleIssues(feature, reader({}))).toEqual([]);
  });
});

describe("조건부 필드 — isFieldShown · isFieldSingle (2026-10-01)", () => {
  const field = (key: string) => findMasterField(`feature.${key}`)!.field;
  const reader = (slots: Record<string, ValueSlot>) => (key: string) => slots[key];

  it("조건이 없는 필드는 늘 자리가 있다", () => {
    expect(isFieldShown(field("renewable"), reader({}))).toBe(true);
    expect(isFieldShown(field("notice_kind"), reader({}))).toBe(true);
  });

  it("간편심사구분 · 간편심사유형은 고지유형 = 간편심사일 때만, 건강고지유형은 건강고지일 때만", () => {
    const review = reader({ notice_kind: entered("V02") });
    const health = reader({ notice_kind: entered("V03") });
    expect(isFieldShown(field("review_scope"), review)).toBe(true);
    expect(isFieldShown(field("review_type"), review)).toBe(true);
    expect(isFieldShown(field("notice_type"), review)).toBe(false);
    expect(isFieldShown(field("review_type"), health)).toBe(false);
    expect(isFieldShown(field("notice_type"), health)).toBe(true);
  });

  it("조건 필드가 미입력이면 조건부 칸은 없다", () => {
    expect(isFieldShown(field("review_type"), reader({}))).toBe(false);
    expect(isFieldShown(field("review_type"), reader({ notice_kind: NOT_ENTERED }))).toBe(false);
  });

  it("간편심사유형은 간편심사구분 = 단일심사일 때만 하나만 고른다 — singleWhen 없는 필드는 늘 여럿", () => {
    expect(isFieldSingle(field("review_type"), reader({ review_scope: entered("V01") }))).toBe(true);
    expect(isFieldSingle(field("review_type"), reader({ review_scope: entered("V02") }))).toBe(false);
    expect(isFieldSingle(field("review_type"), reader({}))).toBe(false);
    expect(isFieldSingle(field("notice_type"), reader({ review_scope: entered("V01") }))).toBe(false);
  });
});
