"use client";

/**
 * 결과 타입 기본값 따라가기 (기능/구분자 §3.1 · §4.2 · §4.4, 2026-10-17 — 결과 타입 필수).
 *
 * 식(또는 생성의 레벨)이 바뀔 때마다 호출부가 `follow(식, 레벨)` 을 부른다 — 이펙트가 아니라 바꾸는 자리에서 바로.
 * 새 식의 추론 타입을 순수하게 구하고(`inferResultTypeForm`, 서버 왕복 없음), 지금 값이 직전 식의 추론 타입과 같을 때만
 * (= 사람이 아직 안 골랐다) 새 추론으로 바꾼다 (`autoResultTypeForm`). 직전 추론은 식이 설 때만 갱신한다 —
 * 치는 도중 잠깐 안 서는 식(`any(`)을 지나도 다시 서면 따라간다.
 */
import { useMemo, useRef, useState } from "react";

import type { Discriminator } from "@/domain/catalog/types";
import type { AttachLevel } from "@/domain/types";

import { autoResultTypeForm, inferResultTypeForm, type ResultTypeForm } from "../lib";

export function useAutoResultType({
  catalog,
  initial,
  read,
  write,
}: {
  /** 구분자 참조를 풀 카탈로그 — 서버가 넘긴 구분자 목록. */
  catalog: readonly Discriminator[];
  /** 처음 식 · 레벨 — 상세 편집은 저장된 식(그 추론 = 저장된 타입), 생성은 빈 식. */
  initial: { expression: string; level: AttachLevel };
  /** 지금 결과 타입 폼 값. */
  read: () => ResultTypeForm;
  write: (form: ResultTypeForm) => void;
}): (expression: string, level: AttachLevel) => void {
  const byCode = useMemo(() => new Map(catalog.map((d) => [d.code, d])), [catalog]);
  const [initialInferred] = useState(() => inferResultTypeForm(initial.expression, initial.level, new Map(catalog.map((d) => [d.code, d]))));
  const previous = useRef<ResultTypeForm | undefined>(initialInferred);
  return (expression, level) => {
    const next = inferResultTypeForm(expression, level, byCode);
    const current = read();
    const chosen = autoResultTypeForm(current, previous.current, next);
    if (next) previous.current = next;
    if (chosen !== current) write(chosen);
  };
}
