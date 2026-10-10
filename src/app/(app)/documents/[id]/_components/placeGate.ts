"use client";

/**
 * 누르는 동안 자리 바꾸기를 미룬다 — 문면 · 함수조항 · 조 사본 편집기 공용 (기능/문면 §4.3).
 *
 * 자리가 바뀌면 툴바의 「조건 편집」 · 「고른 것 속성」 묶음이 켜질 때만 서므로 툴바 줄 수가 늘고 본문이 아래로 밀린다.
 * 누르는 순간(pointerdown · 초점) 밀리면 떼는 자리가 달라져 누른 버튼(조건 머리 줄 ⊕ 등)의 click 이 빗나가고,
 * 오른쪽 클릭 메뉴가 누른 칸이 아닌 블록의 목록이 된다. 그래서 누를 때는 자리만 적어 두고 뗄 때(pointerup) 바꾼다.
 * 누르지 않은 초점(키보드 이동)은 곧바로 바꾼다.
 */
import { useEffect, useState } from "react";

export interface PlaceGate<P> {
  /** 본문을 눌렀다 — 그 자리를 적어 두고 뗄 때 바꾼다. */
  press: (at: P) => void;
  /** 툴바 · 셀 조작 줄을 눌렀다 — 떼기까지 초점이 와도 자리를 바꾸지 않는다(그 줄은 자리를 바꾸지 않는다). */
  hold: () => void;
  /** 초점이 갔다 — 누르는 중이면 적어 둔 자리를 덮고, 아니면 곧바로 바꾼다. */
  focus: (at: P) => void;
  /** 뗐다(문서 어디서든) — 적어 둔 자리로 바꾼다. 누르지 않았으면 아무것도 하지 않는다. */
  release: () => void;
}

export function placeGate<P>(apply: (at: P) => void): PlaceGate<P> {
  // 누르는 중 — `at` 이 있으면 뗄 때 그 자리로, `keep` 이면 그대로
  let pending: { at: P } | { keep: true } | undefined;
  return {
    press: (at) => {
      pending = { at };
    },
    hold: () => {
      pending = { keep: true };
    },
    focus: (at) => {
      if (!pending) apply(at);
      else if ("at" in pending) pending = { at };
    },
    release: () => {
      const held = pending;
      pending = undefined;
      if (held && "at" in held) apply(held.at);
    },
  };
}

/**
 * `placeGate` 를 컴포넌트에 — 떼기는 문서 전체에서 받는다(본문 밖에서 떼도 · 끌기가 이벤트를 막아도).
 * `apply` 는 처음 것을 쓴다 — 상태 setter 처럼 바뀌지 않는 함수를 준다.
 */
export function usePlaceGate<P>(apply: (at: P) => void): PlaceGate<P> {
  const [gate] = useState(() => placeGate<P>(apply));
  useEffect(() => {
    document.addEventListener("pointerup", gate.release, true);
    document.addEventListener("pointercancel", gate.release, true);
    return () => {
      document.removeEventListener("pointerup", gate.release, true);
      document.removeEventListener("pointercancel", gate.release, true);
    };
  }, [gate]);
  return gate;
}
