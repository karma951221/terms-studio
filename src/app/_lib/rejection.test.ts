import { describe, expect, it } from "vitest";

import type { Impact, Rejection } from "@/domain/types";

import { describeRejection } from "./rejection";

describe("describeRejection — Rejection → 사람이 읽을 문장", () => {
  it("forbidden — 관리자만 할 수 있다는 문장 + action 을 포함한다", () => {
    const r: Rejection = { reason: "forbidden", role: "editor", action: "catalog.delete" };
    const v = describeRejection(r);
    expect(v.message).toContain("관리자만");
    expect(v.message).toContain("catalog.delete");
  });

  it("duplicate — what 을 그대로 문장에 싣는다", () => {
    const r: Rejection = { reason: "duplicate", what: "사용자 이름 「admin」" };
    expect(describeRejection(r).message).toContain("사용자 이름 「admin」");
  });

  it("minimumStructure — what 을 그대로 싣는다", () => {
    const r: Rejection = { reason: "minimumStructure", what: "급부는 최소 1개" };
    expect(describeRejection(r).message).toContain("급부는 최소 1개");
  });

  it("conflict — 「다른 사람이 먼저 저장했습니다」 + what (ADR-0074 판 충돌)", () => {
    const r: Rejection = { reason: "conflict", what: "편집을 시작한 판 3 · 지금 판 4" };
    expect(describeRejection(r).message).toBe("다른 사람이 먼저 저장했습니다 — 편집을 시작한 판 3 · 지금 판 4");
  });

  it("notFound — what 을 그대로 싣는다", () => {
    const r: Rejection = { reason: "notFound", what: "구분자 D0099" };
    expect(describeRejection(r).message).toContain("구분자 D0099");
  });

  it("failed — 건별 실행 실패 문장에 원인 메시지를 싣는다", () => {
    const r: Rejection = { reason: "failed", message: "저장 실패" };
    expect(describeRejection(r).message).toBe("실행에 실패했습니다 — 저장 실패");
  });

  it("invalid — issue 1건이면 그 메시지를, 여럿이면 건수를 요약하고 issues 를 그대로 싣는다", () => {
    const one: Rejection = { reason: "invalid", issues: [{ kind: "typeMismatch", message: "타입이 다릅니다", at: {} }] };
    expect(describeRejection(one).message).toBe("타입이 다릅니다");
    expect(describeRejection(one).issues).toHaveLength(1);

    const many: Rejection = {
      reason: "invalid",
      issues: [
        { kind: "typeMismatch", message: "a", at: {} },
        { kind: "brokenRef", message: "b", at: {} },
      ],
    };
    expect(describeRejection(many).message).toContain("2건");
    expect(describeRejection(many).issues).toHaveLength(2);
  });

  it("needsConfirmation — impact 를 그대로 실어 돌려준다 (화면이 확인 폼을 그린다)", () => {
    const impact: Impact = { valueRowsLost: 3, brokenRefs: [{ document: "clause", ownerId: "C0001" }], cascade: ["세부보장 A"] };
    const r: Rejection = { reason: "needsConfirmation", impact };
    const v = describeRejection(r);
    expect(v.impact).toBe(impact);
    expect(v.message).toContain("확인");
  });
});
