import { describe, expect, it } from "vitest";

import type { ArticleNode, DocumentNode, ForBlockNode, ParagraphNode, RefTarget } from "../document/nodes";
import type { Id } from "../types";
import { assemble } from "./booklet";
import { waiverFixture, waiverTemplate, type WaiverPlan } from "./fixture";
import type { RenderedDoc, RenderedInline } from "./types";

/**
 * 반복 · 펼친 함수조항 안 참조 · 값 한정 참조 (최종 결정 12 · 13 · ADR-0077 결정 5 · 6 · 7 · 기능/문면 §3.5).
 * 픽스처: 제1조 = 납입면제종마다(fo) 항 P0100 › 사유마다(fi) 호 유형 함수조항 참조 P0200(C0300 — 칸 V01 · V02 는 호 하나 P0100, V03 은 P0100 · P0200),
 * 제2조 = 정의 조(합집합 fu). 참조는 덧붙인 조 · 항에서 건다.
 */

function inlineText(list: readonly RenderedInline[]): string {
  return list.map((n) => (n.kind === "text" ? n.text : n.kind === "error" ? `⟦${n.issue.kind}⟧` : n.label)).join("");
}

function lines(doc: RenderedDoc | undefined): string[] {
  const out: string[] = [];
  for (const a of doc?.children ?? []) {
    if (a.kind !== "article") continue;
    out.push(`${a.label}(${a.title})`);
    for (const p of a.children) {
      if (p.kind !== "paragraph") continue;
      out.push(`  ${p.label} ${inlineText(p.children)}`.trimEnd());
      for (const i of p.items ?? []) if (i.kind === "item") out.push(`    ${i.label} ${inlineText(i.children)}`);
    }
  }
  return out;
}

const TWO: Record<Id, WaiverPlan> = { "opt-type-1": { applies: true, reasons: ["V03", "V01"] }, "opt-type-2": { applies: true, reasons: ["V01"] } };

function run(extra: DocumentNode["children"], plans: Record<Id, WaiverPlan> = TWO, doc?: DocumentNode) {
  const input = waiverFixture(doc ?? waiverTemplate(extra), plans);
  const booklet = assemble(input, input);
  return { lines: lines(booklet.general), issues: booklet.issues.filter((i) => i.at.document === "general" && i.severity !== "warning") };
}

/** 참조 조 하나 — 「〔참조〕를 본다」. */
function refArticle(targets: RefTarget[], connector: "및" | "또는" | undefined = "및"): ArticleNode {
  return {
    id: "z",
    kind: "article",
    title: "참조",
    children: [{ id: "zp", kind: "paragraph", code: "P0100", children: [{ id: "zr", kind: "articleRef", scope: "self", ...(connector ? { connector } : {}), targets }, { id: "zt", kind: "text", text: "를 본다" }] }],
  };
}

function refLine(r: { lines: string[] }): string | undefined {
  const at = r.lines.indexOf("제3조(참조)");
  return r.lines[at + 1]?.trim();
}

describe("반복 블록 · 반복 안 노드를 가리키는 참조 = 펼친 것 전부 (결정 13)", () => {
  it("반복 안 항을 가리키면 펼친 항 전부 — 종이 둘이면 「제1항 및 제2항」", () => {
    const r = run([refArticle([{ articleId: "a", code: "P0100" }])]);
    expect(r.issues).toEqual([]);
    expect(refLine(r)).toBe("제1조(보험료의 납입면제) 제1항 및 제2항를 본다");
  });

  it("반복 블록 자체를 가리켜도 같다 — 원소가 하나면 「제1항」", () => {
    const doc = waiverTemplate([refArticle([{ articleId: "a", code: "P0900" }])]);
    ((doc.children[0] as ArticleNode).children[0] as ForBlockNode).code = "P0900";
    expect(refLine(run([], TWO, doc))).toBe("제1조(보험료의 납입면제) 제1항 및 제2항를 본다");
    const one = run([], { "opt-type-1": { applies: true, reasons: ["V01"] } }, doc);
    expect(refLine(one)).toBe("제1조(보험료의 납입면제) 제1항를 본다");
  });

  it("펼친 것이 0개면 조립 오류 — 좌표 = 참조 자리", () => {
    const doc = waiverTemplate([refArticle([{ articleId: "a", code: "P0100" }])]);
    const r = run([], { "opt-type-1": { applies: false }, "opt-type-2": { applies: false } }, doc);
    expect(r.issues).toEqual([expect.objectContaining({ kind: "articleGone", message: expect.stringContaining("0개"), at: expect.objectContaining({ articleId: "z", nodePath: expect.arrayContaining(["zr"]), refPath: "a#P0100" }) })]);
  });

  it("함수조항 참조(반복 안)를 가리키면 펼친 호 전부 — 여러 번호 표기", () => {
    const r = run([refArticle([{ articleId: "a", code: "P0200" }])]);
    expect(r.issues).toEqual([]);
    // 1종 ① — 1. 암 2. 상해 3. 질병, 2종 ② — 1. 암
    expect(refLine(r)).toBe("제1조(보험료의 납입면제) 제1항 제1호부터 제3호까지 및 제2항 제1호를 본다");
  });

  it("반복 회차 안의 참조는 그 회차의 사본을 가리킨다 — 같은 반복 안 대상", () => {
    const doc = waiverTemplate();
    const p = ((doc.children[0] as ArticleNode).children[0] as ForBlockNode).children[0] as ParagraphNode;
    p.children.push({ id: "pr", kind: "articleRef", scope: "self", connector: "및", targets: [{ articleId: "a", code: "P0200" }] });
    const r = run([], TWO, doc);
    expect(r.issues).toEqual([]);
    expect(r.lines.slice(0, 7)).toEqual([
      "제1조(보험료의 납입면제)",
      "  ① 1종으로 가입한 경우제1호부터 제3호까지",
      "    1. 암(유사암제외)으로 진단확정",
      "    2. 상해로 장해",
      "    3. 질병으로 장해",
      "  ② 2종으로 가입한 경우제1호",
      "    1. 암(유사암제외)으로 진단확정",
    ]);
  });
});

describe("펼친 함수조항 안 노드 참조 — {조, P코드, 안쪽 P코드} (결정 12)", () => {
  it("안쪽 코드가 가리키는 호만 — V03 칸의 둘째 호(P0200)", () => {
    const r = run([refArticle([{ articleId: "a", code: "P0200", innerCode: "P0200" }])]);
    expect(r.issues).toEqual([]);
    expect(refLine(r)).toBe("제1조(보험료의 납입면제) 제1항 제3호를 본다");
  });

  it("switch 칸이 바뀌어도 같은 코드면 참조가 산다 — 칸마다 첫 호는 P0100", () => {
    const r = run([refArticle([{ articleId: "a", code: "P0200", innerCode: "P0100" }])]);
    expect(refLine(r)).toBe("제1조(보험료의 납입면제) 제1항 제1호, 제2호 및 제2항 제1호를 본다");
  });

  it("반복 밖 함수조항 안 항을 가리킴 — 하나면 연결어 없이도", () => {
    const r = run([refArticle([{ articleId: "a", code: "P0300", innerCode: "P0100" }], undefined)]);
    expect(r.issues).toEqual([]);
    expect(refLine(r)).toBe("제1조(보험료의 납입면제) 제3항를 본다");
  });

  it("A 가 B 를 넣고 B 가 A 의 항을 가리키는 순환은 통과 — 가리키기 순환 허용", () => {
    const input = waiverFixture(waiverTemplate(), TWO);
    const addendum = input.clauses.find((c) => c.code === "C0301")!;
    const body = structuredClone(addendum.body) as unknown as ParagraphNode[];
    body[0].children.push({ id: "cr", kind: "articleRef", connector: "및", targets: [{ articleId: "a", code: "P0100" }] } as never);
    const cyclic = { ...input, clauses: input.clauses.map((c) => (c.code === "C0301" ? { ...c, body } : c)) } as typeof input;
    const booklet = assemble(cyclic, cyclic);
    expect(booklet.issues.filter((i) => i.at.document === "general" && i.severity !== "warning")).toEqual([]);
    expect(lines(booklet.general)).toContain("  ③ 암보장개시일보통약관 제1조(보험료의 납입면제) 제1항 및 제2항");
  });
});

describe("값 한정 참조 — 사유 = 해당 값들 / 현재 값 (결정 13)", () => {
  it("사유 = 암 으로 한정 → 종마다 그 사유가 낸 호만", () => {
    const r = run([refArticle([{ articleId: "a", code: "P0200", restrict: { values: ["V01"] } }])]);
    expect(r.issues).toEqual([]);
    expect(refLine(r)).toBe("제1조(보험료의 납입면제) 제1항 제1호 및 제2항 제1호를 본다");
  });

  it("해당 값들 한정이 0개면 조립 오류", () => {
    const r = run([refArticle([{ articleId: "a", code: "P0200", restrict: { values: ["V02"] } }])]);
    expect(r.issues).toEqual([expect.objectContaining({ kind: "articleGone", message: expect.stringContaining("0개"), at: expect.objectContaining({ articleId: "z", refPath: "a#P0200" }) })]);
  });

  it("사유 = 현재 값 — 다른 반복(정의 조 합집합) 회차마다 그 사유의 호", () => {
    const doc = waiverTemplate();
    const fu = (doc.children[1] as ArticleNode).children[0] as ForBlockNode;
    fu.children.push({ id: "dp", kind: "paragraph", code: "P0200", children: [{ id: "dr", kind: "articleRef", scope: "self", connector: "및", targets: [{ articleId: "a", code: "P0200", restrict: { current: "fu" } }] }] });
    const r = run([], { "opt-type-1": { applies: true, reasons: ["V02", "V01"] }, "opt-type-2": { applies: true, reasons: ["V01"] } }, doc);
    expect(r.issues).toEqual([]);
    const at = r.lines.indexOf("제2조(정의 및 진단확정)");
    expect(r.lines.slice(at)).toEqual([
      "제2조(정의 및 진단확정)",
      "  ① 암(유사암제외)의 정의",
      "  ② 제1조(보험료의 납입면제) 제1항 제1호 및 제2항 제1호",
      "  ③ 뇌졸중의 정의",
      "  ④ 제1조(보험료의 납입면제) 제1항 제2호",
    ]);
  });
});
