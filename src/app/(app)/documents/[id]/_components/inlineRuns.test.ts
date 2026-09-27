import { describe, expect, it } from "vitest";

import { nodeBuilders, sequentialIds, type InlineNode } from "@/domain/document";

import { identityRuns, parseGrid, runsFromTokens, runsReplacing, runsWithout, sameRuns } from "./inlineRuns";

/** 「계약일부터 」 + 슬롯 + 「 이내」 — text n1 · slot n2 · text n3. */
function list(): InlineNode[] {
  const b = nodeBuilders(sequentialIds("n"));
  return [b.text("계약일부터 "), b.slot("D0001"), b.text(" 이내")];
}

describe("문장 칸 DOM 조각 → setInlines 조각 (기능/문면 §4.3 그 자리 편집)", () => {
  it("글자만 고치면 같은 문장 id 를 다시 쓴다 — 바뀐 것이 없으면 지금 목록과 같다", () => {
    const cur = list();
    const same = runsFromTokens(cur, [{ text: "계약일부터 " }, { chip: "n2" }, { text: " 이내" }], sequentialIds("x"));
    expect(sameRuns(same, identityRuns(cur))).toBe(true);
    expect(runsFromTokens(cur, [{ text: "계약일로부터 " }, { chip: "n2" }, { text: " 이내에" }], sequentialIds("x"))).toEqual([
      { id: "n1", text: "계약일로부터 " },
      { keep: "n2" },
      { id: "n3", text: " 이내에" },
    ]);
  });

  it("칩을 지우면 양옆 글이 한 구간이 되어 첫 문장 id 로 합쳐진다", () => {
    expect(runsFromTokens(list(), [{ text: "계약일부터  이내" }], sequentialIds("x"))).toEqual([{ id: "n1", text: "계약일부터  이내" }]);
  });

  it("커서 자리에 칩을 넣으면 그 구간 문장이 둘로 갈린다 — 뒤쪽은 새 id", () => {
    const b = nodeBuilders(sequentialIds("s"));
    const chip = b.appendixRef("A01");
    const runs = runsFromTokens(list(), [{ text: "계약일" }, { caret: true }, { text: "부터 " }, { chip: "n2" }, { text: " 이내" }], sequentialIds("x"), chip);
    expect(runs).toEqual([{ id: "n1", text: "계약일" }, { node: chip }, { id: "x1", text: "부터 " }, { keep: "n2" }, { id: "n3", text: " 이내" }]);
    // 커서가 없으면 끝에
    expect(runsFromTokens([], [], sequentialIds("x"), chip)).toEqual([{ node: chip }]);
  });

  it("빈 칸에 쓴 글은 새 문장 — 목록에 없는 칩 조각은 버린다", () => {
    expect(runsFromTokens([], [{ text: "새 문장" }, { chip: "남의칩" }], sequentialIds("x"))).toEqual([{ id: "x1", text: "새 문장" }]);
  });

  it("칩 삭제 · 문장 안 조건 풀기", () => {
    const cur = list();
    expect(runsWithout(cur, "n2")).toEqual([{ id: "n1", text: "계약일부터 " }, { id: "n3", text: " 이내" }]);
    const b = nodeBuilders(sequentialIds("k"));
    const inner = [b.text("갱신계약")];
    expect(runsReplacing(cur, "n2", inner)).toEqual([{ id: "n1", text: "계약일부터 " }, { node: inner[0] }, { id: "n3", text: " 이내" }]);
  });

  it("표 붙여넣기 — 탭 · 줄로 나뉜 글만 격자로 읽는다", () => {
    expect(parseGrid("용어\t정의\n계약자\t회사와…\n")).toEqual([
      ["용어", "정의"],
      ["계약자", "회사와…"],
    ]);
    expect(parseGrid("한 칸")).toBeUndefined();
  });
});
