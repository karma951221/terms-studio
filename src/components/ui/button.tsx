import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * 버튼 — 디자인원칙 §1.3 · §1.6 · §5, ADR-0085.
 * primary 는 채우지 않는다(주칠 테두리 + 주칠 굵은 글자). destructive 는 평소 뉴트럴, hover · focus 에서만 error 로 물든다.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] leading-none no-underline transition-[color,background-color,border-color,box-shadow] duration-150 ease-out outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/15 disabled:pointer-events-none disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default: "border border-input bg-card text-foreground hover:bg-accent",
        primary: "border border-mark bg-card font-bold text-mark hover:bg-mark-bg",
        destructive:
          "border border-input bg-card text-muted-foreground hover:border-destructive hover:bg-destructive-bg hover:text-destructive focus-visible:border-destructive focus-visible:text-destructive",
        ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
        "ghost-destructive": "text-muted-foreground hover:bg-destructive-bg hover:text-destructive focus-visible:text-destructive",
        link: "h-auto px-0 text-foreground underline-offset-4 hover:text-mark hover:underline",
      },
      size: {
        default: "h-8 px-3",
        sm: "h-7 px-2.5",
        icon: "size-8",
        "icon-sm": "size-6",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
