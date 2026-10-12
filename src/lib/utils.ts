import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn 위젯의 클래스 합치기 — 뒤에 준 Tailwind 클래스가 같은 속성의 앞 것을 지운다 (ADR-0085). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
