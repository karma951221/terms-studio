/**
 * 폼 모델 — 「값 자리 = 노드 × 마스터 필드」(ADR-0037) 를 화면 없이 표현한 순수층.
 *
 * - `buildForm`     : 레벨 + enum 조회 + 저장소 값 (+ 스냅샷 문맥) → 폼 모델 (직렬화 가능한 데이터만).
 * - `formReducer`   : 편집 상태 전이 — 문자열 입력을 타입에 맞게 파싱, 오류는 필드 단위.
 * - `toSubmission`  : 저장할 값 목록. 빈 자리는 제출하지 않고, 읽기 전용 출처(const·derived)는 아예 빠진다.
 * - `formProgress`  : 「값 자리 N 중 M 입력」 — 저장소 기준 카운트 (디자인원칙 §9.2 · §9.6).
 * - `zodSchemaFor`  : 서버 액션 입력 검증용 zod 스키마.
 *
 * 기본값(prefill)은 폼이 열릴 때 **입력칸에 이미 들어가 있다** (ADR-0004 「폼을 미리 채워 보여주는
 * 제안」 · 리뷰 #3). 저장소로 자동 유입되는 경로는 여전히 없다 — 사람이 그 값을 보고 「저장」을
 * 눌러야 명시 값이 된다. 저장 전까지 그 자리는 「미입력 + 제안값」 두 배지를 단다.
 *
 * React 를 import 하지 않는다 — 여기 있는 모든 것은 node 환경에서 그대로 테스트된다.
 */
import { z } from "zod";

import type { EnumLookup, SlotPath } from "@/domain/catalog/types";
import { validateSlotValue } from "@/domain/coverage";
import { fieldsOfForm, fieldsOfLevel, formsOfLevel, parseTableDraft, tableRowsToDraft, type MasterTree, type TableDraft } from "@/domain/master";
import { ATTACH_LEVEL_LABEL, type AttachLevel, type Code, type FieldType, type Issue, type TableRow, type Value, type ValueSlot } from "@/domain/types";

// ───────────────────────────── 폼 모델 ─────────────────────────────

export interface EnumOption {
  code: Code;
  label: string;
}

/**
 * 값이 어디서 왔는가 — 디자인원칙 §1.2 출처 문법. 색이 아니라 **형태**가 말한다.
 *
 * 2026-09-12 — 입력 자리는 전부 사람이 정하는 값이다 (ADR-0037). 식(`derived`)·마스터 소유(`const`)
 * 자리는 값 폼에 오지 않는다 — 구분자는 값 행이 없고, 마스터가 정하는 것은 기본값(프리필)뿐이다.
 *
 * - `direct`   : 사람이 여기서 정하는 값 → 실선 테두리 입력 필드
 * - `snapshot` : 탑재 스냅샷을 손댔다 → 입력 필드 오른쪽 끝에 되돌리기 버튼. 마스터 값은 tooltip 으로만
 */
export type FieldSource = "direct" | "snapshot";

/** 필드 하나의 화면 표현. 직렬화 가능 — 서버 컴포넌트에서 클라이언트로 그대로 넘긴다. */
export interface FieldView {
  path: SlotPath;
  label: string;
  type: FieldType;
  /** enum · list<enum> 만. 표시 순서(order)대로. 없는 enum 이면 빈 목록. */
  enumOptions?: EnumOption[];
  /** 저장소 기준 — 기본값과 무관하다. */
  state: "entered" | "notEntered";
  /** state 가 entered 일 때만. */
  value?: Value;
  /** 기본값 — 프리필 제안. 폼이 열릴 때 입력칸에 들어가지만 저장 전까지는 미입력이다. */
  prefill?: Value;
  /** 출처 (§1.2). 스냅샷 문맥에서 유도된다. */
  source: FieldSource;
  /** 이 필드가 속한 폼 — 카드 머리이자 읽기 뷰의 「폼 › 필드」 접두 (기능/마스터 §3.1). */
  form: FormRef;
  /** snapshot 만 — 마스터가 갖고 있는 값. */
  masterValue?: Value;
  /** snapshot 만 — 마스터의 이름 「표시명 (코드)」 (ADR-0005 · §9.4). */
  masterLabel?: string;
}

/**
 * 탑재 스냅샷 문맥 — 「이 값 자리의 마스터는 무엇이고 무슨 값을 갖고 있나」.
 * 넘기면 마스터와 달라진 자리가 `source: "snapshot"` 이 되고 되돌리기 버튼이 붙는다 (ADR-0002 · §1.2).
 */
export interface SnapshotContext {
  /** 마스터 실체의 이름 — 「수술비(1~7종)[상해]」. tooltip 에 그대로 실린다. */
  masterLabel: string;
  /** 마스터가 가진 값 — 같은 경로 체계. */
  masterValues: Map<SlotPath, ValueSlot>;
}

/** 필드가 속한 폼의 이름표 — 카드 머리와 코드 칩(`폼키.필드키`)의 폼 쪽 절반. */
export interface FormRef {
  key: Code;
  label: string;
  /** 여는 폼 — 값 행이 하나도 없으면 카드가 닫힌 채 태어난다 (ADR-0065 §4). */
  optional?: boolean;
}

/** 카드 하나 = 마스터 폼 하나 (기능/마스터 §3.5). 필드는 폼 선언 순. */
export interface FormCard extends FormRef {
  description?: string;
  fields: FieldView[];
}

export interface FormModel {
  /** 값 자리를 정하는 레벨. */
  level: AttachLevel;
  /** 레벨 표시명 (「담보」 · 「세목」). */
  label: string;
  /** 그 레벨의 마스터 폼 순서대로 — 화면의 카드 목록. */
  cards: FormCard[];
  /** 카드를 편 목록 (= `cards.flatMap((c) => c.fields)`) — 편집 상태 · 제출 · 진행 카운트는 이것을 돈다. */
  fields: FieldView[];
}

function enumOptionsOf(type: FieldType, enums: EnumLookup): EnumOption[] | undefined {
  if (type.kind !== "enum" && type.kind !== "list<enum>") return undefined;
  const def = enums(type.enumCode);
  if (!def) return [];
  return [...def.values]
    .sort((a, b) => a.order - b.order)
    .map((v) => ({ code: v.code, label: v.label }));
}

/** 값 동치 — list<enum> 은 순서까지 같아야 같다. */
function valueEquals(a: Value | undefined, b: Value | undefined): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

function fieldView(
  path: SlotPath,
  label: string,
  type: FieldType,
  defaultValue: Value | undefined,
  form: FormRef,
  enums: EnumLookup,
  current: Map<SlotPath, ValueSlot>,
  snapshot?: SnapshotContext,
): FieldView {
  const slot = current.get(path);
  const view: FieldView = { path, label, type, state: "notEntered", source: "direct", form };
  const options = enumOptionsOf(type, enums);
  if (options) view.enumOptions = options;
  if (slot?.entered) {
    view.state = "entered";
    view.value = slot.value;
  }
  if (defaultValue !== undefined) view.prefill = defaultValue;
  // 탑재 스냅샷을 손댄 자리만 「스냅샷 · 변경됨」 — 마스터와 같으면 평범한 직접값이다 (§1.2)
  const master = snapshot?.masterValues.get(path);
  if (snapshot && master?.entered && !valueEquals(master.value, view.value)) {
    view.source = "snapshot";
    view.masterValue = master.value;
    view.masterLabel = snapshot.masterLabel;
  }
  return view;
}

/**
 * 레벨의 마스터 폼으로 폼 모델을 만든다 — 그 레벨 노드는 이 자리를 **전부** 갖는다 (ADR-0037).
 * 부착 · 선택 필드가 없으므로 「무엇이 보이나」를 정하는 것은 마스터뿐이다.
 * 폼 하나가 카드 하나다 (기능/마스터 §3.5) — 카드 목록이 곧 마스터의 폼 목록이다.
 */
export function buildForm(
  level: AttachLevel,
  enums: EnumLookup,
  current: Map<SlotPath, ValueSlot>,
  snapshot?: SnapshotContext,
  master?: MasterTree,
): FormModel {
  const cards: FormCard[] = formsOfLevel(level, master).map((form) => {
    const ref: FormRef = { key: form.key, label: form.label };
    if (form.optional === true) ref.optional = true;
    const card: FormCard = {
      ...ref,
      fields: fieldsOfForm(form).map((r) =>
        fieldView(r.path, r.field.label, r.field.type, r.field.defaultValue, ref, enums, current, snapshot),
      ),
    };
    if (form.description !== undefined) card.description = form.description;
    return card;
  });
  return { level, label: ATTACH_LEVEL_LABEL[level], cards, fields: cards.flatMap((c) => c.fields) };
}

/** 값 자리 — 폼의 모든 필드 (전부 사람이 채우는 자리다). */
export function formSlotsOf(model: FormModel): FieldView[] {
  return model.fields;
}

/**
 * 진행 카운트 — 「값 자리 N 중 M 입력」. **저장소 기준**이다 (§9.2 「카운트는 진짜여야 한다」).
 * 화면에 프리필이 채워져 있어도 저장 전에는 세지 않는다.
 */
export function formProgress(model: FormModel): { total: number; entered: number; percent: number } {
  const slots = formSlotsOf(model);
  const entered = slots.filter((f) => f.state === "entered").length;
  return {
    total: slots.length,
    entered,
    percent: slots.length === 0 ? 0 : Math.round((entered / slots.length) * 100),
  };
}

// ───────────────────────────── 표시 ─────────────────────────────

/** 읽기 전용 표시 문자열. enum 은 표시명(ADR-0005), boolean 은 예/아니오. 미입력이면 undefined. */
export function formatValue(field: FieldView): string | undefined {
  if (field.state !== "entered" || field.value === undefined) return undefined;
  const labelOf = (code: string) =>
    field.enumOptions?.find((o) => o.code === code)?.label ?? code;
  const v = field.value;
  switch (field.type.kind) {
    case "boolean":
      return v === true ? "예" : "아니오";
    case "enum":
      return labelOf(String(v));
    case "list<enum>":
      // enum 목록 case 라 요소는 값 코드(string)다.
      return Array.isArray(v) ? (v as string[]).map(labelOf).join(", ") : String(v);
    case "table":
      return Array.isArray(v) ? `${v.length}행` : String(v);
    default:
      return String(v);
  }
}

// ───────────────────────────── 편집 상태 ─────────────────────────────

/** 입력 원문. list<enum> 은 코드 배열, table 은 셀 원문 2차원 배열, 나머지는 문자열. */
export type Draft = string | string[] | TableDraft;

export interface FieldState {
  /** 폼 모델의 원본 (저장소 기준 상태·프리필·선택지). */
  view: FieldView;
  draft: Draft;
  /** 지금 편집 상태에서 값이 있는가 (파싱 성공 여부와 무관 — 오류여도 「입력 중」). */
  entered: boolean;
  /** 파싱된 값. entered 이고 오류가 없을 때만. */
  value: Value | undefined;
  /** 파싱 오류 문구 (issue.message). */
  error: string | undefined;
  /** 파싱 오류의 Issue — 종류(typeMismatch·brokenRef)와 좌표(refPath)를 보존한다. */
  issue: Issue | undefined;
  /** 사람이 손댔는가. */
  dirty: boolean;
  /**
   * 지금 칸에 든 것이 「제안값」인가 — 기본값이 프리필된 채 아직 사람이 손대지도 저장하지도 않았다.
   * 배지 「제안값 · 저장해야 확정」의 근거 (ADR-0004).
   */
  proposed: boolean;
}

export interface FormState {
  model: FormModel;
  fields: Record<SlotPath, FieldState>;
  /** 여는 폼 카드가 지금 열려 있나 — 카드 키 기준 (ADR-0065 §4). */
  open: Record<Code, boolean>;
}

export type FormAction =
  | { type: "edit"; path: SlotPath; draft: Draft }
  | { type: "clear"; path: SlotPath }
  /** 폼 전체 비우기 — 프리필 제안까지 걷어낸다 (버튼 「비우기」). */
  | { type: "clearAll" }
  /** 스냅샷을 마스터 값으로 되돌리기. 확인을 거친 뒤에만 (§1.2). */
  | { type: "revertToMaster"; path: SlotPath }
  /** 서버가 새 모델을 내려보냈다 (저장 직후) — 편집 상태를 새 진실로 다시 세운다. */
  | { type: "reset"; model: FormModel }
  /** 여는 폼 카드를 연다 — 그 카드 필드를 저장값 → 프리필 → 빈 규칙으로 다시 세운다. */
  | { type: "openForm"; form: Code }
  /** 여는 폼 카드를 닫는다 — 「없음」, 그 카드 필드는 전부 빈 초안이 된다. */
  | { type: "closeForm"; form: Code };

function emptyDraft(type: FieldType): Draft {
  if (type.kind === "table") return [];
  return type.kind === "list<enum>" ? [] : "";
}

/** 값 → 입력 원문. */
function draftOf(type: FieldType, value: Value): Draft {
  if (type.kind === "table") return tableRowsToDraft(type.columns, value as TableRow[]);
  if (type.kind === "list<enum>") return Array.isArray(value) ? [...(value as string[])] : [String(value)];
  return Array.isArray(value) ? value.join(",") : String(value);
}

function isEmptyDraft(draft: Draft): boolean {
  return Array.isArray(draft) ? draft.length === 0 : draft.trim() === "";
}

/** 선택지만으로 만든 enum 조회 — validateValue 를 그대로 재사용하기 위해. */
function lookupFromView(view: FieldView): EnumLookup {
  return (code) => {
    const t = view.type;
    if ((t.kind !== "enum" && t.kind !== "list<enum>") || t.enumCode !== code) return undefined;
    return {
      code,
      label: "",
      values: (view.enumOptions ?? []).map((o, i) => ({ ...o, order: i })),
    };
  };
}

/** 입력 원문 → 값. 실패하면 Issue. 빈 입력은 호출 전에 걸러진다. */
function parseDraft(view: FieldView, draft: Draft): { value: Value } | { issue: Issue } {
  const t = view.type;
  let candidate: unknown;
  switch (t.kind) {
    case "string":
      candidate = Array.isArray(draft) ? draft.join(",") : draft;
      break;
    case "number": {
      const s = Array.isArray(draft) ? draft.join(",") : draft.trim();
      candidate = s === "" ? Number.NaN : Number(s);
      break;
    }
    case "boolean": {
      const s = Array.isArray(draft) ? "" : draft.trim();
      candidate = s === "true" ? true : s === "false" ? false : s;
      break;
    }
    case "date":
    case "enum":
      candidate = Array.isArray(draft) ? draft.join(",") : draft.trim();
      break;
    case "list<enum>":
      candidate = Array.isArray(draft) ? draft : [draft];
      break;
    case "table": {
      const r = parseTableDraft(t.columns, draft as TableDraft, { refPath: view.path });
      if ("issue" in r) return r;
      candidate = r.value;
      break;
    }
  }
  const issues = validateSlotValue(view.path, t, candidate, lookupFromView(view), { refPath: view.path });
  return issues.length === 0 ? { value: candidate as Value } : { issue: issues[0] };
}

function fieldStateOf(view: FieldView, draft: Draft, dirty: boolean, proposed = false): FieldState {
  const base = { view, draft, dirty, proposed, value: undefined, error: undefined, issue: undefined };
  if (isEmptyDraft(draft)) return { ...base, entered: false, proposed: false };
  const parsed = parseDraft(view, draft);
  return "value" in parsed
    ? { ...base, entered: true, value: parsed.value }
    : { ...base, entered: true, error: parsed.issue.message, issue: parsed.issue };
}

/**
 * 필드 하나의 초기 편집 상태 — 저장 값이 있으면 그것을, 카드가 닫혀 있으면 빈 칸을,
 * 열려 있는데 저장 값이 없으면 **기본값을 제안으로 채워** 보여준다
 * (ADR-0004 「폼을 미리 채워 보여주는 제안」 · 리뷰 #3 · ADR-0065 §4 여는 폼).
 */
function initFieldState(view: FieldView, open: boolean, dirty = false): FieldState {
  // 닫힌 카드는 저장 값이 있어도 빈 칸이다 — 「닫기」는 그 값을 지우기로 제출한다 (ADR-0065 §4).
  if (!open) return fieldStateOf(view, emptyDraft(view.type), dirty);
  if (view.state === "entered" && view.value !== undefined) {
    return fieldStateOf(view, draftOf(view.type, view.value), dirty);
  }
  if (view.prefill !== undefined) {
    return fieldStateOf(view, draftOf(view.type, view.prefill), dirty, true);
  }
  return fieldStateOf(view, emptyDraft(view.type), dirty);
}

/** 여는 폼 카드가 처음부터 열려 있나 — 안 여는 폼이거나, 값 행이 하나라도 저장돼 있으면 (ADR-0065 §4). */
function initialOpen(card: FormCard): boolean {
  return !card.optional || card.fields.some((f) => f.state === "entered");
}

/**
 * 편집 상태의 초기값 — 저장 값이 있으면 그것을, 없으면 **기본값을 제안으로 채워** 보여준다
 * (ADR-0004 「폼을 미리 채워 보여주는 제안」 · 리뷰 #3). 상태는 여전히 미입력이다.
 * 여는 폼 카드가 닫힌 채 태어나면 그 카드 필드는 프리필도 없이 빈 칸이다 — 닫힌 카드에
 * 프리필을 흘리면 「감액 표를 열지 않음 = 감액 없음」이 깨진다(ADR-0065 §4).
 */
export function initFormState(model: FormModel): FormState {
  const open: Record<Code, boolean> = {};
  for (const card of model.cards) open[card.key] = initialOpen(card);
  const fields: Record<SlotPath, FieldState> = {};
  for (const view of model.fields) {
    fields[view.path] = initFieldState(view, open[view.form.key] ?? true);
  }
  return { model, fields, open };
}

export function formReducer(state: FormState, action: FormAction): FormState {
  if (action.type === "reset") return initFormState(action.model);
  if (action.type === "openForm" || action.type === "closeForm") {
    const isOpen = action.type === "openForm";
    const open = { ...state.open, [action.form]: isOpen };
    const fields = { ...state.fields };
    for (const view of state.model.fields) {
      if (view.form.key !== action.form) continue;
      fields[view.path] = initFieldState(view, isOpen, true);
    }
    return { ...state, open, fields };
  }
  if (action.type === "clearAll") {
    const fields: Record<SlotPath, FieldState> = {};
    for (const view of state.model.fields) {
      const f = state.fields[view.path];
      if (!f) continue;
      fields[view.path] = fieldStateOf(view, emptyDraft(view.type), true);
    }
    return { ...state, fields };
  }
  const field = state.fields[action.path];
  if (!field) return state;
  let next: FieldState;
  switch (action.type) {
    case "edit":
      next = fieldStateOf(field.view, action.draft, true);
      break;
    case "clear":
      next = fieldStateOf(field.view, emptyDraft(field.view.type), true);
      break;
    case "revertToMaster":
      if (field.view.masterValue === undefined) return state;
      next = fieldStateOf(field.view, draftOf(field.view.type, field.view.masterValue), true);
      break;
  }
  return { ...state, fields: { ...state.fields, [action.path]: next } };
}

// ───────────────────────────── 제출 ─────────────────────────────

/** 저장할 값 하나. value 가 undefined 면 「값 지우기」. */
export interface SubmissionEntry {
  path: SlotPath;
  value: Value | undefined;
}

export interface Submission {
  /** 폼 순서대로. 빈 칸은 없다 — 저장돼 있던 값을 비운 경우만 undefined 로 실린다. */
  values: SubmissionEntry[];
  /** 파싱 오류·깨진 enum 참조. 하나라도 있으면 저장하면 안 된다. */
  issues: Issue[];
}

/** 편집 상태 → 저장할 값 목록 + 최종 검증 Issue. */
export function toSubmission(state: FormState): Submission {
  const values: SubmissionEntry[] = [];
  const issues: Issue[] = [];
  for (const view of state.model.fields) {
    const f = state.fields[view.path];
    if (!f) continue;
    if (!f.entered) {
      // 저장소에 있던 값을 지웠을 때만 「값 지우기」로 제출한다
      if (view.state === "entered") values.push({ path: view.path, value: undefined });
      continue;
    }
    if (f.issue !== undefined || f.value === undefined) {
      issues.push(
        f.issue ?? {
          kind: "typeMismatch",
          message: "값을 해석할 수 없습니다",
          at: { refPath: view.path },
        },
      );
      continue;
    }
    const found = validateSlotValue(view.path, view.type, f.value, lookupFromView(view), { refPath: view.path });
    if (found.length > 0) {
      issues.push(...found);
      continue;
    }
    values.push({ path: view.path, value: f.value });
  }
  return { values, issues };
}

// ───────────────────────────── zod ─────────────────────────────

/** 타입 하나의 값 스키마. enum 값은 코드. 없는 enum 은 어떤 값도 받지 않는다. */
export function zodValueSchema(type: FieldType, enums: EnumLookup): z.ZodType<Value> {
  switch (type.kind) {
    case "string":
      return z.string();
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    case "date":
      return z.iso.date();
    case "enum": {
      const def = enums(type.enumCode);
      if (!def || def.values.length === 0) return z.never();
      return z.enum(def.values.map((v) => v.code));
    }
    case "list<enum>": {
      const def = enums(type.enumCode);
      if (!def || def.values.length === 0) return z.array(z.never());
      return z
        .array(z.enum(def.values.map((v) => v.code)))
        .refine((arr) => new Set(arr).size === arr.length, {
          message: "같은 enum 값을 두 번 고를 수 없습니다",
        });
    }
    case "table":
      // 정밀 검사(구간 규칙 등)는 서버 액션이 validateSlotValue 로 다시 한다 — 제출 스키마는 모양만 본다.
      return z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))).min(1) as unknown as z.ZodType<Value>;
  }
}

/**
 * 제출 목록(`SubmissionEntry[]`) 스키마 — 서버 액션이 받은 입력을 그 레벨 마스터 자리·타입으로 검증한다.
 * value 없음은 「값 지우기」로 허용. 그 레벨의 자리가 아닌 경로는 거부.
 */
export function zodSchemaFor(level: AttachLevel, enums: EnumLookup, master?: MasterTree) {
  const entries: { path: SlotPath; type: FieldType }[] = fieldsOfLevel(level, master).map((ref) => ({
    path: ref.path,
    type: ref.field.type,
  }));
  if (entries.length === 0) return z.array(z.never()).max(0);
  const options = entries.map(({ path, type }) =>
    z.object({ path: z.literal(path), value: zodValueSchema(type, enums).optional() }),
  );
  return z.array(z.discriminatedUnion("path", options as [(typeof options)[number], ...typeof options]));
}
