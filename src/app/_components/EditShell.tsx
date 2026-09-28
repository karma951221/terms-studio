"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import type { EditOutcome } from "@/app/_lib/edit";
import { isDirty } from "@/app/_lib/edit";
import { Breadcrumb, type Crumb } from "./Breadcrumb";
import { Combobox } from "./Combobox";
import { IconButton, IconClose, IconTrash } from "./icons";
import { RadioGroup, type RadioOption } from "./RadioGroup";
import { Toggle } from "./Toggle";
import { InfoTip } from "./InfoTip";

type EditData = Record<string, unknown>;
interface EditContextValue<T extends EditData = EditData> {
  mode: "read" | "edit";
  pending: boolean;
  data: T;
  setValue: (name: string, value: unknown) => void;
  /** 직전 값에서 새 값을 — 한 틱에 여러 입력기가 같은 필드를 고쳐도 서로 덮지 않는다. */
  update: (name: string, next: (current: unknown) => unknown) => void;
  /** 편집 중 변경이 있으면 ✕ 와 같은 「버립니까?」 확인 뒤에, 없으면 바로 `go` 를 실행한다 (다른 화면으로 나가는 링크용). */
  leave: (go: () => void) => void;
}

const EditContext = createContext<EditContextValue | null>(null);

export function useEditField<T = unknown>(name: string): { mode: "read" | "edit"; pending: boolean; value: T; setValue: (value: T) => void; update: (next: (current: T) => T) => void } {
  const context = useContext(EditContext);
  if (!context) throw new Error("Field는 EditShell 안에서만 쓸 수 있습니다.");
  return {
    mode: context.mode,
    pending: context.pending,
    value: context.data[name] as T,
    setValue: (value) => context.setValue(name, value),
    update: (next) => context.update(name, (current) => next(current as T)),
  };
}

/** 편집 화면을 떠나는 조작(다른 화면으로 가는 링크)이 미저장 변경을 ✕ 와 같은 확인으로 거른다. */
export function useEditLeave(): (go: () => void) => void {
  const context = useContext(EditContext);
  if (!context) throw new Error("useEditLeave 는 EditShell 안에서만 쓸 수 있습니다.");
  return context.leave;
}

function ImpactLines({ outcome }: { outcome: Extract<EditOutcome, { ok: "confirm" }> }) {
  const { impact } = outcome;
  const mounts = impact.mounts ?? [];
  return <ul className="ts-confirm-loss">
    <li>사람이 입력한 값 {impact.valueRowsLost}건이 사라진다</li>
    {impact.cascade.length ? <li>함께 삭제되는 항목 {impact.cascade.length}건</li> : null}
    {impact.brokenRefs.length ? <li>깨질 참조 {impact.brokenRefs.length}건</li> : null}
    {/* 탑재 상품담보 — 구조 정정이 미치는 상품과 그 스냅샷에서 사라질 값 행 (ADR-0075) */}
    {mounts.length ? <li>
      탑재 상품담보 {mounts.length}건
      <ul>{mounts.map((m) => <li key={m.productCoverageId}>{m.productName} › {m.productCoverageName} (값 {m.snapshotValueRowsLost}행)</li>)}</ul>
    </li> : null}
  </ul>;
}

/** 편집 모드에서 잠긴 즉시 실행 명령(헤더 🗑 등)의 tooltip — 디자인원칙 §2 L2. */
export const EDIT_MODE_LOCKED_TIP = "저장하거나 취소한 뒤 실행";

/** 「고친 내용을 버립니까?」 — 편집 중 나가기 · ✕ 취소가 함께 쓰는 확인. */
export function DiscardDialog({ onStay, onDiscard }: { onStay: () => void; onDiscard: () => void }) {
  return <dialog open className="ts-dialog"><p className="ts-confirm-title">고친 내용을 버립니까?</p><div className="ts-confirm-actions"><button type="button" onClick={onStay}>계속 편집</button><button type="button" className="danger" onClick={onDiscard}>버리기</button></div></dialog>;
}

export function EditShell<T extends EditData>({
  initial,
  title,
  code,
  headerMeta,
  path,
  saveAction,
  deleteAction,
  deleteLabel,
  deleteTooltip,
  deleteSuccessHref,
  extraActions,
  editActions,
  readBadges,
  saveDisabled,
  initialMode = "read",
  cancelHref,
  saveSuccessHref,
  children,
}: {
  initial: T;
  title: string;
  /** 코드가 있는 실체만 — 담보처럼 도메인에 코드가 없으면 넘기지 않는다 (없는 값을 화면이 지어내지 않는다). */
  code?: string;
  headerMeta?: ReactNode;
  /**
   * 이 화면 위의 경로 — 조회 화면부터 바로 위 상세까지 (「담보 › 골절진단비Ⅱ」 의 앞 마디들, 디자인원칙 §1.7).
   * 마지막 마디(이 화면)는 제목이 된다. 편집 중이면 경로 링크도 ✕ 와 같은 「버립니까?」 확인을 거친다.
   */
  path: readonly Crumb[];
  saveAction: (input: T, confirm?: boolean) => Promise<EditOutcome>;
  deleteAction?: (confirm?: boolean) => Promise<EditOutcome>;
  deleteLabel?: string;
  deleteTooltip?: string;
  deleteSuccessHref?: string;
  /**
   * 헤더 조작 줄의 왼쪽에 붙는 화면별 버튼 (구분자 상세의 「사용처」 등).
   * 읽기 모드에서만 나온다 — 편집 중에는 저장 · 취소가 유일하게 해야 할 일이다.
   */
  extraActions?: ReactNode;
  /**
   * 편집 모드 조작 줄의 왼쪽에 붙는 버튼 — 저장의 일부인 조작만 (구분자의 「검사」: 저장 전 검사, 기능/구분자 §3.3).
   * 저장 · 취소 말고 다른 일을 여기 두지 않는다.
   */
  editActions?: ReactNode;
  /** 읽기 모드 제목 옆 배지 — 저장은 됐지만 남은 경고 (구분자의 「별칭」 등, 기능/구분자 §3.3). 편집 중에는 검사 결과가 대신한다. */
  readBadges?: ReactNode;
  /** 초안이 아직 저장할 수 없는 상태인지 (구조 초안의 빈 이름 · 형제 중복 등) — 참이면 저장 버튼이 잠긴다. */
  saveDisabled?: (data: T) => boolean;
  /**
   * 명령 화면은 편집으로 바로 열 수 있다 — 읽기 모드가 할 일이 없다.
   * 그런 화면은 `cancelHref`(✕ 는 읽기 모드 대신 이 경로로) · `saveSuccessHref`(저장 뒤 이 경로로) 를 같이 준다.
   */
  initialMode?: "read" | "edit";
  cancelHref?: string;
  saveSuccessHref?: string;
  children: ReactNode;
}) {
  const [mode, setMode] = useState<"read" | "edit">(initialMode);
  const [baseline, setBaseline] = useState<T>(initial);
  const [data, setData] = useState<T>(initial);
  // 서버가 새 원본을 넘기면(저장 뒤 refresh — 서버가 채번한 코드 등) 읽기 모드의 화면을 그 원본으로 맞춘다.
  // 저장 직후 로컬 값(`new:1` 같은 임시 코드)이 「새 값」으로 남던 결함 (2026-09-28, 실물재현 E2E). 편집 중이면 초안을 지킨다.
  const initialKey = JSON.stringify(initial);
  const [seenInitial, setSeenInitial] = useState(initialKey);
  if (seenInitial !== initialKey) {
    setSeenInitial(initialKey);
    if (mode === "read") {
      setBaseline(initial);
      setData(initial);
    }
  }
  const [error, setError] = useState("");
  /** 「버립니까?」 확인 — ✕ 면 읽기 모드(또는 cancelHref)로, 떠나는 링크면 그 링크의 `go` 로. */
  const [discard, setDiscard] = useState<{ go: () => void }>();
  const [confirm, setConfirm] = useState<{ kind: "save" | "delete"; outcome: Extract<EditOutcome, { ok: "confirm" }> }>();
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const dirty = isDirty(baseline, data);
  const blocked = saveDisabled?.(data) ?? false;
  const shownTitle = typeof data.label === "string" ? data.label : title;

  const handle = (kind: "save" | "delete", confirmed = false) => {
    startTransition(async () => {
      const outcome = kind === "save" ? await saveAction(data, confirmed) : await deleteAction!(confirmed);
      if (outcome.ok === "confirm") {
        setConfirm({ kind, outcome });
        return;
      }
      if (!outcome.ok) {
        setError(outcome.message);
        setConfirm(undefined);
        return;
      }
      setError("");
      setConfirm(undefined);
      if (kind === "delete") {
        router.replace(deleteSuccessHref ?? "/");
        return;
      }
      if (saveSuccessHref) {
        router.replace(saveSuccessHref);
        return;
      }
      setBaseline(data);
      setMode("read");
      router.refresh();
    });
  };

  /** ✕ — 읽기 모드로 (명령 화면은 cancelHref 로). */
  const cancel = () => {
    if (cancelHref) {
      router.replace(cancelHref);
      return;
    }
    setData(baseline);
    setMode("read");
    setError("");
  };
  const leave = (go: () => void) => (mode === "edit" && dirty ? setDiscard({ go }) : go());

  return <EditContext.Provider value={{ mode, pending, data, setValue: (name, value) => setData((current) => ({ ...current, [name]: value })), update: (name, next) => setData((current) => ({ ...current, [name]: next(current[name]) })), leave }}>
    <div className="ts-edit-head">
      {/* 경로가 곧 제목 줄 — 마지막 마디는 편집 중인 이름을 따라간다 */}
      <Breadcrumb items={[...path, { label: shownTitle }]} guard={leave} />
      {code ? <code className="ts-mono ts-muted">{code}</code> : null}
      {headerMeta}
      {mode === "read" && readBadges ? <span className="ts-edit-badges">{readBadges}</span> : null}
      <span className="ts-edit-actions">
        {mode === "read" ? extraActions : editActions}
        {mode === "read" ? <button type="button" onClick={() => setMode("edit")} disabled={pending}>편집</button> : <><IconButton icon={<IconClose />} label="편집 취소" disabled={pending} onClick={() => leave(cancel)} /><button type="button" className="primary" disabled={!dirty || blocked || pending} onClick={() => handle("save")}>{pending ? "저장 중…" : "저장"}</button></>}
        {/* 즉시 실행 명령은 편집 모드에서 비활성 — 미저장 변경과 즉시 삭제가 한 화면에 겹치지 않게 (디자인원칙 §2 L2 · 점검 P2) */}
        {deleteAction ? <IconButton icon={<IconTrash />} label={mode === "edit" ? EDIT_MODE_LOCKED_TIP : deleteTooltip ?? deleteLabel ?? `${shownTitle} 삭제`} danger disabled={pending || mode === "edit"} onClick={() => handle("delete")} /> : null}
      </span>
    </div>
    {error ? <p className="ts-error-banner">{error}</p> : null}
    <fieldset className="ts-edit-fields" disabled={pending}>{children}</fieldset>
    {discard ? <DiscardDialog onStay={() => setDiscard(undefined)} onDiscard={() => { const { go } = discard; setDiscard(undefined); go(); }} /> : null}
    {confirm ? <dialog open className="ts-dialog"><p className="ts-confirm-title">{confirm.kind === "save" ? confirm.outcome.title ?? "변경하면 저장된 값이 사라질 수 있다" : `${deleteLabel ?? shownTitle} 삭제`}</p><ImpactLines outcome={confirm.outcome} /><div className="ts-confirm-actions"><button type="button" onClick={() => setConfirm(undefined)} disabled={pending}>취소</button><button type="button" className="danger" onClick={() => handle(confirm.kind, true)} disabled={pending}>{confirm.kind === "save" ? confirm.outcome.actionLabel ?? `타입 바꾸고 값 ${confirm.outcome.impact.valueRowsLost}건 삭제` : deleteLabel ?? "삭제"}</button></div></dialog> : null}
  </EditContext.Provider>;
}

export function Field({ name, label, info, type = "text", options = [], readValue, className, toggle }: { name: string; label: string; info?: string; /** "combo" — 참조 고르기(검색 입력, 디자인원칙 §2.6). "select" 는 몇 안 되는 고정 선택지만. */ type?: "text" | "textarea" | "select" | "combo" | "radio" | "number" | "date" | "toggle"; options?: readonly RadioOption[]; readValue?: (value: unknown) => ReactNode; className?: string; /** type="toggle" — 켜진 상태의 이름과 켜짐/꺼짐 뜻풀이. */ toggle?: { label: string; hintOn?: string; hintOff?: string } }) {
  const field = useEditField(name);
  const display = readValue ? readValue(field.value) : field.value === undefined || field.value === "" ? "없음" : typeof field.value === "boolean" ? field.value ? "예" : "아니오" : String(field.value);
  return <div className="ts-form-row"><label>{label}{info ? <InfoTip text={info} /> : null}</label><div className="ts-form-control">{field.mode === "read" ? <span className={`ts-field-locked ${className ?? ""}`}>{display}</span> : type === "textarea" ? <textarea value={String(field.value ?? "")} onChange={(event) => field.setValue(event.target.value)} rows={2} className="ts-field-direct" /> : type === "select" ? <select value={String(field.value ?? "")} onChange={(event) => field.setValue(event.target.value)} className="ts-field-direct">{options.map((option) => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}</select> : type === "combo" ? <Combobox ariaLabel={label} value={String(field.value ?? "")} onChange={(value) => field.setValue(value)} options={options.map((option) => ({ value: String(option.value), label: option.label, hint: option.hint }))} placeholder="이름 · 코드로 찾기" /> : type === "radio" ? <RadioGroup name={name} label={label} options={options} value={field.value as string | boolean} onChange={field.setValue} /> : type === "toggle" ? <Toggle name={name} label={toggle?.label ?? label} checked={Boolean(field.value)} onChange={field.setValue} hintOn={toggle?.hintOn} hintOff={toggle?.hintOff} /> : <input type={type} value={String(field.value ?? "")} onChange={(event) => field.setValue(type === "number" && event.target.value !== "" ? Number(event.target.value) : event.target.value)} className={`ts-field-direct ${className ?? ""}`} />}</div></div>;
}
