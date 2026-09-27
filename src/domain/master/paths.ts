/**
 * 마스터 경로 — 조회 · 평탄화 · 표시명 · 레벨 깊이.
 *
 * 조회 함수는 마스터 트리를 **인자로 받고 기본값이 MVP 정본**(`MASTER`)이다 — 픽스처 · 테스트가 자기 어휘로
 * 같은 규칙을 검증할 수 있어야 한다.
 *
 * 경로는 `폼키.필드키` 두 토막 (기능/마스터 §3.2). 레벨은 폼에서 온다. 화면은 표시명을 쓴다.
 * 레벨 깊이는 `ATTACH_LEVELS` 순서(상품 › 세목 › 담보 › 세부보장 › 급부) — 구분자 식의
 * 「같은 레벨 · 하위는 집계 안 · 상위 금지」 판정이 이 순서를 본다.
 */
import { ATTACH_LEVELS, ATTACH_LEVEL_LABEL, type AttachLevel, type Code } from "../types";
import { MASTER } from "./catalog";
import type { MasterField, MasterFieldRef, MasterForm, MasterPath } from "./types";

/** 조회가 볼 마스터 트리. 기본은 MVP 정본. */
export type MasterTree = readonly MasterForm[];

const CODE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** `폼키.필드키`. */
export function masterPath(formKey: Code, fieldKey: Code): MasterPath {
  return `${formKey}.${fieldKey}`;
}

function ref(form: MasterForm, field: MasterField): MasterFieldRef {
  return { path: masterPath(form.key, field.key), form, field, level: form.level };
}

/** 그 레벨에 서는 폼 — 선언 순. 모델링 화면의 카드 목록이 이것이다. */
export function formsOfLevel(level: AttachLevel, master: MasterTree = MASTER): MasterForm[] {
  return master.filter((f) => f.level === level);
}

export function findForm(key: Code, master: MasterTree = MASTER): MasterForm | undefined {
  return master.find((f) => f.key === key);
}

/** 폼의 값 자리 전부 — 선언 순. */
export function fieldsOfForm(form: MasterForm): MasterFieldRef[] {
  return form.fields.map((field) => ref(form, field));
}

/** 한 레벨의 값 자리 전부 — 폼 선언 순 · 폼 안 선언 순. */
export function fieldsOfLevel(level: AttachLevel, master: MasterTree = MASTER): MasterFieldRef[] {
  return formsOfLevel(level, master).flatMap(fieldsOfForm);
}

/** 마스터 전체의 값 자리 — 폼 선언 순. */
export function allMasterFields(master: MasterTree = MASTER): MasterFieldRef[] {
  return master.flatMap(fieldsOfForm);
}

/** 경로가 가리키는 자리. 없는 경로면 undefined (brokenRef 의 재료). */
export function findMasterField(path: MasterPath, master: MasterTree = MASTER): MasterFieldRef | undefined {
  const segments = path.split(".");
  if (segments.length !== 2) return undefined;
  const form = findForm(segments[0], master);
  const field = form?.fields.find((f) => f.key === segments[1]);
  return form && field ? ref(form, field) : undefined;
}

/** 경로가 마스터 필드 **모양**인가 — 두 토막이고 각 토막이 코드 모양. 존재 여부는 안 본다. */
export function isMasterPathShape(path: string): boolean {
  const segments = path.split(".");
  return segments.length === 2 && segments.every((s) => CODE.test(s));
}

/** 화면 표시명 — 「납입면제 › 적용여부」. */
export function masterFieldLabel(r: MasterFieldRef): string {
  return `${r.form.label} › ${r.field.label}`;
}

/** 레벨까지 붙인 표시명 — 「세목 · 납입면제 › 적용여부」. 사용처 목록 · 오류 문구용. */
export function masterFieldFullLabel(r: MasterFieldRef): string {
  return `${ATTACH_LEVEL_LABEL[r.level]} · ${masterFieldLabel(r)}`;
}

/** 레벨 깊이 (상품 0 … 급부 4). */
export function levelDepth(level: AttachLevel): number {
  return ATTACH_LEVELS.indexOf(level);
}
