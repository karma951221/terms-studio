"use client";

import { Info } from "lucide-react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/** 제목 · 라벨 옆 ⓘ — 필요한 설명은 여기 (디자인원칙 §2 L1). */
export function InfoTip({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="ts-infotip inline-flex cursor-help text-muted-foreground" tabIndex={0} aria-label={text}>
            <Info className="size-3.5" aria-hidden="true" />
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-80 whitespace-pre-line">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
