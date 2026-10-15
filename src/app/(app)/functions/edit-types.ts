/** 함수조항 에디터(`/functions/new` · `/functions/<code>`)가 통째로 들고 있다가 저장 한 번에 보내는 것. */
import type { Bindings, ClauseBody, ClauseMode, LocalDef, ParamDef } from "@/domain/clause";
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

/** 프리셋 (ADR-0084) — 저장된 것은 실제 코드(`S01`), 아직 안 만든 것은 `new:N`. 옵션 선택은 편집 코드(새 옵션 · 선택지는 `new:N`)로 든다. */
export interface ClauseEditPreset {
  code: string;
  name: string;
  /** 옵션 편집 코드 → 선택지 편집 코드. */
  options: Record<string, string>;
  /** 인자 이름 → 연결 (구분자 · 상수 · 원천). 비운 인자는 기본 연결. */
  bindings: Bindings;
  /** 사용처가 채우는 인자(반복의 현재 원소) — 명시로 고른 것. */
  fromUsage: string[];
}

export interface ClauseEditData {
  label: string;
  /** 본문 노드 트리 — 약관 에디터의 편집본을 저장 직전에 함수조항 본문으로 되돌린 것. */
  body: ClauseBody;
  options: ClauseEditOption[];
  /** 인자 표 (최종 결정 2) — 이름 · 타입 · 기본 연결. 없으면 인자를 건드리지 않는다(생성이면 인자 0개). */
  params?: ParamDef[];
  /** 내부 변수 표 (최종 결정 2) — 저장 모양(필드는 키). 없으면 건드리지 않는다(생성이면 0개). */
  locals?: LocalDef[];
  /** 프리셋 (ADR-0084). 없으면 건드리지 않는다(생성이면 0개). */
  presets?: ClauseEditPreset[];
  /**
   * 인자 이름 바꾸기 「옛 → 새」 (기능/함수조항 §3.7) — 본문 · 내부 변수 · 프리셋은 화면이 이미 고쳐 보낸다.
   * 저장은 같은 트랜잭션에서 사용처 문서의 연결 키를 이 표로 고친다. 없으면 바꾼 이름이 없다.
   */
  paramRenames?: Record<string, string>;
}

export interface ClauseCreateData extends ClauseEditData {
  mode: ClauseMode;
}

/** 저장(생성) 결과 — 성공이면 함수조항 코드, 거부면 사유와 (있으면) 고칠 자리. */
export type ClauseSaveOutcome = { ok: true; code: string } | { ok: false; message: string; issues?: Issue[] };
