/**
 * 공통 레이아웃 — 좌측 내비(홈과 같은 단계 묶음 — `_lib/menu`) + 현재 사용자·역할·로그아웃.
 * 내비는 접을 수 있다(`NavShell`) — 접힘 여부는 쿠키로 서버 첫 렌더에 반영한다.
 * 로그인 세션이 없으면 `currentActor()` 가 `/login` 으로 redirect 한다.
 *
 * 현재 위치 표시는 `NavLink`(클라이언트 leaf)가 `aria-current="page"` 로 붙인다 — 디자인원칙 §1.3.
 * 약관 템플릿은 한 경로(`/documents`)가 종류(`?kind=`)로 항목 둘에 갈린다 — `NavHintProvider` 가 상세 화면의 종류를 내비에 전한다.
 */
import { cookies } from "next/headers";
import { Suspense } from "react";

import { NavHintProvider, NavLink } from "@/app/_components/NavLink";
import { NavShell } from "@/app/_components/NavShell";
import { ROLE_LABEL } from "@/app/_lib/labels";
import { MENU_CHECK, MENU_FLOW } from "@/app/_lib/menu";
import { NAV_COOKIE } from "@/app/_lib/navCookie";
import { logoutAction } from "@/app/login/actions";
import { currentActor, getServices } from "@/lib/services";

const NAV_GROUPS = [...MENU_FLOW, MENU_CHECK];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActor();
  const users = await getServices().auth.listUsers();
  const me = users.find((u) => u.id === actor.userId);
  const navCollapsed = (await cookies()).get(NAV_COOKIE)?.value === "collapsed";

  return (
    <NavHintProvider>
      <div className="ts-app">
        <NavShell initialCollapsed={navCollapsed}>
          <Suspense>
            {NAV_GROUPS.map((group) => (
              <div key={group.title} className="ts-nav-group">
                <p className="ts-nav-group-title">{group.title}</p>
                {group.items.map((item) => (
                  <NavLink key={item.href} href={item.href} label={item.label} />
                ))}
              </div>
            ))}
          </Suspense>
          <div className="ts-nav-user">
            <div>
              {me?.name ?? actor.userId} · {ROLE_LABEL[actor.role] ?? actor.role}
            </div>
            <form action={logoutAction}>
              <button type="submit">로그아웃</button>
            </form>
          </div>
        </NavShell>
        <main className="ts-main">{children}</main>
      </div>
    </NavHintProvider>
  );
}
