"use client";

/**
 * 식 입력 — 커서 자리 삽입이 되는 입력 (기능/구분자 §4.3 「더블클릭으로 커서 자리에 토큰이 들어간다」).
 *
 * `useExpressionInsert` 가 `<input ref>` 와 `insert(text, caret)` 을 준다: 지금 커서(`selectionStart`)에 `insertAt` 으로
 * 넣고 값을 올린 뒤, 다시 그린 다음 커서를 넣은 텍스트 뒤(집계면 괄호 안)로 되돌린다. 값의 주인은 호출부다 —
 * 상세는 EditShell 문맥(`useEditField("expression")`), 생성은 로컬 state.
 */
import { useEffect, useRef, type RefObject } from "react";

import type { AttachLevel } from "@/domain/types";

import { insertAt, insideAggregate, referenceToken, type PanelRef } from "../lib";

export function useExpressionInsert(value: string, setValue: (next: string) => void): {
  ref: RefObject<HTMLInputElement | null>;
  /** 텍스트를 커서 자리에 (연산 토큰). */
  insert: (text: string, caret?: number) => void;
  /** 참조 항목을 커서 자리에 — 하위 레벨은 집계로 감싸되, 커서가 이미 집계 괄호 안이면 경로만 (`referenceToken`). */
  insertReference: (item: PanelRef, level: AttachLevel) => void;
} {
  const ref = useRef<HTMLInputElement>(null);
  const pendingCursor = useRef<number | undefined>(undefined);
  // 값이 바뀐 뒤 커서를 되돌린다 — setValue 직후에는 input 이 아직 옛 값이라 setSelectionRange 가 어긋난다
  useEffect(() => {
    const el = ref.current;
    const cursor = pendingCursor.current;
    if (!el || cursor === undefined) return;
    pendingCursor.current = undefined;
    el.focus();
    el.setSelectionRange(cursor, cursor);
  }, [value]);
  const cursorNow = () => ref.current?.selectionStart ?? value.length;
  const insert = (text: string, caret?: number) => {
    const next = insertAt(value, cursorNow(), text, caret);
    pendingCursor.current = next.cursor;
    setValue(next.value);
  };
  const insertReference = (item: PanelRef, level: AttachLevel) => {
    const cursor = cursorNow();
    const token = referenceToken(item.path, item.level, level, item.typeKind, { insideAggregate: insideAggregate(value, cursor) });
    if (token === undefined) return; // 상위 레벨 — 패널이 이미 막지만 여기서도 넣지 않는다
    const next = insertAt(value, cursor, token);
    pendingCursor.current = next.cursor;
    setValue(next.value);
  };
  return { ref, insert, insertReference };
}

/** 식 `<input>` — 코드 글꼴. 제어형이며 ref 로 커서를 다룬다. */
export function ExpressionInput({ inputRef, value, onChange, id, name, className, placeholder, required }: { inputRef: RefObject<HTMLInputElement | null>; value: string; onChange: (next: string) => void; id?: string; name?: string; className?: string; placeholder?: string; required?: boolean }) {
  return <input ref={inputRef} id={id} name={name} type="text" value={value} onChange={(event) => onChange(event.target.value)} className={`ts-mono ${className ?? ""}`} placeholder={placeholder} required={required} autoComplete="off" spellCheck={false} />;
}
