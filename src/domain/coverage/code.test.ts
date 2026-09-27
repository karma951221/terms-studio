import { describe, expect, it } from "vitest";

import { COVERAGE_CODE_PATTERN, createCoverage, formatCoverageCode, isValidCoverageCode } from "./code";
import { renameCoverage } from "./tree";

describe("담보코드 — COV000001 채번 (기능/담보 §3.1)", () => {
  it("접두 COV + 6자리, 넘치면 자르지 않고 늘린다", () => {
    expect(formatCoverageCode(1)).toBe("COV000001");
    expect(formatCoverageCode(496)).toBe("COV000496");
    expect(formatCoverageCode(999_999)).toBe("COV999999");
    expect(formatCoverageCode(1_000_000)).toBe("COV1000000");
  });

  it("순번은 1 이상의 정수만", () => {
    expect(() => formatCoverageCode(0)).toThrow(RangeError);
    expect(() => formatCoverageCode(1.5)).toThrow(RangeError);
  });

  it("모양 검사", () => {
    expect(isValidCoverageCode("COV000001")).toBe(true);
    expect(isValidCoverageCode("cov000001")).toBe(false);
    expect(isValidCoverageCode("AX000001")).toBe(false);
    expect(COVERAGE_CODE_PATTERN.exec("COV000042")?.[1]).toBe("000042");
  });

  it("생성은 순번을 차례로 받아 코드를 붙인다", async () => {
    let seq = 0;
    const next = () => ++seq;
    let id = 0;
    const newId = () => `id-${++id}`;
    const a = await createCoverage({ name: "가" }, newId, [], next);
    const b = await createCoverage({ name: "나" }, newId, ["가"], next);
    expect(a.ok && a.value.code).toBe("COV000001");
    expect(b.ok && b.value.code).toBe("COV000002");
  });

  it("거절된 생성(빈 이름 · 중복 이름)은 순번을 받지 않는다 — 코드에 구멍이 나지 않는다", async () => {
    let calls = 0;
    const next = () => ++calls;
    const newId = () => "x";
    expect((await createCoverage({ name: " " }, newId, [], next)).ok).toBe(false);
    expect((await createCoverage({ name: "가" }, newId, ["가"], next)).ok).toBe(false);
    expect(calls).toBe(0);
  });

  it("이름을 바꿔도 코드는 그대로다 (불변)", async () => {
    const created = await createCoverage({ name: "가" }, () => "c1", [], () => 7);
    if (!created.ok) throw new Error("생성 실패");
    const renamed = renameCoverage(created.value, "나", ["가"]);
    expect(renamed.ok && renamed.value.code).toBe("COV000007");
  });
});
