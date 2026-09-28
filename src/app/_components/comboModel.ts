/**
 * 검색 입력(콤보박스)의 순수 부분 — 거르기 · 강조 조각 · 키보드 이동 · 서버 조회(지연 · 취소).
 *
 * 화면(`Combobox.tsx`)은 이 함수들을 부르기만 한다. React · DOM 을 모르므로 서버(조회 route)도 같은 거르기를 쓴다.
 */

export interface ComboOption {
  /** 고르면 실리는 값 — 코드 · id. 검색 대상이 아니다(불투명한 id 에 숫자가 걸리지 않게). */
  value: string;
  /** 보이는 이름. */
  label: string;
  /** 이름 뒤 흐린 글자 — 담보코드 · 구분자 코드 등. 검색도 이 글자를 본다. */
  hint?: string;
  /** 보이지 않지만 검색이 보는 말 (별칭 · 옛 이름). */
  keywords?: string;
  /** 묶음 머리 — 같은 묶음은 이어 놓는다(순서는 호출이 정한다). */
  group?: string;
  /** 고를 수 없다 — 글자가 있으면 그 사유를 옆에 보인다. */
  disabled?: boolean | string;
}

/** 서버 조회 — 검색어와 취소 신호를 받아 후보를 돌려준다. */
export type ComboLoad = (query: string, signal: AbortSignal) => Promise<readonly ComboOption[]>;

/** 검색어를 낱말로 — 소문자, 공백으로 끊는다. 빈 검색어면 빈 배열. */
export function tokensOf(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** 낱말이 전부 이름 · 보조 글자 · 별칭 어딘가에 있으면 맞는다. */
export function matchOption(option: ComboOption, query: string): boolean {
  const tokens = tokensOf(query);
  if (tokens.length === 0) return true;
  const hay = `${option.label}\n${option.hint ?? ""}\n${option.keywords ?? ""}`.toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

export function filterOptions(options: readonly ComboOption[], query: string): ComboOption[] {
  return options.filter((o) => matchOption(o, query));
}

export interface TextPart {
  text: string;
  hit: boolean;
}

/** 강조 조각 — 낱말마다 첫 등장 자리를 표시하고 겹치면 합친다. 없으면 통째 한 조각. */
export function highlightParts(text: string, query: string): TextPart[] {
  const lower = text.toLowerCase();
  const ranges = tokensOf(query)
    .map((t) => {
      const at = lower.indexOf(t);
      return at < 0 ? undefined : ([at, at + t.length] as const);
    })
    .filter((r): r is readonly [number, number] => r !== undefined)
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [s, e] of ranges) {
    const last = merged.at(-1);
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  if (merged.length === 0) return text === "" ? [] : [{ text, hit: false }];
  const parts: TextPart[] = [];
  let at = 0;
  for (const [s, e] of merged) {
    if (s > at) parts.push({ text: text.slice(at, s), hit: false });
    parts.push({ text: text.slice(s, e), hit: true });
    at = e;
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false });
  return parts;
}

export const isEnabled = (o: ComboOption | undefined): o is ComboOption => o !== undefined && !o.disabled;

export type Move = "next" | "prev" | "first" | "last";

/** 활성 줄 옮기기 — 못 고르는 줄은 건너뛴다. 위 · 아래는 끝에서 돌아간다. 고를 줄이 없으면 -1. */
export function moveActive(options: readonly ComboOption[], active: number, move: Move): number {
  const enabled = options.map((o, i) => (isEnabled(o) ? i : -1)).filter((i) => i >= 0);
  if (enabled.length === 0) return -1;
  switch (move) {
    case "first":
      return enabled[0];
    case "last":
      return enabled[enabled.length - 1];
    case "next":
      return enabled.find((i) => i > active) ?? enabled[0];
    case "prev":
      return [...enabled].reverse().find((i) => i < active) ?? enabled[enabled.length - 1];
  }
}

/** 처음 열 때의 활성 줄 — 지금 값이 보이면 그 줄, 아니면 첫 고를 줄. */
export function initialActive(options: readonly ComboOption[], value: string | undefined): number {
  const at = value === undefined || value === "" ? -1 : options.findIndex((o) => o.value === value && isEnabled(o));
  return at >= 0 ? at : moveActive(options, -1, "first");
}

/** 묶음으로 — 이어진 같은 `group` 끼리. 묶음 없는 항목은 머리 없는 묶음. 원래 순번(`index`)을 같이 싣는다. */
export function groupOptions(options: readonly ComboOption[]): { group?: string; items: { option: ComboOption; index: number }[] }[] {
  const out: { group?: string; items: { option: ComboOption; index: number }[] }[] = [];
  options.forEach((option, index) => {
    const last = out.at(-1);
    if (last && last.group === option.group) last.items.push({ option, index });
    else out.push({ group: option.group, items: [{ option, index }] });
  });
  return out;
}

export type LookupState = { status: "loading"; query: string } | { status: "done"; query: string; options: readonly ComboOption[] } | { status: "error"; query: string };

/**
 * 서버 조회기 — 치는 동안은 기다렸다가(`delay`) 마지막 검색어 하나만 부르고, 앞선 요청은 취소한다.
 * 늦게 온 옛 응답(순서 뒤바뀜)은 버린다.
 */
export function createLookup(load: ComboLoad, onState: (state: LookupState) => void, delay = 250) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let seq = 0;
  const stop = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    controller?.abort();
    controller = undefined;
  };
  return {
    request(query: string): void {
      stop();
      const id = ++seq;
      onState({ status: "loading", query });
      timer = setTimeout(() => {
        timer = undefined;
        const c = new AbortController();
        controller = c;
        const fresh = () => id === seq && !c.signal.aborted;
        load(query, c.signal).then(
          (options) => {
            if (fresh()) onState({ status: "done", query, options });
          },
          () => {
            if (fresh()) onState({ status: "error", query });
          },
        );
      }, delay);
    },
    /** 닫힐 때 — 기다리는 것 · 가는 것 모두 버린다. */
    cancel(): void {
      seq++;
      stop();
    },
  };
}

/** 키 하나가 하는 일 — 화면은 이것을 그대로 적용한다. `undefined` 면 브라우저 기본 동작 그대로. */
export interface KeyEffect {
  /** 기본 동작 막기 (커서 이동 · 폼 제출 · dialog 닫기). */
  prevent: boolean;
  /** 위로 전하지 않기 — Esc 가 떠 있는 팝업까지 닫지 않게. */
  stop?: boolean;
  /** 목록 열기(true) · 닫기(false). */
  open?: boolean;
  active?: number;
  /** 이 줄을 고른다. */
  pick?: number;
  /** 친 글을 버리고 고른 이름으로 되돌린다. */
  revert?: boolean;
}

/**
 * 키보드 규칙 (ARIA APG combobox — 목록 자동완성).
 * ↑ ↓: 닫혀 있으면 열고, 열려 있으면 못 고르는 줄을 건너뛰며 옮긴다(끝에서 돌아감). Home · End: 열려 있을 때만 처음 · 끝(닫혀 있으면 커서 이동).
 * Enter: 활성 줄을 고른다 — 고르는 중(목록이 떴거나 친 글이 남음)이면 폼을 내지 않는다(친 글만 있고 값이 빈 채로 나가지 않게).
 * Esc: 목록을 닫는다 → 닫혀 있으면 친 글을 되돌린다 → 그것도 없으면 위로 전한다(팝업 닫기). Tab: 닫고 되돌리고 다음 칸으로.
 */
export function comboKey(state: { open: boolean; active: number; typing: boolean }, items: readonly ComboOption[], key: string): KeyEffect | undefined {
  const { open, active, typing } = state;
  switch (key) {
    case "ArrowDown":
    case "ArrowUp":
      if (!open) return { prevent: true, open: true };
      return { prevent: true, active: moveActive(items, active, key === "ArrowDown" ? "next" : "prev") };
    case "Home":
    case "End":
      return open ? { prevent: true, active: moveActive(items, active, key === "Home" ? "first" : "last") } : undefined;
    case "Enter":
      if (open && isEnabled(items[active])) return { prevent: true, pick: active };
      if (open) return { prevent: true };
      return typing ? { prevent: true, revert: true } : undefined;
    case "Escape":
      if (open) return { prevent: true, stop: true, open: false };
      return typing ? { prevent: true, stop: true, revert: true } : undefined;
    case "Tab":
      return open || typing ? { prevent: false, open: false, revert: true } : undefined;
    default:
      return undefined;
  }
}

/** 서버 조회 응답 한 벌 — 조회 route 가 돌려주고 `urlLoad` 가 받는다. */
export interface LookupResponse {
  options: ComboOption[];
  /** 한도를 넘어 잘렸다 — 더 쳐서 좁히라고 알린다. */
  more: boolean;
}

/** 조회 route 한 곳에서 한도만큼 — 서버가 같은 거르기를 쓴다. */
export function lookupResponse(options: readonly ComboOption[], query: string, limit: number): LookupResponse {
  const hits = filterOptions(options, query);
  return { options: hits.slice(0, limit), more: hits.length > limit };
}

/** 잘렸다는 표시 줄 — 고를 수 없다. */
export const MORE_OPTION: ComboOption = { value: "", label: "더 있다 — 더 쳐서 좁힌다", disabled: true };

/** 조회 route(GET `?q=`)를 부르는 `load` — 서버 컴포넌트는 함수를 못 넘기므로 주소만 넘기고 여기서 만든다. */
export function urlLoad(url: string): ComboLoad {
  return async (query, signal) => {
    const res = await fetch(`${url}?q=${encodeURIComponent(query)}`, { signal, headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`조회 실패 ${res.status}`);
    const body = (await res.json()) as LookupResponse;
    return body.more ? [...body.options, MORE_OPTION] : body.options;
  };
}
