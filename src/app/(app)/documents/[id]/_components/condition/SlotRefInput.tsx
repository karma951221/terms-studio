"use client";

/**
 * 슬롯 참조 입력 — 구분자를 이름 · 코드로 찾아 고르는 검색 입력(콤보박스) 하나 (디자인원칙 §1.8).
 * 후보는 조건 문맥의 구분자 중 결과가 string · enum 인 것 (기능/문면 §3.4), 붙는 레벨로 묶는다.
 * 반복 표 템플릿 셀 안(`context.row`)이면 그 아래에 트리가 붙는다: 맨 위 「현재 행」 가지(한정자 없음) · 그 아래 실제 노드 트리(`@노드` 고정).
 * 잎을 더블클릭하면 입력칸에 그 참조 경로가 들어간다 (ADR-0070 · 설계 §3.1).
 * 종 반복 안(`context.plan`)이면 맨 앞에 「현재 종」 묶음 — 종형명(`builtin.plan.name`) · 선택지 번호(`builtin.plan.number`) (ADR-0077 결정 3).
 * 열거값 반복 안(`context.value`)이면 그 앞에 「현재 값」 묶음 — 값 이름(`builtin.value.name`) · 열거값 글 필드(`builtin.value.<필드키>`) (ADR-0088 결정 1).
 */
import { useState } from "react";

import { Combobox, type ComboOption } from "@/app/_components/Combobox";
import { currentValueRef, currentValueSlot } from "@/domain/document";
import { refPath } from "@/domain/expression";
import { ATTACH_LEVELS, ATTACH_LEVEL_LABEL } from "@/domain/types";

import { DiscriminatorTree } from "./DiscriminatorTree";
import { qualifiedLabel } from "./rows";
import type { ConditionContext, CtxDiscriminator } from "./types";

const slotable = (d: CtxDiscriminator) => d.type?.kind === "string" || d.type?.kind === "enum";

/** 「현재 종」 묶음의 내장 경로 — 원문 표기 「2종(보험료 납입면제형)」 = 번호 슬롯 + 「종(」 + 이름 슬롯 + 「)」 (기능/문면 §3.7). */
const PLAN_SLOTS: readonly { path: string; label: string }[] = [
  { path: "builtin.plan.name", label: "종형명" },
  { path: "builtin.plan.number", label: "선택지 번호" },
];

/** 「현재 값」 묶음의 값 이름 줄. */
const VALUE_NAME = "값 이름";

/** 후보 — 구분자 코드 하나씩, 붙는 레벨 순으로 묶는다. */
export function slotOptions(context: ConditionContext): ComboOption[] {
  // 함수조항 본문 — 인자(`arg.<이름>` · 필드 `arg.<이름>.F01`) · 내부 변수(`var.<이름>`)가 맨 앞 묶음 (최종 결정 2 · 18)
  const params = context.discriminators.filter((d) => d.param && slotable(d)).map((d) => ({ value: d.code, label: d.label, hint: d.code, group: "인자" }));
  const locals = context.discriminators.filter((d) => d.local && slotable(d)).map((d) => ({ value: d.code, label: d.label, hint: d.code, group: "내부 변수" }));
  const plan = context.plan ? PLAN_SLOTS.map((p) => ({ value: p.path, label: p.label, hint: p.path, group: `현재 종 — ${context.plan!.name}` })) : [];
  const value = context.value
    ? [{ key: undefined, label: VALUE_NAME }, ...context.value.fields].map((f) => ({ value: currentValueRef(f.key), label: f.label, hint: currentValueRef(f.key), group: `현재 값 — ${context.value!.name}` }))
    : [];
  return [
    ...value,
    ...plan,
    ...params,
    ...locals,
    ...ATTACH_LEVELS.flatMap((level) =>
      context.discriminators.filter((d) => !d.param && !d.local && d.level === level && slotable(d)).map((d) => ({ value: d.code, label: d.label, hint: d.code, group: ATTACH_LEVEL_LABEL[level] })),
    ),
  ];
}

/** 후보에 없는 경로(트리에서 고른 `코드@키경로`)의 이름 — 「세부보장 01 · 이름 › 급부 1 · 이름 › 구분자」. 모르는 코드면 undefined(경로 그대로 보인다). */
export function slotPathLabel(context: ConditionContext, path: string): string | undefined {
  const builtin = PLAN_SLOTS.find((p) => p.path === path);
  if (builtin) return `현재 종 › ${builtin.label}`;
  const current = currentValueSlot(path);
  if (current) return `현재 값 › ${current.kind === "name" ? VALUE_NAME : (context.value?.fields.find((f) => f.key === current.field)?.label ?? current.field)}`;
  const [code, keyPath] = path.split("@");
  const d = context.discriminators.find((x) => x.code === code);
  if (!d) return undefined;
  if (!keyPath) return d.label;
  return qualifiedLabel(context, d.label, keyPath);
}

export function SlotRefInput({ id, name, initial, context }: { id?: string; name: string; initial?: string; context: ConditionContext }) {
  const [value, setValue] = useState(initial ?? "");
  const [query, setQuery] = useState("");
  const input = (
    <Combobox
      id={id}
      name={name}
      value={value}
      onChange={setValue}
      options={slotOptions(context)}
      valueLabel={slotPathLabel(context, value)}
      placeholder="구분자 이름 · 코드로 찾기"
      emptyText="일치하는 구분자 없음 (결과가 문자 · 열거형인 것만 찍는다)"
    />
  );
  if (!context.row || !context.coverage) return input;
  return (
    <span className="ts-slot-ref">
      {input}
      <span className="ts-slot-ref-tree" style={{ display: "block", marginTop: 6 }}>
        <input type="search" placeholder="구분자 검색" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="슬롯 구분자 검색" />
        <DiscriminatorTree context={context} query={query} accept={slotable} onPick={(ref) => setValue(refPath(ref))} />
        <span className="ts-muted">잎을 더블클릭하면 참조 칸에 들어간다.</span>
      </span>
    </span>
  );
}
