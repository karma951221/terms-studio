import { describe, expect, it } from "vitest";

import type { Bindings } from "../clause/params";
import type { DocumentNode } from "../document/nodes";
import { nodeBuilders, sequentialIds } from "../document/builders";
import { titleNodes } from "../document/title";
import { dynTableFixtureA, type DynTable } from "../dyntable";
import { findForm } from "../master";
import type { Id } from "../types";
import { assembleSpecial } from "./booklet";
import { buildContexts } from "./context";
import { alphaMaster, alphaPlusFixture, coverageEntry, type CoverageSpec } from "./fixture";
import { resolveDocument } from "./resolve";
import type { AssemblyInput, RenderedArticle, RenderedStatic } from "./types";

/*
 * 동적표 조립 — 기능/동적표 §3.2 · §3.4 · §3.6, QA/인수기준 「동적표(감액 지급금액 표) 인수 케이스」.
 * 마스터 = 알파 픽스처 + 실제 정본의 감액 폼(`reduction` — `reductionPeriods` 가 읽는 창구).
 */

const TABLE_CODE = "DT000001";
const tableA: DynTable = { id: "dt-a", code: TABLE_CODE, ...dynTableFixtureA() };

const master = [...alphaMaster, findForm("reduction")!];

type Benefit = { id: Id; name: string; payRate?: number; reduction?: { periods: { end: number; rate: number }[]; afterRate?: number } };
type Sub = { id: Id; name: string; benefits: Benefit[] };

function spec(subs: Sub[], renewal = false): CoverageSpec {
  const values: CoverageSpec["values"] = { "pc-dyn": { "coverage_basic.renewal": renewal } };
  for (const s of subs) {
    for (const b of s.benefits) {
      const v: Record<string, unknown> = {};
      if (b.payRate !== undefined) v["pay.rate"] = b.payRate;
      if (b.reduction) {
        v["reduction.periods"] = b.reduction.periods;
        if (b.reduction.afterRate !== undefined) v["reduction.after_rate"] = b.reduction.afterRate;
      }
      values[b.id] = v as CoverageSpec["values"][string];
    }
  }
  return {
    id: "pc-dyn",
    name: "감액테스트",
    coverageId: "cov-dyn",
    coverageName: "감액테스트",
    attributes: [],
    subCoverages: subs.map((s, i) => ({ id: s.id, key: String(i + 1).padStart(2, "0"), masterNodeId: `m-${s.id}`, name: s.name, benefits: s.benefits.map((b, j) => ({ id: b.id, key: String(j + 1), masterNodeId: `m-${b.id}`, name: b.name })) })),
    values,
  };
}

function document(tableCode = TABLE_CODE, bindings: Bindings = { 갱신형: { kind: "const", value: false } }): DocumentNode {
  const b = nodeBuilders(sequentialIds("n"));
  return {
    id: "dyn-doc",
    kind: "document",
    title: "감액테스트 특별약관",
    children: [{ id: "dyn-art", kind: "article", title: titleNodes("보험금의 지급", "dyn-art"), children: [{ ...b.dynTableRef(tableCode, bindings), id: "dyn-ref" }] }],
  };
}

function input(subs: Sub[], opts: { renewal?: boolean; doc?: DocumentNode; tables?: DynTable[] } = {}): AssemblyInput {
  const base = alphaPlusFixture();
  return {
    ...base,
    master,
    coverages: [...base.coverages, coverageEntry(spec(subs, opts.renewal))],
    specialDocuments: new Map([...base.specialDocuments, ["cov-dyn", opts.doc ?? document()]]),
    dynTables: opts.tables ?? [tableA],
  };
}

function tableOf(doc: { children: unknown[] }): RenderedStatic | undefined {
  const art = doc.children.find((c) => (c as RenderedArticle).kind === "article" && (c as RenderedArticle).id === "dyn-art") as RenderedArticle | undefined;
  return art?.children.find((c) => c.kind === "table") as RenderedStatic | undefined;
}

const cellText = (cell: { kind: string; text?: string }[]) => cell.map((n) => (n.kind === "text" ? n.text : `<${n.kind}>`)).join("");

function rowsOf(inp: AssemblyInput): { rows: string[][]; issues: { kind: string; message: string }[]; complete: boolean } {
  const r = assembleSpecial(inp, inp, "pc-dyn");
  if (!r.ok) throw new Error(JSON.stringify(r.rejection));
  const t = tableOf(r.value.doc);
  if (t?.kind !== "table") throw new Error(`표 없음: ${JSON.stringify(r.value.issues)}`);
  return { rows: t.rows.map((row) => row.cells.map(cellText)), issues: r.value.issues, complete: r.value.complete };
}

const 후유장해 = (id: Id, reduction = true): Sub => ({ id, name: "질병후유장해", benefits: [{ id: `${id}-b`, name: "질병80%이상후유장해", payRate: 100, ...(reduction ? { reduction: { periods: [{ end: 12, rate: 50 }] } } : {}) }] });

describe("조립 — 동적표 펼침 (기능/동적표 §3.6)", () => {
  it("(a) 인수 케이스 1 — 세부보장 1 · 급부 1 · 감액 12개월 50% → 열 둘 · 셀 50% / 100%", () => {
    const r = rowsOf(input([후유장해("s1")]));
    expect(r.rows).toEqual([
      ["구 분", "계약일부터 1년경과시점 전일 이전", "계약일부터 1년경과시점 이후"],
      ["질병80%이상후유장해", "보험가입금액의 50%", "보험가입금액의 100%"],
    ]);
    expect(r.issues.filter((i) => i.message.includes("동적표"))).toEqual([]);
    expect(r.complete).toBe(true);
  });

  it("(b) 인수 케이스 4 — 세부보장 넷(급부 하나씩) → 셀에 「해당보장의 」, 머리글은 그대로", () => {
    const subs: Sub[] = ["s1", "s2", "s3", "s4"].map((id, i) => ({ id, name: `세부${i + 1}`, benefits: [{ id: `${id}-b`, name: `급부${i + 1}`, payRate: 100, reduction: { periods: [{ end: 12, rate: 50 }] } }] }));
    const r = rowsOf(input(subs));
    expect(r.rows[0]).toEqual(["구 분", "계약일부터 1년경과시점 전일 이전", "계약일부터 1년경과시점 이후"]);
    expect(r.rows.slice(1)).toEqual([1, 2, 3, 4].map((i) => [`급부${i}`, "해당보장의 보험가입금액의 50%", "해당보장의 보험가입금액의 100%"]));
  });

  it("(c) 갱신형을 담보 구분자(D0001 갱신여부)에 연결 · 상품 값 true → 「최초계약일부터…」", () => {
    const r = rowsOf(input([후유장해("s1")], { renewal: true, doc: document(TABLE_CODE, { 갱신형: { kind: "discriminator", code: "D0001" } }) }));
    expect(r.rows[0]).toEqual(["구 분", "최초계약일부터 1년경과시점 전일 이전", "최초계약일부터 1년경과시점 이후"]);
  });

  it("(d) 같은 급부명 · 비율 다름 → 따로 찍고 경고 dynTableMergeConflict, 완성본은 깨지지 않는다", () => {
    const subs: Sub[] = [
      { id: "s1", name: "1종수술", benefits: [{ id: "s1-b", name: "수술보험금", payRate: 100, reduction: { periods: [{ end: 12, rate: 50 }] } }] },
      { id: "s2", name: "2종수술", benefits: [{ id: "s2-b", name: "수술보험금", payRate: 50, reduction: { periods: [{ end: 12, rate: 50 }] } }] },
    ];
    const r = rowsOf(input(subs));
    expect(r.rows).toHaveLength(3);
    expect(r.rows.slice(1).map((row) => row[0])).toEqual(["수술보험금", "수술보험금"]);
    // 지급률 100 · 50 × 감액 50% → 50 · 25 — 열이 달라 묶지 않는다
    expect(r.rows[1].slice(1)).toEqual(["해당보장의 보험가입금액의 50%", "해당보장의 보험가입금액의 100%"]);
    expect(r.rows[2].slice(1)).toEqual(["해당보장의 보험가입금액의 25%", "해당보장의 보험가입금액의 50%"]);
    const warn = r.issues.find((i) => i.kind === "dynTableMergeConflict");
    expect(warn).toBeDefined();
    expect(r.complete).toBe(true);
  });

  it("(e) 보통약관(행 원천 없는 문맥)의 동적표는 구조 오류 마커", () => {
    const inp = input([후유장해("s1")]);
    const ctx = buildContexts(inp).general;
    const out = resolveDocument(document(), ctx, { clauses: new Map(), overrides: new Map(), coordinate: { document: "general" }, dynTables: new Map([[TABLE_CODE, tableA]]) });
    expect(out.issues.map((i) => [i.kind, i.message])).toEqual([["structure", "동적표는 담보약관(상품담보) 문맥에서만 쓸 수 있습니다"]]);
  });

  it("(f) 없는 동적표 코드 → brokenRef 마커", () => {
    const inp = input([후유장해("s1")], { doc: document("DT999999") });
    const r = assembleSpecial(inp, inp, "pc-dyn");
    if (!r.ok) throw new Error(JSON.stringify(r.rejection));
    expect(tableOf(r.value.doc)).toBeUndefined();
    const issue = r.value.issues.find((i) => i.kind === "brokenRef");
    expect(issue?.message).toBe("동적표 DT999999 이(가) 없습니다");
    expect(issue?.at.nodePath).toContain("dyn-ref");
    expect(r.value.complete).toBe(false);
  });

  it("(g) 어느 급부도 감액 폼을 열지 않음 → 열 하나 「지급금액」 · 비율 = 지급률", () => {
    const r = rowsOf(input([후유장해("s1", false)]));
    expect(r.rows).toEqual([
      ["구 분", "지급금액"],
      ["질병80%이상후유장해", "보험가입금액의 100%"],
    ]);
  });
});
