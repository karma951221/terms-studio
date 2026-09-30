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

  it("작업용 글자색 — 색이 바뀌는 자리에서 문장이 갈리고, 같은 색이 잇닿으면 합친다 (§3.2 작업 표시)", () => {
    const cur = list();
    // 「계약일부터 」 가운데 「부터」만 빨강 — 첫 조각은 제 id, 나머지는 새 id
    const runs = runsFromTokens(cur, [{ text: "계약일" }, { text: "부터", mark: "red" }, { text: " " }, { chip: "n2" }, { text: " 이내", mark: "blue" }], sequentialIds("x"));
    expect(runs).toEqual([{ id: "n1", text: "계약일" }, { id: "x1", text: "부터", mark: "red" }, { id: "x2", text: " " }, { keep: "n2" }, { id: "n3", text: " 이내", mark: "blue" }]);
    // 칠한 목록의 제자리 조각은 색까지 같다 — 바뀐 것 없음
    const colored = [{ ...cur[0], mark: "red" as const }, cur[1], cur[2]];
    expect(identityRuns(colored)[0]).toEqual({ id: "n1", text: "계약일부터 ", mark: "red" });
    expect(sameRuns(runsFromTokens(colored, [{ text: "계약일", mark: "red" }, { text: "부터 ", mark: "red" }, { chip: "n2" }, { text: " 이내" }], sequentialIds("x")), identityRuns(colored))).toBe(true);
    // 색을 지우면 옛 조각과 합쳐진다
    expect(runsFromTokens(colored, [{ text: "계약일부터 " }, { chip: "n2" }, { text: " 이내" }], sequentialIds("x"))).toEqual(identityRuns(cur));
    // 칩 삭제 · 풀기도 색을 지킨다
    expect(runsWithout(colored, "n2")[0]).toEqual({ id: "n1", text: "계약일부터 ", mark: "red" });
  });

  it("표 붙여넣기 — 탭 · 줄로 나뉜 글만 격자로 읽는다", () => {
    expect(parseGrid("용어\t정의\n계약자\t회사와…\n")).toEqual([
      ["용어", "정의"],
      ["계약자", "회사와…"],
    ]);
    expect(parseGrid("한 칸")).toBeUndefined();
  });
});
