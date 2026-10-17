/** 동적표 에디터(`/dyntables/new` · `/dyntables/<code>`)가 통째로 들고 있다가 저장 한 번에 보내는 것 (기능/동적표 §4.2). */
import type { NewDynTable } from "@/domain/dyntable/types";
import type { Issue } from "@/domain/types";

/** 저장 입력 — 정의 전체(코드 · id · 저장 메타 없음). 서비스 `create` · `save` 가 같은 모양을 받는다. */
export type DynTableEditData = NewDynTable;

/** 저장(생성) 결과 — 성공이면 코드(+ 저장 뒤 문제 있는 사용처 수), 거부면 사유와 (있으면) 고칠 자리(`refPath` = 인자 · 템플릿 줄). */
export type DynTableSaveOutcome = { ok: true; code: string; recheck?: number } | { ok: false; message: string; issues?: Issue[] };
