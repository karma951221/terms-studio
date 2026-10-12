import * as React from "react";

import { cn } from "@/lib/utils";

/** 네이티브 `<select>` 에 위젯 모양만 — 폼 제출 · 키보드 · E2E `selectOption` 이 그대로다 (ADR-0085). */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "h-8 w-full min-w-0 cursor-pointer appearance-none rounded-md border border-input bg-card bg-size-[14px] bg-position-[right_8px_center] bg-no-repeat py-0 pr-7 pl-2.5 text-[13px] text-foreground outline-none transition-[border-color,box-shadow] duration-150 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/15 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive",
        "bg-[url(data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2024%2024%27%20fill=%27none%27%20stroke=%27%2377726a%27%20stroke-width=%272%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27%3E%3Cpath%20d=%27m6%209%206%206%206-6%27/%3E%3C/svg%3E)]",
        className,
      )}
      {...props}
    />
  );
}

export { NativeSelect };
