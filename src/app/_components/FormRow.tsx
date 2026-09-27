/**
 * 2열 필드 한 줄 — 라벨 좌측 고정폭, 값 우측 (디자인원칙 §2 L2).
 *
 * 생성 화면마다 같은 마크업을 적던 것을 모았다. 라벨을 값 위에 두지 않는다 —
 * 세로 길이가 두 배가 되고 「한눈에」가 깨진다.
 */
import type { ReactNode } from "react";

import { ACTION_LABEL } from "@/app/_lib/labels";

import { Breadcrumb, type Crumb } from "./Breadcrumb";

export function FormRow({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="ts-form-row">
      {htmlFor ? (
        <label className="ts-form-label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className="ts-form-label">{label}</span>
      )}
      <div className="ts-form-control">{children}</div>
    </div>
  );
}

/** 생성 화면의 머리 — 제목과 「생성」을 한 줄에. 조작을 화면 하단에 두지 않는다 (§2 L2). */
export function CreateHead({
  title,
  formId,
  label = ACTION_LABEL.create,
  path,
  banner,
  actions,
}: {
  title: string;
  formId: string;
  label?: string;
  /** 이 화면 위의 경로 — 「구분자 › 새 구분자」 의 앞 마디 (디자인원칙 §1.7). */
  path: readonly Crumb[];
  banner?: ReactNode;
  /** 제출 버튼 왼쪽의 화면별 조작 — 구분자 생성의 「검사」 (저장의 일부인 것만). */
  actions?: ReactNode;
}) {
  return (
    <>
      <div className="ts-edit-head">
        <Breadcrumb items={[...path, { label: title }]} />
        <span className="ts-edit-actions">
          {actions}
          <button type="submit" form={formId} className="primary">
            {label}
          </button>
        </span>
      </div>
      {banner}
    </>
  );
}
