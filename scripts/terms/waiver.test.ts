import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { WAIVER_PRESENT } from "./waiver";

/**
 * 알파Plus 납입면제 재모델링의 변환 결과(시드 JSON) — 템플릿 모양 · 역할 함수조항 본문 · 값 한정 참조.
 * 원문과의 글자 대조는 `src/db/seed/real.test.ts`, 세목 변형은 같은 파일의 변형 describe.
 */

const DATA = path.join(process.cwd(), "src/db/seed/data");
const read = <T>(file: string): T => JSON.parse(readFileSync(path.join(DATA, file), "utf8")) as T;
type Json = Record<string, unknown> & { id?: string; kind?: string; children?: Json[] };

const generals = read<{ code: string; tree: Json }[]>("generals.json");
const clauses = read<(Json & { code: string; label: string; params?: { name: string }[] })[]>("clauses.json");
const alpha = generals.find((g) => g.code === "alpha-general")!.tree;

function find(n: unknown, pred: (x: Json) => boolean): Json | undefined {
  if (Array.isArray(n)) {
    for (const x of n) {
      const hit = find(x, pred);
      if (hit) return hit;
    }
    return undefined;
  }
  if (!n || typeof n !== "object") return undefined;
  const o = n as Json;
  if (pred(o)) return o;
  for (const v of Object.values(o)) {
    const hit = find(v, pred);
    if (hit) return hit;
  }
  return undefined;
}
const all = (n: unknown, pred: (x: Json) => boolean, out: Json[] = []): Json[] => {
  if (Array.isArray(n)) n.forEach((x) => all(x, pred, out));
  else if (n && typeof n === "object") {
    if (pred(n as Json)) out.push(n as Json);
    Object.values(n).forEach((v) => all(v, pred, out));
  }
  return out;
};
const clauseByLabel = (label: string) => clauses.find((c) => c.label === label)!;

describe("알파Plus 납입면제 템플릿 — 사유 값으로 분기하지 않는다 (결정 10 · 11 · 16)", () => {
  it("납입면제 세 조는 「납입면제 있음」 조 자리 IF 하나로 감싼다", () => {
    const wrap = find(alpha, (x) => x.kind === "condBlock" && JSON.stringify(x).includes('"title":"보험료의 납입면제"'))!;
    const branches = wrap.branches as { when: string; children: Json[] }[];
    expect(branches).toHaveLength(1);
    expect(branches[0].when).toBe(WAIVER_PRESENT);
    expect(branches[0].children.map((a) => a.title)).toEqual([
      "보험료의 납입면제",
      "납입면제에 관한 세부규정",
      "암(유사암제외), 뇌졸중, 급성심근경색증, 말기폐질환, 말기간경화, 말기신부전증, 양성뇌종양, 중대한재생불량성빈혈, 만성당뇨합병증의 정의 및 진단확정",
    ]);
  });

  it("제27조의1 ① = [납입면제종마다] 항(번호 · 이름 슬롯) › [현재 종의 사유마다] ⟨납입면제 호(사유 ← 현재 원소)⟩", () => {
    const outer = find(alpha, (x) => x.kind === "forBlock" && (x.source as Json).kind === "planOptions")!;
    expect(outer.source).toEqual({ kind: "planOptions", form: "waiver", filter: "waiver.applies = true" });
    const p = outer.children![0];
    expect((p.children as Json[]).filter((c) => c.kind === "slot").map((c) => c.ref)).toEqual(["builtin.plan.number", "builtin.plan.name"]);
    const inner = (p.items as Json[])[0];
    expect(inner.source).toEqual({ kind: "listOfCurrent", loop: outer.id, field: "reasons" });
    const ref = inner.children![0];
    expect(ref.clauseCode).toBe(clauseByLabel("납입면제 호").code);
    expect(ref.bindings).toEqual({ 사유: { kind: "current", loop: inner.id } });
    // 템플릿 어디에도 사유 값 코드 비교가 없다
    expect(all(alpha, (x) => typeof x.when === "string" && /V\d\d/.test(x.when as string))).toEqual([]);
  });

  it("정의 조 = [사유 합집합 ∩ 정의조대상(F03) = 예마다] ⟨정의(사유 ← 현재 원소)⟩", () => {
    const union = find(alpha, (x) => x.kind === "forBlock" && (x.source as Json).kind === "union")!;
    expect(union.source).toEqual({ kind: "union", form: "waiver", filter: "waiver.applies = true", field: "reasons", where: { field: "F03", value: true } });
    expect(union.children![0].clauseCode).toBe(clauseByLabel("정의 및 진단확정(알파Plus)").code);
  });

  it("종들을 받는 역할 함수조항 넷은 원천 연결(적용 납입면제종)로 넣는다", () => {
    for (const label of ["면제 부가항(알파Plus)", "납입면제 세부규정(알파Plus)", "무효 문구(알파Plus)", "부활 문구(알파Plus)"]) {
      const ref = find(alpha, (x) => x.kind === "clauseBlockRef" && x.clauseCode === clauseByLabel(label).code)!;
      expect(ref.bindings, label).toEqual({ 종들: { kind: "source", source: { form: "waiver", filter: "waiver.applies = true" } } });
    }
  });
});

describe("역할 함수조항 — switch 는 값마다 정확히 한 칸, 반복으로 생긴 호는 값 한정 참조 (결정 5 · 13 · 22)", () => {
  it("납입면제 호 · 정의 — E0001 값 14 가 각각 정확히 한 칸, 장해 값은 정의에서 「문구 없음」", () => {
    for (const label of ["납입면제 호", "정의 및 진단확정(알파Plus)"]) {
      const sw = find(clauseByLabel(label).body, (x) => x.kind === "switchBlock")!;
      const values = (sw.cases as { values: string[] }[]).flatMap((c) => c.values);
      expect(values, label).toEqual(Array.from({ length: 14 }, (_, i) => `V${String(i + 1).padStart(2, "0")}`));
    }
    const definition = find(clauseByLabel("정의 및 진단확정(알파Plus)").body, (x) => x.kind === "switchBlock")!;
    expect((definition.cases as { values: string[]; empty?: boolean }[]).filter((c) => c.empty).map((c) => c.values)).toEqual([["V11", "V12", "V13"]]);
  });

  it("세부규정의 「제27조의1 제1항 제1호」 = 사유 암·면책 한정, 「제10호, 제11호」 = 장해 값 한정(연결어는 원문대로 및 · 또는)", () => {
    const refs = all(clauseByLabel("납입면제 세부규정(알파Plus)").body, (x) => x.kind === "articleRef" && JSON.stringify(x).includes("restrict"));
    const shapes = refs.map((r) => [(r.targets as { restrict: { values: string[] } }[]).map((t) => t.restrict.values.join("+")).join(), r.connector]);
    expect(shapes).toEqual([
      ["V01", "및"],
      ["V01", "및"],
      ["V01", "및"],
      ["V11+V12+V13", "및"],
      ["V11+V12+V13", "또는"],
    ]);
  });
});
