import { describe, expect, it } from "vitest";

import type { Discriminator } from "../catalog";
import type { TypeResolver } from "../expression";
import { surgery } from "../coverage";
import type { AttachLevel } from "../types";
import { validateExpressions } from "./expressions";
import type { DocumentNode, InlineNode, TableNode, TableRow } from "./nodes";
import { expandRepeatTable, repeatScopeOf, repeatTableIssues, rowReadableLevels, templateIdOf } from "./repeat";

const defs: Discriminator[] = [
  { code: "D0101", label: "담보명", description: "", level: "coverage", expression: "coverage_basic.claim_name" },
  { code: "D0102", label: "면책여부", description: "", level: "subCoverage", expression: "any(pay.exempt)" },
  { code: "D0103", label: "급부명", description: "", level: "benefit", expression: "builtin.benefit.name" },
];
const levelOf = (code: string): AttachLevel | undefined => defs.find((d) => d.code === code)?.level;

const text = (id: string, t: string): InlineNode => ({ id, kind: "text", text: t });
const key = (id: string, level: "subCoverage" | "benefit" | "coverage" | "plan"): InlineNode => ({ id, kind: "structKey", level });
const slot = (id: string, ref: string): InlineNode => ({ id, kind: "slot", ref });

function doc(table: TableNode, extra: InlineNode[] = []): DocumentNode {
  return {
    id: "doc",
    kind: "document",
    title: "수술비",
    children: [{ id: "art", kind: "article", title: "보장내용", children: [{ id: "p1", kind: "paragraph", children: [text("t0", "표"), ...extra], items: [table] }] }],
  };
}

function table(depth: 1 | 2 | undefined, rows: TableRow[]): TableNode {
  return { id: "tbl", kind: "table", columns: rows[0].cells.map(() => ({})), rows, ...(depth ? { repeat: { depth } } : {}) };
}

const header: TableRow = { header: true, cells: [[text("h1", "세부보장")], [text("h2", "값")]] };
const scope = { hasCoverage: true, levelOf };
const messages = (d: DocumentNode, s = scope) => repeatTableIssues(d, s).map((i) => [i.severity, i.message]);

describe("반복 표 저장 검사 — 설계 §2.6 다섯 줄", () => {
  it("정상 — 깊이 2 표에 세부보장 · 급부 표기 + 급부 구분자는 이슈 없음", () => {
    const d = doc(table(2, [header, { cells: [[key("k1", "subCoverage")], [key("k2", "benefit"), slot("s1", "D0103")]] }]));
    expect(messages(d)).toEqual([]);
  });

  it("① 문맥 담보 없는 문서의 반복 표 → 오류", () => {
    const d = doc(table(1, [header, { cells: [[key("k1", "subCoverage")], [text("x", "a")]] }]));
    expect(messages(d, { ...scope, hasCoverage: false })).toEqual([["error", "반복 표는 담보 약관 템플릿에서만 쓸 수 있습니다"]]);
  });

  it("② 구조 표기 레벨이 사슬 밖 → 오류 (깊이 1 의 급부 표기 · 담보 표기)", () => {
    const d = doc(table(1, [header, { cells: [[key("k1", "subCoverage")], [key("k2", "benefit")]] }]));
    expect(messages(d)).toEqual([["error", "이 표는 세부보장까지만 반복합니다 — 급부 표기는 깊이 2 에서"]]);
    const d2 = doc(table(2, [header, { cells: [[key("k1", "coverage")], [key("k2", "benefit")]] }]));
    expect(messages(d2)[0][1]).toContain("반복 레벨(세부보장 › 급부) 밖");
  });

  it("③ 행 레벨보다 아래 레벨의 한정자 없는 참조 → 오류 · 집계 · @노드 · 위 레벨은 통과", () => {
    const { b11 } = surgery();
    const row = (cells: InlineNode[][]): TableRow => ({ cells });
    const bad = doc(table(1, [header, row([[key("k1", "subCoverage")], [slot("s1", "D0103")]])]));
    const issues = repeatTableIssues(bad, scope);
    expect(issues.map((i) => i.message)).toEqual(["행보다 아래 레벨은 그 레벨을 집계한 구분자로 쓰세요"]);
    expect(issues[0].at).toMatchObject({ refPath: "D0103", articleId: "art" });
    const cond: InlineNode = { id: "c1", kind: "inlineCond", branches: [{ id: "c1-if", when: "D0103 = '수술'", children: [text("x", "예")] }] };
    expect(messages(doc(table(1, [header, row([[key("k1", "subCoverage")], [cond]])])))).toHaveLength(1);
    const ok = doc(
      table(1, [
        header,
        row([
          [key("k1", "subCoverage"), slot("s2", "D0101"), slot("s3", "D0102")],
          [slot("s4", `D0103@${b11}`), { id: "c2", kind: "inlineCond", branches: [{ id: "c2-if", when: "count(D0103) > 1", children: [text("y", "예")] }] }],
        ]),
      ]),
    );
    expect(messages(ok)).toEqual([]);
  });

  it("④ 구조 표기가 반복 표 밖(본문 · 반복 없는 표 · 머리글 행) → 오류", () => {
    const inBody = doc(table(undefined, [header]), [key("k0", "subCoverage")]);
    expect(messages(inBody)).toEqual([["error", "구조 표기는 반복 표 안에서만"]]);
    const plain = doc(table(undefined, [header, { cells: [[key("k1", "subCoverage")], [text("x", "a")]] }]));
    expect(messages(plain)).toEqual([["error", "구조 표기는 반복 표 안에서만"]]);
    const inHeader = doc(table(1, [{ header: true, cells: [[key("k1", "subCoverage")], [text("h", "값")]] }, { cells: [[key("k2", "subCoverage")], [text("x", "a")]] }]));
    expect(messages(inHeader)).toEqual([["error", "구조 표기는 반복 표 안에서만"]]);
  });

  it("⑤ 템플릿 행에 구조 표기 · 참조가 하나도 없으면 경고 (저장은 막지 않는다)", () => {
    const d = doc(table(1, [header, { cells: [[text("a", "가")], [text("b", "나")]] }]));
    expect(messages(d)).toEqual([["warning", "모든 행이 같아집니다"]]);
  });

  it("validateExpressions 는 오류만 싣는다 — 경고는 저장을 막지 않는다", () => {
    const resolve: TypeResolver = (ref) => (ref.kind === "discriminator" ? (ref.code === "D0102" ? { kind: "boolean" } : { kind: "string" }) : undefined);
    const { tree } = surgery();
    const flat = doc(table(1, [header, { cells: [[text("a", "가")], [text("b", "나")]] }]));
    expect(validateExpressions(flat, resolve, {}, { coverage: tree, levelOf })).toEqual([]);
    const noCov = doc(table(1, [header, { cells: [[key("k1", "subCoverage")], [text("b", "나")]] }]));
    expect(validateExpressions(noCov, resolve, {}, { levelOf }).map((i) => i.message)).toEqual(["반복 표는 담보 약관 템플릿에서만 쓸 수 있습니다"]);
  });
});

describe("repeatScopeOf · rowReadableLevels — 편집기 「현재 행」 가지 재료", () => {
  it("템플릿 셀 안 노드면 표 · 행 레벨 사슬 · 읽을 수 있는 레벨(행 레벨과 그 위)", () => {
    const d = doc(table(2, [header, { cells: [[key("k1", "subCoverage")], [slot("s1", "D0103")]] }]));
    const r = repeatScopeOf(d, "s1");
    expect(r?.table.id).toBe("tbl");
    expect(r?.levels).toEqual(["subCoverage", "benefit"]);
    expect(r?.readable).toEqual(["product", "plan", "coverage", "subCoverage", "benefit"]);
    expect(repeatScopeOf(d, "h1")).toBeUndefined(); // 머리글
    expect(repeatScopeOf(d, "t0")).toBeUndefined(); // 본문
    expect(rowReadableLevels(["subCoverage"])).toEqual(["product", "plan", "coverage", "subCoverage"]);
  });
});

describe("expandRepeatTable — 머리글 자리 · 여러 줄 템플릿", () => {
  const n = (level: "subCoverage" | "benefit", id: string, name: string, order: number) => ({ level, id, name, order });
  it("템플릿 여러 줄은 조합마다 통째로 복제하고 병합하지 않는다", () => {
    const t = table(1, [header, { cells: [[key("k1", "subCoverage")], [text("a", "1")]] }, { cells: [[text("b", "-")], [text("c", "2")]] }]);
    const out = expandRepeatTable(t, [[n("subCoverage", "s1", "1종", 0)], [n("subCoverage", "s2", "2종", 1)]])!;
    expect(out.table.rows).toHaveLength(5);
    expect(out.table.rows.every((r) => r.spans === undefined)).toBe(true);
    expect(out.rows.map((r) => [r.index, r.template, r.node.id])).toEqual([
      [1, 1, "s1"],
      [2, 2, "s1"],
      [3, 1, "s2"],
      [4, 2, "s2"],
    ]);
    expect(templateIdOf(out.table.rows[4].cells[1][0].id)).toBe("c");
  });
  it("조합이 없으면 undefined (표 생략)", () => {
    expect(expandRepeatTable(table(1, [header, { cells: [[key("k1", "subCoverage")], [text("a", "1")]] }]), [])).toBeUndefined();
  });
});
