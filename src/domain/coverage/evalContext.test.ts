import { describe, expect, it } from "vitest";

import type { Discriminator } from "../catalog";
import { evaluate, parse, type EvalResult } from "../expression";
import { entered, NOT_ENTERED } from "../types";
import { coverageChildrenProviders, coverageRowSource, coverageStructNode, masterCatalog, masterEvalContext, nodeEvalContext } from "./evalContext";
import { enumerateRows } from "../structure";
import { surgery } from "./fixture";
import type { MasterValues } from "./values";

/** 투영 구분자 하나 + 집계 구분자 하나 — 구분자는 전부 식이다 (ADR-0037). */
const 담보명: Discriminator = {
  code: "D0001",
  label: "담보명",
  description: "",
  level: "coverage",
  expression: "coverage_basic.claim_name",
};
const 면책구분: Discriminator = {
  code: "D0002",
  label: "면책구분",
  description: "",
  level: "coverage",
  expression: "any(pay.exempt)",
};
const 납입면제적용: Discriminator = {
  code: "D0003",
  label: "납입면제적용",
  description: "",
  level: "plan",
  expression: "waiver.applies",
};
const 깨진식: Discriminator = {
  code: "D0004",
  label: "깨진식",
  description: "",
  level: "coverage",
  expression: "coverage_basic.claim_name and",
};
const defs = [담보명, 면책구분, 납입면제적용, 깨진식];

function unwrap<T>(r: { ok: true; value: T } | { ok: false; rejection: unknown }): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

function mv(
  slots: Record<string, Record<string, ReturnType<typeof entered> | typeof NOT_ENTERED>>,
): MasterValues {
  return { slots: new Map(Object.entries(slots).map(([id, s]) => [id, new Map(Object.entries(s))])) };
}

function run(src: string, ctx: ReturnType<typeof masterEvalContext>): EvalResult {
  return evaluate(unwrap(parse(src)), ctx);
}
const value = (v: unknown): EvalResult => ({ kind: "value", value: v as never });

describe("masterEvalContext — 담보 마스터 값으로 만든 평가 문맥", () => {
  it("담보 레벨 마스터 자리는 담보 값에서 읽힌다 · 미입력은 notEntered 오류", () => {
    const { tree } = surgery();
    const ctx = masterEvalContext(tree, mv({ [tree.id]: { "coverage_basic.claim_name": entered("수술비") } }), masterCatalog(defs));
    expect(run("coverage_basic.claim_name", ctx)).toEqual(value("수술비"));
    const empty = masterEvalContext(tree, mv({}), masterCatalog(defs));
    expect(run("coverage_basic.claim_name", empty)).toMatchObject({
      kind: "error",
      issue: {
        kind: "notEntered",
        at: { document: "coverageMaster", ownerId: tree.id, node: { level: "coverage", id: tree.id }, refPath: "coverage_basic.claim_name" },
      },
    });
  });

  it("집계 범위 = 부착점 하위 트리 — 담보 문맥의 any(급부.면책여부) 는 아래 모든 급부를 본다", () => {
    const { tree, b11, b21, b22 } = surgery();
    const values = mv({
      [b11]: { "pay.exempt": entered(false), "pay.rate": entered(100) },
      [b21]: { "pay.exempt": entered(false), "pay.rate": entered(50) },
      [b22]: { "pay.exempt": entered(true), "pay.rate": entered(30) },
    });
    const ctx = masterEvalContext(tree, values, masterCatalog(defs));
    expect(run("any(pay.exempt)", ctx)).toEqual(value(true));
    expect(run("all(pay.exempt)", ctx)).toEqual(value(false));
    expect(run("sum(pay.rate)", ctx)).toEqual(value(180));
    expect(run("count(pay.rate)", ctx)).toEqual(value(3));
  });

  it("세부보장 문맥의 집계는 자기 급부들뿐 — 세부보장 단위 조건식 (핵심 개선)", () => {
    const { tree, b11, b21, b22 } = surgery();
    const values = mv({
      [b11]: { "pay.exempt": entered(true) },
      [b21]: { "pay.exempt": entered(false) },
      [b22]: { "pay.exempt": entered(false) },
    });
    const one = nodeEvalContext(tree, { level: "subCoverage", id: tree.subCoverages[0].id }, values, masterCatalog(defs));
    const two = nodeEvalContext(tree, { level: "subCoverage", id: tree.subCoverages[1].id }, values, masterCatalog(defs));
    expect(run("any(pay.exempt)", one!)).toEqual(value(true));
    expect(run("any(pay.exempt)", two!)).toEqual(value(false));
  });

  it("하위 급부 하나라도 미입력이면 집계는 오류 + 그 급부의 좌표", () => {
    const { tree, b11, b21 } = surgery();
    const values = mv({
      [b11]: { "pay.exempt": entered(false) },
      [b21]: { "pay.exempt": entered(false) },
    });
    const ctx = masterEvalContext(tree, values, masterCatalog(defs));
    expect(run("any(pay.exempt)", ctx)).toMatchObject({
      kind: "error",
      issue: {
        kind: "notEntered",
        at: { ownerName: "수술비 > 2종수술 > 입원보험금", refPath: "pay.exempt" },
      },
    });
  });

  it("내장 경로 builtin.<레벨>.name 은 뼈대 이름이다 — 급부 문맥은 조상 이름도 안다", () => {
    const { tree, b22 } = surgery();
    const values = mv({});
    const cov = masterEvalContext(tree, values, masterCatalog(defs));
    expect(run("builtin.coverage.name", cov)).toEqual(value("수술비"));
    expect(run("count(builtin.subCoverage.name)", cov)).toEqual(value(2));
    expect(run("count(builtin.benefit.name)", cov)).toEqual(value(2)); // distinct — 수술보험금 ×2 · 입원보험금
    const ben = nodeEvalContext(tree, { level: "benefit", id: b22 }, values, masterCatalog(defs))!;
    expect(run("builtin.benefit.name", ben)).toEqual(value("입원보험금"));
    expect(run("builtin.subCoverage.name", ben)).toEqual(value("2종수술"));
    expect(run("builtin.coverage.name = '수술비'", ben)).toEqual(value(true));
  });

  it("아래 레벨 자리를 집계 없이 직접 읽으면 값 자리가 없다 — 위 레벨 값은 조상에서 읽힌다", () => {
    const { tree, b11 } = surgery();
    const values = mv({ [tree.id]: { "coverage_basic.claim_name": entered("수술비") } });
    const cov = masterEvalContext(tree, values, masterCatalog(defs));
    expect(run("pay.exempt", cov)).toMatchObject({ kind: "error", issue: { kind: "notAttached" } });
    const ben = nodeEvalContext(tree, { level: "benefit", id: b11 }, values, masterCatalog(defs))!;
    expect(run("coverage_basic.claim_name", ben)).toEqual(value("수술비"));
    expect(run("coverage_basic.claim_name = '수술비' and builtin.subCoverage.name = '1종수술'", ben)).toEqual(
      value(true),
    );
  });

  it("구분자는 그 레벨 문맥에서 식을 평가한 값이다 — 값 행이 없다", () => {
    const { tree, b11, b21, b22 } = surgery();
    const ok = mv({
      [tree.id]: { "coverage_basic.claim_name": entered("수술비") },
      [b11]: { "pay.exempt": entered(false) },
      [b21]: { "pay.exempt": entered(true) },
      [b22]: { "pay.exempt": entered(false) },
    });
    const cov = masterEvalContext(tree, ok, masterCatalog(defs));
    expect(run("D0001", cov)).toEqual(value("수술비")); // 투영
    expect(run("D0002", cov)).toEqual(value(true)); // 집계
    // 급부 문맥에서 담보 레벨 구분자를 읽으면 담보 문맥(조상)에서 평가된다
    const ben = nodeEvalContext(tree, { level: "benefit", id: b11 }, ok, masterCatalog(defs))!;
    expect(run("D0002", ben)).toEqual(value(true));
  });

  it("구분자 식이 미입력·문법 오류로 못 풀리면 그 자리를 미입력으로 보고한다", () => {
    const { tree, b11 } = surgery();
    const partial = mv({ [b11]: { "pay.exempt": entered(false) } });
    const ctx = masterEvalContext(tree, partial, masterCatalog(defs));
    expect(run("D0002", ctx)).toMatchObject({
      kind: "error",
      issue: { kind: "notEntered", at: { refPath: "D0002" } },
    });
    expect(run("D0004", ctx)).toMatchObject({ kind: "error", issue: { kind: "brokenRef" } });
  });

  it("세목·상품 레벨 참조와 담보속성은 마스터 문맥에서 미결(undetermined)이다 — 조립 때 결정", () => {
    const { tree } = surgery();
    const ctx = masterEvalContext(
      tree,
      mv({ [tree.id]: { "coverage_basic.claim_name": entered("수술비") } }),
      masterCatalog(defs),
    );
    expect(run("waiver.applies", ctx)).toEqual({ kind: "undetermined", reason: "waiver.applies" });
    expect(run("D0003", ctx)).toEqual({ kind: "undetermined", reason: "D0003" });
    expect(run("attr.A0001 = '2'", ctx)).toEqual({ kind: "undetermined", reason: "attr.A0001" });
    expect(run("exist(attr.A0001)", ctx)).toEqual({ kind: "undetermined", reason: "attr.A0001" });
    // 미결 가드 관용구 — 왼쪽이 결정되면 오른쪽은 평가하지 않는다
    expect(run("coverage_basic.claim_name = '수술비' or D0003", ctx)).toEqual(value(true));
  });

  it("없는 구분자·없는 마스터 자리 참조는 brokenRef", () => {
    const { tree } = surgery();
    const ctx = masterEvalContext(tree, mv({}), masterCatalog(defs));
    expect(run("D9999", ctx)).toMatchObject({ kind: "error", issue: { kind: "brokenRef" } });
    expect(run("coverage.gone", ctx)).toMatchObject({ kind: "error", issue: { kind: "brokenRef" } });
  });

  it("nodeEvalContext 는 트리에 없는 노드면 undefined", () => {
    const { tree } = surgery();
    expect(nodeEvalContext(tree, { level: "benefit", id: "nope" }, mv({}), masterCatalog(defs))).toBeUndefined();
  });
});

describe("여는 폼 — 감액 폼을 안 연 급부는 exist 가 false · 직접 읽으면 notAttached", () => {
  const 감액여부: Discriminator = { code: "D0010", label: "감액여부", description: "", level: "benefit", expression: "exist(reduction.periods)" };
  it("값 행 없는 급부에서 exist(reduction.periods) = false, 있는 급부는 true", () => {
    const { tree, b11 } = surgery();
    const ctx = nodeEvalContext(tree, { level: "benefit", id: b11 }, mv({}), masterCatalog([감액여부]))!;
    expect(run("exist(reduction.periods)", ctx)).toEqual(value(false));
    const withRows = nodeEvalContext(tree, { level: "benefit", id: b11 }, mv({ [b11]: { "reduction.periods": entered([{ end: 12, rate: 50 }]) } }), masterCatalog([감액여부]))!;
    expect(run("exist(reduction.periods)", withRows)).toEqual(value(true));
  });
  it("담보 문맥의 exist 는 하위 급부 중 하나라도 열려 있으면 true", () => {
    const { tree, b22 } = surgery();
    const ctx = masterEvalContext(tree, mv({ [b22]: { "reduction.periods": entered([{ end: 12, rate: 50 }]) } }), masterCatalog([감액여부]));
    expect(run("exist(reduction.periods)", ctx)).toEqual(value(true));
    expect(run("any(D0010)", ctx)).toEqual(value(true));
  });
  it("안 연 폼의 필드를 집계 없이 직접 읽으면 notAttached 오류", () => {
    const { tree, b11 } = surgery();
    const ctx = nodeEvalContext(tree, { level: "benefit", id: b11 }, mv({}), masterCatalog([]))!;
    expect(run("reduction.new_only", ctx)).toMatchObject({ kind: "error", issue: { kind: "notAttached" } });
  });
});

describe("노드 한정자 — 구분자를 그 노드 문맥에서 평가 (ADR-0066 §1)", () => {
  const 급부감액여부: Discriminator = { code: "D0002", label: "감액여부", description: "", level: "benefit", expression: "exist(reduction.periods)" };
  const 세부감액여부: Discriminator = { code: "D0007", label: "감액여부", description: "", level: "subCoverage", expression: "any(D0002)" };
  const defs2 = [급부감액여부, 세부감액여부];
  it("2종수술 쪽에만 감액 → D0007@2종수술 참 · D0007@1종수술 거짓 · 한정자 없는 D0007 은 담보 문맥에서 자리 없음(집계 필요)", () => {
    const { tree, b22 } = surgery();
    const [s1, s2] = tree.subCoverages.map((s) => s.id);
    const ctx = masterEvalContext(tree, mv({ [b22]: { "reduction.periods": entered([{ end: 12, rate: 50 }]) } }), masterCatalog(defs2));
    expect(run(`D0007@${s2}`, ctx)).toEqual(value(true));
    expect(run(`D0007@${s1}`, ctx)).toEqual(value(false));
    expect(run(`any(D0007)`, ctx)).toEqual(value(true));
  });
  it("트리에 없는 노드 · 레벨이 다른 노드는 brokenRef", () => {
    const { tree, b22 } = surgery();
    const ctx = masterEvalContext(tree, mv({}), masterCatalog(defs2));
    expect(run("D0007@nope", ctx)).toMatchObject({ kind: "error", issue: { kind: "brokenRef" } });
    expect(run(`D0007@${b22}`, ctx)).toMatchObject({ kind: "error", issue: { kind: "brokenRef" } }); // 세부보장 구분자를 급부에
  });
});

describe("자식 제공자 — 담보 트리에서 coverage → 세부보장 · subCoverage → 급부 (ADR-0070 결정 2)", () => {
  it("담보 노드의 자식 = 세부보장(order 순), 세부보장의 자식 = 급부", () => {
    const { tree, b21, b22 } = surgery();
    const p = coverageChildrenProviders(tree);
    const subs = p.coverage!.children({ level: "coverage", id: tree.id });
    expect(subs.map((n) => [n.level, n.name, n.order])).toEqual([
      ["subCoverage", "1종수술", 0],
      ["subCoverage", "2종수술", 1],
    ]);
    expect(p.subCoverage!.children(subs[1]).map((n) => n.id)).toEqual([b21, b22]);
  });

  it("plan · product 제공자는 없다 — 열거가 「제공자 없음」으로 떨어진다", () => {
    const { tree } = surgery();
    const p = coverageChildrenProviders(tree);
    expect(p.plan).toBeUndefined();
    expect(p.product).toBeUndefined();
  });

  it("트리에 없는 노드의 자식은 빈 목록", () => {
    const { tree } = surgery();
    expect(coverageChildrenProviders(tree).subCoverage!.children({ level: "subCoverage", id: "nope" })).toEqual([]);
  });

  it("행 원천 — 뿌리 = 담보 노드, 행 문맥은 그 노드에서 평가 (자기-또는-조상)", () => {
    const { tree, b22 } = surgery();
    const values = mv({ [tree.id]: { "coverage_basic.claim_name": entered("수술비") } });
    const src = coverageRowSource(tree, values, masterCatalog(defs));
    expect(src.root).toEqual(coverageStructNode(tree));
    const rows = enumerateRows(src.root, 2, src.providers);
    expect(rows.ok && rows.value.length).toBe(3);
    const ctx = src.rowContext({ level: "benefit", id: b22 })!;
    expect(run("D0001", ctx)).toEqual(value("수술비"));
    expect(src.rowContext({ level: "benefit", id: "nope" })).toBeUndefined();
  });
});

