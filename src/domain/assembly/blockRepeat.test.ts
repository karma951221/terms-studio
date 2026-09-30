import { describe, expect, it } from "vitest";

import type { ForBlockNode } from "../document/nodes";
import type { Id, Issue } from "../types";
import { assemble } from "./booklet";
import { buildContexts } from "./context";
import { waiverFixture, waiverTemplate, type WaiverPlan } from "./fixture";
import { resolveDocument } from "./resolve";
import type { RenderedDoc, RenderedInline, ResolvedDoc } from "./types";

/**
 * 블록 반복 조립 (최종 결정 11 · 23 · ADR-0077 결정 2 · 3 · 4 · 기능/조립산출 §3.1).
 * 납입면제종마다(세목 선택지 · 적용여부 = 예) 항 하나 → 그 안에 현재 종의 사유마다 호(열거형 순서) → 호 유형 함수조항(사유 ← 현재 사유).
 * 정의 조 = 사유 합집합 ∩ 정의조대상 = 예. 복제 id · 열쇠 합성(`@원소` 두 번 × 함수조항 펼치기 `/`)과 오류 좌표를 함께 본다.
 */

function inlineText(list: readonly RenderedInline[]): string {
  return list.map((n) => (n.kind === "text" ? n.text : n.kind === "error" ? `⟦${n.issue.kind}⟧` : n.label)).join("");
}

/** 렌더된 보통약관 — 조 · 항 · 호를 한 줄씩. */
function lines(doc: RenderedDoc | undefined): string[] {
  const out: string[] = [];
  for (const a of doc?.children ?? []) {
    if (a.kind !== "article") continue;
    out.push(`${a.label}(${a.title})`);
    for (const p of a.children) {
      if (p.kind !== "paragraph") {
        out.push(`  [${p.kind}]`);
        continue;
      }
      out.push(`  ${p.label} ${inlineText(p.children)}`.trimEnd());
      for (const i of p.items ?? []) out.push(i.kind === "item" ? `    ${i.label} ${inlineText(i.children)}` : `    [${i.kind}]`);
    }
  }
  return out;
}

function run(plans: Record<Id, WaiverPlan>, doc = waiverTemplate()) {
  const input = waiverFixture(doc, plans);
  const booklet = assemble(input, input);
  // 특약 문서는 픽스처 보통약관의 조를 가리킨다 — 보통약관을 바꿔 끼웠으니 보통약관 쪽 이슈만 본다
  return { lines: lines(booklet.general), issues: booklet.issues.filter((i) => i.at.document === "general") };
}

function resolved(plans: Record<Id, WaiverPlan>, doc = waiverTemplate()): { doc: ResolvedDoc; issues: Issue[] } {
  const input = waiverFixture(doc, plans);
  const ctx = buildContexts(input).general;
  return resolveDocument(doc, ctx, { clauses: new Map(input.clauses.map((c) => [c.code, c])), overrides: new Map(), coordinate: { document: "general", ownerId: "g" }, enums: new Map(input.enums.map((e) => [e.code, e])), master: input.master });
}

describe("블록 반복 조립 — 납입면제종마다 · 사유마다 (결정 11)", () => {
  it("적용 종마다 항 하나, 그 안에 현재 종의 사유마다 호(열거형 순서) · 종형명 = 현재 종 · 호 유형 함수조항은 현재 사유의 칸", () => {
    const r = run({ "opt-type-1": { applies: true, reasons: ["V03", "V01"] }, "opt-type-2": { applies: true, reasons: ["V02"] } });
    expect(r.issues.filter((i) => i.severity !== "warning")).toEqual([]);
    expect(r.lines.slice(0, 8)).toEqual([
      "제1조(보험료의 납입면제)",
      "  ① 1종으로 가입한 경우",
      "    1. 암(유사암제외)으로 진단확정",
      "    2. 상해로 장해",
      "    3. 질병으로 장해",
      "  ② 2종으로 가입한 경우",
      "    1. 뇌졸중으로 진단확정",
      "  ③ 암보장개시일",
    ]);
  });

  it("적용여부 = 아니오 · 값 없는 종은 건너뛴다 — 종이 하나면 항 하나", () => {
    const r = run({ "opt-type-1": { applies: true, reasons: ["V02"] }, "opt-type-2": { applies: false, reasons: ["V01"] } });
    expect(r.lines.slice(0, 4)).toEqual(["제1조(보험료의 납입면제)", "  ① 1종으로 가입한 경우", "    1. 뇌졸중으로 진단확정", "  ② 없음"]);
    const none = run({ "opt-type-1": { applies: true, reasons: ["V02"] } });
    expect(none.lines.slice(0, 4)).toEqual(["제1조(보험료의 납입면제)", "  ① 1종으로 가입한 경우", "    1. 뇌졸중으로 진단확정", "  ② 없음"]);
    expect(none.issues.filter((i) => i.severity !== "warning")).toEqual([]);
  });

  it("원소 0개 = 블록을 펼치지 않는다 — 조의 항이 모두 빠지면 조째 빠진다 (결정 15)", () => {
    const doc = waiverTemplate();
    (doc.children[0] as { children: unknown[] }).children.pop(); // 부가항 빼고 반복만
    const r = run({ "opt-type-1": { applies: false }, "opt-type-2": { applies: false } }, doc);
    expect(r.lines).toEqual([]);
    expect(r.issues.filter((i) => i.severity !== "warning")).toEqual([]);
  });

  it("종 반복 안 builtin.plan.number 는 현재 종의 번호 — 원문 표기 「2종(보험료 납입면제형) 가입시」를 번호 · 이름 슬롯으로", () => {
    const doc = waiverTemplate();
    const p = (doc.children[0] as { children: ForBlockNode[] }).children[0].children[0] as { children: unknown[] };
    p.children = [{ id: "pn", kind: "slot", ref: "builtin.plan.number" }, { id: "pa", kind: "text", text: "종(" }, { id: "ps", kind: "slot", ref: "builtin.plan.name" }, { id: "pt", kind: "text", text: ") 가입시" }];
    const r = run({ "opt-type-1": { applies: false, reasons: ["V01"] }, "opt-type-2": { applies: true, reasons: ["V02"] } }, doc);
    expect(r.issues.filter((i) => i.severity !== "warning")).toEqual([]);
    expect(r.lines.slice(0, 3)).toEqual(["제1조(보험료의 납입면제)", "  ① 2종(2종) 가입시", "    1. 뇌졸중으로 진단확정"]);
  });

  it("종 원소를 세목 선택지 목록 인자에 — 현재 종 하나짜리 목록으로 합치기", () => {
    const doc = waiverTemplate();
    const fo = (doc.children[0] as { children: ForBlockNode[] }).children[0];
    fo.children.push({ id: "pb", kind: "clauseBlockRef", code: "P0400", clauseCode: "C0301", options: {}, bindings: { 종들: { kind: "current", loop: "fo" } } });
    const r = run({ "opt-type-1": { applies: true, reasons: ["V01"] }, "opt-type-2": { applies: true, reasons: ["V02"] } }, doc);
    expect(r.lines.filter((l) => /^ {2}\S/.test(l)).slice(0, 5)).toEqual(["  ① 1종으로 가입한 경우", "  ② 암보장개시일", "  ③ 2종으로 가입한 경우", "  ④ 없음", "  ⑤ 암보장개시일"]);
  });
});

describe("합집합 원천 — 정의 조 (결정 23)", () => {
  it("적용 종의 사유 합집합(같은 값 한 번 · 열거형 순서) ∩ 정의조대상 = 예", () => {
    const r = run({ "opt-type-1": { applies: true, reasons: ["V03", "V02"] }, "opt-type-2": { applies: true, reasons: ["V02", "V01"] } });
    const at = r.lines.indexOf("제2조(정의 및 진단확정)");
    expect(r.lines.slice(at)).toEqual(["제2조(정의 및 진단확정)", "  ① 암(유사암제외)의 정의", "  ② 뇌졸중의 정의"]);
  });
});

describe("복제 id · 열쇠 합성과 오류 좌표 — 두 단계 (위험 4)", () => {
  it("복제 노드 id 는 `원id@종[@사유]`, 펼친 함수조항 노드는 그 뒤 `/` · 열쇠도 같은 순서 — 문서 안에서 유일", () => {
    const r = resolved({ "opt-type-1": { applies: true, reasons: ["V01", "V03"] }, "opt-type-2": { applies: true, reasons: ["V01"] } });
    expect(r.issues).toEqual([]);
    const a = r.doc.children[0];
    if (a.kind !== "article") throw new Error("조가 아니다");
    const paragraphs = a.children.filter((p) => p.kind === "paragraph");
    expect(paragraphs.map((p) => [p.id, p.kind === "paragraph" ? p.key : undefined])).toEqual([
      ["p@opt-type-1", "P0100@opt-type-1"],
      ["p@opt-type-2", "P0100@opt-type-2"],
      ["b/q", "P0300/P0100"],
    ]);
    const first = paragraphs[0];
    if (first.kind !== "paragraph") throw new Error("항이 아니다");
    expect((first.items ?? []).map((i) => [i.id, i.kind === "item" ? i.key : undefined])).toEqual([
      ["r@opt-type-1@V01/i1", "P0200@opt-type-1@V01/P0100"],
      ["r@opt-type-1@V03/i3a", "P0200@opt-type-1@V03/P0100"],
      ["r@opt-type-1@V03/i3b", "P0200@opt-type-1@V03/P0200"],
    ]);
    const ids: string[] = [];
    const walk = (x: unknown) => {
      if (Array.isArray(x)) return x.forEach(walk);
      if (typeof x !== "object" || x === null) return;
      const o = x as Record<string, unknown>;
      if (typeof o.id === "string" && typeof o.kind === "string") ids.push(o.id);
      Object.values(o).forEach(walk);
    };
    walk(r.doc);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("안쪽 반복에서 칸 없는 값(미배정)에 닿으면 오류 좌표 = 바깥 반복 › 복제 항 › 안쪽 반복 › 복제 참조 › 펼친 분기 · refPath 값", () => {
    const r = resolved({ "opt-type-1": { applies: true, reasons: ["V01"] }, "opt-type-2": { applies: true, reasons: ["V04"] } });
    expect(r.issues).toEqual([
      expect.objectContaining({
        kind: "unassignedValue",
        at: expect.objectContaining({ articleId: "a", nodePath: ["g", "a", "fo", "p@opt-type-2", "fi@opt-type-2", "r@opt-type-2@V04", "r@opt-type-2@V04/sw"], refPath: "V04" }),
      }),
    ]);
  });
});
