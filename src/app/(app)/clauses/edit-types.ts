/** 공용조항 상세의 편집 대상 — EditShell 이 통째로 들고 있다가 한 번에 저장한다. */
import type { ClauseBody } from "@/domain/clause";


export interface ClauseEditValue {
  /** 저장된 선택지는 실제 코드, 아직 안 만든 것은 `new:1` — 저장 때 갈린다. */
  code: string;
  label: string;
}

export interface ClauseEditOption {
  code: string;
  label: string;
  values: ClauseEditValue[];
}

export interface ClauseEditData extends Record<string, unknown> {
  label: string;
  /** 본문 노드 트리 — 구조 에디터가 통째로 들고 있다가 저장에 한 번 나간다. */
  body: ClauseBody;
  options: ClauseEditOption[];
}
