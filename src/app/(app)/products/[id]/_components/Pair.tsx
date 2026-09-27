import type { ReactNode } from "react";

/** 좁은 섹션 두 개를 한 줄에 — L2 「한눈에」(디자인원칙 §2 L2 · 리뷰 #52). */
export function Pair({ children }: { children: ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0 32px", alignItems: "start" }}>{children}</div>;
}
