import { describe, expect, it } from "vitest";

import type { RepeatSource } from "../document/blockRepeat";
import type { ArticleNode, DocumentNode, ForBlockNode, InlineForNode, InlineNode } from "../document/nodes";
import { titleNodes } from "../document/title";
import type { Id } from "../types";
import { assemble } from "./booklet";
import { waiverFixture, waiverTemplate, type WaiverPlan } from "./fixture";
import type { RenderedDoc, RenderedInline } from "./types";

/**
 * 인라인 반복 조립 (ADR-0088 결정 1 · 2 · 3 · 수용 기준 3 · 기능/조립산출 §3.1).
 * 원소 0 → 「비었을 때」 칸, 1 → 「A」, 2 → 「A 및 B」, 3+ → 「A, B 및 C」. 원소 순서 · 현재 원소 문맥은 블록 반복과 같다. 조 제목도 같은 길.
 */

const 종마다: RepeatSource = { kind: "planOptions", form: "waiver", filter: "waiver.applies = true" };
const 사유합집합: RepeatSource = { kind: "union", form: "waiver", filter: "waiver.applies = true", field: "reasons" };
const 정의조대상마다: RepeatSource = { ...사유합집합, where: { field: "F03", value: true } };

const text = (id: string, t: string): InlineNode => ({ id, kind: "text", text: t });
const slot = (id: string, ref: string): InlineNode => ({ id, kind: "slot", ref });
const repeat = (id: string, source: RepeatSource, children: InlineNode[], opts: Partial<InlineForNode> = {}): InlineForNode => ({ id, kind: "inlineFor", source, connector: "및", children, ...opts });

function inlineText(list: readonly RenderedInline[]): string {
  return list.map((n) => (n.kind === "text" ? n.text : n.kind === "error" ? `⟦${n.issue.kind}⟧` : n.label)).join("");
}

/** 렌더된 보통약관 — 조 머리 · 항 한 줄씩. */
function lines(doc: RenderedDoc | undefined): string[] {
  const out: string[] = [];
  for (const a of doc?.children ?? []) {
    if (a.kind !== "article") continue;
    out.push(`${a.label}(${a.title})`);
    for (const p of a.children) if (p.kind === "paragraph") out.push(`  ${[p.label, inlineText(p.children)].filter(Boolean).join(" ")}`);
  }
  return out;
}

/** 문장 하나짜리 조 — 픽스처 보통약관 맨 앞에 둔다. */
function sentenceDoc(children: InlineNode[], title: InlineNode[] = titleNodes("적용", "x")): DocumentNode {
  const doc = waiverTemplate();
  const article: ArticleNode = { id: "x", kind: "article", title, children: [{ id: "xp", kind: "paragraph", code: "P0100", children }] };
  return { ...doc, children: [article] };
}

function run(plans: Record<Id, WaiverPlan>, doc: DocumentNode) {
  const input = waiverFixture(doc, plans);
  const booklet = assemble(input, input);
  return { lines: lines(booklet.general), issues: booklet.issues.filter((i) => i.at.document === "general" && i.severity !== "warning") };
}

const two = { "opt-type-1": { applies: true, reasons: ["V03", "V01"] }, "opt-type-2": { applies: true, reasons: ["V02"] } };

describe("인라인 반복 조립 — 원소 수 · 연결어 (수용 기준 3)", () => {
  it("종마다: 1개 「1종」 · 2개 「1종 및 2종」 — 본문 슬롯은 현재 종", () => {
    const doc = sentenceDoc([repeat("r", 종마다, [slot("s", "builtin.plan.name")]), text("t", "에 적용")]);
    expect(run({ "opt-type-1": { applies: true, reasons: [] }, "opt-type-2": { applies: false, reasons: [] } }, doc).lines).toEqual(["제1조(적용)", "  1종에 적용"]);
    const r = run(two, doc);
    expect(r).toEqual({ lines: ["제1조(적용)", "  1종 및 2종에 적용"], issues: [] });
  });

  it("합집합: 3개 「A, B 및 C」(열거형 순서 · 같은 값 한 번) · 「또는」이면 그 자리 · 「현재 값」의 값 이름 · 글 필드", () => {
    const names = sentenceDoc([repeat("r", 사유합집합, [slot("s", "builtin.value.name")]), text("t", "의 경우")]);
    expect(run(two, names)).toEqual({ lines: ["제1조(적용)", "  암, 뇌졸중 및 장해의 경우"], issues: [] });
    const fields = sentenceDoc([repeat("r", 사유합집합, [slot("s", "builtin.value.F01")], { connector: "또는" }), text("t", "의 경우")]);
    expect(run(two, fields).lines).toEqual(["제1조(적용)", "  암(유사암제외), 뇌졸중 또는 장해의 경우"]);
  });

  it("반복 뒤 조사는 펼친 뒤의 앞 글로 고른다 — 「…장해를」 · 칸이면 칸 글로 「해당 없음을」", () => {
    const doc = sentenceDoc([repeat("r", 사유합집합, [slot("s", "builtin.value.name")], { fallback: [text("f", "해당 없음")] }), { id: "pp", kind: "particle", preset: "eul-reul" }, text("t", " 본다")]);
    expect(run(two, doc).lines[1]).toBe("  암, 뇌졸중 및 장해를 본다");
    expect(run({ "opt-type-1": { applies: true, reasons: [] } }, doc).lines[1]).toBe("  해당 없음을 본다");
  });

  it("원소 0개 = 「비었을 때」 칸 내용, 칸이 비면 빈 글 — 오류 · 경고 없음", () => {
    const none = { "opt-type-1": { applies: false, reasons: [] }, "opt-type-2": { applies: false, reasons: [] } };
    const withFallback = sentenceDoc([text("a", "대상: "), repeat("r", 종마다, [slot("s", "builtin.plan.name")], { fallback: [text("f", "해당 없음")] })]);
    expect(run(none, withFallback)).toEqual({ lines: ["제1조(적용)", "  대상: 해당 없음"], issues: [] });
    const empty = sentenceDoc([text("a", "대상: "), repeat("r", 종마다, [slot("s", "builtin.plan.name")]), text("b", "끝")]);
    expect(run(none, empty)).toEqual({ lines: ["제1조(적용)", "  대상: 끝"], issues: [] });
  });

  it("연결어가 없는 옛 트리는 원소가 둘 이상일 때 그 자리 오류 — 하나면 그대로", () => {
    const doc = sentenceDoc([repeat("r", 종마다, [slot("s", "builtin.plan.name")], { connector: undefined })]);
    expect(run(two, doc).issues.map((i) => i.kind)).toEqual(["structure"]);
    expect(run({ "opt-type-1": { applies: true, reasons: [] } }, doc).issues).toEqual([]);
  });

  it("원천 오류(미입력 목록값)는 반복 자리 오류 마커", () => {
    const doc = sentenceDoc([repeat("r", 사유합집합, [slot("s", "builtin.value.name")])]);
    const r = run({ "opt-type-1": { applies: true }, "opt-type-2": { applies: false } }, doc);
    expect(r.issues.map((i) => i.kind)).toEqual(["notEntered"]);
  });
});

describe("인라인 반복 — 블록 반복 안 · 조 제목", () => {
  it("블록 반복(종마다) 안의 목록 원천 — 현재 종의 사유만 · 열거형 순서", () => {
    const inline = repeat("ri", { kind: "listOfCurrent", loop: "fo", field: "reasons" }, [slot("s", "builtin.value.name")], { fallback: [text("f", "없음")] });
    const outer: ForBlockNode = { id: "fo", kind: "forBlock", source: 종마다, children: [{ id: "p", kind: "paragraph", code: "P0100", children: [slot("ps", "builtin.plan.name"), text("pt", " — "), inline] }] };
    const doc: DocumentNode = { ...waiverTemplate(), children: [{ id: "x", kind: "article", title: titleNodes("사유", "x"), children: [outer] }] };
    const r = run({ "opt-type-1": { applies: true, reasons: ["V03", "V01"] }, "opt-type-2": { applies: true, reasons: [] } }, doc);
    expect(r).toEqual({ lines: ["제1조(사유)", "  ① 1종 — 암 및 장해", "  ② 2종 — 없음"], issues: [] });
  });

  it("조 제목의 인라인 반복 — 정의조대상 사유의 약관표시명을 잇는다 (ADR-0088 결정 7 모양)", () => {
    const title: InlineNode[] = [repeat("tr", 정의조대상마다, [slot("ts", "builtin.value.F01")]), text("tt", "의 정의 및 진단확정")];
    const doc = sentenceDoc([text("b", "본문")], title);
    expect(run(two, doc)).toEqual({ lines: ["제1조(암(유사암제외) 및 뇌졸중의 정의 및 진단확정)", "  본문"], issues: [] });
    expect(run({ "opt-type-1": { applies: true, reasons: ["V02"] } }, doc).lines[0]).toBe("제1조(뇌졸중의 정의 및 진단확정)");
  });
});
