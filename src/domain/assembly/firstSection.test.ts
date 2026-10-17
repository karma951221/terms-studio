/**
 * 제1절 판정 — 조립 관통 (ADR-0082 결정 1 ~ 9 · 11 · 15 · 기능/조립산출 §3.9 · §3.10 · §3.12).
 *
 * 독립특약 · 블록 둘(A = 상해사망 기본계약 문면, B = 일반상해사망 담보약관 — 둘 다 이 픽스처에서 새로 쓴다).
 * 템플릿 조 여섯이 판정 6종을 하나씩 친다:
 *   제1조 용어의 정의 — 연결 0 → 마스터
 *   제2조 보험금의 지급사유 — 2/2 · 일반 글 → 위임
 *   제3조 보험금의 청구 — 1/2 · 옵션 공통항 → 특칙 + partialLinkOption
 *   제4조 특별약관의 소멸 — 2/2 · 같은 함수조항 · 같은 옵션 → 공통
 *   제5조 보험금을 지급하지 않는 사유 — 2/2 · 옵션 공통항 · 공통 항(함수조항) + A 전용 일반 글 → 공통항 분리
 *   제6조 보험금 지급에 관한 세부규정 — 2/2 · 옵션 전체항 · 같은 함수조항 하나 + 블록마다 일반 글 → 전체항 합침 + joinPlainText
 */
import { describe, expect, it } from "vitest";

import type { ArticleNode, BlockNode, DocumentNode } from "../document/nodes";
import { titleNodes } from "../document/title";
import { entered, type Id } from "../types";
import { assemble } from "./booklet";
import { alphaPlusFixture } from "./fixture";
import type { AssemblyInput, Booklet, RenderedDoc, RenderedInline } from "./types";

const text = (id: string, value: string): BlockNode => ({ id, kind: "paragraph", children: [{ id: `${id}-t`, kind: "text", text: value }] });
const clause = (id: string, clauseCode: string, options: Record<string, string> = {}, code?: string): BlockNode => ({ id, kind: "clauseBlockRef", clauseCode, options, ...(code ? { code } : {}) }) as BlockNode;
const article = (id: string, title: string, children: BlockNode[], extra: Partial<ArticleNode> = {}): ArticleNode => ({ id, kind: "article", title: titleNodes(title, id), children, ...extra });

function template(options: Partial<Record<string, "common" | "all">> = {}): DocumentNode {
  const mode = (id: string) => (options[id] ? { joinMode: options[id] } : {});
  return {
    id: "t-doc",
    kind: "document",
    title: "독립특약 템플릿",
    children: [
      article("t-def", "용어의 정의", [text("t-def-p", "이 특별약관에서 사용하는 용어의 정의는 다음과 같습니다.")]),
      article("t-pay", "보험금의 지급사유", [text("t-pay-p", "마스터 지급사유")], mode("t-pay")),
      article("t-claim", "보험금의 청구", [text("t-claim-p", "마스터 청구")], mode("t-claim")),
      article("t-lapse", "특별약관의 소멸", [text("t-lapse-p", "마스터 소멸")], mode("t-lapse")),
      article("t-exempt", "보험금을 지급하지 않는 사유", [text("t-exempt-p", "마스터 면책")], mode("t-exempt")),
      article("t-detail", "보험금 지급에 관한 세부규정", [text("t-detail-p", "마스터 세부")], mode("t-detail")),
    ],
  };
}

function docA(extra: ArticleNode[] = []): DocumentNode {
  return {
    id: "a-doc",
    kind: "document",
    title: "A 문면",
    children: [
      article("a-pay", "보험금의 지급사유", [text("a-pay-p", "A 지급사유")], { linkedArticleId: "t-pay" }),
      article("a-claim", "보험금의 청구", [text("a-claim-p", "A 청구 특칙")], { linkedArticleId: "t-claim" }),
      article("a-lapse", "특별약관의 소멸", [clause("a-lapse-c", "C0001", { O01: "V02" })], { linkedArticleId: "t-lapse" }),
      article("a-exempt", "보험금을 지급하지 않는 사유", [clause("a-exempt-c", "C0003"), text("a-exempt-own", "A 전용 면책")], { linkedArticleId: "t-exempt" }),
      article("a-detail", "보험금 지급에 관한 세부규정", [clause("a-detail-c", "C0001", { O01: "V01" }), text("a-detail-own", "A 세부")], { linkedArticleId: "t-detail" }),
      article("a-own", "A 고유 조", [{ id: "a-own-p", kind: "paragraph", children: [{ id: "a-own-ref", kind: "articleRef", scope: "self", targets: [{ articleId: "a-lapse" }], connector: "및" }, { id: "a-own-t", kind: "text", text: "에 따라 소멸합니다." }] }]),
      ...extra,
    ],
  };
}

function docB(): DocumentNode {
  return {
    id: "b-doc",
    kind: "document",
    title: "B 문면",
    children: [
      article("b-pay", "보험금의 지급사유", [text("b-pay-p", "B 지급사유")], { linkedArticleId: "t-pay" }),
      article("b-lapse", "특별약관의 소멸", [clause("b-lapse-c", "C0001", { O01: "V02" })], { linkedArticleId: "t-lapse" }),
      article("b-exempt", "보험금을 지급하지 않는 사유", [clause("b-exempt-c", "C0003")], { linkedArticleId: "t-exempt" }),
      article("b-detail", "보험금 지급에 관한 세부규정", [clause("b-detail-c", "C0001", { O01: "V01" }), text("b-detail-own", "B 세부")], { linkedArticleId: "t-detail" }),
    ],
  };
}

const OPTIONS = { "t-claim": "common", "t-exempt": "common", "t-detail": "all" } as const;

function standalone(opts: { options?: Partial<Record<string, "common" | "all">>; blocks?: Id[]; a?: DocumentNode; b?: DocumentNode; product?: Partial<AssemblyInput["product"]>; master?: Partial<AssemblyInput> } = {}): AssemblyInput {
  const input = alphaPlusFixture();
  const values = new Map(input.product.values);
  values.set("feature.contract_kind", entered("V02"));
  const blocks = opts.blocks ?? ["pc-base", "pc-basic"];
  return {
    ...input,
    coverages: input.coverages.filter((c) => blocks.includes(c.snapshot.id)),
    generalDocuments: new Map([["t-doc", template(opts.options ?? OPTIONS)]]),
    specialDocuments: new Map([["cov-base-death", opts.a ?? docA()], ["cov-death", opts.b ?? docB()]]),
    product: { ...input.product, name: "판정 표본", values, baseContractIds: [], generalDocumentId: "t-doc", ...opts.product },
    ...opts.master,
  };
}

const run = (input: AssemblyInput) => assemble(input, input);

function lines(doc: RenderedDoc): string[] {
  const inline = (list: RenderedInline[]) => list.map((n) => (n.kind === "text" ? n.text : n.kind === "error" ? `⟦${n.issue.kind}⟧` : n.label)).join("");
  const out: string[] = [];
  for (const a of doc.children) {
    if (a.kind !== "article") continue;
    out.push(`${a.label}(${a.title})`);
    for (const p of a.children) if (p.kind === "paragraph") out.push(`  ${p.label} ${inline(p.children)}`.trimEnd());
  }
  return out;
}
const blockLines = (b: Booklet, i: number) => lines(b.blocks!.flatMap((g) => g.docs)[i]);
const record = (b: Booklet, articleId: Id) => b.firstSection!.find((r) => r.articleId === articleId)!;

describe("판정 6종 — 제1절 · 제2절 · 판정 기록", () => {
  const b = run(standalone());

  it("제1절 — 마스터 · 위임 · 특칙(마스터 그대로) · 공통(블록 글 조째) · 공통항 분리(공통 항) · 전체항 합침(합집합: 같은 함수조항 한 번, 일반 글은 블록마다) · 조 제목은 템플릿 조 제목", () => {
    expect(lines(b.general!)).toEqual([
      "제1조(용어의 정의)",
      "   이 특별약관에서 사용하는 용어의 정의는 다음과 같습니다.",
      "제2조(보험금의 지급사유)",
      "   제2조(보험금의 지급사유)는 제2절 보장조항에서 정합니다.",
      "제3조(보험금의 청구)",
      "   마스터 청구",
      "제4조(특별약관의 소멸)",
      "   이 특별약관은 피보험자가 사망한 때 소멸합니다.",
      "제5조(보험금을 지급하지 않는 사유)",
      "   법령에 따라 보험금 지급이 제한되는 경우에는 보험금을 지급하지 않습니다.",
      "제6조(보험금 지급에 관한 세부규정)",
      "  ① 이 특별약관은 보험기간이 끝난 때 소멸합니다.",
      "  ② A 세부",
      "  ③ B 세부",
    ]);
  });

  it("제2절 — 위임 · 특칙은 블록마다 자기 조, 공통 · 합침은 생략, 공통항 분리는 ① 준용 문구 + 전용 항(②부터) · 전용 항 없는 블록은 생략", () => {
    expect(blockLines(b, 0)).toEqual([
      "제1조(보험금의 지급사유)",
      "   A 지급사유",
      "제2조(보험금의 청구)",
      "   A 청구 특칙",
      "제3조(보험금을 지급하지 않는 사유)",
      "  ① 제1절 일반조항 제5조(보험금을 지급하지 않는 사유) 및 아래의 각 항을 따릅니다.",
      "  ② A 전용 면책",
      "제4조(A 고유 조)",
      "   보통약관 제4조(특별약관의 소멸)에 따라 소멸합니다.",
      "제5조(준용규정)",
      "   이 특별약관에서 정하지 않은 사항은 보통약관을 따릅니다.",
    ]);
    expect(blockLines(b, 1)).toEqual(["제1조(보험금의 지급사유)", "   B 지급사유", "제2조(준용규정)", "   이 특별약관에서 정하지 않은 사항은 보통약관을 따릅니다."]);
  });

  it("판정 기록 — 템플릿 조 순 · k/N · 옵션 · 결과 · 사유 · 연결한 · 안 한 블록 · 블록별 처리 (ADR-0082 결정 11)", () => {
    expect(b.firstSection!.map((r) => [r.number, r.title, `${r.k}/${r.n}`, r.option, r.result, r.reason, r.blocks.map((x) => `${x.productCoverageId}:${x.treatment}`).join(" ")])).toEqual([
      [2, "보험금의 지급사유", "2/2", "none", "delegate", "differentNoCommon", "pc-base:listed pc-basic:listed"],
      [3, "보험금의 청구", "1/2", "common", "special", "partialOption", "pc-base:listed"],
      [4, "특별약관의 소멸", "2/2", "none", "common", "allSame", "pc-base:omitted pc-basic:omitted"],
      [5, "보험금을 지급하지 않는 사유", "2/2", "common", "commonSplit", "differentWithCommon", "pc-base:split pc-basic:omitted"],
      [6, "보험금 지급에 관한 세부규정", "2/2", "all", "joinAll", "differentWithCommon", "pc-base:omitted pc-basic:omitted"],
    ]);
    expect(record(b, "t-claim").unlinked).toEqual([{ productCoverageId: "pc-basic", name: "일반상해사망" }]);
  });

  it("경고 — partialLinkOption(옵션 조의 일부 연결 · 제1절 그 조 · 연결하지 않은 담보 이름) · joinPlainText(전체항 모드 조에 연결한 블록 조의 일반 글) · 완성본은 그대로", () => {
    const warn = b.issues.filter((i) => i.severity === "warning");
    expect(warn.map((i) => i.kind)).toEqual(["partialLinkOption", "joinPlainText", "joinPlainText"]);
    expect(warn[0]).toMatchObject({ at: { document: "general", articleId: "t-claim", articleNumber: 3, section: { label: "제1절" } } });
    expect(warn[0].message).toContain("연결하지 않은 담보: 일반상해사망");
    expect(warn[1]).toMatchObject({ at: { document: "special", ownerId: "pc-base", articleId: "a-detail", section: { label: "제2절 1." } } });
    expect(b.complete).toBe(true);
  });

  it("옵션이 「없음」인 조의 일부 연결은 정상 특칙 — 경고 없음", () => {
    const r = run(standalone({ options: { "t-exempt": "common", "t-detail": "all" } }));
    expect(record(r, "t-claim")).toMatchObject({ result: "special", reason: "partial" });
    expect(r.issues.map((i) => i.kind)).not.toContain("partialLinkOption");
  });
});

describe("옵션 표 — 같은 재료 · 다른 옵션 (결정 5)", () => {
  it("옵션 없음 — 공통 항이 있어도 위임 · 모두 같으면 공통", () => {
    const r = run(standalone({ options: {} }));
    expect(["t-lapse", "t-exempt", "t-detail"].map((id) => record(r, id).result)).toEqual(["common", "delegate", "delegate"]);
  });

  it("전체항 모으기 · 모두 같으면 공통 · 공통항 모으기 · 공통 항 없으면 위임", () => {
    const r = run(standalone({ options: { "t-lapse": "all", "t-pay": "common" } }));
    expect(record(r, "t-lapse").result).toBe("common");
    expect(record(r, "t-pay")).toMatchObject({ result: "delegate", reason: "differentNoCommon" });
  });

  it("옵션은 다르면 「다르다」 — 같은 함수조항이라도 옵션 값이 다르면 공통이 아니다", () => {
    const b = docB();
    const changed = { ...b, children: b.children.map((a) => (a.kind === "article" && a.id === "b-lapse" ? { ...a, children: [clause("b-lapse-c", "C0001", { O01: "V01" })] } : a)) } as DocumentNode;
    const r = run(standalone({ b: changed }));
    expect(record(r, "t-lapse")).toMatchObject({ result: "delegate", reason: "differentNoCommon" });
  });
});

describe("블록 하나 · 블록 수 (결정 7 · 결정 2)", () => {
  it("블록 하나(N = 1) — 연결한 조는 옵션과 무관하게 모두 위임 · partialLinkOption 없음 · 블록에 자기 조 그대로", () => {
    const r = run(standalone({ blocks: ["pc-base"] }));
    expect(r.firstSection!.map((x) => [x.title, x.result, `${x.k}/${x.n}`, x.reason])).toEqual([
      ["보험금의 지급사유", "delegate", "1/1", "single"],
      ["보험금의 청구", "delegate", "1/1", "single"],
      ["특별약관의 소멸", "delegate", "1/1", "single"],
      ["보험금을 지급하지 않는 사유", "delegate", "1/1", "single"],
      ["보험금 지급에 관한 세부규정", "delegate", "1/1", "single"],
    ]);
    expect(r.issues.filter((i) => i.severity === "warning")).toEqual([]);
    expect(blockLines(r, 0)).toContain("  ② A 전용 면책");
  });
});

describe("참조 (결정 9 · C1 · C2 · C4)", () => {
  it("C4 — 블록에 남은 조가 제1절로 오른 조를 가리키면 제1절 조 번호(지금 표기 「보통약관 제N조」 — 위치 호칭은 ④)", () => {
    const r = run(standalone());
    expect(blockLines(r, 0)).toContain("   보통약관 제4조(특별약관의 소멸)에 따라 소멸합니다.");
    expect(r.issues.filter((i) => i.kind === "articleGone")).toEqual([]);
  });

  it("C1 — 공통항 분리에서 전용 항이 공통 항을 가리키는 블록은 조를 쪼개지 않고 통째 · 다른 블록은 분리 그대로", () => {
    const a = docA();
    const exempt = article("a-exempt", "보험금을 지급하지 않는 사유", [clause("a-exempt-c", "C0003", {}, "P0100"), { id: "a-exempt-own", kind: "paragraph", children: [{ id: "a-exempt-ref", kind: "articleRef", scope: "self", targets: [{ articleId: "a-exempt", code: "P0100" }], connector: "및" }, { id: "a-exempt-t", kind: "text", text: "의 예외" }] }], { linkedArticleId: "t-exempt" });
    const r = run(standalone({ a: { ...a, children: a.children.map((x) => (x.kind === "article" && x.id === "a-exempt" ? exempt : x)) } }));
    expect(record(r, "t-exempt").blocks.map((x) => x.treatment)).toEqual(["whole", "omitted"]);
    expect(blockLines(r, 0)).toEqual(expect.arrayContaining(["제3조(보험금을 지급하지 않는 사유)", "  ① 법령에 따라 보험금 지급이 제한되는 경우에는 보험금을 지급하지 않습니다.", "  ② 제1항의 예외"]));
  });

  it("C2 — 전체항 합침에서 같은 조 안의 항 참조는 합친 조의 새 번호", () => {
    const a = docA();
    const detail = article("a-detail", "보험금 지급에 관한 세부규정", [clause("a-detail-c", "C0001", { O01: "V01" }, "P0100"), { id: "a-detail-own", kind: "paragraph", children: [{ id: "a-detail-ref", kind: "articleRef", scope: "self", targets: [{ articleId: "a-detail", code: "P0100" }], connector: "및" }, { id: "a-detail-t", kind: "text", text: "에도 불구하고 A 세부" }] }], { linkedArticleId: "t-detail" });
    const r = run(standalone({ a: { ...a, children: a.children.map((x) => (x.kind === "article" && x.id === "a-detail" ? detail : x)) } }));
    expect(lines(r.general!).slice(-3)).toEqual(["  ① 이 특별약관은 보험기간이 끝난 때 소멸합니다.", "  ② 제1항에도 불구하고 A 세부", "  ③ B 세부"]);
  });

  it("참조 대치 — 자기 블록 조를 가리키는 참조는 연결한 템플릿 조로 바꿔 견준다: 두 블록이 각자 자기 지급사유 조를 가리켜도 같다 → 공통 · 기록에 대치 내역", () => {
    const withRef = (prefix: "a" | "b", doc: DocumentNode): DocumentNode => ({
      ...doc,
      children: doc.children.map((x) =>
        x.kind === "article" && x.id === `${prefix}-lapse`
          ? { ...x, children: [{ id: `${prefix}-lapse-c`, kind: "clauseBlockRef", clauseCode: "C0004", options: {}, bindings: { R: { kind: "articleRef", targets: [{ articleId: `${prefix}-pay` }], scope: "self" } } } as unknown as BlockNode] }
          : x,
      ),
    });
    const input = standalone({ a: withRef("a", docA()), b: withRef("b", docB()) });
    const refClause = { code: "C0004", label: "지급사유 참조", mode: "block" as const, params: [{ name: "R", type: { kind: "articleRef" } }], body: [{ id: "c4-par", kind: "paragraph", children: [{ id: "c4-ref", kind: "articleRef", targets: [{ param: "R" }], scope: "param" }, { id: "c4-t", kind: "text", text: "의 보험금 지급사유가 생기면 소멸합니다." }] }], options: [], required: { discriminators: [], attributes: [] } };
    const r = run({ ...input, clauses: [...input.clauses, refClause as never] });
    expect(record(r, "t-lapse")).toMatchObject({ result: "common", reason: "allSame" });
    expect(record(r, "t-lapse").substitutions.map((x) => [x.productCoverageId, x.from, x.to])).toEqual([
      ["pc-base", "a-pay", "t-pay"],
      ["pc-basic", "b-pay", "t-pay"],
    ]);
    expect(lines(r.general!)).toContain("   제2조(보험금의 지급사유)의 보험금 지급사유가 생기면 소멸합니다.");
  });
});

describe("연결 검사 (기능/조립산출 §3.12)", () => {
  it("duplicateLink — 한 블록의 두 조가 같은 템플릿 조에 연결: 오류 · 앞 조만 연결로 센다(뒤 조는 블록에 그대로)", () => {
    const r = run(standalone({ a: docA([article("a-pay2", "보험금의 지급사유 2", [text("a-pay2-p", "둘째")], { linkedArticleId: "t-pay" })]) }));
    expect(r.issues.filter((i) => i.kind === "duplicateLink").map((i) => [i.severity, i.at.articleId])).toEqual([["error", "a-pay2"]]);
    expect(record(r, "t-pay").k).toBe(2);
    expect(blockLines(r, 0)).toContain("   둘째");
  });

  it("linkTargetGone — 연결한 템플릿 조가 이 상품 최종 트리에 없다(노출 끔): 오류 · 연결로 세지 않는다", () => {
    const r = run(standalone({ product: { hiddenArticleIds: new Set(["t-claim"]) } }));
    const gone = r.issues.filter((i) => i.kind === "linkTargetGone");
    expect(gone.map((i) => [i.severity, i.at.articleId])).toEqual([["error", "a-claim"]]);
    expect(gone[0].message).toContain("노출을 끈 조");
    expect(r.firstSection!.map((x) => x.articleId)).not.toContain("t-claim");
    expect(blockLines(r, 0)).toContain("   A 청구 특칙");
  });

  it("wrongGeneral — 블록 담보약관의 대응 보통약관 ≠ 상품 템플릿: 오류 · 셈에서 빼지 않는다", () => {
    const r = run(standalone({ master: { coverageGenerals: new Map([["cov-death", "other-general"], ["cov-base-death", "t-doc"]]) } }));
    expect(r.issues.filter((i) => i.kind === "wrongGeneral").map((i) => i.at.ownerId)).toEqual(["pc-basic"]);
    expect(record(r, "t-pay").n).toBe(2);
  });

  it("linkedSpecialRule — 블록 조가 자기 연결 대상 템플릿 조를 보통약관 참조로도 가리킴: 경고", () => {
    const a = docA();
    const claim = article("a-claim", "보험금의 청구", [{ id: "a-claim-p", kind: "paragraph", children: [{ id: "a-claim-ref", kind: "articleRef", scope: "general", targets: [{ articleId: "t-claim" }], connector: "및" }, { id: "a-claim-t", kind: "text", text: " 이외에도 청구합니다." }] }], { linkedArticleId: "t-claim" });
    const r = run(standalone({ a: { ...a, children: a.children.map((x) => (x.kind === "article" && x.id === "a-claim" ? claim : x)) } }));
    expect(r.issues.filter((i) => i.kind === "linkedSpecialRule").map((i) => [i.severity, i.at.articleId])).toEqual([["warning", "a-claim"]]);
  });
});
