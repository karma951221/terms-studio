/**
 * 열거형 유저 정의 필드 (ADR-0078 결정 2 · 기능/열거형 §3.1) — 순수.
 *
 * - 열거형마다 필드(이름 · 타입 문자열 | 참거짓)를 선언하고 값마다 채운다. 필드 코드(`F01`)는 그 열거형 안에서 자동 채번 · 불변.
 * - **빈 칸 = 미입력** — 값의 `fields` 에 키가 없다. 빈 문자열 · 공백 · null 은 저장 때 키를 뺀다.
 * - 필드는 열거형 정의의 일부라 참조로 전 상품에 전파된다 — 상품이 조정하는 길은 없다.
 * - 필드 삭제 · 타입 변경은 관리자 + 영향 확인(서비스 몫, ADR-0019). 여기서는 무엇이 지워지고 바뀌는지만 돌려준다.
 *
 * 뒤 페이즈(함수조항 내부 변수 · 슬롯 — `사유.약관표시명`)는 `enumFieldValue` 로 값을 읽는다.
 */
import type { Code, Issue, Result } from "../types";
import { ok, reject } from "../types";
import { ENUM_FIELD_TYPES, type EnumDef, type EnumFieldDef, type EnumFieldType, type EnumFieldValue } from "./types";

/** 표시명 동일성 — 값 이름과 같은 규칙(앞뒤 · 연속 공백 · 대소문자 무시). definitions.enumValueLabelKey 와 한 몸. */
const labelKey = (label: string) => label.trim().replace(/\s+/g, " ").toLowerCase();

/** 필드 목록 — 순서대로. 없으면 빈 목록. */
export function enumFields(def: EnumDef): EnumFieldDef[] {
  return [...(def.fields ?? [])].sort((a, b) => a.order - b.order);
}

export function enumFieldByLabel(def: EnumDef, label: string): EnumFieldDef | undefined {
  const key = labelKey(label);
  return def.fields?.find((f) => labelKey(f.label) === key);
}

export type EnumFieldRead =
  | { kind: "value"; value: EnumFieldValue }
  /** 빈 칸 — 읽으면 조립 `notEntered` */
  | { kind: "notEntered" }
  | { kind: "unknownField" }
  | { kind: "unknownValue" };

/** 열거값 × 필드 한 칸 읽기. 모르는 필드 · 모르는 값(삭제된 코드)은 부르는 쪽이 오류로 바꾼다. */
export function enumFieldValue(def: EnumDef, valueCode: Code, fieldKey: Code): EnumFieldRead {
  if (!def.fields?.some((f) => f.key === fieldKey)) return { kind: "unknownField" };
  const value = def.values.find((v) => v.code === valueCode);
  if (!value) return { kind: "unknownValue" };
  const read = value.fields?.[fieldKey];
  return read === undefined ? { kind: "notEntered" } : { kind: "value", value: read };
}

// ───────────────────────────── 편집 저장 ─────────────────────────────

/** 편집 화면의 필드 한 행. `key` 가 없으면 새 필드 — 같은 저장의 값이 `ref` 로 가리킨다. */
export interface EnumFieldRevision {
  key?: Code;
  ref?: string;
  label: string;
  type: EnumFieldType;
}

/** 값 한 행의 필드 입력 — 필드 코드(또는 새 필드의 ref) → 값. 빈 칸은 빈 문자열 · null · 키 없음. */
export type EnumFieldInput = Readonly<Record<string, EnumFieldValue | null | undefined>>;

export interface FieldPlan {
  /** 채번 전 최종 필드 — `key` 가 없는 행은 새 필드. */
  rows: readonly EnumFieldRevision[];
  removedFields: Code[];
  retypedFields: Code[];
}

function invalid<T>(message: string): Result<T> {
  const issue: Issue = { kind: "typeMismatch", message, at: {} };
  return reject({ reason: "invalid", issues: [issue] });
}

/** 필드 정의의 최종 상태 검사 — 이름 비움 · 중복 · 모르는 코드 · 같은 코드 두 번 · 타입. 채번은 하지 않는다. */
export function planFields(def: EnumDef, revision: readonly EnumFieldRevision[] | undefined): Result<FieldPlan> {
  const current = def.fields ?? [];
  if (revision === undefined) return ok({ rows: enumFields(def).map(({ key, label, type }) => ({ key, label, type })), removedFields: [], retypedFields: [] });
  const known = new Map(current.map((f) => [f.key, f]));
  const kept = new Set<Code>();
  const labels = new Set<string>();
  const refs = new Set<string>();
  const retypedFields: Code[] = [];
  for (const row of revision) {
    if (typeof row.label !== "string" || row.label.trim() === "") return invalid("필드 이름은 비울 수 없습니다");
    if (!(ENUM_FIELD_TYPES as readonly string[]).includes(row.type)) return invalid(`필드 「${row.label}」 의 타입은 문자열 · 참거짓 중 하나여야 합니다`);
    if (row.key !== undefined) {
      const was = known.get(row.key);
      if (!was) return reject({ reason: "notFound", what: `필드 ${row.key}` });
      if (kept.has(row.key)) return invalid(`필드 ${row.key} 이(가) 두 번 있습니다`);
      kept.add(row.key);
      if (was.type !== row.type) retypedFields.push(row.key);
    } else if (row.ref !== undefined) {
      if (refs.has(row.ref)) return invalid(`새 필드 ${row.ref} 이(가) 두 번 있습니다`);
      refs.add(row.ref);
    }
    const key = labelKey(row.label);
    if (labels.has(key)) return reject({ reason: "duplicate", what: `필드 이름 「${row.label}」` });
    labels.add(key);
  }
  return ok({ rows: revision, removedFields: current.filter((f) => !kept.has(f.key)).map((f) => f.key), retypedFields });
}

/**
 * 값 한 행의 필드 값 — 최종 필드(`byRef`: 코드 또는 ref → 확정 필드)로 검사하고 빈 칸을 뺀다.
 * `input` 이 없으면(옛 호출) 기존 값을 넘기되 지워진 필드 · 타입이 바뀐 필드의 값은 버린다.
 */
export function fieldValuesFor(
  valueLabel: string,
  input: EnumFieldInput | undefined,
  previous: Readonly<Record<Code, EnumFieldValue>> | undefined,
  byRef: ReadonlyMap<string, EnumFieldDef>,
): Result<Record<Code, EnumFieldValue> | undefined> {
  const out: Record<Code, EnumFieldValue> = {};
  if (input === undefined) {
    for (const [key, value] of Object.entries(previous ?? {})) {
      const field = byRef.get(key);
      if (field && typeof value === (field.type === "boolean" ? "boolean" : "string")) out[field.key] = value;
    }
  } else {
    for (const [ref, raw] of Object.entries(input)) {
      const field = byRef.get(ref);
      if (!field) return invalid(`값 「${valueLabel}」 에 없는 필드 ${ref} 가 있습니다`);
      if (raw === null || raw === undefined) continue;
      if (field.type === "boolean") {
        if (typeof raw !== "boolean") return invalid(`값 「${valueLabel}」 의 필드 「${field.label}」 은(는) 참거짓이어야 합니다`);
        out[field.key] = raw;
      } else {
        if (typeof raw !== "string") return invalid(`값 「${valueLabel}」 의 필드 「${field.label}」 은(는) 문자열이어야 합니다`);
        if (raw.trim() === "") continue; // 빈 칸 = 미입력
        out[field.key] = raw;
      }
    }
  }
  return ok(Object.keys(out).length > 0 ? out : undefined);
}
