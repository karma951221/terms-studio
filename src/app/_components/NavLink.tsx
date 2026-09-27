"use client";

/**
 * 좌측 내비 링크 — 현재 위치에 `aria-current="page"` 를 붙인다 (디자인원칙 §1.3, 발견 #61).
 * 색은 CSS(`.ts-nav a[aria-current="page"]`)가 준다. 여기서는 「어디 있는지」만 판단한다.
 *
 * 판단 규칙: 정확히 같거나, 세그먼트 경계로 시작하면 현재 위치다
 * (`/catalog/D0001` → 「기본정보」, `/products/x/preview` → 「상품」).
 * 기능 여럿을 탭으로 묶은 항목은 `activePaths` 로 접두를 여럿 준다 — 「기본정보」는 `/master` · `/catalog` 어디서나 현재 위치.
 *
 * `href` 에 쿼리가 있으면(`/documents?kind=coverage`) 그 값까지 같아야 현재 위치다 — 한 경로가 사이드바 항목
 * 둘로 갈리는 자리(보통약관 템플릿 · 담보약관 템플릿). 쿼리가 없는 하위 경로(`/documents/<id>`)에서는 페이지가
 * `NavHint` 로 알려 준 값과 비교한다.
 */
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Hint = Readonly<Record<string, string>>;

const HintContext = createContext<Hint>({});
const SetHintContext = createContext<(hint: Hint) => void>(() => {});

/** 레이아웃이 내비와 본문을 함께 감싼다 — 본문의 `NavHint` 가 내비의 `NavLink` 에 닿는 길. */
export function NavHintProvider({ children }: { children: ReactNode }) {
  const [hint, setHint] = useState<Hint>({});
  return (
    <SetHintContext.Provider value={setHint}>
      <HintContext.Provider value={hint}>{children}</HintContext.Provider>
    </SetHintContext.Provider>
  );
}

/** 하위 경로 화면이 「나는 이 쿼리 값에 속한다」고 알린다 (예: 문서 상세가 `kind` 를). 화면을 떠나면 지운다. */
export function NavHint(hint: Hint) {
  const setHint = useContext(SetHintContext);
  const key = JSON.stringify(hint);
  useEffect(() => {
    setHint(JSON.parse(key) as Hint);
    return () => setHint({});
  }, [key, setHint]);
  return null;
}

export function NavLink({ href, label, exact = false, excludePrefix, activePaths }: { href: string; label: string; exact?: boolean; excludePrefix?: string; activePaths?: readonly string[] }) {
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const hint = useContext(HintContext);
  const [path = "", queryString] = href.split("?");
  const onPath = pathname === path;
  const under = !exact && (activePaths ?? [path]).some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  const queryMatches = [...new URLSearchParams(queryString ?? "")].every(([key, value]) => (onPath ? searchParams.get(key) : hint[key]) === value);
  const current = (onPath || under) && queryMatches && !(excludePrefix && pathname.startsWith(excludePrefix));
  return (
    <Link href={href} aria-current={current ? "page" : undefined}>
      {label}
    </Link>
  );
}
