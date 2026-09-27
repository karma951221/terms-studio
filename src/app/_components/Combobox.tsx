"use client";

/**
 * 검색되는 선택 상자 — 입력칸에 치면 걸러지고, 고르면 코드가 숨은 칸에 실린다.
 *
 * `<select>` 는 항목이 늘면 훑어야 하고 타이핑으로 못 좁힌다. `<datalist>` 는 표시명을 보여 주면서
 * 코드를 실을 방법이 없어서(값 하나뿐) 직접 만든다.
 *
 * 보이는 입력칸에는 **표시명**이, 폼에 실리는 숨은 칸에는 **코드**가 들어간다.
 * 고르지 않은 채 글자만 남으면 코드는 빈 값이다 — `required` 가 그때 막는다.
 */
import { useEffect, useId, useRef, useState } from "react";

export interface ComboOption {
  value: string;
  label: string;
}

export function Combobox({
  name,
  options,
  placeholder,
  required,
  ariaLabel,
}: {
  name: string;
  options: readonly ComboOption[];
  placeholder?: string;
  required?: boolean;
  ariaLabel: string;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ComboOption>();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  const needle = query.trim().toLowerCase();
  const shown = needle
    ? options.filter((o) => o.label.toLowerCase().includes(needle) || o.value.toLowerCase().includes(needle))
    : options;

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const choose = (option: ComboOption) => {
    setPicked(option);
    setQuery(option.label);
    setOpen(false);
  };

  return (
    <div className="ts-combo" ref={box}>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        autoComplete="off"
        className="ts-field-direct"
        placeholder={placeholder}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setPicked(undefined);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setActive((i) => (shown.length === 0 ? 0 : (i + (event.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length));
            return;
          }
          if (event.key === "Enter" && open && shown[active]) {
            event.preventDefault();
            choose(shown[active]);
            return;
          }
          if (event.key === "Escape") setOpen(false);
        }}
      />
      <input type="hidden" name={name} value={picked?.value ?? ""} />
      {required ? (
        /* 코드가 비면 제출을 막는다 — 보이는 칸은 표시명이라 required 를 걸 수 없다. */
        <input
          tabIndex={-1}
          aria-hidden
          className="ts-combo-guard"
          required
          value={picked?.value ?? ""}
          onChange={() => {}}
        />
      ) : null}
      {open && shown.length > 0 ? (
        <ul id={listId} className="ts-combo-list" role="listbox">
          {shown.map((option, index) => (
            <li key={option.value}>
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                className={index === active ? "is-active" : undefined}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(option)}
              >
                {option.label} <span className="ts-mono ts-muted">{option.value}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {open && shown.length === 0 ? <p className="ts-combo-empty">맞는 것이 없습니다</p> : null}
    </div>
  );
}
