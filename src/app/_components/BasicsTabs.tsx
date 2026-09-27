/**
 * 메뉴 「기본정보」의 탭 줄 — `열거형 | 폼 | 구분자` (기능/마스터 §4 · 기능/구분자 §4). 탭은 URL 이다:
 * 열거형 `/master/enums` · 폼 `/master` · 구분자 `/catalog`. 기능은 셋이 따로이고(ADR-0073) 이 탭 줄이 한 메뉴로 묶는다.
 * 탭 구성은 `_lib/menu` 의 `BASICS_TABS` — 내비 · 홈과 같은 정본.
 *
 * 현재 탭은 화면이 안다 — 사이드바 `NavLink` 처럼 경로 접두로 판정하면 `/master` 가 열거형 · 폼 두 탭에 걸린다.
 * `enums` 는 폼키로 쓰지 않는 예약어다 — 정적 세그먼트 `/master/enums` 가 폼 상세 `/master/[key]` 보다 먼저 잡힌다 (master/reserved.test.ts).
 */
import Link from "next/link";

import { BASICS_TABS, BASICS_TITLE, type BasicsTab } from "@/app/_lib/menu";

/** 상세 · 생성 화면의 경로 첫 마디 — 「기본정보」가 그 기능의 탭으로 돌아간다. */
export function basicsCrumb(tab: BasicsTab): { label: string; href: string } {
  const { href } = BASICS_TABS.find((t) => t.tab === tab) ?? BASICS_TABS[0];
  return { label: BASICS_TITLE, href };
}

export function BasicsTabs({ current }: { current: BasicsTab }) {
  return (
    <nav className="ts-subtabs" aria-label={`${BASICS_TITLE} 하위 탭`}>
      {BASICS_TABS.map(({ tab, href, label }) => (
        <Link key={tab} href={href} aria-current={tab === current ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
