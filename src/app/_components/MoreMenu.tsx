"use client";

/**
 * 더보기 메뉴 — 상세 화면의 부차 조작(미리보기 · 삭제)을 버튼 하나 뒤에 모은다
 * (디자인원칙 「상세 화면 버튼 정리」 · 와이어프레임 §19A).
 *
 * 항목은 링크가 기본이다 — 삭제도 확인 카드로 가는 링크(`?confirm=…`)라 여기서 실행하지 않는다.
 * 화면 안에서 여닫는 것(미리보기 대화상자 · 그 자리 팝업)은 `onSelect` 로 준다.
 * 바깥 클릭 · Esc 로 닫히고, 화살표로 항목을 오간다. 열림 상태는 `aria-expanded` 가 말한다.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";

export interface MoreMenuItem {
  label: string;
  /** 링크 항목. `onSelect` 와 둘 중 하나. */
  href?: string;
  /** 화면 안 조작 — 누르면 메뉴를 닫고 부른다. 메뉴 버튼 자리를 넘긴다(그 아래에 팝업을 띄울 때). */
  onSelect?: (anchor: DOMRect) => void;
  /** 파괴적 항목 — hover/focus 에서만 error 색 (§1.6). */
  danger?: boolean;
}

export function MoreMenu({ label = "더보기", items, className }: { label?: string; items: MoreMenuItem[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    // 열리면 첫 항목으로 초점 — 키보드로 연 사람이 바로 고를 수 있게
    listRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const nodes = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    if (nodes.length === 0) return;
    e.preventDefault();
    const at = nodes.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === "Home" ? 0 : e.key === "End" ? nodes.length - 1 : e.key === "ArrowDown" ? (at + 1) % nodes.length : (at - 1 + nodes.length) % nodes.length;
    nodes[next]?.focus();
  };

  return (
    <div ref={rootRef} className={["ts-more", className].filter(Boolean).join(" ")}>
      <button
        ref={buttonRef}
        type="button"
        className="ts-more-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {label}
        <span className="ts-more-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div ref={listRef} id={menuId} role="menu" aria-label={label} className="ts-more-menu" onKeyDown={onMenuKeyDown}>
          {items.map((item) =>
            item.href !== undefined ? (
              <Link
                key={item.label}
                role="menuitem"
                href={item.href}
                className={item.danger ? "ts-more-menu-item danger" : "ts-more-menu-item"}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={item.danger ? "ts-more-menu-item danger" : "ts-more-menu-item"}
                onClick={() => {
                  setOpen(false);
                  const rect = buttonRef.current?.getBoundingClientRect() ?? new DOMRect();
                  item.onSelect?.(rect);
                }}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
