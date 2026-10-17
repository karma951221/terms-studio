/**
 * 작성위치 · 범위 낱말 — 같은 보장은 담보 하나 · 담보약관 문면 한 벌 (ADR-0089 결정 2 · 3 · 4 · 5 · 7 · 기능/조립산출 §3.5).
 *
 * 한 담보(cov-base-death)의 문면 한 벌이 기본계약(대치)과 특약(속성 조합이 다른 상품담보) 두 자리에 실린다.
 */
import { describe, expect, it } from "vitest";

import type { Clause } from "../clause/types";
import type { DocumentNode } from "../document/nodes";
import { titleNodes } from "../document/title";
import { assemble } from "./booklet";
import { alphaGeneralDocument, alphaPlusFixture, coverageEntry } from "./fixture";
import type { AssemblyInput, Booklet, RenderedArticle, RenderedDoc } from "./types";

const t = (id: string, text: string) => ({ id, kind: "text" as const, text });

/** 준용규정 함수조항 — 작성위치 = 대치이면 빈 출력 (ADR-0089 결정 5). */
const applicationClause: Clause = {
  code: "C0090",
  label: "준용규정",
  mode: "block",
  body: [{ id: "ap-c", kind: "condBlock", branches: [{ id: "ap-c-if", when: "builtin.output ≠ 'replace'", children: [{ id: "ap-p", kind: "paragraph", children: [t("ap-t", "이 특별약관에서 정하지 않은 사항은 보통약관을 따릅니다.")] }] }] }],
  options: [],
  required: { discriminators: [], attributes: [] },
};

/** 담보약관 문면 한 벌 — 범위 낱말 슬롯 · 작성위치 조건(조 자리 · 문장 안) · 준용규정 함수조항 · 조건 없는 특약 전용 조. */
function unifiedDocument(): DocumentNode {
  return {
    id: "b-doc-death",
    kind: "document",
    title: "상해사망 문면",
    children: [
      {
        id: "b-art-pay",
        kind: "article",
        title: titleNodes("보험금의 지급사유", "b-art-pay"),
        linkedArticleId: "g-art-pay",
        children: [
          {
            id: "b-par-pay",
            kind: "paragraph",
            children: [
              t("b-t1", "회사는 "),
              { id: "b-scope", kind: "slot", ref: "builtin.output.scope" },
              t("b-t2", " 보험기간 중 사망한 경우 보험금을 지급합니다."),
              { id: "b-inl", kind: "inlineCond", branches: [{ id: "b-inl-if", when: "builtin.output = 'replace'", children: [t("b-t3", " 다만, 기본계약 단서를 따릅니다.")] }] },
            ],
          },
          {
            id: "b-par-2",
            kind: "paragraph",
            children: [{ id: "b-scope2", kind: "slot", ref: "builtin.output.scope" }, t("b-t4", " 보험가입금액을 지급합니다.")],
          },
          {
            id: "b-par-3",
            kind: "paragraph",
            children: [t("b-t5", "보험금 "), { id: "b-scope3", kind: "slot", ref: "builtin.output.scope" }, { id: "b-pt", kind: "particle", preset: "eul-reul" }, t("b-t6", " 지급합니다.")],
          },
        ],
      },
      { id: "b-art-app", kind: "article", title: titleNodes("준용규정", "b-art-app"), children: [{ id: "b-app", kind: "clauseBlockRef", clauseCode: "C0090", options: {} }] },
      {
        id: "b-cond-only",
        kind: "condBlock",
        branches: [{ id: "b-cond-only-if", when: "builtin.output = 'special'", children: [{ id: "b-art-only", kind: "article", title: titleNodes("특약 전용 조", "b-art-only"), children: [{ id: "b-par-only", kind: "paragraph", children: [t("b-t7", "특약에만 있는 조입니다.")] }] }] }],
      },
      { id: "b-art-lapse", kind: "article", title: titleNodes("특별약관의 소멸", "b-art-lapse"), children: [{ id: "b-par-lapse", kind: "paragraph", children: [t("b-t8", "소멸합니다.")] }] },
    ],
  };
}

function fixture(edit?: (input: AssemblyInput) => void): AssemblyInput {
  const input = alphaPlusFixture();
  input.specialDocuments.set("cov-base-death", unifiedDocument());
  input.clauses = [...input.clauses, applicationClause];
  // 같은 담보 · 다른 속성 조합 — 특약으로 실린다 (ADR-0089 결정 6 · ADR-0015)
  input.coverages = [
    ...input.coverages,
    coverageEntry({
      id: "pc-base-sp",
      name: "갱신형 상해사망",
      coverageId: "cov-base-death",
      coverageName: "상해사망(기본계약)",
      attributes: [{ kindCode: "A0001", valueCode: "2" }],
      subCoverages: [{ id: "pc-base-sp-sub", masterNodeId: "sub-base-death", name: "상해사망", benefits: [{ id: "pc-base-sp-ben", masterNodeId: "ben-base-death", name: "사망보험금" }] }],
      values: { "pc-base-sp": { "coverage_basic.renewal": true }, "pc-base-sp-ben": { "pay.exempt": false, "pay.rate": 100 } },
    }),
  ];
  edit?.(input);
  return input;
}

const run = (input: AssemblyInput): Booklet => {
  const { product, coverages, ...master } = input;
  return assemble(master, { product, coverages } as never);
};

function articles(doc: RenderedDoc | undefined): RenderedArticle[] {
  return (doc?.children ?? []).flatMap((c) => (c.kind === "article" ? [c] : c.kind === "section" ? c.children.filter((a): a is RenderedArticle => a.kind === "article") : []));
}

function texts(a: RenderedArticle | undefined): string[] {
  return (a?.children ?? []).flatMap((p) => (p.kind === "paragraph" ? [p.children.map((n) => (n.kind === "text" ? n.text : n.kind === "error" ? "〔오류〕" : n.label)).join("")] : []));
}

const special = (b: Booklet, id: string) => b.specials.flatMap((g) => g.docs).find((d) => d.ownerId === id);

describe("기본계약(대치) — 문면 한 벌이 대치 자리로 찍힌다", () => {
  const b = run(fixture());
  const pay = articles(b.general).find((a) => a.id === "g-art-pay");

  it("범위 낱말은 빈 글 — 앞뒤 공백 하나를 접는다 (문장 가운데 · 문장 머리)", () => {
    expect(texts(pay)[0]).toBe("회사는 보험기간 중 사망한 경우 보험금을 지급합니다. 다만, 기본계약 단서를 따릅니다.");
    expect(texts(pay)[1]).toBe("보험가입금액을 지급합니다.");
  });

  it("빈 범위 낱말 뒤 조사 칩은 그 앞 글자로 판정한다", () => {
    expect(texts(pay)[2]).toBe("보험금을 지급합니다.");
    expect(b.issues.filter((i) => i.kind === "particleUnresolved")).toEqual([]);
  });

  it("준용규정 함수조항은 빈 출력 — 빈 조가 먼저 빠져 조연결 경고가 서지 않는다 · 특약 전용 조(조 자리 IF)도 경고 없음", () => {
    const unlinked = b.issues.filter((i) => i.kind === "unlinkedBaseArticle");
    expect(unlinked.map((i) => i.at.articleTitle)).toEqual(["특별약관의 소멸"]);
    expect(articles(b.general).map((a) => a.title)).not.toContain("준용규정");
  });
});

describe("특약 — 같은 문면 한 벌이 특약 자리로 찍힌다", () => {
  const b = run(fixture());
  const doc = special(b, "pc-base-sp");

  it("범위 낱말은 「이 특별약관의」 · 대치 단서 없음 · 준용규정 · 특약 전용 조가 찍힌다", () => {
    const [pay, app, only] = articles(doc);
    expect(texts(pay)).toEqual(["회사는 이 특별약관의 보험기간 중 사망한 경우 보험금을 지급합니다.", "이 특별약관의 보험가입금액을 지급합니다.", "보험금 이 특별약관의를 지급합니다."]);
    expect(texts(app)).toEqual(["이 특별약관에서 정하지 않은 사항은 보통약관을 따릅니다."]);
    expect(only?.title).toBe("특약 전용 조");
  });
});

describe("보통약관 문맥에는 작성위치가 없다", () => {
  it("보통약관 템플릿의 작성위치 조건은 조립 structure 오류", () => {
    const b = run(
      fixture((input) => {
        const g = alphaGeneralDocument();
        g.children.push({ id: "g-cond", kind: "condBlock", branches: [{ id: "g-cond-if", when: "builtin.output = 'replace'", children: [{ id: "g-art-x", kind: "article", title: titleNodes("x", "g-art-x"), children: [] }] }] });
        input.generalDocuments.set("g-doc", g);
      }),
    );
    expect(b.issues.filter((i) => i.kind === "structure").map((i) => i.at.refPath)).toEqual(["builtin.output"]);
  });
});

describe("특약의 보통약관 참조가 대치된 조의 항을 가리키면 자리 별칭을 따른다 (ADR-0089 결정 7)", () => {
  /** 보통약관 지급사유 조를 마스터 항 셋(P0100 · P0200 · P0300)으로 — 기본계약 문면의 항 셋과 자리가 맞는다. */
  const withMasterParagraphs = (count: number) => (input: AssemblyInput) => {
    const g = alphaGeneralDocument();
    const pay = g.children.find((c) => c.id === "g-art-pay");
    if (pay?.kind === "article") pay.children = Array.from({ length: count }, (_, i) => ({ id: `g-par-pay-${i + 1}`, kind: "paragraph" as const, code: `P0${i + 1}00`, children: [t(`g-txt-pay-${i + 1}`, `마스터 ${i + 1}`)] }));
    input.generalDocuments.set("g-doc", g);
    const death = input.specialDocuments.get("cov-death")!;
    death.children.push({
      id: "s-art-refpay",
      kind: "article",
      title: titleNodes("참조", "s-art-refpay"),
      children: [{ id: "s-par-refpay", kind: "paragraph", children: [{ id: "s-ref-pay", kind: "articleRef", scope: "general", targets: [{ articleId: "g-art-pay", code: "P0200" }] }, t("s-txt-refpay", "에 따릅니다.")] }],
    });
  };

  it("항 구성이 같으면 대치된 기본계약 항으로 풀린다 (articleGone 아님)", () => {
    const b = run(fixture(withMasterParagraphs(3)));
    const ref = articles(special(b, "pc-basic")).find((a) => a.title === "참조");
    expect(texts(ref)).toEqual(["보통약관 제2조(보험금의 지급사유) 제2항에 따릅니다."]);
    expect(b.issues.filter((i) => i.kind === "articleGone")).toEqual([]);
  });

  it("마스터와 항 수가 다르면 오류 그대로 — 템플릿 ↔ 담보 불일치의 신호", () => {
    const b = run(fixture(withMasterParagraphs(4)));
    expect(b.issues.filter((i) => i.kind === "articleGone").map((i) => [i.at.ownerId, i.at.refPath])).toEqual([
      ["pc-basic", "g-art-pay#P0200"],
      ["pc-addon", "g-art-pay#P0200"],
    ]);
  });
});
