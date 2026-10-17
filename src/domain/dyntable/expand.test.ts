/**
 * 동적표 펼침 — QA/인수기준 「동적표(감액 지급금액 표) 인수 케이스」 1 ~ 6 · 같은 급부명 묶기 · 충돌 예.
 *
 * 기대 표는 인수기준의 `[칸 │ 칸 │ …]` 글자 그대로. 셀 템플릿의 「해당보장의」 조건(`count(builtin.subCoverage.name) >= 2`)은 조립이 담보 문맥에서
 * 평가하는 것이라, 여기서는 세부보장 이름을 돌려주는 작은 평가 문맥으로 남은 인라인 조건을 풀어 글로 만든다.
 */
import { describe, expect, it } from "vitest";

import { plainConst } from "../clause/bind";
import type { Inline } from "../clause/nodes";
import { evaluate, parse, type EvalContext } from "../expression";
import { entered } from "../types";
import { expandDynTable } from "./expand";
import { dynTableFixtureA, dynTableFixtureAPrime, dynTableFixtureR } from "./fixture";
import type { DynBenefit, DynTable, ExpandedDynTable, NewDynTable } from "./types";

// ───────────────────────────── 재료 ─────────────────────────────

function def(n: NewDynTable, code = "T0001"): DynTable {
  return { id: `id-${code}`, code, ...n };
}

const A = def(dynTableFixtureA());
const A2 = def(dynTableFixtureAPrime(), "T0002");
const R = def(dynTableFixtureR(), "T0003");

const deps = { formatConst: plainConst, refId: "ref1" };

interface B {
  sub: string;
  name: string;
  rate?: number;
  reduction?: { periods: [number, number][]; afterRate?: number };
}

/** 급부 줄 — `sub` 세부보장명 · `name` 급부명 · `rate` 지급률 · `reduction` [[끝 개월, 비율] …]. */
function benefits(list: B[]): DynBenefit[] {
  const subKeys = new Map<string, string>();
  return list.map((b, i) => {
    if (!subKeys.has(b.sub)) subKeys.set(b.sub, `S${subKeys.size + 1}`);
    return {
      subCoverageKey: subKeys.get(b.sub)!,
      subCoverageName: b.sub,
      key: `G${i + 1}`,
      name: b.name,
      ...(b.rate !== undefined ? { payRate: b.rate } : {}),
      ...(b.reduction ? { reduction: { periods: b.reduction.periods.map(([end, rate]) => ({ end, rate })), afterRate: b.reduction.afterRate ?? 100 } } : {}),
    };
  });
}

/** 담보 문맥 흉내 — `count(builtin.subCoverage.name)` 이 세부보장마다 하나씩 센다. */
function coverageCtx(list: DynBenefit[]): EvalContext {
  const names = [...new Set(list.map((b) => b.subCoverageName))];
  const child = (name: string): EvalContext => ({
    lookup: (ref) => (ref.kind === "builtin" && ref.level === "subCoverage" && ref.prop === "name" ? { kind: "slot", slot: entered(name) } : { kind: "missing" }),
    attribute: () => ({ kind: "undetermined" }),
    children: () => undefined,
  });
  return {
    lookup: () => ({ kind: "undetermined" }),
    attribute: () => ({ kind: "undetermined" }),
    children: (ref) => (ref.kind === "builtin" && ref.level === "subCoverage" ? names.map(child) : undefined),
  };
}

/** 남은 인라인(글 · 조건)을 글로 — 표 슬롯은 펼침이 이미 글로 바꿨어야 하므로 남아 있으면 `{경로}` 로 드러낸다. */
function render(inlines: Inline[], ctx: EvalContext): string {
  let out = "";
  for (const n of inlines) {
    switch (n.kind) {
      case "text":
        out += n.text;
        break;
      case "slot":
        out += `{${n.ref}}`;
        break;
      case "inlineCond": {
        for (const br of n.branches) {
          if (br.when === undefined) {
            out += render(br.children, ctx);
            break;
          }
          const parsed = parse(br.when);
          if (!parsed.ok) throw new Error(`조건 문법 오류: ${br.when}`);
          const r = evaluate(parsed.value, ctx);
          if (r.kind !== "value") throw new Error(`조건 평가 실패: ${br.when} → ${r.kind}`);
          if (r.value === true) {
            out += render(br.children, ctx);
            break;
          }
        }
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function lines(table: ExpandedDynTable, list: DynBenefit[]): string[] {
  const ctx = coverageCtx(list);
  const row = (cells: Inline[][]) => `[${cells.map((c) => render(c, ctx)).join(" │ ")}]`;
  return [row(table.header), ...table.rows.map((r) => row(r.cells))];
}

function expand(d: DynTable, list: DynBenefit[], bindings?: Parameters<typeof expandDynTable>[2]) {
  return expandDynTable(d, { benefits: list }, bindings, deps, { document: "special", ownerId: "pc1" });
}

const 비갱신 = { 갱신형: { kind: "const" as const, value: false } };
const 갱신 = { 갱신형: { kind: "const" as const, value: true } };

// ───────────────────────────── 인수 케이스 ─────────────────────────────

describe("동적표 펼침 — 인수 케이스", () => {
  it("케이스 1 세부보장 1 · 급부 1 — 경계 1개 → 열 2개(첫 + 마지막), 100% × 50% = 50%, 「해당보장의」 없음", () => {
    const list = benefits([{ sub: "질병80%이상후유장해", name: "질병80%이상후유장해", rate: 100, reduction: { periods: [[12, 50]] } }]);
    const t = expand(A, list, 비갱신);
    expect(t.issues).toEqual([]);
    expect(lines(t, list)).toEqual([
      "[구 분 │ 계약일부터 1년경과시점 전일 이전 │ 계약일부터 1년경과시점 이후]",
      "[질병80%이상후유장해 │ 보험가입금액의 50% │ 보험가입금액의 100%]",
    ]);
    expect(t.rows[0].benefitKeys).toEqual(["G1"]);
  });

  it("케이스 2 세부보장 1 · 급부 여러 개 · 감액 없음 — 경계 합집합이 비어 단일 열 「지급금액」, (갱신) 표 R 도 같은 세 행", () => {
    const list = benefits([
      { sub: "항암방사선약물치료비", name: "항암방사선약물치료비(암(유사암제외))", rate: 100 },
      { sub: "항암방사선약물치료비", name: "항암방사선약물치료비(기타피부암)", rate: 20 },
      { sub: "항암방사선약물치료비", name: "항암방사선약물치료비(갑상선암)", rate: 20 },
    ]);
    const expected = [
      "[구 분 │ 지급금액]",
      "[항암방사선약물치료비(암(유사암제외)) │ 보험가입금액의 100%]",
      "[항암방사선약물치료비(기타피부암) │ 보험가입금액의 20%]",
      "[항암방사선약물치료비(갑상선암) │ 보험가입금액의 20%]",
    ];
    const a = expand(A, list, 갱신);
    expect(a.issues).toEqual([]);
    expect(lines(a, list)).toEqual(expected);
    const r = expand(R, list, undefined);
    expect(r.issues).toEqual([]);
    expect(lines(r, list)).toEqual(expected);
  });

  it("케이스 3 급부마다 감액이 다름 — 경계 합집합 {3개월, 1년} → 열 3개, 가운데 열은 기준일을 되풀이, B 는 3개월 경계가 없어 첫 열도 1년 구간 비율", () => {
    // 일 단위 경계(90일)는 아직 적을 수 없어 3개월로 넣는다 (기능/동적표 §5)
    const list = benefits([
      { sub: "○○진단비", name: "○○진단비(A질환)", rate: 100, reduction: { periods: [[3, 10], [12, 50]] } },
      { sub: "○○진단비", name: "○○진단비(B질환)", rate: 100, reduction: { periods: [[12, 50]] } },
    ]);
    const t = expand(A, list, 갱신);
    expect(t.issues).toEqual([]);
    expect(lines(t, list)).toEqual([
      "[구 분 │ 최초계약일부터 3개월경과시점 전일 이전 │ 최초계약일부터 3개월경과시점 이후 최초계약일부터 1년경과시점 전일 이전 │ 최초계약일부터 1년경과시점 이후]",
      "[○○진단비(A질환) │ 보험가입금액의 10% │ 보험가입금액의 50% │ 보험가입금액의 100%]",
      "[○○진단비(B질환) │ 보험가입금액의 50% │ 보험가입금액의 50% │ 보험가입금액의 100%]",
    ]);
  });

  it("케이스 4 세부보장 여러 개 · 각 급부 1 — 세부보장 2개 이상 → 셀 앞 「해당보장의」, 구분은 1칸", () => {
    const red = { periods: [[12, 50]] as [number, number][] };
    const list = benefits([
      { sub: "대장", name: "대장 양성종양및특정폴립진단비", rate: 100, reduction: red },
      { sub: "위", name: "위,십이지장,소화계통 양성종양및특정폴립진단비", rate: 100, reduction: red },
      { sub: "중이", name: "중이,호흡계통,흉곽내기관 양성종양진단비", rate: 100, reduction: red },
      { sub: "골", name: "골,관절연골 양성종양진단비", rate: 100, reduction: red },
    ]);
    const t = expand(A, list, 비갱신);
    expect(t.issues).toEqual([]);
    expect(lines(t, list)).toEqual([
      "[구 분 │ 계약일부터 1년경과시점 전일 이전 │ 계약일부터 1년경과시점 이후]",
      "[대장 양성종양및특정폴립진단비 │ 해당보장의 보험가입금액의 50% │ 해당보장의 보험가입금액의 100%]",
      "[위,십이지장,소화계통 양성종양및특정폴립진단비 │ 해당보장의 보험가입금액의 50% │ 해당보장의 보험가입금액의 100%]",
      "[중이,호흡계통,흉곽내기관 양성종양진단비 │ 해당보장의 보험가입금액의 50% │ 해당보장의 보험가입금액의 100%]",
      "[골,관절연골 양성종양진단비 │ 해당보장의 보험가입금액의 50% │ 해당보장의 보험가입금액의 100%]",
    ]);
  });

  it("케이스 5 세부보장 여러 개 · 급부 여러 개 — 감액 없는 급부는 두 열 모두 100%, 행 순서 = 트리 순서", () => {
    const red = { periods: [[12, 50]] as [number, number][] };
    const list = benefits([
      { sub: "암진단비(유사암제외)", name: "암진단비(암(유사암 및 소액암 제외))", rate: 100 },
      { sub: "암진단비(유사암제외)", name: "암진단비(소액암)", rate: 100, reduction: red },
      { sub: "암 통합치료비III(비급여)", name: "암 통합치료비III(암(유사암제외))", rate: 100, reduction: red },
      { sub: "암 통합치료비III(비급여)", name: "암 통합치료비III(기타피부암 및 갑상선암)", rate: 100, reduction: red },
    ]);
    const t = expand(A, list, 비갱신);
    expect(t.issues).toEqual([]);
    expect(lines(t, list)).toEqual([
      "[구 분 │ 계약일부터 1년경과시점 전일 이전 │ 계약일부터 1년경과시점 이후]",
      "[암진단비(암(유사암 및 소액암 제외)) │ 해당보장의 보험가입금액의 100% │ 해당보장의 보험가입금액의 100%]",
      "[암진단비(소액암) │ 해당보장의 보험가입금액의 50% │ 해당보장의 보험가입금액의 100%]",
      "[암 통합치료비III(암(유사암제외)) │ 해당보장의 보험가입금액의 50% │ 해당보장의 보험가입금액의 100%]",
      "[암 통합치료비III(기타피부암 및 갑상선암) │ 해당보장의 보험가입금액의 50% │ 해당보장의 보험가입금액의 100%]",
    ]);
  });

  it("같은 급부명 묶기 — 급부 3개 → 표 2행(급부명이 같고 열마다 비율이 같아 묶임)", () => {
    const list = benefits([
      { sub: "항암방사선약물치료비", name: "항암방사선약물치료비(암(유사암제외))", rate: 100 },
      { sub: "항암방사선약물치료비", name: "항암방사선약물치료비(기타피부암 및 갑상선암)", rate: 20 },
      { sub: "항암방사선약물치료비", name: "항암방사선약물치료비(기타피부암 및 갑상선암)", rate: 20 },
    ]);
    const t = expand(A, list, 갱신);
    expect(t.issues).toEqual([]);
    expect(lines(t, list)).toEqual([
      "[구 분 │ 지급금액]",
      "[항암방사선약물치료비(암(유사암제외)) │ 보험가입금액의 100%]",
      "[항암방사선약물치료비(기타피부암 및 갑상선암) │ 보험가입금액의 20%]",
    ]);
    expect(t.rows[1].benefitKeys).toEqual(["G2", "G3"]);
  });

  it("묶기 충돌 예 — 갑상선암만 1년 50% 감액이면 묶지 않고 따로 찍고 경고 dynTableMergeConflict", () => {
    const list = benefits([
      { sub: "항암방사선약물치료비", name: "항암방사선약물치료비(암(유사암제외))", rate: 100 },
      { sub: "항암방사선약물치료비", name: "항암방사선약물치료비(기타피부암 및 갑상선암)", rate: 20 },
      { sub: "항암방사선약물치료비", name: "항암방사선약물치료비(기타피부암 및 갑상선암)", rate: 20, reduction: { periods: [[12, 50]] } },
    ]);
    const t = expand(A, list, 갱신);
    expect(lines(t, list)).toEqual([
      "[구 분 │ 최초계약일부터 1년경과시점 전일 이전 │ 최초계약일부터 1년경과시점 이후]",
      "[항암방사선약물치료비(암(유사암제외)) │ 보험가입금액의 100% │ 보험가입금액의 100%]",
      "[항암방사선약물치료비(기타피부암 및 갑상선암) │ 보험가입금액의 20% │ 보험가입금액의 20%]",
      "[항암방사선약물치료비(기타피부암 및 갑상선암) │ 보험가입금액의 10% │ 보험가입금액의 20%]",
    ]);
    expect(t.rows.map((r) => r.benefitKeys)).toEqual([["G1"], ["G2"], ["G3"]]);
    expect(t.issues).toEqual([
      expect.objectContaining({
        kind: "dynTableMergeConflict",
        severity: "warning",
        at: expect.objectContaining({ document: "special", ownerId: "pc1", refPath: "동적표 T0001 › 행 항암방사선약물치료비(기타피부암 및 갑상선암)" }),
      }),
    ]);
    expect(t.issues[0].message).toContain("열 1");
    expect(t.issues[0].message).toContain("20");
    expect(t.issues[0].message).toContain("10");
  });

  it("케이스 6 주요치료비 — 단서문구 글 인자가 첫 · 마지막 열 기간 문구 뒤에 붙는다 (정의 A′)", () => {
    const list = benefits([
      { sub: "2대질환 주요치료비", name: "보험금 지급기간 동안 「2대질환 주요치료」를 받은 경우 (연간1회한, 10년간) (보험금 지급기간 동안 적용)", rate: 100, reduction: { periods: [[12, 50]] } },
    ]);
    const t = expand(A2, list, { ...갱신, 단서: { kind: "const", value: "「2대질환」으로 진단확정 시" } });
    expect(t.issues).toEqual([]);
    expect(lines(t, list)).toEqual([
      "[구 분 │ 최초계약일부터 1년경과시점 전일 이전 「2대질환」으로 진단확정 시 │ 최초계약일부터 1년경과시점 이후 「2대질환」으로 진단확정 시]",
      "[보험금 지급기간 동안 「2대질환 주요치료」를 받은 경우 (연간1회한, 10년간) (보험금 지급기간 동안 적용) │ 보험가입금액의 50% │ 보험가입금액의 100%]",
    ]);
  });
});

// ───────────────────────────── 규칙 ─────────────────────────────

describe("동적표 펼침 — 규칙", () => {
  it("셀 비율 = 지급률 × 감액비율 / 100 — 정수가 아니면 소수 한 자리까지 그대로(반올림 없음)", () => {
    const list = benefits([
      { sub: "S", name: "a", rate: 33, reduction: { periods: [[12, 50]] } }, // 16.5
      { sub: "S", name: "b", rate: 100, reduction: { periods: [[12, 33.33]] } }, // 33.33 → 33.3
      { sub: "S", name: "c", rate: 20, reduction: { periods: [[12, 50]] } }, // 10
    ]);
    const t = expand(A, list, 비갱신);
    expect(lines(t, list).slice(1)).toEqual(["[a │ 보험가입금액의 16.5% │ 보험가입금액의 33%]", "[b │ 보험가입금액의 33.3% │ 보험가입금액의 100%]", "[c │ 보험가입금액의 10% │ 보험가입금액의 20%]"]);
  });

  it("이후 지급률 — 마지막 구간 뒤는 afterRate, 제 경계가 없는 열은 그 열을 덮는 자기 구간의 비율", () => {
    const list = benefits([
      { sub: "S", name: "a", rate: 100, reduction: { periods: [[6, 20], [24, 50]], afterRate: 80 } },
      { sub: "S", name: "b", rate: 100, reduction: { periods: [[12, 30]] } },
    ]);
    const t = expand(A, list, 비갱신);
    // 경계 {6, 12, 24} → 열 4개: [0,6) [6,12) [12,24) [24,∞)
    expect(lines(t, list)).toEqual([
      "[구 분 │ 계약일부터 6개월경과시점 전일 이전 │ 계약일부터 6개월경과시점 이후 계약일부터 1년경과시점 전일 이전 │ 계약일부터 1년경과시점 이후 계약일부터 2년경과시점 전일 이전 │ 계약일부터 2년경과시점 이후]",
      "[a │ 보험가입금액의 20% │ 보험가입금액의 50% │ 보험가입금액의 50% │ 보험가입금액의 80%]",
      "[b │ 보험가입금액의 30% │ 보험가입금액의 30% │ 보험가입금액의 100% │ 보험가입금액의 100%]",
    ]);
  });

  it("지급률 미입력 — 그 행 notEntered, 셀은 빈 글, 표 구조는 그대로", () => {
    const list = benefits([{ sub: "S", name: "a", reduction: { periods: [[12, 50]] } }, { sub: "S", name: "b", rate: 100 }]);
    const t = expand(A, list, 비갱신);
    expect(t.rows).toHaveLength(2);
    expect(lines(t, list)[1]).toBe("[a │  │ ]");
    expect(t.issues).toEqual([expect.objectContaining({ kind: "notEntered", at: expect.objectContaining({ refPath: "동적표 T0001 › 행 a" }) })]);
  });

  it("구분자 연결 — arg.갱신형 이 구분자 코드로 바뀌어 조건에 남는다(사용처 문맥에서 늦게 평가)", () => {
    const list = benefits([{ sub: "S", name: "a", rate: 100, reduction: { periods: [[12, 50]] } }]);
    const t = expand(A, list, { 갱신형: { kind: "discriminator", code: "D0001" } });
    expect(t.issues).toEqual([]);
    const first = t.header[1][0];
    expect(first.kind).toBe("inlineCond");
    if (first.kind !== "inlineCond") throw new Error();
    expect(first.branches[0].when).toBe("D0001");
    expect(first.branches[1].when).toBeUndefined();
  });

  it("연결도 기본 연결도 없으면 argUnbound(동적표 코드로), 기본 연결이 있으면 그것을 쓴다", () => {
    const list = benefits([{ sub: "S", name: "a", rate: 100, reduction: { periods: [[12, 50]] } }]);
    const t = expand(A, list, undefined);
    expect(t.issues).toEqual([expect.objectContaining({ kind: "argUnbound", at: expect.objectContaining({ refPath: "arg.갱신형" }) })]);
    expect(t.issues[0].message).toContain("동적표 T0001");
    expect(t.header).toHaveLength(3); // 구조는 그대로

    const withDefault: DynTable = { ...A, params: [{ name: "갱신형", type: { kind: "boolean" }, default: { kind: "const", value: true } }] };
    const d = expand(withDefault, list, undefined);
    expect(d.issues).toEqual([]);
    expect(lines(d, list)[0]).toBe("[구 분 │ 최초계약일부터 1년경과시점 전일 이전 │ 최초계약일부터 1년경과시점 이후]");
  });

  it("노드 id — 참조 id / 템플릿 노드 id @ 행 · 열, 머리글 행은 h; 표 슬롯은 같은 id 의 글 노드가 된다", () => {
    const list = benefits([{ sub: "S", name: "a", rate: 100, reduction: { periods: [[12, 50]] } }]);
    const t = expand(A, list, 비갱신);
    expect(t.header[0]).toEqual([{ id: "ref1/rowHeader@rhc0", kind: "text", text: "구 분" }]);
    expect(t.header[1].map((n) => n.id)).toEqual(["ref1/first-base@rhc1", "ref1/first-t1@rhc1", "ref1/first-boundary@rhc1", "ref1/first-t2@rhc1"]);
    expect(t.header[1][2]).toEqual({ id: "ref1/first-boundary@rhc1", kind: "text", text: "1년" });
    expect(t.rows[0].cells[0]).toEqual([{ id: "ref1/row@r1c0", kind: "text", text: "a" }]);
    expect(t.rows[0].cells[1].map((n) => n.id)).toEqual(["ref1/cell-prefix@r1c1", "ref1/cell-t1@r1c1", "ref1/cell-rate@r1c1", "ref1/cell-t2@r1c1"]);
    const cond = t.rows[0].cells[1][0];
    if (cond.kind !== "inlineCond") throw new Error();
    expect(cond.branches[0].id).toBe("ref1/cell-prefix-b1@r1c1");
    expect(cond.branches[0].children[0].id).toBe("ref1/cell-prefix-b1-t@r1c1");
    // 표 슬롯은 남지 않는다
    const slots = [...t.header, ...t.rows.flatMap((r) => r.cells)].flat().filter((n) => n.kind === "slot");
    expect(slots).toEqual([]);
  });

  it("열 기준 「없음」이면 감액이 있어도 열 하나 · 비율 = 지급률", () => {
    const list = benefits([{ sub: "S", name: "a", rate: 60, reduction: { periods: [[12, 50]] } }]);
    const t = expand(R, list, undefined);
    expect(lines(t, list)).toEqual(["[구 분 │ 지급금액]", "[a │ 보험가입금액의 60%]"]);
  });

  it("급부가 없으면 머리글만 (단일 열) · 행 없음", () => {
    const t = expand(A, [], 비갱신);
    expect(lines(t, [])).toEqual(["[구 분 │ 지급금액]"]);
    expect(t.rows).toEqual([]);
  });
});
