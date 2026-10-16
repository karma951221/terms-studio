import { describe, expect, it } from "vitest";

import { coverageChildrenProviders, coverageStructNode } from "../coverage/children";
import type { Coverage } from "../coverage/types";
import type { DocumentNode, ForBlockNode } from "../document/nodes";
import type { Id, Issue } from "../types";
import { repeatElementId, repeatElements, type RepeatDeps, type RepeatElement } from "./blockRepeat";
import { assemble, assembleSpecial } from "./booklet";
import { buildContexts, specialContext } from "./context";
import { nodeQualFixture, waiverFixture, waiverTemplate, type WaiverPlan } from "./fixture";
import { resolveDocument } from "./resolve";
import type { AssemblyInput, RenderedDoc, RenderedInline, ResolvedDoc } from "./types";
import { titleNodes } from "@/domain/document/title";

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

describe("합집합 거름 필드가 미입력 — 원천 좌표 = 그 열거형", () => {
  it("정의조대상이 빈 값이면 notEntered · 원천 { document: enum, ownerId: 열거형 코드, refPath: 값 코드 }", () => {
    const input = waiverFixture(waiverTemplate(), { "opt-type-1": { applies: true, reasons: ["V02"] } });
    input.enums = input.enums.map((e) => (e.code === "E0009" ? { ...e, values: e.values.map((v) => (v.code === "V02" ? { ...v, fields: { F01: "뇌졸중" } } : v)) } : e));
    const issue = assemble(input, input).issues.find((i) => i.kind === "notEntered" && i.message.includes("정의조대상"));
    expect(issue?.source).toEqual({ document: "enum", ownerId: "E0009", ownerName: "납입면제사유", refPath: "V02" });
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

describe("담보 트리 원소 (ADR-0087 결정 5)", () => {
  const tree: Coverage = {
    id: "pc",
    name: "암",
    description: "",
    subCoverages: [
      { id: "ps3", key: "03", name: "일반암", order: 0, benefits: [{ id: "pb1", key: "2", name: "진단", order: 0 }] },
      { id: "ps1", key: "01", name: "유사암", order: 1, benefits: [{ id: "pb2", key: "1", name: "진단", order: 0 }, { id: "pb3", key: "4", name: "재진단", order: 1 }] },
    ],
  };
  const rows = { root: coverageStructNode(tree), providers: coverageChildrenProviders(tree), rowContext: () => undefined };
  const deps = (current?: RepeatElement): RepeatDeps => ({ options: [], optionContext: () => undefined, current: () => current, enums: new Map(), explain: (m, at) => ({ kind: "structure", message: m, at }), rows });

  it("세부보장마다 — 트리 순서(키 순 아님), 접미사 = 키", () => {
    const r = repeatElements({ kind: "subCoverages" }, deps(), {});
    expect(r.ok && r.value.map((e) => [repeatElementId(e), (e as { path: string }).path])).toEqual([["03", "03"], ["01", "01"]]);
  });

  it("세부보장 › 급부마다 — 접미사 = 키 경로", () => {
    const r = repeatElements({ kind: "benefits" }, deps(), {});
    expect(r.ok && r.value.map(repeatElementId)).toEqual(["03.2", "01.1", "01.4"]);
  });

  it("현재 세부보장의 급부마다 — 바깥 현재 세부보장의 급부, 접미사 = 급부 키", () => {
    const outer: RepeatElement = { kind: "coverageNode", level: "subCoverage", id: "ps1", path: "01", suffix: "01" };
    const r = repeatElements({ kind: "benefitsOfCurrent", loop: "o" }, deps(outer), {});
    expect(r.ok && r.value.map((e) => [repeatElementId(e), (e as { path: string }).path])).toEqual([["1", "01.1"], ["4", "01.4"]]);
  });

  it("현재 세부보장의 급부마다가 세부보장 반복 밖이면 structure 오류", () => {
    const r = repeatElements({ kind: "benefitsOfCurrent", loop: "o" }, deps(), {});
    expect(!r.ok && r.issue.kind).toBe("structure");
  });

  it("문맥 담보가 없으면(보통약관) structure 오류", () => {
    const r = repeatElements({ kind: "subCoverages" }, { ...deps(), rows: undefined }, {});
    expect(!r.ok && r.issue.kind).toBe("structure");
  });
});

describe("담보 트리 반복 조립 — 현재 노드 문맥 · 복제 접미사 (ADR-0087 결정 5 · 8 · 9)", () => {
  /** 노드 키 픽스처(세부A 키 01 = 감액 있음 · 세부B 키 03 = 감액 없음)에 담보약관 한 벌을 끼운다. */
  function withDoc(article: DocumentNode["children"][number]): AssemblyInput {
    const input = nodeQualFixture();
    const doc: DocumentNode = { id: "nq-doc", kind: "document", title: "노드한정자 특별약관", children: [article] };
    return { ...input, specialDocuments: new Map([...input.specialDocuments, ["cov-nodequal", doc]]) };
  }
  const cond = (id: Id, when: string, yes: string, no: string) => ({ kind: "inlineCond", id, branches: [{ id: `${id}-t`, when, children: [{ kind: "text", id: `${id}-x`, text: yes }] }, { id: `${id}-e`, children: [{ kind: "text", id: `${id}-y`, text: no }] }] });

  /** 세부보장마다 항(P0200) — 그 안에 현재 세부보장의 급부마다 호(P0300). 한정자 없는 D0007 · D0002 가 현재 노드에서 읽힌다. */
  const article = {
    kind: "article",
    id: "a",
    title: titleNodes("감액", "a"),
    children: [
      {
        kind: "forBlock",
        id: "f",
        code: "P0100",
        source: { kind: "subCoverages" },
        children: [
          {
            kind: "paragraph",
            id: "p",
            code: "P0200",
            children: [cond("c", "D0007 = true", "감액 있음", "감액 없음")],
            items: [{ kind: "forBlock", id: "g", code: "P0400", source: { kind: "benefitsOfCurrent", loop: "f" }, children: [{ kind: "item", id: "i", code: "P0300", children: [cond("d", "D0002 = true", "급부 감액", "급부 그대로")] }] }],
          },
        ],
      },
    ],
  } as unknown as DocumentNode["children"][number];

  it("세부보장마다 한 항 — 안의 한정자 없는 세부보장 구분자는 그 세부보장 값, 급부 호는 그 급부 값", () => {
    const input = withDoc(article);
    const r = assembleSpecial(input, input, "pc-nodequal");
    expect(r.ok && r.value.issues.filter((i) => (i.severity ?? "error") === "error")).toEqual([]);
    const art = r.ok ? r.value.doc.children[0] : undefined;
    const paras = art?.kind === "article" ? art.children : [];
    expect(paras.map((p) => (p.kind === "paragraph" ? inlineText(p.children) : p.kind))).toEqual(["감액 있음", "감액 없음"]);
    expect(paras.map((p) => p.id)).toEqual(["p@01", "p@03"]);
    expect(paras.map((p) => (p.kind === "paragraph" ? (p.items ?? []).map((i) => (i.kind === "item" ? `${i.id} ${inlineText(i.children)}` : i.kind)) : []))).toEqual([["i@01@1 급부 감액"], ["i@03@1 급부 그대로"]]);
  });

  it("트리 반복도 「비었을 때」 칸을 받는다 — 세부보장이 있으면 본문만, 없으면 칸 항 (ADR-0088 결정 4 × ADR-0087 결정 5)", () => {
    const withFallback = {
      kind: "article",
      id: "a",
      title: titleNodes("감액", "a"),
      children: [
        {
          kind: "forBlock",
          id: "f",
          source: { kind: "subCoverages" },
          children: [{ kind: "paragraph", id: "p", children: [{ kind: "text", id: "pt", text: "세부보장 항" }] }],
          fallback: [{ kind: "paragraph", id: "q", children: [{ kind: "text", id: "qt", text: "세부보장 없음" }] }],
        },
      ],
    } as unknown as DocumentNode["children"][number];
    const texts = (input: AssemblyInput) => {
      const r = assembleSpecial(input, input, "pc-nodequal");
      const art = r.ok ? r.value.doc.children[0] : undefined;
      return (art?.kind === "article" ? art.children : []).map((p) => (p.kind === "paragraph" ? inlineText(p.children) : p.kind));
    };
    const input = withDoc(withFallback);
    expect(texts(input)).toEqual(["세부보장 항", "세부보장 항"]);
    const empty = { ...input, coverages: input.coverages.map((c) => ({ ...c, snapshot: { ...c.snapshot, subCoverages: [] } })) };
    expect(texts(empty)).toEqual(["세부보장 없음"]);
  });

  it("P코드 열쇠 접미사는 노드 키(@01 · 중첩 @01@1), 반복 표지에 키 경로", () => {
    const input = withDoc(article);
    const doc = input.specialDocuments.get("cov-nodequal")!;
    const ctx = specialContext(input, input.coverages[0]);
    const r = resolveDocument(doc, ctx, { clauses: new Map(), overrides: new Map(), coordinate: { document: "special", ownerId: "pc-nodequal" }, enums: new Map(), master: input.master });
    const art = r.doc.children[0] as { children: { key?: string; loops?: unknown; items?: { key?: string; loops?: unknown }[] }[] };
    expect(art.children.map((p) => p.key)).toEqual(["P0200@01", "P0200@03"]);
    expect(art.children[0].loops).toEqual([{ loop: "f", element: "01", kind: "coverageNode", path: "01" }]);
    expect(art.children[0].items?.map((i) => [i.key, i.loops])).toEqual([
      [
        "P0300@01@1",
        [
          { loop: "f", element: "01", kind: "coverageNode", path: "01" },
          { loop: "g", element: "1", kind: "coverageNode", path: "01.1" },
        ],
      ],
    ]);
  });
});
