"use client";

/**
 * 더보기 메뉴 — 상세 화면의 부차 조작(미리보기 · 삭제)을 버튼 하나 뒤에 모은다
 * (디자인원칙 「상세 화면 버튼 정리」 · 와이어프레임 §19A). 바탕은 shadcn DropdownMenu(Radix, ADR-0085).
 *
 * 항목은 링크가 기본이다 — 삭제도 확인 카드로 가는 링크(`?confirm=…`)라 여기서 실행하지 않는다.
 * 화면 안에서 여닫는 것(미리보기 대화상자 · 그 자리 팝업)은 `onSelect` 로 준다. 켜고 끄는 보기 설정(「수정 흔적 보기」)은 `checked` 를 준 체크 항목이다.
 * 바깥 클릭 · Esc 로 닫히고(초점은 트리거로), 화살표 · Home · End 로 항목을 오간다 — Radix 가 맡는다.
 */
import { useRef, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface MoreMenuItem {
  label: string;
  /** 링크 항목. `onSelect` 와 둘 중 하나. */
  href?: string;
  /** 화면 안 조작 — 누르면 메뉴를 닫고 부른다. 메뉴 버튼 자리를 넘긴다(그 아래에 팝업을 띄울 때). */
  onSelect?: (anchor: DOMRect) => void;
  /** 파괴적 항목 — hover/focus 에서만 error 색 (§1.6). */
  danger?: boolean;
  /** 항목 아래 한 줄 설명 — 고르기 전에 차이를 알아야 하는 메뉴(함수조항 `+` 의 문구 / 항). */
  hint?: string;
  /** 체크 항목 — 주면 켜고 끄는 보기 설정(`menuitemcheckbox`)이고, 켜짐이면 앞에 ✓. `onSelect` 로 뒤집는다 (2026-10-10). */
  checked?: boolean;
}

const DANGER = "text-foreground focus:bg-destructive-bg focus:text-destructive";

function Label({ item }: { item: MoreMenuItem }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span>{item.label}</span>
      {item.hint ? <span className="text-[12px] text-muted-foreground">{item.hint}</span> : null}
    </span>
  );
}

/**
 * `trigger` 를 주면 「더보기 ▾」 대신 그것을 버튼 속에 그린다(`+` 아이콘 등) — `label` 은 그때 버튼의 이름(tooltip)이 된다.
 * `align="start"` 면 메뉴가 버튼 왼쪽 끝에 맞춰 오른쪽으로 펼쳐진다(제목 옆 `+`).
 */
export function MoreMenu({
  label = "더보기",
  items,
  className,
  trigger,
  buttonClassName,
  align = "end",
}: {
  label?: string;
  items: MoreMenuItem[];
  className?: string;
  trigger?: ReactNode;
  buttonClassName?: string;
  align?: "start" | "end";
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const anchor = () => triggerRef.current?.getBoundingClientRect() ?? new DOMRect();

  return (
    <div className={cn("ts-more inline-flex", className)}>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={triggerRef}
            variant={trigger ? "ghost" : "default"}
            size={trigger ? "icon" : "default"}
            className={cn("ts-more-button", buttonClassName)}
            {...(trigger ? { title: label, "aria-label": label } : {})}
          >
            {trigger ?? (
              <>
                {label}
                <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
              </>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align} aria-label={label} className="min-w-44">
          {items.map((item) => {
            if (item.checked !== undefined) {
              return (
                <DropdownMenuCheckboxItem key={item.label} checked={item.checked} onSelect={() => item.onSelect?.(anchor())}>
                  <Label item={item} />
                </DropdownMenuCheckboxItem>
              );
            }
            if (item.href !== undefined) {
              return (
                <DropdownMenuItem key={item.label} asChild className={item.danger ? DANGER : undefined}>
                  <Link href={item.href}>
                    <Label item={item} />
                  </Link>
                </DropdownMenuItem>
              );
            }
            return (
              <DropdownMenuItem key={item.label} className={item.danger ? DANGER : undefined} onSelect={() => item.onSelect?.(anchor())}>
                <Label item={item} />
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
