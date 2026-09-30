"use client";

/**
 * 기본정보 저장 확인 — 화면 위쪽 모달 (2026-10-01, 옛 인라인 「저장하면 아래 항목이 삭제된다」 카드).
 *
 * 저장이 무엇을 함께 바꾸는지 서비스가 준 줄(`impact.cascade`)을 그대로 보인다 — 세목 제거(보험종목 · 종·형 조합 · 세목 부착)와
 * 독립특약 전환의 기본계약 해제(기능/상품 §3.1)가 한 창에 모인다. 모양 · 여는 법은 편집 떠나기 확인(`DiscardDialog`)과 같다:
 * ref + effect 로 showModal (jsdom 은 제자리로 연다), Esc = 취소.
 */
import { useEffect, useRef } from "react";

import type { Impact } from "@/domain/types";

export function SaveConfirmDialog({ impact, pending, onCancel, onConfirm }: { impact: Impact; pending?: boolean; onCancel: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    // jsdom 에는 showModal 이 없다 — 그때는 제자리로 연다
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }, []);
  return (
    <dialog
      ref={ref}
      className="ts-dialog ts-dialog-top"
      aria-labelledby="ts-save-confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <p id="ts-save-confirm-title" className="ts-confirm-title">저장하면 아래 내용이 함께 바뀝니다</p>
      <ul className="ts-confirm-loss">
        {impact.valueRowsLost > 0 && <li>입력한 값 {impact.valueRowsLost}건이 함께 삭제됩니다</li>}
        {impact.cascade.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
        {impact.brokenRefs.length > 0 && <li>깨지는 참조 {impact.brokenRefs.length}건</li>}
      </ul>
      <div className="ts-confirm-actions">
        <button type="button" autoFocus disabled={pending} onClick={onCancel}>
          취소
        </button>
        <button type="button" className="danger" disabled={pending} onClick={onConfirm}>
          바꾸고 저장
        </button>
      </div>
    </dialog>
  );
}
