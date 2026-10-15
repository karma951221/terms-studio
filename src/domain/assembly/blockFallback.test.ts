import { describe, expect, it } from "vitest";

import type { ArticleNode, DocumentNode, ForBlockNode, ParagraphNode, RefTarget } from "../document/nodes";
import type { Id } from "../types";
import { assemble } from "./booklet";
import { waiverFixture, waiverTemplate, type WaiverPlan } from "./fixture";
import type { RenderedDoc, RenderedInline } from "./types";
import { titleNodes } from "@/domain/document/title";

/**
 * 블록 반복의 「비었을 때」 칸 조립 (ADR-0088 결정 3 · 4 · 기능/문면 §3.12).
 * 픽스처: 제1조 = 납입면제종마다(fo) 항 P0100 › 사유마다(fi). 칸에 항 P0100(본문과 같은 코드 — 분기 짝) · P0800(칸에만)을 둔다.
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
const NONE: Record<Id, WaiverPlan> = { "opt-type-1": { applies: false }, "opt-type-2": { applies: false } };

const para = (id: string, code: string, text: string): ParagraphNode => ({ id, kind: "paragraph", code, children: [{ id: `${id}t`, kind: "text", text }] });

/** 반복 블록 fo 에 코드 P0900 · 「비었을 때」 칸(P0100 · P0800)을 단 템플릿. */
function template(extra: DocumentNode["children"] = []): DocumentNode {
  const doc = waiverTemplate(extra);
  const loop = (doc.children[0] as ArticleNode).children[0] as ForBlockNode;
  loop.code = "P0900";
  loop.fallback = [para("e1", "P0100", "납입면제를 적용하는 종이 없습니다."), para("e2", "P0800", "칸에만 있는 항")];
  return doc;
}

function run(doc: DocumentNode, plans: Record<Id, WaiverPlan>) {
  const input = waiverFixture(doc, plans);
  const booklet = assemble(input, input);
  return { lines: lines(booklet.general), issues: booklet.issues.filter((i) => i.at.document === "general" && i.severity !== "warning") };
}

function refArticle(targets: RefTarget[], connector: "및" | "또는" | undefined = "및"): ArticleNode {
  return {
    id: "z",
    kind: "article",
    title: titleNodes("참조", "z"),
    children: [{ id: "zp", kind: "paragraph", code: "P0100", children: [{ id: "zr", kind: "articleRef", scope: "self", ...(connector ? { connector } : {}), targets }, { id: "zt", kind: "text", text: "를 본다" }] }],
  };
}

/** 참조 조(「…(참조)」)의 첫 항 — 원소 0개면 정의 조가 비어 빠져 조 번호가 당겨진다. */
const refLine = (r: { lines: string[] }) => r.lines[r.lines.findIndex((l) => l.endsWith("(참조)")) + 1]?.trim();

describe("블록 반복 「비었을 때」 칸 — 조립 (ADR-0088 결정 3 · 4)", () => {
  it("원소 0개면 칸을 그 자리에 편다 — 칸 항이 조의 항으로 번호를 받는다", () => {
    const r = run(template(), NONE);
    expect(r.issues).toEqual([]);
    expect(r.lines.slice(0, 3)).toEqual(["제1조(보험료의 납입면제)", "  ① 납입면제를 적용하는 종이 없습니다.", "  ② 칸에만 있는 항"]);
  });

  it("원소가 있으면 반복 본문만 — 칸은 나오지 않는다", () => {
    const r = run(template(), TWO);
    expect(r.issues).toEqual([]);
    expect(r.lines.join("\n")).not.toContain("종이 없습니다");
    expect(r.lines.join("\n")).not.toContain("칸에만");
    expect(r.lines[1]).toBe("  ① 1종으로 가입한 경우");
  });

  it("칸 노드는 `@원소` 접미사 없이 제 id 그대로", () => {
    const input = waiverFixture(template(), NONE);
    const a = assemble(input, input).general?.children[0];
    expect(a?.kind === "article" ? a.children.map((c) => c.id).slice(0, 2) : []).toEqual(["e1", "e2"]);
  });

  it("본문과 같은 코드를 가리키는 참조 — 원소 0개면 칸 항의 번호, 있으면 펼친 본문", () => {
    const zero = run(template([refArticle([{ articleId: "a", code: "P0100" }])]), NONE);
    expect(zero.issues).toEqual([]);
    expect(refLine(zero)).toBe("제1조(보험료의 납입면제) 제1항를 본다");
    const two = run(template([refArticle([{ articleId: "a", code: "P0100" }])]), TWO);
    expect(refLine(two)).toBe("제1조(보험료의 납입면제) 제1항 및 제2항를 본다");
  });

  it("반복 블록 자신을 가리키는 참조 — 원소 0개면 칸이 낸 것 전부", () => {
    const zero = run(template([refArticle([{ articleId: "a", code: "P0900" }])]), NONE);
    expect(zero.issues).toEqual([]);
    expect(refLine(zero)).toBe("제1조(보험료의 납입면제) 제1항 및 제2항를 본다");
  });

  it("나온 쪽에 대상이 없으면 0개 조립 오류 — 칸에만 있는 코드를 원소 있는 상품에서", () => {
    const r = run(template([refArticle([{ articleId: "a", code: "P0800" }])]), TWO);
    expect(r.issues).toEqual([expect.objectContaining({ kind: "articleGone", message: expect.stringContaining("0개"), at: expect.objectContaining({ refPath: "a#P0800" }) })]);
    const zero = run(template([refArticle([{ articleId: "a", code: "P0800" }])]), NONE);
    expect(zero.issues).toEqual([]);
    expect(refLine(zero)).toBe("제1조(보험료의 납입면제) 제2항를 본다");
  });

  it("칸이 없거나 비면 지금처럼 아무것도 없다", () => {
    const doc = template();
    ((doc.children[0] as ArticleNode).children[0] as ForBlockNode).fallback = [];
    const r = run(doc, NONE);
    expect(r.lines.join("\n")).not.toContain("종이 없습니다");
  });
});
