"use client";

/**
 * 사용처를 모달로 — 상세 화면에 상시로 펼쳐 두면 편집할 필드보다 자리를 더 먹는다.
 * 볼 일이 있을 때만 연다.
 *
 * `showModal()` 로 연다 — `<dialog open>` 은 backdrop 도 ESC 도 없어서 뒤가 살아 있다.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

export function UsageDialog({ count, children }: { count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        사용처 <b>{count}</b>
      </button>
      <dialog ref={ref} className="ts-dialog ts-dialog-wide" onClose={() => setOpen(false)}>
        <div className="ts-dialog-body">{children}</div>
        <div className="ts-confirm-actions">
          <button type="button" onClick={() => setOpen(false)}>
            닫기
          </button>
        </div>
      </dialog>
    </>
  );
}
