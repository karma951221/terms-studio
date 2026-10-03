import { describe, expect, it } from "vitest";

import type { Discriminator } from "../catalog/types";
import { type EvalContext, type EvalResult, evaluate, parse } from "../expression";
import type { MasterForm } from "../master";
import type { Value } from "../types";
import { buildContexts, snapshotNodeContext, specialContext } from "./context";
import { alphaMaster, alphaPlanOptions, alphaPlusFixture, coverageEntry, planOption } from "./fixture";
import type { AssemblyInput, AssemblyPlanOption } from "./types";

function run(expression: string, ctx: EvalContext): EvalResult {
  const parsed = parse(expression);
  if (!parsed.ok) throw new Error(`파싱 실패: ${expression}`);
  return evaluate(parsed.value, ctx);
}

function value(expression: string, ctx: EvalContext): unknown {
  const r = run(expression, ctx);
  if (r.kind !== "value") throw new Error(`기대: value, 실제: ${JSON.stringify(r)}`);
  return r.value;
}

function withOptions(options: readonly AssemblyPlanOption[]): AssemblyInput {
  const input = alphaPlusFixture();
  return { ...input, product: { ...input.product, planOptions: options } };
}

/**
 * 세목 레벨 조립 문맥 (설계 §2.3) — 집계 범위 = 상품의 `planOptions`(유효 조합에 등장하는 선택지 합집합) 중
 * 참조가 읽는 폼의 선택지. 픽스처: 1종(납입면제 적용 · 12) · 2종(미적용 · 24) · 1형(지급형) · 2형(무저해지형).
 */
describe("세목 레벨 조립 문맥 — 보통약관 문맥의 집계", () => {
  const general = buildContexts(alphaPlusFixture()).general.eval;

  it("any · all · exist · count · sum 이 세목 선택지 값을 범위로 계산한다", () => {
    expect(value("any(waiver.applies)", general)).toBe(true);
    expect(value("all(waiver.applies)", general)).toBe(false);
    expect(value("exist(waiver.applies)", general)).toBe(true);
    expect(value("notexist(waiver.applies)", general)).toBe(false);
    expect(value("count(waiver.months)", general)).toBe(2);
    expect(value("sum(waiver.months)", general)).toBe(36);
  });

  it("구분자 집계 — 세목 레벨 구분자를 선택지마다 평가한다 (any(D0008) · all(D0008) · any(D0009))", () => {
    expect(value("any(D0008)", general)).toBe(true);
    expect(value("all(D0008)", general)).toBe(false);
    // D0009 = 무저해지형 여부 — 2형만 참
    expect(value("any(D0009)", general)).toBe(true);
    expect(value("all(D0009)", general)).toBe(false);
  });

  it("세목 구분자가 세목 구분자를 참조해도 커서가 이어진다 (D0011 = not D0008 and waiver.months > 20 → 2종만 참)", () => {
    expect(value("any(D0011)", general)).toBe(true);
    expect(value("all(D0011)", general)).toBe(false);
  });

  it("빈 범위 규칙 — 선택지가 없는 폼: any → false · all → true · exist → false · notexist → true · count → 0", () => {
    expect(value("any(conversion.converts)", general)).toBe(false);
    expect(value("all(conversion.converts)", general)).toBe(true);
    expect(value("exist(conversion.converts)", general)).toBe(false);
    expect(value("notexist(conversion.converts)", general)).toBe(true);
    expect(value("count(conversion.converts)", general)).toBe(0);
  });

  it("폼 필터 — 다른 폼의 선택지는 범위 밖이다 (무저해지 폼 집계에 납입면제 선택지가 끼지 않는다)", () => {
    expect(value("count(no_surrender.type)", general)).toBe(2);
    expect(value("exist(no_surrender.type)", general)).toBe(true);
    // 폼이 다른 선택지가 범위에 들었다면 그 선택지에 자리가 없어 notAttached 오류가 났을 것이다
    expect(value("count(waiver.applies)", general)).toBe(2);
  });

  it("planOptions 에 없는 선택지는 범위 밖이다 — 조합에 안 든 선택지가 문면에 영향을 주지 않는다", () => {
    // 2형(무저해지형)을 뺀 상품 — D0009 는 어느 선택지에서도 참이 아니다
    const without = alphaPlanOptions.filter((o) => o.id !== "opt-form-2");
    const ctx = buildContexts(withOptions(without)).general.eval;
    expect(value("any(D0009)", ctx)).toBe(false);
    expect(value("count(no_surrender.type)", ctx)).toBe(1);
  });

  it("builtin.plan.name 은 커서의 선택지 이름 — 폼 필터 없이 전부가 범위다", () => {
    expect(value("count(builtin.plan.name)", general)).toBe(4);
    // D0010 = builtin.plan.name = '1종' — 세목 폼을 안 읽는 구분자는 선택지 전부를 돈다
    expect(value("any(D0010)", general)).toBe(true);
    expect(value("all(D0010)", general)).toBe(false);
  });

  it("커서 없이 세목 필드를 직접 읽으면 자리 없음(notAttached) — 정의 시점에 거부되는 식이라 미결이 아니다", () => {
    const r = run("waiver.applies", general);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.issue.kind).toBe("notAttached");
    const b = run("builtin.plan.name", general);
    expect(b.kind).toBe("error");
    if (b.kind === "error") expect(b.issue.kind).toBe("notAttached");
  });

  it("두 폼을 읽는 구분자(정의 검사가 거부하는 꼴)는 범위를 정할 수 없어 미결 — 선택지 전부로 조용히 평가하지 않는다", () => {
    // D0012 = waiver.applies and no_surrender.type = 'V01'. 예전엔 「선택지 전부」 범위로 평가돼 원인 대신 notEntered 가
    // 나왔다 (코덱스 리뷰 2026-09-14 Important-1). 이제 planFormScope 가 invalid → children undefined → 미결 → brokenRef.
    const r = run("any(D0012)", general);
    expect(r.kind).toBe("undetermined");
    const ctx = buildContexts(alphaPlusFixture()).general;
    const issue = ctx.explainUndetermined("D0012", {});
    expect(issue.kind).toBe("brokenRef");
    // 세목 범위 없음의 원천은 구분자 편집기, 그 구분자다 (ADR-0049 §4)
    expect(issue.source).toEqual({ document: "catalog", ownerId: "D0012", ownerName: "두폼읽기" });
  });

  it("구분자 식이 문법 오류 · 순환이면 brokenRef — 원천은 구분자 편집기, 그 구분자 (ADR-0049 §4)", () => {
    const input = alphaPlusFixture();
    const broken: Discriminator = { code: "D0090", label: "깨진식", description: "", level: "coverage", expression: "coverage_basic.renewal =" };
    const a: Discriminator = { code: "D0091", label: "순환a", description: "", level: "coverage", expression: "D0092 = true" };
    const b: Discriminator = { code: "D0092", label: "순환b", description: "", level: "coverage", expression: "D0091 = true" };
    const ctx = buildContexts({ ...input, catalog: [...input.catalog, broken, a, b] }).specials.get("pc-basic")!.eval;
    const r = run("D0090", ctx);
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.issue.kind).toBe("brokenRef");
      expect(r.issue.at.refPath).toBe("D0090");
      expect(r.issue.source).toEqual({ document: "catalog", ownerId: "D0090", ownerName: "깨진식" });
    }
    // 순환(D0091 → D0092 → D0091)은 안쪽에서 멈추지만, 구분자 평가 오류를 미입력으로 보고하는 B1 규약에 가려
    // 바깥 참조에는 notEntered 로 나온다 — 원천 좌표가 실리지 않는다 (M03-b 후보)
    const c = run("D0091", ctx);
    expect(c.kind).toBe("error");
    if (c.kind === "error") expect(c.issue).toMatchObject({ kind: "notEntered", at: { refPath: "D0091" } });
    // 없는 구분자 참조는 문면의 깨진 참조 — 원천이 구분자 편집기가 아니다 (편집기로 갈 구분자가 없다)
    const gone = run("D0999", ctx);
    if (gone.kind === "error") expect(gone.issue.source).toBeUndefined();
  });

  it("미입력 세목 값은 notEntered 오류 (조용한 false 가 아니다)", () => {
    const options = [...alphaPlanOptions, planOption("opt-type-3", "type", 3, "3종", "waiver", {})];
    const ctx = buildContexts(withOptions(options)).general.eval;
    const r = run("any(waiver.applies)", ctx);
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.issue.kind).toBe("notEntered");
      expect(r.issue.at.refPath).toBe("waiver.applies");
    }
  });
});

describe("세목 레벨 조립 문맥 — 담보약관 문맥 · 추적", () => {
  it("담보약관(special) 문맥도 상품 범위의 세목을 쓴다 — 부착 세목이 아니라", () => {
    const input = alphaPlusFixture();
    const contexts = buildContexts(input);
    const basic = contexts.specials.get("pc-basic")!.eval;
    expect(value("any(waiver.applies)", basic)).toBe(true);
    expect(value("count(builtin.plan.name)", basic)).toBe(4);
    // 담보 레벨 집계는 그대로 — 세목 문맥이 담보 트리를 건드리지 않는다
    expect(value("any(pay.exempt)", basic)).toBe(true);
    expect(value("D0005", basic)).toBe(true);
    // 부착 세목이 비어 있어도 범위는 상품의 planOptions
    const addon = input.coverages.find((c) => c.snapshot.id === "pc-addon")!;
    expect(addon.plans).toEqual([]);
    expect(value("count(waiver.months)", specialContext(input, addon).eval)).toBe(2);
  });

  it("세목 값 읽기가 ReadRecord 에 남는다 — owner kind plan · masterId = 선택지 id", () => {
    const input = alphaPlusFixture();
    const contexts = buildContexts(input);
    expect(value("any(waiver.applies)", contexts.general.eval)).toBe(true);
    // 보통약관 문맥의 읽기는 기본계약 추적에 실린다 — 납입면제 폼의 선택지 둘만 읽었다 (형 축 선택지는 범위 밖)
    const base = contexts.traces.find((t) => t.productCoverageId === "pc-base")!;
    expect(base.reads).toEqual([
      { owner: { kind: "plan", id: "opt-type-1" }, masterId: "opt-type-1", path: "waiver.applies", slot: { entered: true, value: true } },
      { owner: { kind: "plan", id: "opt-type-2" }, masterId: "opt-type-2", path: "waiver.applies", slot: { entered: true, value: false } },
    ]);
    // 같은 자리를 다시 읽어도 기록은 한 번
    expect(value("all(waiver.applies)", contexts.general.eval)).toBe(false);
    expect(base.reads).toHaveLength(2);
  });

  it("세목 선택지가 하나도 없는 상품 — 미결이 아니라 빈 범위", () => {
    const ctx = buildContexts(withOptions([])).general.eval;
    expect(value("any(waiver.applies)", ctx)).toBe(false);
    expect(value("all(D0008)", ctx)).toBe(true);
    expect(value("exist(builtin.plan.name)", ctx)).toBe(false);
  });
});

describe("여는 폼(optional) — 급부의 감액 폼을 안 열면 exist 가 false, 값 행이 있으면 true (ADR-0065 §4)", () => {
  const reductionMaster: MasterForm[] = [
    ...alphaMaster,
    {
      key: "reduction",
      label: "감액",
      level: "benefit",
      optional: true,
      fields: [{ key: "periods", label: "구간", type: { kind: "table", columns: [{ key: "end", label: "기간", type: "period" }] } }],
    },
  ];

  /** 일반상해사망 탑재분 하나 — 급부에 reduction.periods 를 넣거나(있으면) 비운다(없으면). */
  function withReduction(periods?: Value): AssemblyInput {
    const input = alphaPlusFixture();
    const coverage = coverageEntry({
      id: "pc-basic",
      name: "일반상해사망",
      coverageId: "cov-death",
      coverageName: "일반상해사망",
      attributes: [{ kindCode: "A0002", valueCode: "1" }],
      subCoverages: [{ id: "pc-basic-sub", masterNodeId: "sub-death", name: "일반상해사망", benefits: [{ id: "pc-basic-ben", masterNodeId: "ben-death", name: "사망보험금" }] }],
      values: {
        "pc-basic": { "coverage_basic.renewal": false, "coverage_basic.reduction_months": 24, "coverage_basic.reduction_text": "24개월" },
        "pc-basic-ben": periods === undefined ? { "pay.exempt": true, "pay.rate": 100 } : { "pay.exempt": true, "pay.rate": 100, "reduction.periods": periods },
      },
    });
    return { ...input, master: reductionMaster, coverages: input.coverages.map((c) => (c.snapshot.id === "pc-basic" ? coverage : c)) };
  }

  it("값 행 없는 급부는 exist(reduction.periods) = false, 값 행이 있으면 true", () => {
    const noRows = withReduction();
    const covNo = noRows.coverages.find((c) => c.snapshot.id === "pc-basic")!;
    expect(value("exist(reduction.periods)", snapshotNodeContext(noRows, covNo, "pc-basic-ben")!)).toBe(false);

    const withRows = withReduction([{ end: 12 }]);
    const covYes = withRows.coverages.find((c) => c.snapshot.id === "pc-basic")!;
    expect(value("exist(reduction.periods)", snapshotNodeContext(withRows, covYes, "pc-basic-ben")!)).toBe(true);
  });
});

describe("노드 한정자 — 조립 문맥은 스냅샷 masterNodeId 역조회로 그 노드에서 평가 (ADR-0066 §1)", () => {
  const reductionMaster: MasterForm[] = [
    {
      key: "reduction",
      label: "감액",
      level: "benefit",
      optional: true,
      fields: [{ key: "periods", label: "구간", type: { kind: "table", columns: [{ key: "end", label: "기간", type: "period" }] } }],
    },
  ];
  const 급부감액여부: Discriminator = { code: "D0002", label: "감액여부", description: "", level: "benefit", expression: "exist(reduction.periods)" };
  const 세부감액여부: Discriminator = { code: "D0007", label: "감액여부", description: "", level: "subCoverage", expression: "any(D0002)" };

  /** 세부A(급부A: 감액 있음) · 세부B(급부B: 감액 없음) — 마스터 세부보장 id 로 한정자가 갈린다. */
  function withTwoSubCoverages(): AssemblyInput {
    const input = alphaPlusFixture();
    const coverage = coverageEntry({
      id: "pc-nodequal",
      name: "노드한정자테스트",
      coverageId: "cov-nodequal",
      coverageName: "노드한정자테스트",
      attributes: [],
      subCoverages: [
        { id: "s-a", masterNodeId: "master-sub-a", name: "세부A", benefits: [{ id: "b-a", masterNodeId: "master-ben-a", name: "급부A" }] },
        { id: "s-b", masterNodeId: "master-sub-b", name: "세부B", benefits: [{ id: "b-b", masterNodeId: "master-ben-b", name: "급부B" }] },
      ],
      values: { "b-a": { "reduction.periods": [{ end: 12 }] } },
    });
    return { ...input, master: reductionMaster, catalog: [급부감액여부, 세부감액여부], coverages: [coverage] };
  }

  it("D0007@마스터세부A 는 참 · D0007@마스터세부B 는 거짓", () => {
    const input = withTwoSubCoverages();
    const c = input.coverages[0];
    const ctx = specialContext(input, c).eval;
    expect(value("D0007@master-sub-a", ctx)).toBe(true);
    expect(value("D0007@master-sub-b", ctx)).toBe(false);
  });
});

describe("없는 값 — 지운 열거값 코드가 남은 값 자리 (ADR-0078 결정 5)", () => {
  function withoutValue(enumCode: string, valueCode: string): AssemblyInput {
    const input = alphaPlusFixture();
    return { ...input, enums: input.enums.map((e) => (e.code === enumCode ? { ...e, values: e.values.filter((v) => v.code !== valueCode) } : e)) };
  }

  it("조립이 없는 값 코드를 읽으면 좌표를 단 오류 — 원천은 그 값을 고친 상품의 값 자리", () => {
    const input = withoutValue("E0001", "V02"); // 상품 고지유형 = V02
    const r = run("product_basic.notice = 'V01'", buildContexts(input).general.eval);
    expect(r).toEqual({
      kind: "error",
      issue: expect.objectContaining({
        kind: "brokenRef",
        message: "없는 값 V02 — 고지유형(E0001)에서 지워진 값입니다",
        at: expect.objectContaining({ refPath: "product_basic.notice" }),
        source: { document: "product", ownerId: input.product.id, ownerName: input.product.name, refPath: "product_basic.notice" },
      }),
    });
  });

  it("세목 선택지 값이면 원천에 그 선택지 이름이 실린다 — 집계도 오류", () => {
    const input = withoutValue("E0002", "V02"); // 2형 무저해지유형 = V02
    const r = run("count(no_surrender.type)", buildContexts(input).general.eval);
    expect(r).toMatchObject({
      kind: "error",
      issue: { kind: "brokenRef", message: "없는 값 V02 — 무저해지유형(E0002)에서 지워진 값입니다", source: { document: "product", ownerId: input.product.id, subjectName: "2형", refPath: "no_surrender.type" } },
    });
  });

  it("정의에 있는 값만 고른 자리는 그대로 읽힌다", () => {
    const input = withoutValue("E0002", "V02");
    const ctx = buildContexts(input).general.eval;
    expect(value("product_basic.notice = 'V02'", ctx)).toBe(true);
  });
});
