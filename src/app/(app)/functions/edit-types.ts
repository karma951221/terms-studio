/** 공용조항 에디터(`/functions/new` · `/functions/<code>`)가 통째로 들고 있다가 저장 한 번에 보내는 것. */
import type { ClauseBody, ClauseMode, ParamDef } from "@/domain/clause";
import type { Issue } from "@/domain/types";

export interface ClauseEditValue {
  /** 저장된 선택지는 실제 코드, 아직 안 만든 것은 `new:1` — 저장 때 갈린다. */
  code: string;
  label: string;
  /** 선택지 문구 — 평문만 (슬롯 · 인라인 조건 불가, 기능/함수조항 §6.2). */
  text: string;
}

export interface ClauseEditOption {
  /** 저장된 옵션은 실제 코드(`O01`), 아직 안 만든 것은 `new:1`. 본문의 옵션 자리도 같은 코드를 가리킨다. */
  code: string;
  label: string;
  values: ClauseEditValue[];
}

export interface ClauseEditData {
  label: string;
  /** 본문 노드 트리 — 약관 에디터의 편집본을 저장 직전에 공용조항 본문으로 되돌린 것. */
  body: ClauseBody;
  options: ClauseEditOption[];
  /** 인자 표 (최종 결정 2) — 이름 · 타입 · 기본 연결. 없으면 인자를 건드리지 않는다(생성이면 인자 0개). */
  params?: ParamDef[];
}

export interface ClauseCreateData extends ClauseEditData {
  mode: ClauseMode;
}

/** 저장(생성) 결과 — 성공이면 공용조항 코드, 거부면 사유와 (있으면) 고칠 자리. */
export type ClauseSaveOutcome = { ok: true; code: string } | { ok: false; message: string; issues?: Issue[] };
