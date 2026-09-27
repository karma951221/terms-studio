import { describe, expect, it } from "vitest";

import type { DocumentNode, InlineNode, TableNode } from "../document/nodes";
import type { Id } from "../types";
import { assembleSpecial } from "./booklet";
import { buildContexts } from "./context";
import { alphaCatalog, alphaPlusFixture, coverageEntry, type CoverageSpec } from "./fixture";
import { resolveDocument } from "./resolve";
import type { AssemblyInput, RenderedArticle, RenderedParagraph, RenderedStatic } from "./types";

/** 수술비 — 1종수술{수술보험금} · 2종수술{수술보험금, 입원보험금}. 마스터 노드 id 는 m-*, 스냅샷 id 는 pc-surg-*. */
function surgerySpec(overrides: Partial<CoverageSpec> = {}): CoverageSpec {
  return {
    id: "pc-surg",
    name: "수술비",
    coverageId: "cov-surg",
    coverageName: "수술비",
    attributes: [],
    subCoverages: [
      { id: "pc-surg-s1", masterNodeId: "m-s1", name: "1종수술", benefits: [{ id: "pc-surg-b11", masterNodeId: "m-b11", name: "수술보험금" }] },
      {
        id: "pc-surg-s2",
        masterNodeId: "m-s2",
        name: "2종수술",
        benefits: [
          { id: "pc-surg-b21", masterNodeId: "m-b21", name: "수술보험금" },
          { id: "pc-surg-b22", masterNodeId: "m-b22", name: "입원보험금" },
        ],
      },
    ],
    values: {
      "pc-surg": { "coverage_basic.renewal": false },
      "pc-surg-b11": { "pay.exempt": true, "pay.rate": 100 },
      "pc-surg-b21": { "pay.exempt": false, "pay.rate": 50 },
      "pc-surg-b22": { "pay.exempt": false, "pay.rate": 30 },
    },
    ...overrides,
  };
}

const key = (id: Id, level: "subCoverage" | "benefit"): InlineNode => ({ id, kind: "structKey", level });
const slot = (id: Id, ref: string): InlineNode => ({ id, kind: "slot", ref });
const text = (id: Id, t: string): InlineNode => ({ id, kind: "text", text: t });

function surgeryDocument(table: TableNode): DocumentNode {
  return {
    id: "surg-doc",
    kind: "document",
    title: "수술비 특별약관",
    children: [{ id: "surg-art", kind: "article", title: "보장내용", children: [{ id: "surg-p", kind: "paragraph", children: [text("surg-t", "다음과 같습니다.")], items: [table] }] }],
  };
}

function repeatTable(depth: 1 | 2, template: InlineNode[][]): TableNode {
  return {
    id: "surg-tbl",
    kind: "table",
    columns: template.map(() => ({})),
    rows: [{ header: true, cells: template.map((_, i) => [text(`surg-h${i}`, `머리${i}`)]) }, { cells: template }],
    repeat: { depth },
  };
}

function input(table: TableNode, spec: CoverageSpec = surgerySpec()): AssemblyInput {
  const base = alphaPlusFixture();
  return {
    ...base,
    catalog: [...alphaCatalog, { code: "D0013", label: "세부면책", description: "", level: "subCoverage", expression: "any(pay.exempt)" }],
    coverages: [...base.coverages, { ...coverageEntry(spec), groupId: "grp-injury" }],
    specialDocuments: new Map([...base.specialDocuments, ["cov-surg", surgeryDocument(table)]]),
  };
}

function tableOf(doc: { children: unknown[] }): RenderedStatic | undefined {
  const art = doc.children.find((c) => (c as RenderedArticle).kind === "article") as RenderedArticle | undefined;
  const p = art?.children.find((c) => c.kind === "paragraph") as RenderedParagraph | undefined;
  return p?.items?.find((i) => i.kind === "table") as RenderedStatic | undefined;
}

const cellText = (cell: { kind: string; text?: string }[]) => cell.map((n) => (n.kind === "text" ? n.text : `<${n.kind}>`)).join("");

describe("조립 — 행 반복 표 (ADR-0070 결정 6)", () => {
  it("깊이 2 — 스냅샷 세부보장 › 급부로 펼치고, 바깥 key 병합 · 행 노드 문맥의 슬롯 값", () => {
    const inp = input(repeatTable(2, [[key("k1", "subCoverage")], [key("k2", "benefit")], [slot("s1", "D0003")]]));
    const r = assembleSpecial(inp, inp, "pc-surg");
    if (!r.ok) throw new Error(JSON.stringify(r.rejection));
    expect(r.value.issues).toEqual([]);
    const t = tableOf(r.value.doc);
    if (t?.kind !== "table") throw new Error("표 없음");
    expect(t.rows.map((row) => row.cells.map(cellText))).toEqual([
      ["머리0", "머리1", "머리2"],
      ["1종수술", "급부 1 수술보험금", "100"],
      ["2종수술", "급부 1 수술보험금", "50"],
      ["2종수술", "급부 2 입원보험금", "30"],
    ]);
    expect(t.rows.map((row) => row.spans)).toEqual([undefined, [1, 1, 1], [2, 1, 1], [0, 1, 1]]);
  });

  it("행 안 조건은 행 노드 문맥 · @노드(마스터 id) 고정 참조는 그 스냅샷 노드", () => {
    const cond: InlineNode = {
      id: "c1",
      kind: "inlineCond",
      branches: [
        { id: "c1-if", when: "D0013", children: [text("c1-a", "면책")] },
        { id: "c1-else", children: [text("c1-b", "지급")] },
      ],
    };
    const inp = input(repeatTable(1, [[key("k1", "subCoverage")], [cond], [slot("s1", "D0003@m-b22")]]));
    const r = assembleSpecial(inp, inp, "pc-surg");
    if (!r.ok) throw new Error(JSON.stringify(r.rejection));
    const t = tableOf(r.value.doc);
    if (t?.kind !== "table") throw new Error("표 없음");
    expect(t.rows.slice(1).map((row) => row.cells.map(cellText))).toEqual([
      ["1종수술", "면책", "30"],
      ["2종수술", "지급", "30"],
    ]);
  });

  it("미입력 셀 → 조립 오류, 좌표에 행 노드(스냅샷) id 가 실린다", () => {
    const spec = surgerySpec();
    delete (spec.values as Record<string, unknown>)["pc-surg-b22"];
    const inp = input(repeatTable(2, [[key("k2", "benefit")], [slot("s1", "D0003")]]), spec);
    const r = assembleSpecial(inp, inp, "pc-surg");
    if (!r.ok) throw new Error(JSON.stringify(r.rejection));
    expect(r.value.complete).toBe(false);
    const issue = r.value.issues.find((i) => i.kind === "notEntered");
    expect(issue?.at.nodePath).toContain("s1@pc-surg-b22");
    expect(issue?.at.articleId).toBe("surg-art");
  });

  it("key 조합 0 이면 표를 통째로 생략한다 (오류 없음)", () => {
    const inp = input(repeatTable(1, [[key("k1", "subCoverage")]]), surgerySpec({ subCoverages: [] }));
    const r = assembleSpecial(inp, inp, "pc-surg");
    if (!r.ok) throw new Error(JSON.stringify(r.rejection));
    expect(tableOf(r.value.doc)).toBeUndefined();
    expect(r.value.issues.filter((i) => i.at.nodePath?.includes("surg-tbl"))).toEqual([]);
  });

  it("행 원천 없는 문맥(보통약관)의 반복 표는 오류 마커", () => {
    const inp = input(repeatTable(1, [[key("k1", "subCoverage")]]));
    const ctx = buildContexts(inp).general;
    const out = resolveDocument(surgeryDocument(repeatTable(1, [[key("k1", "subCoverage")]])), ctx, { clauses: new Map(), overrides: new Map(), coordinate: { document: "general" } });
    expect(out.issues.map((i) => i.message)).toEqual(["반복 표는 담보 약관 템플릿에서만 쓸 수 있습니다"]);
  });
});
