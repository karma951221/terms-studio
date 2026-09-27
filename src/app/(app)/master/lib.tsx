/**
 * 마스터 화면의 공통 조각 — 링크 · 값 표기 · 타입 표기. FormDetail · FieldDetail · MasterTable · page 가 같이 쓴다.
 * 링크는 상세 경로 `/master/{폼키}` · `/master/{폼키.필드키}` (2026-09-27 두 칸 → L1 목록 + 상세 화면 전환 — 목록 상태를 실어 나르지 않는다).
 */
import Link from "next/link";

import { TYPE_LABEL } from "@/app/_lib/labels";
import type { FieldType, Value } from "@/domain/types";

export type EnumLabels = ReadonlyMap<string, string>;

/** 폼 상세 — `/master/{폼키}`. */
export function formHref(key: string): string {
  return `/master/${encodeURIComponent(key)}`;
}

/** 필드 상세 — `/master/{폼키.필드키}`. `page` 는 값 노드 페이저 — 1 이면 안 싣는다. */
export function fieldHref(path: string, page?: number): string {
  const base = `/master/${encodeURIComponent(path)}`;
  return page && page > 1 ? `${base}?page=${page}` : base;
}

/** 기본값 표기 — 없으면 「—」 (프리필일 뿐이라 「미입력」이 아니다). */
export function defaultValueText(value: Value | undefined): string {
  if (value === undefined) return "—";
  if (typeof value === "boolean") return value ? "예" : "아니오";
  if (Array.isArray(value)) return value.length === 0 ? "—" : value.join(", ");
  return String(value);
}

/** 노드에 들어 있는 값 표기 — enum 은 값 표시명으로, 없으면 「미입력」. 명시 입력된 빈 목록은 미입력이 아니다 (ADR-0004) — 「(선택 없음)」. */
export function nodeValueText(value: Value | undefined, type: FieldType, valueLabel: (enumCode: string, valueCode: string) => string): string {
  if (value === undefined) return "미입력";
  if (typeof value === "boolean") return value ? "예" : "아니오";
  const enumCode = type.kind === "enum" || type.kind === "list<enum>" ? type.enumCode : undefined;
  if (Array.isArray(value)) {
    if (value.length === 0) return "(선택 없음)";
    // table 표시는 아직 없다 — 후속 태스크가 채운다. 그 전까지는 행 수만 보인다.
    if (type.kind === "table") return `${value.length}행`;
    return (value as string[]).map((v) => (enumCode ? valueLabel(enumCode, v) : v)).join(", ");
  }
  if (enumCode && typeof value === "string") return valueLabel(enumCode, value);
  return String(value);
}

/** 타입 표기 — enum 계열은 열거형변수 링크(유형 화면)를 붙인다. */
export function TypeText({ type, enumLabels }: { type: FieldType; enumLabels: EnumLabels }) {
  if (type.kind !== "enum" && type.kind !== "list<enum>") return <>{TYPE_LABEL[type.kind]}</>;
  return (
    <>
      {TYPE_LABEL[type.kind]} ▸ <Link href={`/types/enums/${encodeURIComponent(type.enumCode)}`}>{enumLabels.get(type.enumCode) ?? type.enumCode}</Link>
    </>
  );
}
