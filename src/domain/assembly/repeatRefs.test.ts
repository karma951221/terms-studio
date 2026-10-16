import { describe, expect, it } from "vitest";

import type { ArticleNode, DocumentNode, ForBlockNode, ParagraphNode, RefTarget } from "../document/nodes";
import type { Id, RefRestrict } from "../types";
import { assemble, assembleSpecial } from "./booklet";
import { nodeQualFixture, waiverFixture, waiverTemplate, type WaiverPlan } from "./fixture";
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
    // 보통약관이 넣은 함수조항의 보통약관 참조는 제 문서 참조다 — 「보통약관」 머리 없이, 같은 조면 조를 뺀다(원문 제27조의1 ② 「제1항 제1호의 …」)
    expect(lines(booklet.general)).toContain("  ③ 암보장개시일제1항 및 제2항");
  });

  it("보통약관이 넣은 함수조항의 보통약관 참조 — 다른 조를 가리키면 「제N조(…)」, 「보통약관」 머리는 붙지 않는다", () => {
    const input = waiverFixture(waiverTemplate(), TWO);
    const addendum = input.clauses.find((c) => c.code === "C0301")!;
    const body = structuredClone(addendum.body) as unknown as ParagraphNode[];
    body[0].children.push({ id: "cr", kind: "articleRef", connector: "및", targets: [{ articleId: "d" }] } as never);
    const other = { ...input, clauses: input.clauses.map((c) => (c.code === "C0301" ? { ...c, body } : c)) } as typeof input;
    const booklet = assemble(other, other);
    expect(booklet.issues.filter((i) => i.at.document === "general" && i.severity !== "warning")).toEqual([]);
    expect(lines(booklet.general)).toContain("  ③ 암보장개시일제2조(정의 및 진단확정)");
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

  it("대상 여럿 중 일부만 0개면 남은 대상으로 찍는다 — 참조 하나의 펼친 것 합이 0개일 때만 오류 (사유별 함수조항이 스스로 꺼진 대상, ADR-0086 결정 2)", () => {
    const r = run([refArticle([{ articleId: "a", code: "P0200", restrict: { values: ["V01"] } }, { articleId: "a", code: "P0200", restrict: { values: ["V02"] } }], "또는")]);
    expect(r.issues).toEqual([]);
    expect(refLine(r)).toBe("제1조(보험료의 납입면제) 제1항 제1호 또는 제2항 제1호를 본다");
    const none = run([refArticle([{ articleId: "a", code: "P0200", restrict: { values: ["V02"] } }, { articleId: "a", code: "P0200", restrict: { values: ["V04"] } }], "또는")]);
    expect(none.issues.map((i) => [i.kind, i.at.refPath])).toEqual([
      ["articleGone", "a#P0200"],
      ["articleGone", "a#P0200"],
    ]);
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

describe("키 한정 해소 (ADR-0087 결정 10)", () => {
  /**
   * 노드 키 픽스처(`nodeQualFixture` — 세부A 키 01 · 세부B 키 03, 각 급부 키 1)에 담보약관 한 벌:
   * 제1조 = 「세부보장마다」 반복 블록(P0100) 안 항(P0200) — 그 안에 현재 세부보장의 급부마다 호(P0400 블록 · 호 P0500) — + 반복 밖 참조 항(P0300).
   * 표기 = 렌더된 담보약관의 참조 항 인라인을 이 파일의 `inlineText` 로 이은 글(값 한정 테스트와 같은 추출).
   */
  function treeRepeatDoc(refPara: ParagraphNode, extra: ArticleNode[] = []): DocumentNode {
    const body: ForBlockNode = {
      id: "f",
      kind: "forBlock",
      code: "P0100",
      source: { kind: "subCoverages" },
      children: [
        {
          id: "p",
          kind: "paragraph",
          code: "P0200",
          children: [{ id: "pt", kind: "text", text: "세부보장 항" }],
          items: [{ id: "g", kind: "forBlock", code: "P0400", source: { kind: "benefitsOfCurrent", loop: "f" }, children: [{ id: "i", kind: "item", code: "P0500", children: [{ id: "it", kind: "text", text: "급부 호" }] }] }],
        },
      ],
    } as unknown as ForBlockNode;
    return { id: "nq-doc", kind: "document", title: "노드한정자 특별약관", children: [{ id: "a1", kind: "article", title: "감액", children: [body, refPara] }, ...extra] } as DocumentNode;
  }
  function assembleDoc(doc: DocumentNode) {
    const base = nodeQualFixture();
    const input = { ...base, specialDocuments: new Map([...base.specialDocuments, ["cov-nodequal", doc]]) };
    const r = assembleSpecial(input, input, "pc-nodequal");
    if (!r.ok) throw new Error("조립 거부");
    return { doc: r.value.doc, issues: r.value.issues.filter((i) => (i.severity ?? "error") === "error") };
  }
  function assembleTreeRepeatDoc(ref: { restrict: RefRestrict; connector?: "및" | "또는"; code?: string }) {
    const refPara = {
      id: "rp",
      kind: "paragraph",
      code: "P0300",
      children: [{ id: "rr", kind: "articleRef", scope: "self", ...(ref.connector ? { connector: ref.connector } : {}), targets: [{ articleId: "a1", code: ref.code ?? "P0200", restrict: ref.restrict }] }],
    } as unknown as ParagraphNode;
    const out = assembleDoc(treeRepeatDoc(refPara));
    const art = out.doc.children[0];
    const last = art?.kind === "article" ? art.children.at(-1) : undefined;
    return { refText: last?.kind === "paragraph" ? inlineText(last.children) : undefined, issues: out.issues };
  }

  it("「세부보장 = 03 인 것」 — 그 세부보장 회차의 항만 「제2항」", () => {
    const out = assembleTreeRepeatDoc({ restrict: { keys: ["03"] } });
    expect(out.issues).toEqual([]);
    expect(out.refText).toBe("제2항");
  });
  it("「01 · 03」 — 둘 다", () => {
    expect(assembleTreeRepeatDoc({ restrict: { keys: ["01", "03"] }, connector: "및" }).refText).toBe("제1항 및 제2항");
  });
  it("스냅샷에 없는 키 — 조용히 비지 않고 articleGone 「펼친 것이 0개」", () => {
    const out = assembleTreeRepeatDoc({ restrict: { keys: ["02"] } });
    expect(out.issues).toContainEqual(expect.objectContaining({ kind: "articleGone", message: expect.stringContaining("0개") }));
  });
  it("세부보장 키는 그 아래 급부 원소까지 — 급부 호 대상에 키 03 이면 세부B 급부의 호만", () => {
    const out = assembleTreeRepeatDoc({ restrict: { keys: ["03"] }, code: "P0500" });
    expect(out.issues).toEqual([]);
    expect(out.refText).toBe("제2항 제1호");
  });
  it("급부 키 경로는 정확히 — 01.1 은 세부A 급부의 호만", () => {
    expect(assembleTreeRepeatDoc({ restrict: { keys: ["01.1"] }, code: "P0500" }).refText).toBe("제1항 제1호");
  });
  it("키 비교는 문자열 정확 · 「.」 경계 — 0 은 01 · 03 을 고르지 않는다", () => {
    const out = assembleTreeRepeatDoc({ restrict: { keys: ["0"] } });
    expect(out.issues).toContainEqual(expect.objectContaining({ kind: "articleGone", message: expect.stringContaining("0개") }));
  });
  it("「현재」 = 감싼 트리 반복의 현재 노드 키 — 다른 조의 세부보장 회차마다 그 세부보장의 항", () => {
    const other = {
      id: "b1",
      kind: "article",
      title: "참조",
      children: [
        {
          id: "h",
          kind: "forBlock",
          code: "P0100",
          source: { kind: "subCoverages" },
          children: [{ id: "hp", kind: "paragraph", code: "P0200", children: [{ id: "hr", kind: "articleRef", scope: "self", targets: [{ articleId: "a1", code: "P0200", restrict: { current: "h" } }] }] }],
        },
      ],
    } as unknown as ArticleNode;
    const refPara = { id: "rp", kind: "paragraph", code: "P0300", children: [{ id: "rt", kind: "text", text: "끝" }] } as unknown as ParagraphNode;
    const out = assembleDoc(treeRepeatDoc(refPara, [other]));
    expect(out.issues).toEqual([]);
    const art = out.doc.children[1];
    const paras = art?.kind === "article" ? art.children : [];
    expect(paras.map((p) => (p.kind === "paragraph" ? inlineText(p.children) : p.kind))).toEqual(["제1조(감액) 제1항", "제1조(감액) 제2항"]);
  });
  it("「현재」가 급부 반복인데 대상이 세부보장 회차 항 — 조용히 비지 않고 articleGone 「0개」(저장 검사가 막는 꼴이 들어와도)", () => {
    const other = {
      id: "b1",
      kind: "article",
      title: "참조",
      children: [
        {
          id: "h",
          kind: "forBlock",
          code: "P0100",
          source: { kind: "subCoverages" },
          children: [
            {
              id: "hp",
              kind: "paragraph",
              code: "P0200",
              children: [{ id: "ht", kind: "text", text: "회차" }],
              items: [{ id: "k", kind: "forBlock", code: "P0400", source: { kind: "benefitsOfCurrent", loop: "h" }, children: [{ id: "ki", kind: "item", code: "P0500", children: [{ id: "kr", kind: "articleRef", scope: "self", targets: [{ articleId: "a1", code: "P0200", restrict: { current: "k" } }] }] }] }],
            },
          ],
        },
      ],
    } as unknown as ArticleNode;
    const refPara = { id: "rp", kind: "paragraph", code: "P0300", children: [{ id: "rt", kind: "text", text: "끝" }] } as unknown as ParagraphNode;
    const out = assembleDoc(treeRepeatDoc(refPara, [other]));
    expect(out.issues).toContainEqual(expect.objectContaining({ kind: "articleGone", message: expect.stringContaining("0개") }));
  });
});
