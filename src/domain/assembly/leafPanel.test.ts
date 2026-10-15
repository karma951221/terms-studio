// 「구분자」 값 패널 줄 (ADR-0087 결정 6 · 기능/문면 §3.9).
import { describe, expect, it } from "vitest";

import type { Clause } from "../clause/types";
import type { DocumentNode } from "../document/nodes";
import { nodeQualFixture } from "./fixture";
import { leafPanel } from "./leafPanel";

const slot = (id: string, ref: string) => ({ id, kind: "slot", ref });
const para = (id: string, children: unknown[]) => ({ id, kind: "paragraph", children });
const docOf = (children: unknown[]): DocumentNode => ({ id: "d", kind: "document", title: "t", children: [{ id: "a1", kind: "article", title: "감액", children }] }) as unknown as DocumentNode;
const loop = (source: object, children: unknown[]) => ({ id: "f", kind: "forBlock", source, children });
const clause = (def: string): Clause =>
  ({ code: "C0100", label: "감액", mode: "block", options: [], body: [], required: { discriminators: [] }, params: [{ name: "감액", type: { kind: "boolean" }, default: { kind: "discriminator", code: def } }] }) as unknown as Clause;

function panel(doc: DocumentNode, pcId = "pc-nodequal", clauses: Clause[] = []) {
  const { coverages, product, ...master } = { ...nodeQualFixture(), clauses };
  return leafPanel(master, { product, coverages }, pcId, doc);
}
const rows = (r: ReturnType<typeof panel>) => (Array.isArray(r) ? r : []);

describe("「구분자」 값 패널 (ADR-0087 결정 6)", () => {
  it("키 경로 줄 — 「세부보장 01 · 세부A › 감액여부」 예 · 끊어진 키는 brokenKey", () => {
    const r = rows(panel(docOf([para("p", [slot("s1", "D0007@01"), slot("s2", "D0007@09")])])));
    expect(r.map((x) => [x.label, x.value ?? x.problem])).toEqual([
      ["세부보장 01 · 세부A › 감액여부", "예"],
      ["세부보장 09 › 감액여부", "brokenKey"],
    ]);
    expect(r[0].path).toBe("01");
    expect(r[0].at).toMatchObject({ articleId: "a1" });
  });

  it("값이 없는 잎은 「아니오」 — 급부 레벨 키 경로 라벨은 「세부보장 › 급부」", () => {
    const r = rows(panel(docOf([para("p", [slot("s1", "D0002@03.1")])])));
    expect(r.map((x) => [x.label, x.value])).toEqual([["세부보장 03 · 세부B › 급부 1 · 급부B › 감액여부", "아니오"]]);
  });

  it("같은 (코드, 경로)는 한 줄 · 조건 가지 when 도 모은다", () => {
    const cond = { id: "c", kind: "condBlock", branches: [{ id: "br", when: "D0007@03", children: [para("q", [slot("s3", "D0007@01")])] }] };
    const r = rows(panel(docOf([para("p", [slot("s1", "D0007@01")]), cond])));
    expect(r.map((x) => x.path)).toEqual(["03", "01"]);
  });

  it("세부보장마다 반복 안 한정자 없는 참조는 키마다 한 줄", () => {
    const r = rows(panel(docOf([loop({ kind: "subCoverages" }, [para("p", [slot("s1", "D0007")])])])));
    expect(r.map((x) => [x.path, x.value])).toEqual([["01", "예"], ["03", "아니오"]]);
  });

  it("함수조항 기본 연결 — 반복 안이면 키마다, 반복 밖 하위 레벨은 unbound, 담보 레벨 아닌 키 경로 연결은 그 줄", () => {
    const ref = (bindings?: object) => ({ id: "r", kind: "clauseBlockRef", clauseCode: "C0100", options: {}, ...(bindings ? { bindings } : {}) });
    const inLoop = rows(panel(docOf([loop({ kind: "subCoverages" }, [ref()])]), "pc-nodequal", [clause("D0007")]));
    expect(inLoop.map((x) => x.path)).toEqual(["01", "03"]);
    const bare = rows(panel(docOf([ref()]), "pc-nodequal", [clause("D0007")]));
    expect(bare).toEqual([expect.objectContaining({ code: "D0007", problem: "unbound", at: expect.objectContaining({ refPath: "arg.감액" }) })]);
    const keyed = rows(panel(docOf([ref({ 감액: { kind: "discriminator", code: "D0007", node: { path: "03" } } })]), "pc-nodequal", [clause("D0007")]));
    expect(keyed.map((x) => [x.path, x.value])).toEqual([["03", "아니오"]]);
  });

  it("상품담보가 없으면 unavailable", () => {
    expect(panel(docOf([]), "없음")).toEqual({ unavailable: expect.any(String) });
  });
});
