import { describe, expect, it } from "vitest";

import type { Clause } from "../clause/types";
import { applyCommand } from "../document/commands";
import { validateTree, type DocumentNode } from "../document/nodes";
import type { Result } from "../types";
import { buildContexts } from "./context";
import { alphaPlusFixture } from "./fixture";
import { numberDocument, renderDocument } from "./render";
import { resolveDocument } from "./resolve";
import type { RenderedArticleRef, RenderedDoc, SubstitutedDoc } from "./types";

/**
 * 참조 대상 = 조 uuid + 조 안 P코드 (ADR-0072 결정 3 · 4 · 6 · 9 · 최종 결정 12) — 조립이 살아남은 트리에서 코드로 푼다.
 * 수용 기준 5(코드 변경) · 6(들여쓰기 — 명령이 아직 없어 「다른 항으로 옮기기」로 본다) · IF 가지 · 값별 분기 칸의 코드 공유.
 */

const at = { document: "general" as const, ownerId: "g" };
const text = (id: string, value: string) => ({ id, kind: "text" as const, text: value });

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

/** 조립 파이프(펼치기 → 번호 → 참조 해소) — 슬롯이 없는 문서라 치환은 건너뛴다. */
function assembleDoc(doc: DocumentNode, clauses: readonly Clause[] = []): { doc: RenderedDoc; issues: string[] } {
  const input = alphaPlusFixture();
  const ctx = buildContexts(input).general;
  const resolved = resolveDocument(doc, ctx, { clauses: new Map(clauses.map((c) => [c.code, c])), overrides: new Map(), coordinate: at });
  const rendered = renderDocument(numberDocument(resolved.doc as unknown as SubstitutedDoc), { document: "general", ownerId: "g", appendices: [] });
  return { doc: rendered.doc, issues: [...resolved.issues, ...rendered.issues].map((i) => `${i.kind}:${i.at.refPath ?? ""}`) };
}

/** 렌더 결과의 조 참조들 (문서 순). */
function refsOf(doc: RenderedDoc): RenderedArticleRef[] {
  const out: RenderedArticleRef[] = [];
  const visit = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const node = n as { kind?: string; children?: unknown[]; items?: unknown[]; subitems?: unknown[] };
    if (node.kind === "articleRef") out.push(n as RenderedArticleRef);
    for (const list of [node.children, node.items, node.subitems]) list?.forEach(visit);
  };
  visit(doc);
  return out;
}

/** 제1조 = 조건 블록(IF 가지 · ELSE 가지 — 같은 자리 항이 같은 코드 P0100) + 제P0200 항이 P0100 을 가리킨다. */
function branchDoc(when: string): DocumentNode {
  return {
    kind: "document",
    id: "d",
    title: "보통약관",
    children: [
      {
        kind: "article",
        id: "a1",
        title: "보험금의 지급사유",
        children: [
          {
            kind: "condBlock",
            id: "c",
            branches: [
              { id: "b-if", when, children: [{ kind: "paragraph", id: "p-if", code: "P0100", children: [text("t-if", "IF 가지의 1항")] }] },
              { id: "b-else", children: [{ kind: "paragraph", id: "p-else", code: "P0100", children: [text("t-else", "ELSE 가지의 1항")] }] },
            ],
          },
          { kind: "paragraph", id: "p2", code: "P0200", children: [text("t2", "앞 "), { id: "r", kind: "articleRef", targets: [{ articleId: "a1", code: "P0100" }], scope: "self" }] },
        ],
      },
    ],
  };
}

describe("IF 가지 둘에 같은 코드 항 — 어느 가지가 서든 참조가 산다 (ADR-0072 결정 4 · 9)", () => {
  it("저장 검사 — 배타 가지의 같은 코드는 중복이 아니고, 참조 대상(조 · P0100)이 있다", () => {
    expect(validateTree(branchDoc("1 = 1"))).toEqual([]);
  });

  it("IF 가 서면 IF 가지의 항으로, ELSE 가 서면 ELSE 가지의 항으로 — 둘 다 「제1항」", () => {
    for (const [when, node] of [["1 = 1", "p-if"], ["1 = 2", "p-else"]] as const) {
      const r = assembleDoc(branchDoc(when));
      expect(r.issues).toEqual([]);
      expect(refsOf(r.doc)).toEqual([expect.objectContaining({ label: "제1항", targets: [{ nodeId: node, label: "제1항" }] })]);
    }
  });
});

describe("수용 기준 5 — 코드 변경 (참조는 따라가지 않는다 · 결정 6)", () => {
  it("항 코드를 바꿔도 하위 호 코드와 그 호를 가리키는 참조는 그대로다", () => {
    const doc: DocumentNode = {
      kind: "document",
      id: "d",
      title: "보통약관",
      children: [
        {
          kind: "article",
          id: "a1",
          title: "보험금의 지급사유",
          children: [
            { kind: "paragraph", id: "p1", code: "P0100", children: [text("t1", "다음과 같다.")], items: [{ kind: "item", id: "i1", code: "P0300", children: [text("ti", "첫 호")] }] },
            { kind: "paragraph", id: "p2", code: "P0200", children: [{ id: "r", kind: "articleRef", targets: [{ articleId: "a1", code: "P0300" }], scope: "self" }] },
          ],
        },
      ],
    };
    const changed = unwrap(applyCommand(doc, { type: "setCode", nodeId: "p1", code: "P0700" }));
    const article = changed.children[0] as Extract<DocumentNode["children"][number], { kind: "article" }>;
    const p1 = article.children[0] as { code?: string; items?: { code?: string }[] };
    expect([p1.code, p1.items?.[0]?.code]).toEqual(["P0700", "P0300"]);
    expect(validateTree(changed)).toEqual([]);
    const r = assembleDoc(changed);
    expect(r.issues).toEqual([]);
    expect(refsOf(r.doc).map((x) => x.label)).toEqual(["제1항 제1호"]);
  });

  it("분기 짝이 남아 있으면 참조는 짝으로 풀리고, 그 짝이 서지 않으면 사라진 대상(articleGone)", () => {
    const moved = unwrap(applyCommand(branchDoc("1 = 1"), { type: "setCode", nodeId: "p-if", code: "P0500" }));
    expect(validateTree(moved)).toEqual([]); // ELSE 가지의 P0100 이 남아 대상은 있다
    expect(assembleDoc(moved).issues).toEqual(["articleGone:a1#P0100"]);
    const elseSide = unwrap(applyCommand(branchDoc("1 = 2"), { type: "setCode", nodeId: "p-if", code: "P0500" }));
    const r = assembleDoc(elseSide);
    expect(r.issues).toEqual([]);
    expect(refsOf(r.doc)[0]).toMatchObject({ label: "제1항", targets: [{ nodeId: "p-else" }] });
  });

  it("짝 없는 코드를 바꾸면 그 코드를 가리키던 참조는 깨진다 — 저장 검사 brokenRef", () => {
    const doc = branchDoc("1 = 1");
    const both = unwrap(applyCommand(unwrap(applyCommand(doc, { type: "setCode", nodeId: "p-if", code: "P0500" })), { type: "setCode", nodeId: "p-else", code: "P0600" }));
    expect(validateTree(both).map((i) => [i.kind, i.at.refPath])).toEqual([["brokenRef", "a1#P0100"]]);
  });
});

describe("수용 기준 6 — 다른 항으로 옮겨도(들여쓰기 대신) 코드 · 참조가 그대로, 번호는 새 자리로", () => {
  it("1항의 호를 2항으로 옮기면 참조가 「제2항 제1호」로 찍힌다", () => {
    const doc: DocumentNode = {
      kind: "document",
      id: "d",
      title: "보통약관",
      children: [
        {
          kind: "article",
          id: "a1",
          title: "보험금의 지급사유",
          children: [
            { kind: "paragraph", id: "p1", code: "P0100", children: [text("t1", "1항")], items: [{ kind: "item", id: "i1", code: "P0300", children: [text("ti", "호")] }] },
            { kind: "paragraph", id: "p2", code: "P0200", children: [text("t2", "2항")] },
          ],
        },
        { kind: "article", id: "a2", title: "다른 조", children: [{ kind: "paragraph", id: "q1", code: "P0100", children: [{ id: "r", kind: "articleRef", targets: [{ articleId: "a1", code: "P0300" }], scope: "self" }] }] },
      ],
    };
    expect(refsOf(assembleDoc(doc).doc).map((x) => x.label)).toEqual(["제1조(보험금의 지급사유) 제1항 제1호"]);
    const moved = unwrap(applyCommand(doc, { type: "move", nodeId: "i1", to: { parentId: "p2", slot: "items" } }));
    expect(validateTree(moved)).toEqual([]);
    const r = assembleDoc(moved);
    expect(r.issues).toEqual([]);
    expect(refsOf(r.doc).map((x) => x.label)).toEqual(["제1조(보험금의 지급사유) 제2항 제1호"]);
  });
});

describe("삭제 — 같은 코드의 분기 짝이 남으면 참조는 살아 있어 지울 수 있다 (D-P4-7 · ADR-0072 결정 9)", () => {
  it("IF 가지의 항은 지울 수 있고, 남은 ELSE 가지의 항까지 지우면 참조가 남아 거부한다", () => {
    const doc = branchDoc("1 = 1");
    const first = unwrap(applyCommand(doc, { type: "remove", nodeId: "p-if" }));
    const second = applyCommand(first, { type: "remove", nodeId: "p-else" });
    expect(second.ok).toBe(false);
    if (!second.ok && second.rejection.reason === "invalid") expect(second.rejection.issues.map((i) => [i.kind, i.at.refPath])).toEqual([["brokenRef", "a1#P0100"]]);
  });
});

describe("함수조항 — 값별 분기 칸의 같은 자리 항은 코드를 공유해 「이 함수조항」 참조가 어느 칸이든 산다 (ADR-0072 결정 4 · 최종 결정 12)", () => {
  const 사유항: Clause = {
    code: "C0400",
    label: "사유 항",
    mode: "block",
    body: [
      {
        id: "sw",
        kind: "switchBlock",
        on: "arg.사유",
        cases: [
          { id: "k1", values: ["V01"], children: [{ id: "c-cancer", kind: "paragraph", code: "P0100", children: [text("tc", "암의 정의")] }] },
          { id: "k2", values: ["V02", "V03", "V04"], children: [{ id: "c-other", kind: "paragraph", code: "P0100", children: [text("to", "장해의 정의")] }] },
        ],
      },
      { id: "c-ref", kind: "paragraph", code: "P0200", children: [{ id: "cr", kind: "articleRef", targets: [{ code: "P0100" }], scope: "clause" }, text("ct", "에 따릅니다.")] },
    ],
    options: [],
    params: [{ name: "사유", type: { kind: "enum", enumCode: "E0009" } }],
    required: { discriminators: [], attributes: [] },
  };
  const doc: DocumentNode = {
    kind: "document",
    id: "d",
    title: "보통약관",
    children: ["V01", "V03"].map((value, i) => ({
      kind: "article" as const,
      id: `a${i + 1}`,
      title: `정의 ${value}`,
      children: [{ kind: "clauseBlockRef" as const, id: `k${i + 1}`, code: "P0100", clauseCode: "C0400", options: {}, bindings: { 사유: { kind: "const" as const, value } } }],
    })),
  };

  it("V01 이면 암 칸의 항 · V03 이면 장해 칸의 항 — 둘 다 「제1항」, 펼친 노드로 해소된다", () => {
    const r = assembleDoc(doc, [사유항]);
    expect(r.issues).toEqual([]);
    expect(refsOf(r.doc).map((x) => [x.label, x.targets[0]?.nodeId])).toEqual([
      ["제1항", "k1/c-cancer"],
      ["제1항", "k2/c-other"],
    ]);
  });
});
