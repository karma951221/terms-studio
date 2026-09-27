"use client";

/**
 * 좌측 내비의 접기·펴기 — 접으면 얇은 레일만 남고 펼치기 버튼 하나가 선다.
 * 제목(`term-studio`)은 홈(`/`) 링크다 — 접히면 홈 아이콘이 그 자리를 잇는다.
 * 상태는 쿠키(`ts-nav`)에 두어 서버 레이아웃이 첫 렌더부터 같은 모양을 그린다(깜빡임 없음).
 */
import Link from "next/link";
import { useState } from "react";

import { IconButton, IconChevron, IconHome } from "@/app/_components/icons";
import { NAV_COOKIE } from "@/app/_lib/navCookie";

export function NavShell({
  initialCollapsed,
  children,
}: {
  initialCollapsed: boolean;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${NAV_COOKIE}=${next ? "collapsed" : "open"}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <nav className="ts-nav" data-collapsed={collapsed || undefined}>
      <div className="ts-nav-head">
        {collapsed ? null : (
          <Link href="/" className="ts-nav-title">
            term-studio
          </Link>
        )}
        <IconButton
          className="ts-nav-toggle"
          label={collapsed ? "메뉴 펼치기" : "메뉴 접기"}
          aria-expanded={!collapsed}
          icon={<IconChevron />}
          onClick={toggle}
        />
      </div>
      {collapsed ? (
        <Link href="/" className="ts-nav-home" title="홈" aria-label="홈">
          <IconHome />
        </Link>
      ) : (
        children
      )}
    </nav>
  );
}
