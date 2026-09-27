/**
 * 마스터의 하위 탭 — `폼 | 열거형변수` (기능/마스터 §4). 탭은 URL 이다: 폼 `/master` · 열거형변수 `/master/enums`.
 *
 * 현재 탭은 화면이 안다 — 사이드바 `NavLink` 처럼 경로 접두로 판정하면 `/master` 가 두 탭 모두에 걸린다.
 * `enums` 는 폼키로 쓰지 않는 예약어다 — 정적 세그먼트 `/master/enums` 가 폼 상세 `/master/[key]` 보다 먼저 잡힌다 (reserved.test.ts).
 */
import Link from "next/link";

import { ENTITY_LABEL } from "@/app/_lib/labels";

export type MasterTab = "forms" | "enums";

export const MASTER_TABS: readonly { tab: MasterTab; href: string; label: string }[] = [
  { tab: "forms", href: "/master", label: "폼" },
  { tab: "enums", href: "/master/enums", label: ENTITY_LABEL.enum },
];

/** 열거형변수 상세 · 생성의 경로 첫 마디 — 「마스터」가 열거형변수 탭으로 돌아간다. */
export const ENUMS_CRUMB = { label: "마스터", href: "/master/enums" } as const;

export function MasterTabs({ current }: { current: MasterTab }) {
  return (
    <nav className="ts-subtabs" aria-label="마스터 하위 탭">
      {MASTER_TABS.map(({ tab, href, label }) => (
        <Link key={tab} href={href} aria-current={tab === current ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
