/**
 * 절 형태 ① 뼈대 (ADR-0021 결정 1 · ADR-0082 결정 2 · 7 · 8 · ADR-0090 결정 7 · 8 · 기능/조립산출 §3.8).
 *
 * - 형태 판별: 주계약 기본계약 0 → noBaseContract · 1 → 대치 형태(single) · 2+ → 절 형태(sectioned).
 *   독립특약: 기본계약 지정 → unsupported · 블록 0 → noBlock · 1+ → 절 형태. 블록 수는 조건 해소 · 블록 빈 조 빼기 뒤에 센다.
 * - 제1절 = 최종 트리. ①은 판정 없이 블록이 하나라도 조연결한 템플릿 조를 **위임** — 잠정, ② 판정에서 바뀐다.
 * - 제2절 = 블록을 그룹 순서대로, 블록마다 제1조부터. 블록 머리 = 「그룹 제목 표시」 옵션(끔 「1.」 · 켬 「Ⅰ-1.」).
 */
import { describe, expect, it } from "vitest";

import { formatCoordinate } from "../coordinate";
import type { ArticleNode, DocumentNode } from "../document/nodes";
import { titleNodes } from "../document/title";
import { entered, type Id } from "../types";
import { assemble, assembleGeneral, assembleSpecial, bookletForm } from "./booklet";
import { previewArticle } from "./articlePreview";
import { alphaGeneralDocument, alphaPlusFixture, deathCoverage } from "./fixture";
import type { AssemblyInput, Booklet, RenderedBlock, RenderedDoc, RenderedInline } from "./types";

const assembleInput = (input: AssemblyInput) => assemble(input, input);

function lines(doc: RenderedDoc): string[] {
  const inline = (list: RenderedInline[]) => list.map((n) => (n.kind === "text" ? n.text : n.kind === "error" ? `⟦${n.issue.kind}⟧` : n.label)).join("");
  const out: string[] = [];
  const article = (a: RenderedDoc["children"][number]) => {
    if (a.kind !== "article") return;
    out.push(`${a.label}(${a.title})`);
    for (const p of a.children) if (p.kind === "paragraph") out.push(`  ${p.label} ${inline(p.children)}`.trimEnd());
  };
  for (const c of doc.children) {
    if (c.kind === "section") {
      out.push(`${c.label} ${c.title}`);
      c.children.forEach(article);
    } else article(c);
  }
  return out;
}

const blocksOf = (b: Booklet): RenderedBlock[] => (b.blocks ?? []).flatMap((g) => g.blocks);
const kinds = (b: Booklet) => b.issues.map((i) => i.kind);

/** 주계약 · 기본계약 둘 — 상해사망(기본계약 문면) · 일반상해사망(담보약관). 특약은 일반상해사망 추가. */
function mainTwoBase(extra: Partial<AssemblyInput["product"]> = {}): AssemblyInput {
  const input = alphaPlusFixture();
  return { ...input, product: { ...input.product, baseContractIds: ["pc-base", "pc-basic"], ...extra } };
}

const STANDALONE = ["feature.contract_kind", entered("V02")] as const;

/** 독립특약 — 기본계약 없음, 탑재 상품담보 전부가 블록. */
function standalone(coverageIds: Id[] | undefined = undefined, extra: Partial<AssemblyInput["product"]> = {}): AssemblyInput {
  const input = alphaPlusFixture();
  const values = new Map(input.product.values);
  values.set(...STANDALONE);
  const coverages = coverageIds ? input.coverages.filter((c) => coverageIds.includes(c.snapshot.id)) : input.coverages;
  return { ...input, coverages, product: { ...input.product, name: "알파 독립특약", values, baseContractIds: [], ...extra } };
}

describe("형태 판별 — 계약형태 + 블록 수 (ADR-0021 결정 1 · ADR-0082 결정 2)", () => {
  it("주계약 기본계약 1개 = 대치 형태 — form single · 블록 없음 · 제목은 템플릿 제목", () => {
    const b = assembleInput(alphaPlusFixture());
    expect(b.form).toBe("single");
    expect(b.title).toBe("알파Plus 보통약관");
    expect(b.blocks).toBeUndefined();
  });

  it("주계약 기본계약 0개 = noBaseContract · 대치 형태로 끝까지 조립", () => {
    const input = alphaPlusFixture();
    const b = assembleInput({ ...input, product: { ...input.product, baseContractIds: [] } });
    expect(b.form).toBe("single");
    expect(kinds(b)).toEqual(["noBaseContract"]);
  });

  it("주계약 기본계약 2개 = 절 형태 — 수 오류 없음 · 제목은 템플릿 제목 · 블록 = 기본계약 상품담보(그룹 순 → 담보코드 순) · 블록 제목 = 상품담보명", () => {
    const b = assembleInput(mainTwoBase());
    expect(b.form).toBe("sectioned");
    expect(b.title).toBe("알파Plus 보통약관");
    expect(kinds(b)).not.toContain("unsupported");
    expect(blocksOf(b).map((x) => [x.label, x.title, x.productCoverageId])).toEqual([
      ["1.", "상해사망(기본계약)", "pc-base"],
      ["2.", "일반상해사망", "pc-basic"],
    ]);
    // 특약은 그대로 특약 그룹에 — 기본계약들은 특약에서 빠진다
    expect(b.specials.flatMap((g) => g.docs.map((d) => d.ownerId))).toEqual(["pc-addon"]);
    expect(b.baseContracts.map((r) => r.productCoverageId)).toEqual(["pc-base", "pc-basic"]);
  });

  it("독립특약 = 절 형태 — 제목은 상품명 · 탑재 상품담보 전부가 블록 · 블록 제목 「{상품담보명} 특별약관」 · 특약 그룹은 비었다", () => {
    const b = assembleInput(standalone());
    expect(b.form).toBe("sectioned");
    expect(b.title).toBe("알파 독립특약");
    expect(blocksOf(b).map((x) => [x.label, x.title])).toEqual([
      ["1.", "상해사망(기본계약) 특별약관"],
      ["2.", "일반상해사망 특별약관"],
      ["3.", "일반상해사망 추가 특별약관"],
    ]);
    expect(b.specials).toEqual([]);
    expect(kinds(b)).not.toContain("noBaseContract");
  });

  it("독립특약에 기본계약 지정 — unsupported 를 남기고 절 형태로 끝까지 (기본계약도 블록)", () => {
    const b = assembleInput(standalone(undefined, { baseContractIds: ["pc-base"] }));
    expect(kinds(b)).toContain("unsupported");
    expect(b.form).toBe("sectioned");
    expect(blocksOf(b).map((x) => x.productCoverageId)).toEqual(["pc-base", "pc-basic", "pc-addon"]);
  });

  it("독립특약에 블록 0 — noBlock 오류(상품 › 상품담보 탭) · 제1절만 찍힌다", () => {
    const b = assembleInput(standalone([]));
    expect(b.form).toBe("sectioned");
    expect(b.issues.find((i) => i.kind === "noBlock")).toMatchObject({ severity: "error", at: { document: "product", ownerId: "prod-alpha", refPath: "baseContract" } });
    expect(blocksOf(b)).toEqual([]);
    expect(b.general).toBeDefined();
    expect(b.complete).toBe(false);
  });

  it("블록 수는 조건 해소 · 블록 빈 조 빼기 뒤에 센다 — 조건으로 조가 다 빠진 담보는 블록이 아니다", () => {
    const input = standalone(["pc-basic"]);
    // 담보약관의 모든 조를 거짓 조건 안에 넣는다 → 블록 빈 조 빼기 뒤 0 조
    const doc: DocumentNode = { id: "s-doc-empty", kind: "document", title: "빈 담보", children: [{ id: "s-cond-none", kind: "condBlock", branches: [{ id: "s-cond-none-if", when: "D0001 = true", children: [{ id: "s-art-x", kind: "article", title: titleNodes("보험금의 지급사유", "s-art-x"), linkedArticleId: "g-art-pay", children: [{ id: "s-par-x", kind: "paragraph", children: [{ id: "s-txt-x", kind: "text", text: "글" }] }] }] }] }] };
    const b = assembleInput({ ...input, specialDocuments: new Map([...input.specialDocuments, ["cov-death", doc]]) });
    expect(blocksOf(b)).toEqual([]);
    expect(kinds(b)).toContain("noBlock");
    // 연결이 조건으로 빠졌으니 제1절의 그 조는 마스터 그대로다(위임 아님)
    expect(lines(b.general!).join("\n")).not.toContain("제2절 보장조항에서 정합니다");
  });

  it("저장본에 form 이 없으면 single 로 읽는다 — 옛 산출본 호환", () => {
    expect(bookletForm({})).toBe("single");
    expect(bookletForm({ form: "sectioned" })).toBe("sectioned");
  });
});

describe("제1절 일반조항 — 연결 조는 위임 (①잠정: ADR-0082 결정 7 의 블록 하나 규칙을 전부에 — ② 판정에서 바뀜)", () => {
  const b = assembleInput(mainTwoBase());
  const first = lines(b.general!);

  it("블록이 조연결한 템플릿 조 = 위임 문구 한 항 「제N조(조 제목)는 제2절 보장조항에서 정합니다.」 — N 은 그 조 자신의 제1절 번호 · 연결 없는 조는 마스터", () => {
    expect(first).toEqual([
      "제1조(용어의 정의)",
      "   이 계약에서 사용하는 용어의 정의는 다음과 같습니다.",
      "제2조(보험금의 지급사유)",
      "   제2조(보험금의 지급사유)는 제2절 보장조항에서 정합니다.",
      "제3조(보험금 지급에 관한 세부규정)",
      "   제3조(보험금 지급에 관한 세부규정)는 제2절 보장조항에서 정합니다.",
      "제4조(보험금을 지급하지 않는 사유)",
      "   제4조(보험금을 지급하지 않는 사유)는 제2절 보장조항에서 정합니다.",
      "제5조(장해의 분류)",
      "   장해의 분류는 【별표1(장해분류표)】 에 따릅니다.",
      "제6조(해약환급금)",
      "   제6조(해약환급금)는 제2절 보장조항에서 정합니다.",
    ]);
  });

  it("위임 문구 항의 열쇠는 P · PZ 밖 예약 열쇠 — 위임된 조의 항을 가리키는 참조는 articleGone, 조 단위 참조는 유효 (ADR-0082 결정 8)", () => {
    const art = b.general!.children.find((c) => c.id === "g-art-refund");
    expect(art?.kind === "article" && art.children.map((p) => p.id)).toEqual(["g-art-refund::delegation"]);
    // 블록(일반상해사망)의 감액 조가 템플릿 해약환급금 조의 ① · ② 를 가리킨다 — 위임됐으니 사라짐
    const gone = b.issues.filter((i) => i.kind === "articleGone" && i.at.ownerId === "pc-basic");
    expect(gone.map((i) => i.at.refPath)).toEqual(["g-art-refund#P0100", "g-art-refund#P0200"]);
  });

  it("위임된 조의 마스터 본문은 실행 경로가 아니다 — 그 안의 미입력 슬롯이 오류를 내지 않는다", () => {
    const input = mainTwoBase({ values: new Map() }); // D0002(product_basic.notice) 미입력
    const flat = alphaGeneralDocument();
    const withSlot = flat.children.map((a) => (a.kind === "article" && a.id === "g-art-refund" ? ({ ...a, children: [{ id: "g-par-r", kind: "paragraph", children: [{ id: "g-slot-r", kind: "slot", ref: "D0002" }] }] } as ArticleNode) : a));
    const r = assembleInput({ ...input, generalDocuments: new Map([["g-doc", { ...flat, children: withSlot }]]) });
    expect(r.issues.filter((i) => i.kind === "notEntered")).toEqual([]);
  });

  it("제1절은 담보 값을 읽지 않는다 — 템플릿 조의 담보 레벨 참조는 generalReadsCoverage(「첫 기본계약」 문맥 없음 · 기능/조립산출 §3.2)", () => {
    const input = mainTwoBase();
    const flat = alphaGeneralDocument();
    const def = flat.children[0] as ArticleNode;
    const withCoverageSlot: ArticleNode = { ...def, children: [{ id: "g-par-def", kind: "paragraph", children: [{ id: "g-slot-cov", kind: "slot", ref: "D0001" }] }] };
    const r = assembleInput({ ...input, generalDocuments: new Map([["g-doc", { ...flat, children: [withCoverageSlot, ...flat.children.slice(1)] }]]) });
    const issue = r.issues.find((i) => i.kind === "generalReadsCoverage");
    expect(issue).toMatchObject({ at: { document: "general", refPath: "D0001", section: { kind: "general", label: "제1절" } } });
    expect(kinds(r)).not.toContain("noBaseContract");
  });
});

describe("제2절 보장조항 — 블록마다 제1조부터 · 블록 조는 그대로(특약 조 판정을 타지 않는다)", () => {
  const b = assembleInput(mainTwoBase());
  const [base, basic] = blocksOf(b);

  it("블록 본문 = 담보 문면 통째 + 준용규정 최소형 — 조 번호는 블록마다 제1조부터", () => {
    expect(lines(base.doc)).toEqual([
      "제1조(보험금의 지급사유)",
      "   피보험자가 보험기간 중 상해로 사망한 경우 보험금을 지급합니다.",
      "제2조(보험금 지급에 관한 세부규정)",
      "   보험금 지급에 관한 세부사항은 산출방법서에 따릅니다.",
      "제3조(준용규정)",
      "   이 특별약관에서 정하지 않은 사항은 보통약관을 따릅니다.",
    ]);
    expect(lines(basic.doc)[0]).toBe("제1조(보험금의 지급사유)");
    expect(basic.doc.title).toBe("일반상해사망");
    // 마스터와 같은 글의 면책 조도 생략되지 않는다 — 블록 조는 위임이라 블록마다 자기 조
    expect(lines(basic.doc)).toContain("제2조(보험금을 지급하지 않는 사유)");
  });

  it("블록 문맥의 작성위치 = 블록 — 조건식이 builtin.output = 'block' 을 읽는다 (ADR-0089)", () => {
    const input = mainTwoBase();
    const doc = input.specialDocuments.get("cov-base-death")!;
    const marked: DocumentNode = {
      ...doc,
      children: [...doc.children, { id: "b-cond-out", kind: "condBlock", branches: [{ id: "b-cond-out-if", when: "builtin.output = 'block'", children: [{ id: "b-art-out", kind: "article", title: titleNodes("블록 전용", "b-art-out"), children: [{ id: "b-par-out", kind: "paragraph", children: [{ id: "b-txt-out", kind: "text", text: "블록에서만" }] }] }] }] }],
    };
    const r = assembleInput({ ...input, specialDocuments: new Map([...input.specialDocuments, ["cov-base-death", marked]]) });
    expect(lines(blocksOf(r)[0].doc)).toContain("제3조(블록 전용)");
  });

  it("주계약 기본계약 2+ 의 특약은 지금처럼 판정한다 — 실제로 찍힌 제1절(위임 문구)과 비교되어 위임된 조에 연결한 특약 조는 통째 (현 상태 고정 — 판정 대상 정리는 ④)", () => {
    expect(b.omitted.map((o) => [o.productCoverageId, o.linkedArticleId, o.disposition])).toEqual([
      ["pc-addon", "g-art-pay", "full"],
      ["pc-addon", "g-art-exempt", "full"],
      ["pc-addon", "g-art-refund", "full"],
    ]);
  });

  it("별표는 제1절 → 제2절 블록 → 특약 등장 순", () => {
    expect(b.appendices.map((a) => [a.number, a.code])).toEqual([[1, "APX_DISABILITY"]]);
  });
});

describe("블록 번호 머리 · 그룹 제목 표시 (ADR-0090 결정 7 · 8)", () => {
  const groups = { groups: [{ kind: "user" as const, id: "ug-death", name: "사망 관련 보장" }, { kind: "category" as const, code: "V01" }], memberships: [{ coverageId: "cov-death", groupId: "ug-death" }] };

  it("끔(기본) — 그룹 제목 없이 그룹 순서대로 「1.」 「2.」 「3.」", () => {
    const b = assembleInput(standalone(undefined, { groups }));
    expect(b.blocks!.map((g) => [g.label, g.title])).toEqual([
      [undefined, undefined],
      [undefined, undefined],
    ]);
    expect(blocksOf(b).map((x) => [x.label, x.productCoverageId])).toEqual([
      ["1.", "pc-basic"],
      ["2.", "pc-addon"],
      ["3.", "pc-base"],
    ]);
  });

  it("켬 — 「Ⅰ. {그룹 제목}」 아래 「Ⅰ-1.」 · 「Ⅰ-2.」, 다음 그룹 「Ⅱ.」 아래 「Ⅱ-1.」 · 제목 = 사용자 그룹 이름 / 담보분류 「그룹 제목」", () => {
    const input = standalone(undefined, { groups });
    const values = new Map(input.product.values);
    values.set("booklet.group_titles", entered(true));
    const b = assembleInput({ ...input, product: { ...input.product, values } });
    expect(b.blocks!.map((g) => [g.label, g.title, g.blocks.map((x) => x.label)])).toEqual([
      ["Ⅰ.", "사망 관련 보장", ["Ⅰ-1.", "Ⅰ-2."]],
      ["Ⅱ.", "상해 관련 특별약관", ["Ⅱ-1."]],
    ]);
  });

  it("켬 · 담보분류의 「그룹 제목」이 비면 notEntered + 제목 자리 오류 마커 — 끄면 제목을 찍지 않으니 오류도 없다", () => {
    const input = standalone();
    const enums = input.enums.map((e) => (e.code === "E0009" ? { ...e, values: e.values.map((v) => ({ ...v, fields: {} })) } : e));
    const off = assembleInput({ ...input, enums });
    expect(off.issues.filter((i) => i.message.includes("그룹 제목"))).toEqual([]);
    const values = new Map(input.product.values);
    values.set("booklet.group_titles", entered(true));
    const on = assembleInput({ ...input, enums, product: { ...input.product, values } });
    expect(on.blocks![0].titleError?.issue.kind).toBe("notEntered");
  });
});

describe("오류 좌표 — Coordinate.section 블록 이름공간 (기능/조립산출 §3.4)", () => {
  it("블록 안 오류는 「제2절 {블록 머리}」 · 제1절 오류는 「제1절」 — 조 번호가 블록마다 재시작해도 자리가 갈린다", () => {
    const b = assembleInput(mainTwoBase());
    const gone = b.issues.find((i) => i.kind === "articleGone" && i.at.ownerId === "pc-basic")!;
    expect(gone.at.section).toEqual({ kind: "benefit", label: "제2절 2." });
    expect(formatCoordinate(gone.at)).toContain("제2절 2. › 제3조(보험금의 감액지급)");
  });

  it("그룹 제목 표시면 블록 머리도 「제2절 Ⅰ-1.」", () => {
    const input = mainTwoBase();
    const values = new Map(input.product.values);
    values.set("booklet.group_titles", entered(true));
    const b = assembleInput({ ...input, product: { ...input.product, values } });
    const gone = b.issues.find((i) => i.kind === "articleGone" && i.at.ownerId === "pc-basic")!;
    expect(gone.at.section?.label).toBe("제2절 Ⅰ-2.");
  });
});

describe("미리보기 진입점 — 보통약관 · 상품담보 미리보기도 절 형태를 안다", () => {
  it("assembleGeneral = 제1절(위임 문구가 든)", () => {
    const input = mainTwoBase();
    const g = assembleGeneral(input, input)!;
    expect(lines(g.doc)[3]).toBe("   제2조(보험금의 지급사유)는 제2절 보장조항에서 정합니다.");
  });

  it("assembleSpecial — 블록 상품담보면 그 블록(제목 · 블록 문맥 · 특약 조 판정 없음)과 상품 전체의 제1절", () => {
    const input = standalone();
    const r = assembleSpecial(input, input, "pc-basic");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.doc.title).toBe("일반상해사망 특별약관");
    expect(r.value.omitted).toEqual([]);
    expect(lines(r.value.general!).join("\n")).toContain("제2절 보장조항에서 정합니다");
  });

  it("assembleSpecial — 주계약 2+ 의 특약은 지금처럼 특약 조립 (제1절과 비교)", () => {
    const input = mainTwoBase();
    const r = assembleSpecial(input, input, "pc-addon");
    expect(r.ok && r.value.omitted.map((o) => o.disposition)).toEqual(["full", "full", "full"]);
  });

  it("문면 저작 미리보기(previewArticle) — 주계약 2+ 의 기본계약은 블록이라 조 하나를 보인다(대치 형태의 기본계약만 「특약으로 찍히지 않는다」)", () => {
    const input = mainTwoBase();
    const doc = input.specialDocuments.get("cov-base-death")!;
    const r = previewArticle(input, input, { document: "special", productCoverageId: "pc-base", tree: doc }, "b-art-pay");
    expect(r.kind === "shown" && r.article.label).toBe("제1조");
    const single = alphaPlusFixture();
    expect(previewArticle(single, single, { document: "special", productCoverageId: "pc-base", tree: doc }, "b-art-pay").kind).toBe("unavailable");
  });

  it("대치 형태 상품의 미리보기는 그대로 — 특약 하나 (회귀)", () => {
    const input = alphaPlusFixture();
    const coverages = [...input.coverages, deathCoverage("pc-extra", "일반상해사망 추가2", [{ kindCode: "A0001", valueCode: "V02" }])];
    const full: AssemblyInput = { ...input, coverages };
    const r = assembleSpecial(full, full, "pc-extra");
    expect(r.ok && r.value.doc.title).toBe("일반상해사망 추가2 특별약관");
  });
});
