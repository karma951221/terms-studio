"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

/** 경로의 한 마디 — 상위 화면은 `href` 로 이동한다. 마지막 마디(현재 화면)의 `href` 는 무시된다. */
export interface Crumb {
  label: string;
  href?: string;
}

/**
 * 상세 화면의 경로가 곧 제목 줄이다 — 「상품 › 알파Plus보장보험 › 골절진단비Ⅱ」 (디자인원칙 §1.7).
 * 앞 마디는 상위 화면으로 가는 링크(옅게), 마지막 마디는 현재 화면이라 링크가 아니고 진하게 선다(`aria-current`).
 * 조회 화면(L1)에는 두지 않는다 — 상단 내비의 현재 위치 표시가 그 역할이다.
 * 돌아가는 길은 이 경로 하나다. 「← 목록으로」류 링크를 따로 두지 않는다.
 *
 * `guard` 는 편집 중 미저장 변경을 지키는 확인(EditShell 의 `leave`) — 앞 마디 링크가 그 확인을 거쳐 이동한다.
 */
export function Breadcrumb({ items, guard }: { items: readonly Crumb[]; guard?: (go: () => void) => void }) {
  const router = useRouter();
  const last = items.length - 1;
  return (
    <h1 className="ts-h1 ts-path">
      {items.map((item, i) =>
        i === last ? (
          <span key={i} className="ts-crumb-current" aria-current="page">
            {item.label}
          </span>
        ) : (
          <span key={i}>
            {item.href ? (
              <Link
                href={item.href}
                className="ts-crumb"
                onClick={
                  guard
                    ? (event) => {
                        event.preventDefault();
                        guard(() => router.push(item.href!));
                      }
                    : undefined
                }
              >
                {item.label}
              </Link>
            ) : (
              <span className="ts-crumb">{item.label}</span>
            )}
            <span className="ts-crumb-sep">›</span>
          </span>
        ),
      )}
    </h1>
  );
}
