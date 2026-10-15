import { describe, expect, it } from "vitest";

import type { DocumentNode, InlineNode } from "../document/nodes";
import { titleNodes } from "../document/title";
import { specialContext } from "./context";
import { alphaPlusFixture, coverageEntry } from "./fixture";
import { numberDocument, renderDocument } from "./render";
import { resolveDocument } from "./resolve";
import { substituteSlots } from "./substitute";
import type { Issue } from "../types";
import type { AssemblyCoverage } from "./types";

/**
 * 조 제목 = 인라인 노드 목록 — 조립은 제목을 그 상품 문맥에서 풀어 조 머리 · 참조 라벨에 같은 글로 찍는다
 * (ADR-0088 결정 1 · 6 · 수용 기준 1 · 2, ADR-0072 결정 2a).
 */
const at = { document: "special" as const, ownerId: "pc", ownerName: "특약" };

/** 제1조가 제2조를 가리킨다. 제2조 제목은 `title`. */
function source(title: InlineNode[]): DocumentNode {
  return {
    kind: "document",
    id: "s",
    title: "특약",
    children: [
      { kind: "article", id: "a1", title: titleNodes("준용", "a1"), children: [{ kind: "paragraph", id: "a1-p", children: [{ kind: "articleRef", id: "ref", targets: [{ articleId: "a2" }], scope: "self" }] }] },
      { kind: "article", id: "a2", title, children: [{ kind: "paragraph", id: "a2-p", children: [{ kind: "text", id: "a2-x", text: "본문" }] }] },
    ],
  };
}

function assembled(title: InlineNode[], coverage: AssemblyCoverage): { head: string; ref: string; issues: Issue[] } {
  const input = alphaPlusFixture();
  const ctx = specialContext(input, coverage);
  const resolved = resolveDocument(source(title), ctx, { clauses: new Map(), overrides: new Map(), coordinate: at });
  const substituted = substituteSlots(resolved.doc, ctx, { catalog: new Map(input.catalog.map((d) => [d.code, d])), enums: new Map(input.enums.map((e) => [e.code, e])), master: input.master });
  const result = renderDocument(numberDocument(substituted.doc), { document: "special", ownerId: coverage.snapshot.id, appendices: [] });
  const [first, second] = result.doc.children;
  if (first.kind !== "article" || first.children[0].kind !== "paragraph" || second.kind !== "article") throw new Error("unexpected");
  const ref = first.children[0].children[0];
  return { head: `${second.label}(${second.title})`, ref: ref.kind === "articleRef" ? ref.label : `(${ref.kind})`, issues: [...resolved.issues, ...substituted.issues, ...result.issues] };
}

/** 면책여부합(D0005) 이 갈리는 상품담보 — 감액기간문구(D0007) 「24개월」. */
const coverage = (id: string, exempt: boolean) =>
  coverageEntry({
    id,
    name: id,
    coverageId: "cov-death",
    coverageName: "일반상해사망",
    attributes: [],
    subCoverages: [{ id: `${id}-sub`, masterNodeId: "sub-death", name: "일반상해사망", benefits: [{ id: `${id}-ben`, masterNodeId: "ben-death", name: "사망보험금" }] }],
    values: { [id]: { "coverage_basic.renewal": false, "coverage_basic.reduction_months": 24, "coverage_basic.reduction_text": "24개월" }, [`${id}-ben`]: { "pay.exempt": exempt, "pay.rate": 100 } },
  });

describe("조 제목을 상품 문맥에서 푼다 (ADR-0088)", () => {
  it("글 제목은 그대로 — 조 머리와 참조 라벨이 같은 글", () => {
    const r = assembled(titleNodes("보험금의 지급절차", "a2"), coverage("pc-a", true));
    expect(r).toEqual({ head: "제2조(보험금의 지급절차)", ref: "제2조(보험금의 지급절차)", issues: [] });
  });

  it("제목 인라인 조건 — 상품마다 「보험금 등의 지급절차」 / 「보험금 지급절차」가 조 머리 · 참조 라벨 모두에 찍힌다 (수용 기준 2)", () => {
    const title: InlineNode[] = [
      { id: "t1", kind: "text", text: "보험금 " },
      { id: "c", kind: "inlineCond", branches: [{ id: "c-if", when: "D0005 = true", children: [{ id: "t2", kind: "text", text: "등의 " }] }, { id: "c-else", children: [] }] },
      { id: "t3", kind: "text", text: "지급절차" },
    ];
    expect(assembled(title, coverage("pc-a", true))).toEqual({ head: "제2조(보험금 등의 지급절차)", ref: "제2조(보험금 등의 지급절차)", issues: [] });
    expect(assembled(title, coverage("pc-b", false))).toEqual({ head: "제2조(보험금 지급절차)", ref: "제2조(보험금 지급절차)", issues: [] });
  });

  it("제목 안 슬롯은 그 상품의 값으로 · 조사는 앞 글 받침으로 고른다", () => {
    const title: InlineNode[] = [
      { id: "s", kind: "slot", ref: "D0007" },
      { id: "t1", kind: "text", text: " 감액기간" },
      { id: "p", kind: "particle", preset: "eul-reul" },
      { id: "t2", kind: "text", text: " 두는 경우" },
    ];
    expect(assembled(title, coverage("pc-a", true))).toEqual({ head: "제2조(24개월 감액기간을 두는 경우)", ref: "제2조(24개월 감액기간을 두는 경우)", issues: [] });
  });

  it("값이 없는 슬롯은 오류로 남기고 그 자리를 비운다 — 조용한 빈칸이 아니다", () => {
    const r = assembled([{ id: "s", kind: "slot", ref: "D9999" }, { id: "t", kind: "text", text: "지급절차" }], coverage("pc-a", true));
    expect(r.head).toBe("제2조(지급절차)");
    expect(r.issues.map((i) => i.kind)).toContain("brokenRef");
  });
});
