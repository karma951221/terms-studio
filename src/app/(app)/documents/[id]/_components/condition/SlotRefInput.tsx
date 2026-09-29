"use client";

/**
 * 슬롯 참조 입력 — 구분자를 이름 · 코드로 찾아 고르는 검색 입력(콤보박스) 하나 (디자인원칙 §1.8).
 * 후보는 조건 문맥의 구분자 중 결과가 string · enum 인 것 (기능/문면 §3.4), 붙는 레벨로 묶는다.
 * 반복 표 템플릿 셀 안(`context.row`)이면 그 아래에 트리가 붙는다: 맨 위 「현재 행」 가지(한정자 없음) · 그 아래 실제 노드 트리(`@노드` 고정).
 * 잎을 더블클릭하면 입력칸에 그 참조 경로가 들어간다 (ADR-0070 · 설계 §3.1).
 */
import { useState } from "react";

import { Combobox, type ComboOption } from "@/app/_components/Combobox";
import { refPath } from "@/domain/expression";
import { ATTACH_LEVELS, ATTACH_LEVEL_LABEL } from "@/domain/types";

import { DiscriminatorTree } from "./DiscriminatorTree";
import type { ConditionContext, CtxDiscriminator } from "./types";

const slotable = (d: CtxDiscriminator) => d.type?.kind === "string" || d.type?.kind === "enum";

/** 후보 — 구분자 코드 하나씩, 붙는 레벨 순으로 묶는다. */
export function slotOptions(context: ConditionContext): ComboOption[] {
  // 함수조항 본문 — 인자(`arg.<이름>` · 필드 `arg.<이름>.F01`) · 내부 변수(`var.<이름>`)가 맨 앞 묶음 (최종 결정 2 · 18)
  const params = context.discriminators.filter((d) => d.param && slotable(d)).map((d) => ({ value: d.code, label: d.label, hint: d.code, group: "인자" }));
  const locals = context.discriminators.filter((d) => d.local && slotable(d)).map((d) => ({ value: d.code, label: d.label, hint: d.code, group: "내부 변수" }));
  return [
    ...params,
    ...locals,
    ...ATTACH_LEVELS.flatMap((level) =>
      context.discriminators.filter((d) => !d.param && !d.local && d.level === level && slotable(d)).map((d) => ({ value: d.code, label: d.label, hint: d.code, group: ATTACH_LEVEL_LABEL[level] })),
    ),
  ];
}

/** 후보에 없는 경로(트리에서 고른 `코드@노드`)의 이름 — 「이름 @노드이름」. 모르는 코드면 undefined(경로 그대로 보인다). */
export function slotPathLabel(context: ConditionContext, path: string): string | undefined {
  const [code, nodeId] = path.split("@");
  const d = context.discriminators.find((x) => x.code === code);
  if (!d) return undefined;
  if (!nodeId) return d.label;
  return `${d.label} @${context.coverage?.nodes.find((n) => n.id === nodeId)?.name ?? "끊어진 노드"}`;
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
