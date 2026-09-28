import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { comboKey, createLookup, filterOptions, groupOptions, highlightParts, initialActive, matchOption, moveActive, type ComboOption, type LookupState } from "./comboModel";

const OPTS: ComboOption[] = [
  { value: "c1", label: "일반상해사망보장", hint: "COV000002" },
  { value: "c2", label: "수술비", hint: "COV000008", keywords: "surgery" },
  { value: "c3", label: "질병사망", hint: "COV000011", disabled: "이미 탑재됨" },
  { value: "c4", label: "암진단비", hint: "COV000020" },
];

describe("거르기 — 이름 · 보조 글자 · 별칭, 낱말마다", () => {
  it("빈 검색어면 전부", () => {
    expect(filterOptions(OPTS, "  ")).toHaveLength(4);
  });
  it("이름 일부 · 코드 일부 · 별칭 · 대소문자 무시", () => {
    expect(filterOptions(OPTS, "사망").map((o) => o.value)).toEqual(["c1", "c3"]);
    expect(filterOptions(OPTS, "cov000008").map((o) => o.value)).toEqual(["c2"]);
    expect(filterOptions(OPTS, "SURG").map((o) => o.value)).toEqual(["c2"]);
  });
  it("낱말이 여럿이면 모두 맞아야 — 띄어 쳐도 붙은 이름에 걸린다", () => {
    expect(filterOptions(OPTS, "상해 사망").map((o) => o.value)).toEqual(["c1"]);
    expect(matchOption(OPTS[1], "수술 사망")).toBe(false);
  });
  it("값(불투명 id)은 검색하지 않는다", () => {
    expect(filterOptions(OPTS, "c4")).toEqual([]);
  });
});

describe("강조 조각", () => {
  it("맞은 글자만 hit — 대소문자 무시, 원문 글자 그대로", () => {
    expect(highlightParts("COV000008", "v0000")).toEqual([
      { text: "CO", hit: false },
      { text: "V0000", hit: true },
      { text: "08", hit: false },
    ]);
  });
  it("낱말 여럿 — 자리 순, 겹치면 합친다", () => {
    expect(highlightParts("일반상해사망보장", "사망 상해")).toEqual([
      { text: "일반", hit: false },
      { text: "상해사망", hit: true },
      { text: "보장", hit: false },
    ]);
  });
  it("안 맞으면 통째 한 조각", () => {
    expect(highlightParts("수술비", "암")).toEqual([{ text: "수술비", hit: false }]);
    expect(highlightParts("수술비", "")).toEqual([{ text: "수술비", hit: false }]);
  });
});

describe("키보드 이동 — 못 고르는 줄은 건너뛰고 끝에서 돌아간다", () => {
  it("↓ · ↑", () => {
    expect(moveActive(OPTS, 1, "next")).toBe(3); // c3(못 고름)를 건너뜀
    expect(moveActive(OPTS, 3, "next")).toBe(0); // 돌아감
    expect(moveActive(OPTS, 0, "prev")).toBe(3);
    expect(moveActive(OPTS, 3, "prev")).toBe(1);
    expect(moveActive(OPTS, -1, "next")).toBe(0);
  });
  it("Home · End", () => {
    expect(moveActive(OPTS, 2, "first")).toBe(0);
    expect(moveActive(OPTS, 0, "last")).toBe(3);
  });
  it("고를 줄이 없으면 -1", () => {
    expect(moveActive([], 0, "next")).toBe(-1);
    expect(moveActive([OPTS[2]], -1, "first")).toBe(-1);
  });
  it("처음 열면 지금 값의 줄, 없으면 첫 고를 줄", () => {
    expect(initialActive(OPTS, "c4")).toBe(3);
    expect(initialActive(OPTS, "")).toBe(0);
    expect(initialActive(OPTS, "c3")).toBe(0); // 못 고르는 값이면 첫 줄
  });
});

describe("묶음", () => {
  it("이어진 같은 group 끼리, 원래 순번을 싣는다", () => {
    const g = groupOptions([
      { value: "a", label: "A", group: "담보" },
      { value: "b", label: "B", group: "담보" },
      { value: "c", label: "C", group: "급부" },
    ]);
    expect(g.map((x) => [x.group, x.items.map((i) => i.index)])).toEqual([
      ["담보", [0, 1]],
      ["급부", [2]],
    ]);
  });
});

describe("서버 조회 — 250ms 기다렸다 마지막 검색어만, 앞 요청은 취소, 늦게 온 옛 응답은 버림", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("치는 동안에는 부르지 않고, 멈추면 마지막 검색어 하나만 부른다", async () => {
    const load = vi.fn(async (q: string) => [{ value: q, label: q }]);
    const states: LookupState[] = [];
    const lookup = createLookup(load, (s) => states.push(s));
    lookup.request("수");
    await vi.advanceTimersByTimeAsync(100);
    lookup.request("수술");
    await vi.advanceTimersByTimeAsync(249);
    expect(load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0][0]).toBe("수술");
    expect(states.at(0)).toEqual({ status: "loading", query: "수" });
    expect(states.at(-1)).toEqual({ status: "done", query: "수술", options: [{ value: "수술", label: "수술" }] });
  });

  it("새 검색이 시작되면 가던 요청은 abort, 그 응답이 늦게 와도 버린다", async () => {
    const pending: { q: string; signal: AbortSignal; resolve: (o: ComboOption[]) => void }[] = [];
    const load = (q: string, signal: AbortSignal) => new Promise<ComboOption[]>((resolve) => pending.push({ q, signal, resolve }));
    const states: LookupState[] = [];
    const lookup = createLookup(load, (s) => states.push(s));

    lookup.request("암");
    await vi.advanceTimersByTimeAsync(250);
    expect(pending).toHaveLength(1);
    lookup.request("암진단");
    expect(pending[0].signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(250);
    expect(pending).toHaveLength(2);

    // 새 응답이 먼저, 옛 응답이 나중에 와도 화면은 새 것
    pending[1].resolve([{ value: "new", label: "암진단비" }]);
    await vi.advanceTimersByTimeAsync(0);
    pending[0].resolve([{ value: "old", label: "암" }]);
    await vi.advanceTimersByTimeAsync(0);
    const done = states.filter((s) => s.status === "done");
    expect(done).toEqual([{ status: "done", query: "암진단", options: [{ value: "new", label: "암진단비" }] }]);
  });

  it("실패는 error 상태 — 취소된 요청의 실패는 조용히 버린다", async () => {
    let fail: (e: Error) => void = () => {};
    const load = vi.fn(() => new Promise<ComboOption[]>((_, reject) => (fail = reject)));
    const states: LookupState[] = [];
    const lookup = createLookup(load, (s) => states.push(s));
    lookup.request("x");
    await vi.advanceTimersByTimeAsync(250);
    fail(new Error("500"));
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)).toEqual({ status: "error", query: "x" });

    lookup.request("y");
    await vi.advanceTimersByTimeAsync(250);
    lookup.cancel();
    fail(new Error("aborted"));
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)).toEqual({ status: "loading", query: "y" });
  });

  it("닫으면(cancel) 기다리던 요청은 부르지도 않는다", async () => {
    const load = vi.fn(async () => []);
    const lookup = createLookup(load, () => {});
    lookup.request("a");
    lookup.cancel();
    await vi.advanceTimersByTimeAsync(1000);
    expect(load).not.toHaveBeenCalled();
  });
});

describe("키보드 규칙 (comboKey)", () => {
  const closed = { open: false, active: -1, typing: false };
  const opened = { open: true, active: 1, typing: true };
  it("↑ ↓ — 닫혀 있으면 연다, 열려 있으면 못 고르는 줄을 건너뛰며 옮긴다", () => {
    expect(comboKey(closed, OPTS, "ArrowDown")).toEqual({ prevent: true, open: true });
    expect(comboKey(opened, OPTS, "ArrowDown")).toEqual({ prevent: true, active: 3 });
    expect(comboKey({ ...opened, active: 0 }, OPTS, "ArrowUp")).toEqual({ prevent: true, active: 3 });
  });
  it("Home · End — 열려 있을 때만 (닫혀 있으면 커서 이동 그대로)", () => {
    expect(comboKey(opened, OPTS, "Home")).toEqual({ prevent: true, active: 0 });
    expect(comboKey(opened, OPTS, "End")).toEqual({ prevent: true, active: 3 });
    expect(comboKey(closed, OPTS, "Home")).toBeUndefined();
  });
  it("Enter — 활성 줄을 고른다, 고르는 중이면 폼을 내지 않는다, 아니면 기본(제출)", () => {
    expect(comboKey(opened, OPTS, "Enter")).toEqual({ prevent: true, pick: 1 });
    expect(comboKey({ ...opened, active: -1 }, OPTS, "Enter")).toEqual({ prevent: true });
    expect(comboKey({ ...opened, active: 2 }, OPTS, "Enter")).toEqual({ prevent: true }); // 못 고르는 줄
    expect(comboKey({ open: false, active: -1, typing: true }, OPTS, "Enter")).toEqual({ prevent: true, revert: true });
    expect(comboKey(closed, OPTS, "Enter")).toBeUndefined();
  });
  it("Esc — 목록 닫기 → 친 글 되돌리기 → 위로 전함(팝업 닫기)", () => {
    expect(comboKey(opened, OPTS, "Escape")).toEqual({ prevent: true, stop: true, open: false });
    expect(comboKey({ open: false, active: -1, typing: true }, OPTS, "Escape")).toEqual({ prevent: true, stop: true, revert: true });
    expect(comboKey(closed, OPTS, "Escape")).toBeUndefined();
  });
  it("Tab — 닫고 되돌리되 초점 이동은 막지 않는다", () => {
    expect(comboKey(opened, OPTS, "Tab")).toEqual({ prevent: false, open: false, revert: true });
    expect(comboKey(closed, OPTS, "Tab")).toBeUndefined();
  });
});
