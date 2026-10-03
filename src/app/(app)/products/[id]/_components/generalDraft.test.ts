import { describe, expect, it } from "vitest";

import { generalDraftChanges, generalDraftDirty, generalDraftReducer, initGeneralDraft, issuesByPlace, toGeneralSettings } from "./generalDraft";

const BASE = { style: "A", tone: "T1" };
const saved = initGeneralDraft(["a1"], [{ id: "o1", scope: { kind: "product", id: "p" }, nodeId: "n1", clauseCode: "C0001", options: { style: "B" } }]);

describe("보통약관 탭 초안 (기능/상품 §3.8 · §4.6)", () => {
  it("저장된 숨김 · 오버라이드로 시작하고, 시작 그대로면 고친 것이 없다", () => {
    expect(saved).toEqual({ hidden: ["a1"], overrides: { n1: { clauseCode: "C0001", options: { style: "B" } } } });
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
    expect(toGeneralSettings("doc", d)).toEqual({ generalDocumentId: "doc", hiddenArticles: ["a1", "a2"], overrides: [{ nodeId: "n1", clauseCode: "C0001", options: { style: "B" } }] });
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
