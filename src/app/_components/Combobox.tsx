"use client";

/**
 * 검색 입력(콤보박스) — 참조를 고르는 자리는 모두 이것 하나다 (디자인원칙 §2.6 「참조 고르기는 검색 입력 하나로」).
 *
 * `<select>` 는 항목이 늘면 훑어야 하고 타이핑으로 못 좁힌다. `<datalist>` 는 표시명을 보여 주면서
 * 코드를 실을 방법이 없고(값 하나뿐) 브라우저마다 모양이 달라서 직접 만든다.
 *
 * - 치면 이름 · 보조 글자(코드) · 별칭으로 걸러지고, 맞은 글자는 강조된다. 없으면 「일치하는 항목 없음」.
 * - 키보드: ↑ ↓ 줄 이동(끝에서 돌아감) · Home End 처음 · 끝 · Enter 고르기 · Esc 닫기(닫혀 있으면 친 글 되돌림) · Tab 닫고 다음 칸.
 * - 고르기 전에는 값이 바뀌지 않는다 — 친 글만 남기고 떠나면 원래 고른 이름으로 돌아온다.
 * - 두 쓰임: 값 고르기(`value` + `onChange`) · 폼 칸(`name` → 숨은 칸에 값, `defaultValue`). 둘을 섞어도 된다.
 * - 후보 출처: `options`(정적, 여기서 거른다) 또는 `load(query, signal)` · `lookupUrl`(서버 조회 — 250ms 기다렸다 부르고 앞 요청은 취소).
 * - ARIA 1.2 combobox — 입력칸 role=combobox · aria-activedescendant, 목록 role=listbox · option, 묶음 role=group.
 * - 목록은 가장 가까운 <dialog>(없으면 body)에 포털로 띄운다 — <label> 안에 놓여도 목록 글자가 칸 이름에 섞이지 않고,
 *   누름이 label 을 거쳐 입력칸 클릭으로 번지지 않으며, 모달 dialog 밖(inert)으로 나가지도 않는다.
 */
import { useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type Ref } from "react";
import { createPortal } from "react-dom";

import { comboKey, createLookup, filterOptions, groupOptions, highlightParts, initialActive, isEnabled, moveActive, urlLoad, type ComboLoad, type ComboOption, type LookupState } from "./comboModel";

export type { ComboLoad, ComboOption } from "./comboModel";

export const COMBO_EMPTY_TEXT = "일치하는 항목 없음";

export interface ComboboxProps {
  /** 보이는 입력칸 id — `<label htmlFor>` 가 이것을 가리킨다. */
  id?: string;
  /** 폼 칸 이름 — 주면 숨은 칸에 고른 값이 실린다. */
  name?: string;
  options?: readonly ComboOption[];
  /** 서버 조회 — 주면 `options` 대신 이것으로 후보를 찾는다. */
  load?: ComboLoad;
  /** 서버 조회 route 주소(GET `?q=`) — 함수를 넘길 수 없는 서버 컴포넌트가 `load` 대신 준다. */
  lookupUrl?: string;
  debounceMs?: number;
  /** 주면 제어형 — 바뀐 값은 `onChange` 로 받는다. */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string, option: ComboOption | undefined) => void;
  /** 지금 값이 후보에 없을 때 보일 이름 (서버 조회의 처음 값 · 목록에 없는 옛 값). 없으면 값 그대로. */
  valueLabel?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  /** `<label>` 이 없을 때의 이름. */
  ariaLabel?: string;
  /** 감싸는 칸에 더할 class — 자리마다 너비. */
  className?: string;
  inputRef?: Ref<HTMLInputElement>;
  emptyText?: string;
  autoFocus?: boolean;
}

/** 강조 조각을 그린다 — 맞은 글자만 `<mark>`. */
export function Highlight({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((p, i) =>
        p.hit ? (
          <mark key={i} className="ts-combo-mark">
            {p.text}
          </mark>
        ) : (
          p.text
        ),
      )}
    </>
  );
}

export type ComboStatus = "ready" | "loading" | "error";

/** 떠 있는 목록 — 그리기만 한다 (상태는 `Combobox`). 단위 테스트가 이것을 정적으로 그려 본다. */
export function ComboList({
  id,
  label,
  items,
  active,
  value,
  query,
  status = "ready",
  emptyText = COMBO_EMPTY_TEXT,
  style,
  onPick,
  onHover,
}: {
  id: string;
  label?: string;
  items: readonly ComboOption[];
  active: number;
  value?: string;
  query: string;
  status?: ComboStatus;
  emptyText?: string;
  style?: CSSProperties;
  onPick?: (option: ComboOption) => void;
  onHover?: (index: number) => void;
}) {
  const option = (o: ComboOption, index: number) => {
    const reason = typeof o.disabled === "string" ? o.disabled : undefined;
    const cls = [index === active && "is-active", o.value === value && "is-current", o.disabled && "is-disabled"].filter(Boolean).join(" ");
    return (
      <li
        key={`${index}:${o.value}`}
        id={`${id}-o${index}`}
        role="option"
        aria-selected={index === active}
        aria-disabled={o.disabled ? true : undefined}
        data-value={o.value}
        className={cls || undefined}
        onMouseMove={() => onHover?.(index)}
        onClick={() => {
          if (isEnabled(o)) onPick?.(o);
        }}
      >
        <span className="ts-combo-label">
          <Highlight text={o.label} query={query} />
        </span>
        {o.hint && (
          <span className="ts-combo-hint">
            <Highlight text={o.hint} query={query} />
          </span>
        )}
        {reason && <span className="ts-combo-reason">{reason}</span>}
      </li>
    );
  };
  const groups = groupOptions(items);
  return (
    <div
      className="ts-combo-pop"
      style={style}
      // 목록을 눌러도 초점은 입력칸에 — 떠나면 닫히므로
      onMouseDown={(e) => e.preventDefault()}
      // <label> 안에 놓여도 누름이 입력칸 클릭으로 번져 목록이 다시 열리지 않게
      onClick={(e) => e.preventDefault()}
    >
      <ul id={id} role="listbox" aria-label={label} className="ts-combo-list">
        {groups.map((g, gi) =>
          g.group === undefined ? (
            g.items.map(({ option: o, index }) => option(o, index))
          ) : (
            <li key={`g${gi}`} role="presentation">
              <ul role="group" aria-labelledby={`${id}-g${gi}`}>
                <li id={`${id}-g${gi}`} role="presentation" className="ts-combo-group">
                  {g.group}
                </li>
                {g.items.map(({ option: o, index }) => option(o, index))}
              </ul>
            </li>
          ),
        )}
      </ul>
      {status === "loading" ? (
        <p className="ts-combo-status" role="status">
          찾는 중…
        </p>
      ) : status === "error" ? (
        <p className="ts-combo-status" role="status">
          불러오지 못했습니다 — 다시 쳐 보세요
        </p>
      ) : items.length === 0 ? (
        <p className="ts-combo-status" role="status">
          {emptyText}
        </p>
      ) : null}
    </div>
  );
}

/** 목록을 입력칸 바로 아래(모자라면 위)에 — 고정 좌표라 팝업(dialog)의 스크롤에 잘리지 않는다. */
function placeUnder(input: HTMLElement): CSSProperties {
  const r = input.getBoundingClientRect();
  const below = window.innerHeight - r.bottom;
  const up = below < 240 && r.top > below;
  return {
    position: "fixed",
    left: r.left,
    minWidth: Math.max(r.width, 240),
    ...(up ? { bottom: window.innerHeight - r.top + 2 } : { top: r.bottom + 2 }),
  };
}

export function Combobox({
  id,
  name,
  options,
  load: loadProp,
  lookupUrl,
  debounceMs = 250,
  value: controlled,
  defaultValue = "",
  onChange,
  valueLabel,
  placeholder,
  required,
  disabled,
  ariaLabel,
  className,
  inputRef,
  emptyText,
  autoFocus,
}: ComboboxProps) {
  const load = useMemo(() => loadProp ?? (lookupUrl ? urlLoad(lookupUrl) : undefined), [loadProp, lookupUrl]);
  const [own, setOwn] = useState(defaultValue);
  const value = controlled ?? own;
  /** 치는 중인 글 — `null` 이면 고른 이름을 보인다. */
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [lookup, setLookup] = useState<LookupState>();
  /** 마지막으로 고른 항목 — 서버 조회라 후보가 바뀌어도 이름을 잃지 않게. */
  const [chosen, setChosen] = useState<ComboOption>();
  const [place, setPlace] = useState<CSSProperties>();
  const [host, setHost] = useState<HTMLElement>();
  const inputEl = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  const text = query ?? "";
  const items: readonly ComboOption[] = load ? (lookup?.status === "done" ? lookup.options : []) : filterOptions(options ?? [], text);
  const status: ComboStatus = !load || lookup === undefined || lookup.status === "done" ? "ready" : lookup.status;

  const known =
    (options ?? []).find((o) => o.value === value) ?? (chosen?.value === value ? chosen : undefined) ?? (lookup?.status === "done" ? lookup.options.find((o) => o.value === value) : undefined);
  const shownLabel = value === "" ? "" : (known?.label ?? valueLabel ?? value);

  // 서버 조회기 — load 가 있을 때 한 벌. 결과가 오면 활성 줄을 지금 값(없으면 첫 줄)에 둔다
  const latest = useRef({ load, value });
  useEffect(() => {
    latest.current = { load, value };
  });
  const hasLoad = load !== undefined;
  const [lookupApi, setLookupApi] = useState<ReturnType<typeof createLookup>>();
  useEffect(() => {
    if (!hasLoad) return;
    const api = createLookup(
      (q, signal) => latest.current.load?.(q, signal) ?? Promise.resolve([]),
      (s) => {
        setLookup(s);
        if (s.status === "done") setActive(initialActive(s.options, latest.current.value));
      },
      debounceMs,
    );
    setLookupApi(api);
    return () => api.cancel();
  }, [hasLoad, debounceMs]);

  // 열린 동안 치는 글이 바뀌면 다시 찾는다 (서버 조회)
  useEffect(() => {
    if (!lookupApi) return;
    if (open) lookupApi.request(text);
    else lookupApi.cancel();
  }, [lookupApi, open, text]);

  // 목록 자리 — 열릴 때 · 스크롤 · 창 크기
  useLayoutEffect(() => {
    const el = inputEl.current;
    if (!open || !el) return;
    const measure = () => setPlace(placeUnder(el));
    const frame = requestAnimationFrame(measure);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open]);

  // 활성 줄이 보이게
  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(`${listId}-o${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, active, listId]);

  /** 열기 직전 — 자리를 재고 띄울 곳(가까운 dialog · body)을 정한다. */
  const prepare = () => {
    const el = inputEl.current;
    if (!el) return;
    setPlace(placeUnder(el));
    setHost(el.closest("dialog") ?? document.body);
  };
  const openList = () => {
    if (disabled || open) return;
    prepare();
    setOpen(true);
    setActive(initialActive(items, value));
  };
  const close = () => {
    setOpen(false);
    setActive(-1);
  };
  const pick = (option: ComboOption) => {
    if (!isEnabled(option)) return;
    setChosen(option);
    if (controlled === undefined) setOwn(option.value);
    setQuery(null);
    close();
    if (option.value !== value) onChange?.(option.value, option);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const effect = comboKey({ open, active, typing: query !== null }, items, event.key);
    if (!effect) return;
    if (effect.prevent) event.preventDefault();
    if (effect.stop) event.stopPropagation();
    if (effect.pick !== undefined && items[effect.pick]) return pick(items[effect.pick]);
    if (effect.open === true) openList();
    if (effect.open === false) close();
    if (effect.active !== undefined) setActive(effect.active);
    if (effect.revert) setQuery(null);
  };

  const activeId = open && active >= 0 && items[active] ? `${listId}-o${active}` : undefined;
  useImperativeHandle(inputRef, () => inputEl.current as HTMLInputElement, []);

  return (
    <span className={`ts-combo${className ? ` ${className}` : ""}`}>
      <input
        ref={inputEl}
        id={id}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={activeId}
        aria-label={ariaLabel}
        autoComplete="off"
        spellCheck={false}
        className="ts-field-direct"
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        autoFocus={autoFocus}
        title={shownLabel || undefined}
        value={query ?? shownLabel}
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          if (!open) {
            prepare();
            setOpen(true);
          }
          setActive(load ? -1 : moveActive(filterOptions(options ?? [], next), -1, "first"));
        }}
        onClick={openList}
        onKeyDown={onKeyDown}
        onBlur={() => {
          close();
          setQuery(null);
        }}
      />
      {name !== undefined && <input type="hidden" name={name} value={value} />}
      {open &&
        host &&
        createPortal(
          <ComboList id={listId} label={ariaLabel} items={items} active={active} value={value} query={text} status={status} emptyText={emptyText} style={place} onPick={pick} onHover={setActive} />,
          host,
        )}
    </span>
  );
}
