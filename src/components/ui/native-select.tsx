import * as React from "react";

import { cn } from "@/lib/utils";

/** 네이티브 `<select>` 에 위젯 모양만 — 폼 제출 · 키보드 · E2E `selectOption` 이 그대로다 (ADR-0085). */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "h-8 w-full min-w-0 cursor-pointer appearance-none rounded-md border border-input bg-card bg-[length:14px] bg-[right_8px_center] bg-no-repeat py-0 pr-7 pl-2.5 text-[13px] text-foreground outline-none transition-[border-color,box-shadow] duration-150 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/15 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive",
        "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2377726a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]",
        className,
      )}
      {...props}
    />
  );
}

export { NativeSelect };
