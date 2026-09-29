import { describe, expect, it } from "vitest";

import { addBenefit, addSubCoverage, createCoverageTree } from "../coverage/tree";
import type { Coverage } from "../coverage/types";
import type { TypeResolver } from "../expression";
import type { AttachLevel } from "../types";
import { nodeBuilders, sequentialIds } from "./builders";
import { validateExpressions } from "./expressions";
import type { DocumentNode } from "./nodes";

function unwrapTree(r: { ok: true; value: Coverage } | { ok: false; rejection: unknown }): Coverage {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

/** 수술비: 1종수술{수술보험금} · 2종수술{수술보험금, 입원보험금} — evalContext.test.ts 의 surgery() 와 같은 모양. */
function surgeryTree(): { tree: Coverage; b11: string } {
  let seq = 0;
  const newId = () => `id-${++seq}`;
  let tree = unwrapTree(createCoverageTree({ name: "수술비", subCoverageName: "1종수술", benefitName: "수술보험금" }, newId, []));
  tree = unwrapTree(addSubCoverage(tree, { name: "2종수술", benefitName: "수술보험금" }, newId));
  tree = unwrapTree(addBenefit(tree, tree.subCoverages[1].id, "입원보험금", newId));
  const b11 = tree.subCoverages[0].benefits[0].id;
  return { tree, b11 };
}

/** 조건 가지 하나만 있는 문서 — 노드 한정자 검사용 최소 픽스처. */
function documentWithCondition(when: string): DocumentNode {
  const b = nodeBuilders(sequentialIds("n"));
  return b.document("d", [b.condBlock([b.branch(when, [b.article("x", [])])])]);
}

/**
 * 관통 1 픽스처의 타입 조회 — 구분자는 전부 식이라 타입이 **추론된 결과 타입**이다 (ADR-0037).
 * D0001 boolean · D0002 enum · D0003 boolean(집계) · D0004 string(리터럴) · D0005 boolean(집계).
 */
const resolve: TypeResolver = (ref) => {
  if (ref.kind === "attr") return ref.code === "renew_type" ? { kind: "attribute", validValues: ["renew", "fixed"] } : undefined;
  if (ref.kind === "builtin") return { kind: "string" };
  if (ref.kind === "master" || ref.kind === "param") return undefined; // 문면은 마스터를 직접 못 본다
  const kinds: Record<string, ReturnType<TypeResolver>> = {
    D0001: { kind: "boolean" },
    D0002: { kind: "enum", enumCode: "E0001" },
    D0003: { kind: "boolean" },
    D0004: { kind: "string" },
    D0005: { kind: "boolean" },
  };
  return kinds[ref.code];
};

describe("문면작성 S2 경계 — 조건식 자리는 문법 검사 + boolean 검사 (ADR-0013 언어 밖 규칙)", () => {
  it("올바른 조건식과 string·enum 슬롯은 문제 없음", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const doc = b.document("d", [
      b.condBlock([b.branch("D0001 = true and D0003", [b.article("x", [b.paragraph([b.slot("D0004"), b.slot("D0002")])])])]),
      b.article("y", [b.paragraph([b.inlineCond([b.inlineBranch("attr.renew_type = 'renew'", [b.text("a")]), b.inlineBranch(undefined, [b.text("b")])])])]),
    ]);
    expect(validateExpressions(doc, resolve)).toEqual([]);
  });

  it("문면 조건식·슬롯은 인자(arg.X)를 읽을 수 없다 — 인자는 함수조항 본문 문맥에서만 (경계, 최종 결정 2)", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const doc = b.document("d", [
      b.condBlock([b.branch("arg.갱신형 = true", [b.article("x", [])])]),
      b.article("y", [b.paragraph([b.slot("arg.담보명")])]),
    ]);
    const issues = validateExpressions(doc, resolve);
    expect(issues.map((i) => [i.kind, i.at.refPath])).toEqual([
      ["structure", "arg.갱신형"],
      ["structure", "arg.담보명"],
    ]);
  });

  it("문면 조건식·슬롯이 마스터 필드를 직접 부르면 거부한다 (ADR-0037 — 문면은 구분자만 본다)", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const doc = b.document("d", [
      b.condBlock([b.branch("coverage_basic.claim_name ≠ ''", [b.article("x", [])])]),
      b.article("y", [b.paragraph([b.slot("waiver.applies")])]),
    ]);
    const issues = validateExpressions(doc, resolve);
    expect(issues.map((i) => [i.kind, i.at.refPath])).toEqual([
      ["typeMismatch", "coverage_basic.claim_name"],
      ["typeMismatch", "waiver.applies"],
    ]);
    expect(issues[0].message).toContain("구분자");
  });

  it("값 슬롯은 string·enum 만 허용하고 number·boolean·date·list<enum> 은 거부한다", () => {
    const typed: TypeResolver = (ref) => {
      if (ref.kind !== "discriminator") return undefined;
      const kinds = {
        text: { kind: "string" as const },
        choice: { kind: "enum" as const, enumCode: "E1" },
        amount: { kind: "number" as const },
        enabled: { kind: "boolean" as const },
        day: { kind: "date" as const },
        choices: { kind: "list<enum>" as const, enumCode: "E1" },
      };
      return kinds[ref.code as keyof typeof kinds];
    };
    const b = nodeBuilders(sequentialIds("n"));
    const doc = b.document("d", [
      b.article("a", [b.paragraph([b.slot("text"), b.slot("choice"), b.slot("amount"), b.slot("enabled"), b.slot("day"), b.slot("choices")])]),
    ]);

    const issues = validateExpressions(doc, typed);
    expect(issues.map((issue) => [issue.kind, issue.at.refPath])).toEqual([
      ["typeMismatch", "amount"],
      ["typeMismatch", "enabled"],
      ["typeMismatch", "day"],
      ["typeMismatch", "choices"],
    ]);
  });

  it("파싱 실패 → syntax · boolean 아님 → typeMismatch · 없는 참조 → brokenRef, 전부 노드 경로 좌표", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const doc = b.document("d", [
      b.condBlock([b.branch("D0001 = = true", [b.article("x", [])])]), // article n1 · branch n2 · cond n3
      b.article("y", [b.paragraph([b.inlineCond([b.inlineBranch("D0004", [b.text("a")])])])]), // text n4 · branch n5 · inlineCond n6 · paragraph n7 · article n8
      b.condBlock([b.branch("D0099 = true", [b.article("z", [])])]), // article n9 · branch n10 · cond n11 — document n12
    ]);
    const issues = validateExpressions(doc, resolve, { document: "special" });
    expect(issues.map((i) => [i.kind, i.at.nodePath, i.at.document])).toEqual([
      ["syntax", ["n12", "n3", "n2"], "special"],
      ["typeMismatch", ["n12", "n8", "n7", "n6", "n5"], "special"],
      ["brokenRef", ["n12", "n11", "n10"], "special"],
    ]);
    expect(issues[1].at.articleId).toBe("n8");
  });

  it("슬롯 참조는 구분자 경로 하나여야 한다 — 식·담보속성·마스터 직접 참조·문법 오류는 거부", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const doc = b.document("d", [
      b.article("x", [b.paragraph([b.slot("D0001 = true"), b.slot("attr.renew_type"), b.slot("coverage_basic.claim_name"), b.slot("D0001 =")])]),
    ]);
    const issues = validateExpressions(doc, resolve);
    expect(issues.map((i) => [i.kind, i.at.nodePath?.at(-1)])).toEqual([
      ["typeMismatch", "n1"],
      ["typeMismatch", "n2"],
      ["typeMismatch", "n3"], // 문면은 입력 항목을 직접 부를 수 없다 (ADR-0037)
      ["syntax", "n4"],
    ]);
  });
});

describe("노드 한정자 검사 (ADR-0066 §3)", () => {
  const { tree, b11 } = surgeryTree();
  const s1 = tree.subCoverages[0].id;
  const levelOf = (code: string): AttachLevel | undefined => (code === "D0007" ? "subCoverage" : code === "D0002" ? "benefit" : undefined);
  const resolveBool: TypeResolver = (ref) => (ref.kind === "discriminator" ? { kind: "boolean" } : undefined);
  const docWith = (when: string) => documentWithCondition(when);

  it("문맥 담보가 없는 문서(보통약관)에서는 오류", () => {
    const issues = validateExpressions(docWith(`D0007@${s1} = true`), resolveBool, {}, {});
    expect(issues).toMatchObject([{ kind: "brokenRef", message: expect.stringContaining("담보 약관 문서에서만") }]);
  });
  it("트리에 없는 노드는 끊어진 참조", () => {
    const issues = validateExpressions(docWith("D0007@nope = true"), resolveBool, {}, { coverage: tree, levelOf });
    expect(issues).toMatchObject([{ kind: "brokenRef", at: { refPath: "D0007@nope" } }]);
  });
  it("노드 레벨 ≠ 구분자 레벨이면 typeMismatch", () => {
    const issues = validateExpressions(docWith(`D0007@${b11} = true`), resolveBool, {}, { coverage: tree, levelOf });
    expect(issues).toMatchObject([{ kind: "typeMismatch", message: expect.stringContaining("세부보장") }]);
  });
  it("맞으면 통과", () => {
    expect(validateExpressions(docWith(`D0007@${s1} = true`), resolveBool, {}, { coverage: tree, levelOf })).toEqual([]);
  });
});
