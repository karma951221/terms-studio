import { describe, expect, it } from "vitest";

import type { ArticleNode } from "@/domain/document";
import { articleHash } from "@/domain/product";

import { generalDraftChanges, generalDraftDirty, generalDraftReducer, initGeneralDraft, issuesByPlace, toGeneralSettings } from "./generalDraft";

const BASE = { style: "A", tone: "T1" };
const saved = initGeneralDraft(["a1"], [{ id: "o1", scope: { kind: "product", id: "p" }, nodeId: "n1", clauseCode: "C0001", options: { style: "B" } }]);

describe("보통약관 탭 초안 (기능/상품 §3.8 · §4.6)", () => {
  it("저장된 숨김 · 오버라이드로 시작하고, 시작 그대로면 고친 것이 없다", () => {
    expect(saved).toEqual({ hidden: ["a1"], overrides: { n1: { clauseCode: "C0001", options: { style: "B" } } }, copies: {} });
    expect(generalDraftDirty(saved, saved)).toBe(false);
  });

  it("조 노출 토글 — 끄면 숨김에 들고, 다시 켜면 빠지며 시작과 같아지면 변경이 아니다", () => {
    const off = generalDraftReducer(saved, { type: "toggleArticle", articleId: "a2", shown: false });
    expect(off.hidden).toEqual(["a1", "a2"]);
    expect([...generalDraftChanges(saved, off).articles]).toEqual(["a2"]);
    const back = generalDraftReducer(off, { type: "toggleArticle", articleId: "a2", shown: true });
    expect(generalDraftDirty(saved, back)).toBe(false);
    const on = generalDraftReducer(saved, { type: "toggleArticle", articleId: "a1", shown: true });
    expect(on.hidden).toEqual([]);
    expect([...generalDraftChanges(saved, on).articles]).toEqual(["a1"]);
  });

  it("옵션 고르기 — 마스터 기본과 같은 값 · 빈 값은 키를 빼고, 키가 다 빠지면 자리를 지운다", () => {
    const tone = generalDraftReducer(saved, { type: "setOption", nodeId: "n1", clauseCode: "C0001", optionCode: "tone", value: "T2", base: BASE });
    expect(tone.overrides.n1.options).toEqual({ style: "B", tone: "T2" });
    expect([...generalDraftChanges(saved, tone).nodes]).toEqual(["n1"]);
    const masterTone = generalDraftReducer(tone, { type: "setOption", nodeId: "n1", clauseCode: "C0001", optionCode: "tone", value: "T1", base: BASE });
    expect(generalDraftDirty(saved, masterTone)).toBe(false);
    const cleared = generalDraftReducer(saved, { type: "setOption", nodeId: "n1", clauseCode: "C0001", optionCode: "style", value: "", base: BASE });
    expect(cleared.overrides).toEqual({});
    const fresh = generalDraftReducer(saved, { type: "setOption", nodeId: "n2", clauseCode: "C0002", optionCode: "x", value: "X2", base: {} });
    expect(fresh.overrides.n2).toEqual({ clauseCode: "C0002", options: { x: "X2" } });
  });

  it("↺ 되돌리기 — 그 자리의 오버라이드를 통째로 뺀다 · reset 은 시작으로", () => {
    const reset = generalDraftReducer(saved, { type: "resetNode", nodeId: "n1" });
    expect(reset.overrides).toEqual({});
    expect([...generalDraftChanges(saved, reset).nodes]).toEqual(["n1"]);
    expect(generalDraftReducer(reset, { type: "reset", draft: saved })).toEqual(saved);
  });

  it("저장 입력 — 템플릿 id 와 최종 상태 전부", () => {
    const d = generalDraftReducer(saved, { type: "toggleArticle", articleId: "a2", shown: false });
    expect(toGeneralSettings("doc", d)).toEqual({ generalDocumentId: "doc", hiddenArticles: ["a1", "a2"], overrides: [{ nodeId: "n1", clauseCode: "C0001", options: { style: "B" } }], copies: [] });
  });

  it("저장 거부의 이슈를 자리별로 — 조 사본 검사 오류(articleId + nodePath)는 그 조(목차)와 사본 이슈 목록(편집기)으로", () => {
    const copyIssue = { kind: "brokenRef" as const, message: "없는 별표", at: { articleId: "a3", nodePath: ["doc", "a3", "p1"] } };
    const by = issuesByPlace([copyIssue]);
    expect(by.articles.get("a3")).toEqual(["없는 별표"]);
    expect(by.nodes.size).toBe(0);
    expect(by.copies).toEqual([copyIssue]);
  });

  it("저장 거부의 이슈를 자리별로 — 조(articleId) · 함수조항 자리(nodePath 끝) · 그 밖", () => {
    const by = issuesByPlace([
      { kind: "brokenRef", message: "없는 조", at: { articleId: "a9" } },
      { kind: "optionInvalid", message: "없는 선택지", at: { nodePath: ["n1"] } },
      { kind: "typeMismatch", message: "그 밖", at: {} },
    ]);
    expect(by.articles.get("a9")).toEqual(["없는 조"]);
    expect(by.nodes.get("n1")).toEqual(["없는 선택지"]);
    expect(by.other).toEqual(["그 밖"]);
  });
});

describe("조 사본 초안 (ADR-0079 · 기능/상품 §3.10)", () => {
  const template: ArticleNode = { id: "a1", kind: "article", title: "목적", children: [{ id: "p1", kind: "paragraph", children: [{ id: "t1", kind: "text", text: "원문" }] }] };
  const edited = (text: string, title = "목적"): ArticleNode => ({ ...template, title, children: [{ id: "p1", kind: "paragraph", children: [{ id: "t1", kind: "text", text }] }] });
  const base = initGeneralDraft([], []);

  it("조를 고치면 사본 — 지문은 고칠 때의 템플릿 조 지문, 다시 고쳐도 처음 지문을 지킨다(노랑을 조용히 지우지 않는다)", () => {
    const one = generalDraftReducer(base, { type: "editArticle", article: edited("고침"), template });
    expect(one.copies.a1).toEqual({ article: edited("고침"), templateHash: articleHash(template) });
    expect([...generalDraftChanges(base, one).articles]).toEqual(["a1"]);
    const stale = initGeneralDraft([], [], [{ articleId: "a1", article: edited("옛 사본"), templateHash: "옛지문" }]);
    const again = generalDraftReducer(stale, { type: "editArticle", article: edited("또 고침", "새 제목"), template });
    expect(again.copies.a1).toEqual({ article: edited("또 고침", "새 제목"), templateHash: "옛지문" });
  });

  it("템플릿과 같은 내용으로 돌아오면 사본이 아니다 — 변경도 아니다", () => {
    const one = generalDraftReducer(base, { type: "editArticle", article: edited("고침"), template });
    const back = generalDraftReducer(one, { type: "editArticle", article: JSON.parse(JSON.stringify(template)) as ArticleNode, template });
    expect(back.copies).toEqual({});
    expect(generalDraftDirty(base, back)).toBe(false);
  });

  it("「템플릿대로 되돌리기」는 사본을 빼고, 「사본 유지」는 지문만 지금 템플릿 것으로", () => {
    const stale = initGeneralDraft([], [], [{ articleId: "a1", article: edited("사본"), templateHash: "옛지문" }]);
    const kept = generalDraftReducer(stale, { type: "keepCopy", articleId: "a1", templateHash: articleHash(template) });
    expect(kept.copies.a1).toEqual({ article: edited("사본"), templateHash: articleHash(template) });
    expect([...generalDraftChanges(stale, kept).articles]).toEqual(["a1"]);
    const reverted = generalDraftReducer(stale, { type: "revertArticle", articleId: "a1" });
    expect(reverted.copies).toEqual({});
    expect([...generalDraftChanges(stale, reverted).articles]).toEqual(["a1"]);
    expect(generalDraftReducer(base, { type: "keepCopy", articleId: "없음", templateHash: "h" })).toBe(base);
  });

  it("저장 입력 — 사본 전부와 편집을 시작한 템플릿 판", () => {
    const one = generalDraftReducer(base, { type: "editArticle", article: edited("고침"), template });
    expect(toGeneralSettings("doc", one, 7)).toEqual({ generalDocumentId: "doc", hiddenArticles: [], overrides: [], copies: [{ articleId: "a1", article: edited("고침"), templateHash: articleHash(template) }], templateVersion: 7 });
  });
});
