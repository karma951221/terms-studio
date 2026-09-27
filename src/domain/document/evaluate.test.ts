import { describe, expect, it } from "vitest";

import { refPath } from "../expression";
import type { EvalContext, LookupResult } from "../expression";
import type { Value } from "../types";
import { nodeBuilders, sequentialIds } from "./builders";
import { surgeryFixture } from "./fixture";
import { preEvaluate } from "./evaluate";
import type { Discriminator } from "../catalog";
import { coverageRowSource, masterCatalog, masterEvalContext, surgery, type MasterValues } from "../coverage";
import { entered } from "../types";
import type { DocumentNode, InlineNode, TableNode } from "./nodes";
import { repeatCloneId, templateIdOf } from "./repeat";

/**
 * 담보 마스터 편집 문맥 흉내 (B1 의 masterEvalContext 자리) —
 * 담보 레벨 값은 주어진 대로, 상품 레벨(D0002)·담보속성은 미결, 급부 집계는 하위 문맥 열거.
 */
function masterContext(values: Record<string, Value | "notEntered">, benefits: Record<string, Value>[] = []): EvalContext {
  const lookup = (path: string): LookupResult => {
    if (path.startsWith("D0002")) return { kind: "undetermined" };
    const v = values[path];
    if (v === undefined) return { kind: "missing" };
    if (v === "notEntered") return { kind: "slot", slot: { entered: false } };
    return { kind: "slot", slot: { entered: true, value: v } };
  };
  const benefitCtx = (vals: Record<string, Value>): EvalContext => ({
    lookup: (ref) => {
      const path = refPath(ref);
      const v = vals[path];
      return v === undefined ? { kind: "missing" } : { kind: "slot", slot: { entered: true, value: v } };
    },
    attribute: () => ({ kind: "undetermined" }),
    children: () => undefined,
  });
  return {
    lookup: (ref) => lookup(ref.kind === "builtin" ? "builtin" : refPath(ref)),
    attribute: () => ({ kind: "undetermined" }),
    children: (ref) => (ref.kind === "master" && ref.form === "pay" ? benefits.map(benefitCtx) : undefined),
    coordinate: { document: "coverageMaster", ownerId: "cov-surgery" },
  };
}

function states(doc: Parameters<typeof preEvaluate>[0], ctx: EvalContext) {
  const r = preEvaluate(doc, ctx);
  return Object.fromEntries([...r.branches].map(([id, s]) => [id, s.state]));
}

describe("사전평가 S1 — 담보 마스터 값으로 안 타는 분기 톤다운", () => {
  it("갱신여부 = false 면 「최초계약일」 쪽·보험기간 조 가지는 notTaken, else 쪽은 taken", () => {
    const { special } = surgeryFixture();
    const ctx = masterContext({ D0001: false, D0004: "2.5%", D0005: true }, [{ "D0003.F01": true, "D0003.F02": 100 }]);
    const s = states(special, ctx);
    expect(s["s-inl-renew-if"]).toBe("notTaken");
    expect(s["s-inl-renew-else"]).toBe("taken");
    expect(s["s-cond-term-if"]).toBe("notTaken");
    expect(s["s-cond-exempt-if"]).toBe("taken");
  });

  it("마스터 값을 true 로 바꾸면 톤다운이 반대로 뒤집힌다", () => {
    const { special } = surgeryFixture();
    const ctx = masterContext({ D0001: true, D0004: "2.5%", D0005: false });
    const s = states(special, ctx);
    expect(s["s-inl-renew-if"]).toBe("taken");
    expect(s["s-inl-renew-else"]).toBe("notTaken");
    expect(s["s-cond-term-if"]).toBe("taken");
    expect(s["s-cond-exempt-if"]).toBe("notTaken");
  });

  it("슬롯 값 맵 — const 「평균공시이율」 값이 실린다", () => {
    const { special } = surgeryFixture();
    const r = preEvaluate(special, masterContext({ D0001: true, D0004: "2.5%", D0005: false }));
    expect(r.slots.get("s-slot-rate")).toEqual({ kind: "value", value: "2.5%" });
  });
});

describe("사전평가 S2 — 미입력 값을 읽는 분기는 미결이 아니라 오류로 드러난다 (조용한 false 없음)", () => {
  it("미입력 참조 → error + notEntered 이슈(좌표) · 값이 들어오면 taken/notTaken 으로 갈린다", () => {
    const { special } = surgeryFixture();
    const r = preEvaluate(special, masterContext({ D0001: "notEntered", D0004: "2.5%", D0005: false }));
    expect(r.branches.get("s-cond-term-if")).toMatchObject({ state: "error", issue: { kind: "notEntered" } });
    expect(r.branches.get("s-cond-term-if")?.issue?.at).toMatchObject({
      document: "coverageMaster",
      ownerId: "cov-surgery",
      nodePath: ["s-doc", "s-cond-term", "s-cond-term-if"],
      refPath: "D0001",
    });
    expect(r.issues.map((i) => i.kind)).toContain("notEntered");
  });
});

describe("사전평가 S3 — 상품 레벨·담보속성 조건은 미결", () => {
  it("상품 레벨(D0002)·담보속성 조건은 undetermined — 뒤따르는 가지(else 포함)도 미결", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const doc = b.document("d", [
      b.condBlock([
        b.branch("D0002 = 'V01'", [b.article("a", [])]), // 가지 n2
        b.branch("attr.renew_type = 'renew'", [b.article("b", [])]), // 가지 n4
        b.branch(undefined, [b.article("c", [])]), // 가지 n6
      ]),
    ]);
    const r = preEvaluate(doc, masterContext({}));
    expect(r.branches.get("n2")).toMatchObject({ state: "undetermined", reason: "D0002" });
    expect(r.branches.get("n4")?.state).toBe("undetermined");
    expect(r.branches.get("n6")?.state).toBe("undetermined");
  });

  it("앞 가지가 taken 이면 뒤 가지는 평가 없이 notTaken · 앞이 false 고 뒤가 미결이면 else 도 미결", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const doc = b.document("d", [
      b.condBlock([
        b.branch("D0001 = true", [b.article("a", [])]), // 가지 n2
        b.branch("D0002 = 'V01'", [b.article("b", [])]), // 가지 n4
        b.branch(undefined, [b.article("c", [])]), // 가지 n6
      ]),
    ]);
    const taken = preEvaluate(doc, masterContext({ D0001: true }));
    expect([taken.branches.get("n2")?.state, taken.branches.get("n4")?.state, taken.branches.get("n6")?.state]).toEqual(["taken", "notTaken", "notTaken"]);
    const und = preEvaluate(doc, masterContext({ D0001: false }));
    expect([und.branches.get("n2")?.state, und.branches.get("n4")?.state, und.branches.get("n6")?.state]).toEqual(["notTaken", "undetermined", "undetermined"]);
  });

  it("문법 오류 조건식은 error(syntax) · 그 뒤 가지는 미결", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const doc = b.document("d", [b.condBlock([b.branch("D0001 = =", [b.article("a", [])]), b.branch(undefined, [])])]);
    const r = preEvaluate(doc, masterContext({ D0001: true }));
    expect(r.branches.get("n2")).toMatchObject({ state: "error", issue: { kind: "syntax" } }); // 가지 n2 · else 가지 n3
    expect(r.branches.get("n3")?.state).toBe("undetermined");
  });

  it("톤다운된 가지 안의 중첩 조건도 독립적으로 평가된다 (톤다운은 잠금이 아니다 — 사전평가 S4)", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const doc = b.document("d", [
      b.condBlock([b.branch("D0001 = true", [b.condBlock([b.branch("D0005 = true", [b.article("a", [])])])])]), // 안 가지 n2 · 바깥 가지 n4
    ]);
    const r = preEvaluate(doc, masterContext({ D0001: false, D0005: true }));
    expect(r.branches.get("n4")?.state).toBe("notTaken");
    expect(r.branches.get("n2")?.state).toBe("taken");
  });
});

// ───────────────────────────── 반복 표 (ADR-0070 결정 6) ─────────────────────────────

describe("반복 표 — 행 문맥 평가 · 바깥 key 병합 · 행 0 생략", () => {
  const defs: Discriminator[] = [
    { code: "D0101", label: "담보명", description: "", level: "coverage", expression: "coverage_basic.claim_name" },
    { code: "D0102", label: "면책여부", description: "", level: "subCoverage", expression: "any(pay.exempt)" },
    { code: "D0103", label: "지급률", description: "", level: "benefit", expression: "pay.rate" },
  ];
  const cat = masterCatalog(defs);

  function repeatDoc(depth: 1 | 2, template: InlineNode[][], header = true): DocumentNode {
    const b = nodeBuilders(sequentialIds("t"));
    const table: TableNode = {
      id: "tbl",
      kind: "table",
      columns: template.map(() => ({})),
      rows: [...(header ? [{ header: true, cells: template.map((_, i) => [b.text(`머리${i}`)]) }] : []), { cells: template }],
      repeat: { depth },
    };
    return b.document("수술비 약관", [{ ...b.article("보장내용", [b.paragraph([b.text("다음과 같습니다")], [table])]), id: "art" }]);
  }

  type Ids = ReturnType<typeof surgery>;
  function setup(valuesOf: (ids: Ids) => Record<string, Record<string, ReturnType<typeof entered>>> = () => ({})) {
    const { tree, b11, b21, b22 } = surgery();
    const values = valuesOf({ tree, b11, b21, b22 });
    const mv: MasterValues = { slots: new Map(Object.entries(values).map(([id, s]) => [id, new Map(Object.entries(s))])) };
    const ctx = masterEvalContext(tree, mv, cat);
    return { tree, b11, b21, b22, ctx, rows: coverageRowSource(tree, mv, cat) };
  }

  const key = (id: string, level: "subCoverage" | "benefit"): InlineNode => ({ id, kind: "structKey", level });
  const slot = (id: string, ref: string): InlineNode => ({ id, kind: "slot", ref });

  it("깊이 1 — 세부보장마다 한 줄, 구조 표기는 세부보장명 · 한정자 없는 세부보장 구분자는 그 행 노드에서", () => {
    const { tree, ctx, rows } = setup(({ b11, b21, b22 }) => ({
      [b11]: { "pay.exempt": entered(true) },
      [b21]: { "pay.exempt": entered(false) },
      [b22]: { "pay.exempt": entered(false) },
    }));
    const doc = repeatDoc(1, [[key("k1", "subCoverage")], [slot("s1", "D0102")]]);
    const r = preEvaluate(doc, ctx, { rows });
    const t = r.tables.get("tbl");
    expect(t?.kind).toBe("expanded");
    if (t?.kind !== "expanded") return;
    const [s1, s2] = tree.subCoverages.map((s) => s.id);
    expect(t.expansion.table.repeat).toBeUndefined();
    expect(t.expansion.table.rows).toHaveLength(3);
    expect(t.expansion.table.rows[1].cells[0]).toEqual([{ id: repeatCloneId("k1", s1), kind: "text", text: "1종수술" }]);
    expect(t.expansion.table.rows[2].cells[0]).toEqual([{ id: repeatCloneId("k1", s2), kind: "text", text: "2종수술" }]);
    expect(t.expansion.table.rows[1].spans).toBeUndefined(); // 깊이 1 은 바깥 key 가 없다
    expect(r.slots.get(repeatCloneId("s1", s1))).toEqual({ kind: "value", value: true });
    expect(r.slots.get(repeatCloneId("s1", s2))).toEqual({ kind: "value", value: false });
    expect(r.slots.has("s1")).toBe(false); // 템플릿 자체는 문서 문맥으로 평가하지 않는다
  });

  it("깊이 2 — 세부보장 order → 급부 order 로 펼치고, 바깥 key(세부보장) 열은 세로 병합", () => {
    const { b11, b21, b22, ctx, rows, tree } = setup(({ b11, b21, b22 }) => ({
      [b11]: { "pay.rate": entered(100) },
      [b21]: { "pay.rate": entered(50) },
      [b22]: { "pay.rate": entered(30) },
    }));
    const doc = repeatDoc(2, [[key("k1", "subCoverage")], [key("k2", "benefit")], [slot("s1", "D0103")]]);
    const r = preEvaluate(doc, ctx, { rows });
    const t = r.tables.get("tbl");
    if (t?.kind !== "expanded") throw new Error(`expanded 기대: ${t?.kind}`);
    const body = t.expansion.table.rows.slice(1);
    expect(body.map((row) => (row.cells[1][0] as { text: string }).text)).toEqual(["급부 1 수술보험금", "급부 1 수술보험금", "급부 2 입원보험금"]);
    expect(body.map((row) => row.spans)).toEqual([
      [1, 1, 1],
      [2, 1, 1],
      [0, 1, 1],
    ]);
    expect(t.expansion.table.rows[0].spans).toBeUndefined(); // 머리글은 그대로
    expect([b11, b21, b22].map((b) => r.slots.get(repeatCloneId("s1", b)))).toEqual([
      { kind: "value", value: 100 },
      { kind: "value", value: 50 },
      { kind: "value", value: 30 },
    ]);
    expect(t.expansion.rows.map((x) => x.key.map((k) => k.id))).toEqual([
      [tree.subCoverages[0].id, b11],
      [tree.subCoverages[1].id, b21],
      [tree.subCoverages[1].id, b22],
    ]);
  });

  it("한정자 없는 위 레벨(담보) 참조는 행 노드의 조상 — 문맥 담보에서 평가", () => {
    const { b11, b21, b22, ctx, rows } = setup(({ tree }) => ({ [tree.id]: { "coverage_basic.claim_name": entered("수술비") } }));
    const doc = repeatDoc(2, [[key("k2", "benefit")], [slot("s1", "D0101")]]);
    const r = preEvaluate(doc, ctx, { rows });
    expect([b11, b21, b22].map((b) => r.slots.get(repeatCloneId("s1", b)))).toEqual(Array(3).fill({ kind: "value", value: "수술비" }));
  });

  it("@노드 고정 참조는 행과 무관하게 그 노드에서", () => {
    const { b11, b21, b22, ctx, rows } = setup(({ b11, b21, b22 }) => ({
      [b11]: { "pay.rate": entered(100) },
      [b21]: { "pay.rate": entered(50) },
      [b22]: { "pay.rate": entered(30) },
    }));
    const doc = repeatDoc(2, [[key("k2", "benefit")], [slot("s1", `D0103@${b22}`)]]);
    const r = preEvaluate(doc, ctx, { rows });
    expect([b11, b21, b22].map((b) => r.slots.get(repeatCloneId("s1", b)))).toEqual(Array(3).fill({ kind: "value", value: 30 }));
  });

  it("행 안 인라인 조건도 행 문맥 — 가지 id 도 복제본 id", () => {
    const { ctx, rows, tree } = setup(({ b11, b21, b22 }) => ({
      [b11]: { "pay.exempt": entered(true) },
      [b21]: { "pay.exempt": entered(false) },
      [b22]: { "pay.exempt": entered(false) },
    }));
    const cond: InlineNode = {
      id: "c1",
      kind: "inlineCond",
      branches: [
        { id: "c1-if", when: "D0102", children: [{ id: "x1", kind: "text", text: "면책" }] },
        { id: "c1-else", children: [{ id: "x2", kind: "text", text: "지급" }] },
      ],
    };
    const doc = repeatDoc(1, [[key("k1", "subCoverage")], [cond]]);
    const r = preEvaluate(doc, ctx, { rows });
    const [s1, s2] = tree.subCoverages.map((s) => s.id);
    expect(r.branches.get(repeatCloneId("c1-if", s1))?.state).toBe("taken");
    expect(r.branches.get(repeatCloneId("c1-if", s2))?.state).toBe("notTaken");
    expect(r.branches.get(repeatCloneId("c1-else", s2))?.state).toBe("taken");
    expect(r.branches.has("c1-if")).toBe(false);
  });

  it("key 조합이 0 이면 표 생략 (omitted)", () => {
    const { ctx } = setup();
    const empty = { root: { level: "coverage" as const, id: "c", name: "빈 담보", order: 0 }, providers: { coverage: { children: () => [] } }, rowContext: () => ctx };
    const doc = repeatDoc(1, [[key("k1", "subCoverage")]]);
    const r = preEvaluate(doc, ctx, { rows: empty });
    expect(r.tables.get("tbl")).toEqual({ kind: "omitted" });
    expect(r.issues).toEqual([]);
  });

  it("미입력 셀 → 슬롯 오류, 좌표 nodePath 에 행 노드 id 가 실린다", () => {
    const { b22, ctx, rows } = setup(({ b11, b21 }) => ({ [b11]: { "pay.rate": entered(100) }, [b21]: { "pay.rate": entered(50) } }));
    const doc = repeatDoc(2, [[key("k2", "benefit")], [slot("s1", "D0103")]]);
    const r = preEvaluate(doc, ctx, { rows });
    const ev = r.slots.get(repeatCloneId("s1", b22));
    expect(ev).toMatchObject({ kind: "error", issue: { kind: "notEntered" } });
    const path = ev?.kind === "error" ? ev.issue.at.nodePath ?? [] : [];
    expect(path).toContain(repeatCloneId("s1", b22));
    expect(path[0]).toBe(doc.id);
    expect(ev?.kind === "error" && ev.issue.at.articleId).toBe("art");
    expect(templateIdOf(path[path.length - 1])).toBe("s1");
  });

  it("행 원천 없이(문맥 담보 없음) 반복 표를 만나면 오류", () => {
    const { ctx } = setup();
    const doc = repeatDoc(1, [[key("k1", "subCoverage")]]);
    const r = preEvaluate(doc, ctx);
    expect(r.tables.get("tbl")).toMatchObject({ kind: "error", issue: { message: "반복 표는 담보 약관 템플릿에서만 쓸 수 있습니다" } });
  });

  it("반복 없는 표는 지금과 같다 — tables 에 싣지 않고 셀 슬롯은 문서 문맥", () => {
    const { ctx, rows } = setup(({ tree }) => ({ [tree.id]: { "coverage_basic.claim_name": entered("수술비") } }));
    const doc = repeatDoc(1, [[slot("s1", "D0101")]]);
    delete (doc.children[0] as { children: { items: TableNode[] }[] }).children[0].items[0].repeat;
    const r = preEvaluate(doc, ctx, { rows });
    expect(r.tables.size).toBe(0);
    expect(r.slots.get("s1")).toEqual({ kind: "value", value: "수술비" });
  });
});
