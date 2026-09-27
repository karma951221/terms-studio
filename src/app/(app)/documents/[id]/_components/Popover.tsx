"use client";

/**
 * 그 자리 팝업 · 오른쪽 클릭 메뉴 (기능/문면 §4.3).
 *
 * - `Popover` — 누른 자리 **바로 아래**에 뜨는 모달 `<dialog>`. 아래가 모자라면 위로 올린다. Esc · 바깥 클릭으로 닫힌다.
 * - `ContextMenu` — 브라우저 기본 메뉴 대신 뜨는 앱 메뉴(툴바의 지름길). 팝업 안에서 열면 그 팝업 안에 그린다(모달 밖은 눌리지 않는다).
 *   툴바의 여러 갈래 버튼(옵션 자리 ▾)도 이 메뉴로 고른다.
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import type { Anchor } from "./ctx";
import { forContextMenu, type MenuItem, type MenuSections } from "./menus";

/** 떠 있는 요소를 자리 바로 아래에 — 화면 밖으로 나가지 않게 당긴다. */
export function placeAt(el: HTMLElement, anchor: Anchor): void {
  el.style.position = "fixed";
  el.style.margin = "0";
  el.style.inset = "auto";
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top = anchor.y + 4;
  if (top + r.height > vh - 8 && anchor.top !== undefined && anchor.top - r.height - 4 >= 8) top = anchor.top - r.height - 4;
  top = Math.max(8, Math.min(top, vh - r.height - 8));
  const left = Math.max(8, Math.min(anchor.x, vw - r.width - 8));
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
}

export function Popover({ anchor, label, onClose, children, wide }: { anchor: Anchor; label: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!d.open) d.showModal();
    placeAt(d, anchor);
  }, [anchor]);
  return (
    <dialog
      ref={ref}
      className={`ts-dialog ts-pop${wide ? " is-wide" : ""}`}
      aria-label={label}
      onClose={(e) => {
        // 안에 뜬 조건 팝업(dialog)이 닫힐 때의 close 는 React 트리를 타고 여기까지 온다 — 제 것만 받는다
        if (e.target === e.currentTarget) onClose();
      }}
      onMouseDown={(e) => {
        // 바깥(backdrop) 클릭 — 대상이 dialog 자신이고 좌표가 상자 밖이면 닫는다
        if (e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose();
      }}
    >
      <p className="ts-pop-title">{label}</p>
      {children}
    </dialog>
  );
}

/** 팝업의 확인 · 취소 줄 — 확인은 편집본에 곧바로 적용한다(서버로 가지 않는다). */
export function PopActions({ onCancel, confirmLabel = "확인", disabled }: { onCancel: () => void; confirmLabel?: string; disabled?: boolean }) {
  return (
    <div className="ts-form-actions">
      <button type="button" onClick={onCancel}>
        취소
      </button>
      <button type="submit" className="primary" disabled={disabled}>
        {confirmLabel}
      </button>
    </div>
  );
}

function topModal(): HTMLElement {
  const open = Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]")).filter((d) => d.matches(":modal"));
  return open.at(-1) ?? document.body;
}

export function ContextMenu({ x, y, sections, onPick, onClose }: { x: number; y: number; sections: MenuSections; onPick: (item: MenuItem) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [host] = useState<HTMLElement>(() => topModal());
  // 툴바 전용(조건 넣기)은 오른쪽 클릭 메뉴에 싣지 않는다 (기능/문면 §4.3)
  const shown = forContextMenu(sections);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    placeAt(el, { x, y: y - 4 });
    el.querySelector<HTMLElement>("[role=menuitem]:not([disabled])")?.focus();
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as globalThis.Node)) onClose();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        // 팝업 안에서 연 메뉴면 Esc 가 팝업까지 닫지 않게 여기서 멈춘다
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const nodes = Array.from(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([disabled])") ?? []);
    if (nodes.length === 0) return;
    e.preventDefault();
    const at = nodes.indexOf(document.activeElement as HTMLElement);
    nodes[e.key === "ArrowDown" ? (at + 1) % nodes.length : (at - 1 + nodes.length) % nodes.length]?.focus();
  };

  return createPortal(
    <div ref={ref} role="menu" aria-label="편집 메뉴" className="ts-ctx-menu" onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
      {shown.length === 0 ? (
        <p className="ts-muted">이 자리에서 할 수 있는 것이 없다.</p>
      ) : (
        shown.map((section, i) => (
          <div key={i} className="ts-ctx-section">
            {section.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={item.danger ? "danger" : undefined}
                disabled={item.disabled}
                onClick={() => {
                  onClose();
                  onPick(item);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        ))
      )}
    </div>,
    host,
  );
}
