"use client";

/**
 * 마스터 표의 행 · 폼 칸 전체 클릭 (2026-09-27 L1 목록 전환) — 칸 안의 진짜 `<Link>` 는 그대로 두고(키보드 · 가운데 클릭),
 * 그 밖의 빈 자리를 눌러도 같은 곳으로 간다. 안쪽 링크 · 버튼 클릭과 글자 드래그 선택은 가로채지 않는다.
 * 폼 칸(`ClickCell`)은 행(`ClickRow`)보다 먼저 받아 전파를 끊는다 — 폼 칸은 폼 상세, 나머지는 필드 상세.
 */
import { useRouter } from "next/navigation";
import type { MouseEvent, ReactNode, TdHTMLAttributes } from "react";

function useGo(href: string) {
  const router = useRouter();
  return (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("a, button, input, label")) return;
    if (window.getSelection()?.toString()) return;
    event.stopPropagation();
    if (event.metaKey || event.ctrlKey) window.open(href, "_blank");
    else router.push(href);
  };
}

export function ClickRow({ href, children }: { href: string; children: ReactNode }) {
  const go = useGo(href);
  return (
    <tr className="ts-master-row" onClick={go}>
      {children}
    </tr>
  );
}

export function ClickCell({ href, children, ...rest }: { href: string; children: ReactNode } & TdHTMLAttributes<HTMLTableCellElement>) {
  const go = useGo(href);
  return (
    <td {...rest} onClick={go}>
      {children}
    </td>
  );
}
