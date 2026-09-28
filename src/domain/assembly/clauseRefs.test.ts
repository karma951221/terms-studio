import { describe, expect, it } from "vitest";

import type { BlockClause } from "../clause/types";
import type { DocumentNode } from "../document/nodes";
import { specialContext } from "./context";
import { alphaPlusFixture } from "./fixture";
import { numberDocument, renderDocument } from "./render";
import { hostLocator, resolveDocument } from "./resolve";
import type { SubstitutedDoc } from "./types";

/**
 * 조째 공용조항의 조 참조 (기능/공용조항 §3.5) — 「제1조(보험금의 지급사유)에서 정한」(사용처 위치) · 「제1항에 따라」(제 항)가
 * 사용처에 펼쳐진 자리의 계산 번호로 찍힌다.
 */
const 소멸: BlockClause = {
  code: "C0009",
  label: "특별약관의 소멸",
  mode: "block",
  options: [],
  required: { discriminators: [], attributes: [] },
  body: [
    { id: "p1", kind: "paragraph", children: [
      { id: "r1", kind: "articleRef", targets: [{ nodeId: "1" }], connector: "및", scope: "host" },
      { id: "t1", kind: "text", text: "에서 정한 지급사유가 발생하면 소멸됩니다." },
    ] },
    { id: "p2", kind: "paragraph", children: [
      { id: "r2", kind: "articleRef", targets: [{ nodeId: "p1" }], connector: "및", scope: "clause" },
      { id: "t2", kind: "text", text: "에 따라 소멸되면 해약환급금을 지급하지 않습니다." },
      { id: "r3", kind: "articleRef", targets: [{ nodeId: "2.1" }], connector: "및", scope: "host" },
    ] },
  ],
};

function doc(): DocumentNode {
  return {
    kind: "document",
    id: "s",
    title: "특약",
    children: [
      { kind: "article", id: "a1", title: "보험금의 지급사유", children: [{ kind: "paragraph", id: "a1-p", children: [{ kind: "text", id: "a1-t", text: "지급" }] }] },
      { kind: "article", id: "a2", title: "세부규정", children: [{ kind: "paragraph", id: "a2-p", children: [{ kind: "text", id: "a2-t", text: "세부" }] }, { kind: "paragraph", id: "a2-q", children: [] }] },
      { kind: "article", id: "a3", title: "특별약관의 소멸", children: [{ kind: "clauseBlockRef", id: "k", clauseCode: "C0009", options: {} }] },
    ],
  };
}

describe("조째 공용조항의 조 참조 — 사용처 위치 · 제 항", () => {
  it("hostLocator — n번째 조 · m번째 항 (공용조항 블록이 펼칠 항은 세지 않는다)", () => {
    const find = hostLocator(doc());
    expect([find("1"), find("2.2"), find("3"), find("3.1"), find("9")]).toEqual(["a1", "a2-q", "a3", undefined, undefined]);
  });

  it("펼치면 사용처 자기 참조가 되어 「제1조(보험금의 지급사유)」 · 「제1항」 · 「제2조(세부규정) 제1항」으로 찍힌다", () => {
    const input = alphaPlusFixture();
    const ctx = specialContext(input, input.coverages[0]);
    const resolved = resolveDocument(doc(), ctx, { clauses: new Map([["C0009", 소멸]]), overrides: new Map(), coordinate: { document: "special", ownerId: "pc" } });
    expect(resolved.issues).toEqual([]);
    const result = renderDocument(numberDocument(resolved.doc as unknown as SubstitutedDoc), { document: "special", ownerId: "pc", appendices: [] });
    expect(result.issues).toEqual([]);
    const lapse = result.doc.children[2];
    if (lapse.kind !== "article") throw new Error("조 아님");
    const labels = lapse.children.flatMap((p) => (p.kind === "paragraph" ? p.children.filter((c) => c.kind === "articleRef").map((c) => (c as { label: string }).label) : []));
    expect(labels).toEqual(["제1조(보험금의 지급사유)", "제1항", "제2조(세부규정) 제1항"]);
  });
});
