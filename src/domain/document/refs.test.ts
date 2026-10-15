import { describe, expect, it } from "vitest";

import { nodeBuilders, sequentialIds } from "./builders";
import { surgeryFixture } from "./fixture";
import type { DocumentNode } from "./nodes";
import { codeChangeBreaks, collectRefs, requiredDiscriminators } from "./refs";

describe("기능/관계정보 §3 참조 그래프 — collectRefs 는 문서가 읽는 참조 전부를 좌표와 함께 뽑는다 (C1 역인덱스 재료)", () => {
  it("다중 조 참조를 대상 단위 간선으로 수집한다", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const doc = b.document("d", [
      b.article("a", [
        b.paragraph([
          {
            id: "refs",
            kind: "articleRef",
            targets: [{ articleId: "g1" }, { articleId: "g2" }],
            connector: "또는",
            scope: "general",
          },
        ]),
      ]),
    ]);

    expect(collectRefs(doc).filter((ref) => ref.kind === "article")).toEqual([
      expect.objectContaining({ kind: "article", articleId: "g1", scope: "general" }),
      expect.objectContaining({ kind: "article", articleId: "g2", scope: "general" }),
    ]);
  });

  it("구분자(식 안·슬롯) · 담보속성 · 함수조항 · 조(자기·보통약관) · 별표 · 조연결", () => {
    const { special } = surgeryFixture();
    const refs = collectRefs(special, { document: "special", ownerId: "cov-surgery" });
    const summary = refs.map((r) => {
      switch (r.kind) {
        case "discriminator":
          return ["discriminator", r.path, r.via, r.at.articleId];
        case "attribute":
          return ["attribute", r.path, r.at.articleId];
        case "builtin":
          return ["builtin", r.path, r.at.articleId];
        case "clause":
          return ["clause", r.clauseCode, r.mode, r.at.articleId];
        case "article":
          return ["article", r.articleId, r.scope, r.at.articleId];
        case "appendix":
          return ["appendix", r.appendixCode, r.at.articleId];
        case "link":
          return ["link", r.linkedArticleId, r.at.articleId];
      }
    });
    expect(summary).toMatchSnapshot();
    expect(refs.every((r) => r.at.document === "special" && r.at.ownerId === "cov-surgery")).toBe(true);
    const slotRef = refs.find((r) => r.kind === "discriminator" && r.via === "slot");
    expect(slotRef?.at.nodePath).toEqual(["s-doc", "s-art-pay", "s-par-pay-1", "s-slot-rate"]);
    expect(slotRef?.at.refPath).toBe("D0004");
  });

  it("문법이 깨진 식은 참조를 내지 않는다 (문법 오류는 validateExpressions 몫)", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const doc = b.document("d", [b.condBlock([b.branch("D0001 = = true", [b.article("x", [])])])]);
    expect(collectRefs(doc)).toEqual([]);
  });

  it("요구 구분자 = 문서 자체 참조 + 함수조항의 요구 구분자(게이트) — 중복 없이 등장 순", () => {
    const { special } = surgeryFixture();
    const own = requiredDiscriminators(special);
    expect(own).toEqual(["D0001", "D0004", "D0005", "D0003"]);
    const withGate = requiredDiscriminators(special, {
      clauseExists: () => true,
      requiredCodes: (code) => (code === "C001" ? ["D0009", "D0001"] : []),
      missingRequired: () => [],
      validateOptions: () => [],
    });
    expect(withGate).toEqual(["D0001", "D0004", "D0005", "D0003", "D0009"]);
  });
});

describe("조 참조 인자 연결도 문서의 조 참조로 센다 (ADR-0083 결정 4)", () => {
  it("함수조항 참조의 연결 대상이 article 참조로 · 좌표는 함수조항 참조 자리", () => {
    const doc = {
      kind: "document",
      id: "d",
      title: "특약",
      children: [
        { kind: "article", id: "a1", title: "지급사유", children: [] },
        { kind: "article", id: "a2", title: "소멸", children: [{ kind: "clauseBlockRef", id: "k", clauseCode: "C0009", options: {}, bindings: { "지급사유 조": { kind: "articleRef", targets: [{ articleId: "a1" }], scope: "self" } } }] },
      ],
    } as DocumentNode;
    const refs = collectRefs(doc).filter((r) => r.kind === "article");
    expect(refs).toEqual([expect.objectContaining({ kind: "article", articleId: "a1", scope: "self", at: expect.objectContaining({ nodePath: ["d", "a2", "k"], refPath: "a1" }) })]);
  });
});

describe("코드 수정 창의 영향 건수 — 이 문서 안에서 깨지는 참조 (ADR-0072 결정 6 · 수용 기준 5)", () => {
  /** 조 › IF [항 P0100] / 그 밖의 경우 [항 P0100], 항 P0200, 그 뒤 항이 P0100 둘 · P0200 하나를 가리킨다(조 참조 인자 연결 포함). */
  const build = () => {
    const b = nodeBuilders(sequentialIds("k"));
    const a = b.paragraph([b.text("가")]);
    const c = b.paragraph([b.text("나")]);
    const plain = b.paragraph([b.text("다")]);
    a.code = "P0100";
    c.code = "P0100";
    plain.code = "P0200";
    const article = b.article("조", [b.condBlock([b.branch("D0001", [a]), b.branch(undefined, [c])]), plain]);
    const ref1 = b.articleRef({ articleId: article.id, code: "P0100" }, "self");
    const ref2 = b.articleRef([{ articleId: article.id, code: "P0100" }, { articleId: article.id, code: "P0200" }], "self", "및");
    const clause = b.clauseBlock("C0001");
    clause.bindings = { 지급사유: { kind: "articleRef", targets: [{ articleId: article.id, code: "P0200" }], scope: "self" } };
    const refs = b.paragraph([ref1, ref2]);
    refs.code = "P0300";
    clause.code = "P0400";
    article.children.push(refs, clause);
    return { doc: b.document("d", [article]), a, plain };
  };

  it("짝이 남는 코드를 바꾸면 0건 — 짝으로 해소된다", () => {
    const { doc, a } = build();
    expect(codeChangeBreaks(doc, a.id, "P0900")).toBe(0);
  });

  it("짝 없는 코드를 바꾸면 그 코드를 가리키는 대상 수 — 조 참조 인자 연결도 센다, 같은 코드면 0", () => {
    const { doc, plain } = build();
    expect(codeChangeBreaks(doc, plain.id, "P0900")).toBe(2);
    expect(codeChangeBreaks(doc, plain.id, "P0200")).toBe(0);
  });
});
