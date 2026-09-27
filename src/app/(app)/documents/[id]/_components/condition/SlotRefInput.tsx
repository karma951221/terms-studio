"use client";

/**
 * 슬롯 참조 입력 — 반복 표 템플릿 셀 밖이면 지금과 같은 글자 입력(구분자 코드 datalist) 하나.
 * 반복 셀 안(`context.row`)이면 그 아래에 트리가 붙는다: 맨 위 「현재 행」 가지(한정자 없음) · 그 아래 실제 노드 트리(`@노드` 고정).
 * 잎을 더블클릭하면 입력칸에 그 참조 경로가 들어간다 (ADR-0070 · 설계 §3.1). 슬롯은 string · enum 결과만 찍는다 (기능/문면 §3.4).
 */
import { useState } from "react";

import { refPath } from "@/domain/expression";

import { DiscriminatorTree } from "./DiscriminatorTree";
import type { ConditionContext, CtxDiscriminator } from "./types";

const slotable = (d: CtxDiscriminator) => d.type?.kind === "string" || d.type?.kind === "enum";

export function SlotRefInput({ id, name, initial, context }: { id?: string; name: string; initial?: string; context: ConditionContext }) {
  const [value, setValue] = useState(initial ?? "");
  const [query, setQuery] = useState("");
  const input = <input id={id} type="text" name={name} list="slot-candidates" value={value} onChange={(e) => setValue(e.target.value)} placeholder="D0003.F01" className="ts-mono" />;
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
