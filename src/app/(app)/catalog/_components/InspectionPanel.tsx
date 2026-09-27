"use client";

/**
 * 「검사」 버튼과 「검사 결과」 블록 (기능/구분자 §3.3) — 생성 화면과 상세 편집이 같이 쓴다.
 *
 * - 버튼은 헤더 조작 줄에 서고, 결과는 폼 아래 블록에 선다. 둘은 같은 `InspectionState` 를 본다 (호출부가 든다).
 * - 타이핑 중 자동 검사는 없다 — 버튼을 눌렀을 때만 서버 액션을 부른다. 결과가 있는 동안 식 · 타입 · 레벨을 바꾸면
 *   결과는 지우지 않고 「오래되었습니다 — 다시 검사」 한 줄을 붙인다 (지금 값과 검사한 값을 `sameInspectInput` 으로 대조).
 * - 오류(빨강)는 저장을 막고, 경고(노랑 — 별칭 · 깨질 사용처)는 저장되고 배지로 남는다. 확인창은 없다.
 * - 좌표가 있는 항목은 그 자리로 가는 링크를 단다 (사용처 문면 · 참조하는 구분자). 자기 자신(이 구분자) 좌표는 링크하지 않는다.
 */
import Link from "next/link";
import { useTransition } from "react";

import { coordinateHref } from "@/app/_components/coordinateHref";
import { SeverityGlyph } from "@/app/_components/IssueList";
import { formatCoordinate } from "@/domain/coordinate";
import type { EnumDef } from "@/domain/catalog/types";
import type { Issue } from "@/domain/types";
import type { InspectInput, InspectResult } from "@/services/catalog";

import { inspectDiscriminatorAction } from "../edit-actions";
import { inferredLabel, sameInspectInput } from "../lib";

/** 검사한 입력과 그 결과 — 결과가 어느 값에 대한 것인지 알아야 「오래됨」을 판정한다. 액션이 실패하면 `error` 만 (결과 없음). */
export type InspectionState = { input: InspectInput; result: InspectResult; error?: undefined } | { input: InspectInput; result?: undefined; error: string };

export function InspectButton({ input, onResult, disabled }: { input: InspectInput; onResult: (state: InspectionState) => void; disabled?: boolean }) {
  const [pending, startTransition] = useTransition();
  const run = async () => {
    try {
      onResult({ input, result: await inspectDiscriminatorAction(input) });
    } catch (e) {
      // 서버 액션이 던지면(네트워크 · 서버 오류) 화면을 깨지 않고 결과 블록에 오류 한 줄로
      onResult({ input, error: e instanceof Error && e.message ? `검사하지 못했습니다 — ${e.message}` : "검사하지 못했습니다" });
    }
  };
  return (
    <button
      type="button"
      disabled={disabled || pending || input.expression.length === 0}
      title="저장하지 않고 식 · 결과 타입 · 사용처를 검사한다"
      onClick={() => startTransition(run)}
    >
      {pending ? "검사 중…" : "검사"}
    </button>
  );
}

function IssueRow({ issue, severity, selfCode }: { issue: Issue; severity: "error" | "warning"; selfCode: string | undefined }) {
  // 자기 좌표(이 구분자)는 지금 보고 있는 화면이다 — 링크하지 않는다
  const href = issue.at.ownerId !== undefined && issue.at.ownerId !== selfCode ? coordinateHref(issue.at) : undefined;
  return (
    <li className={severity === "warning" ? "ts-issue-warning" : undefined}>
      <SeverityGlyph severity={severity} /> {issue.message}
      {href ? <> · <Link href={href}>{formatCoordinate(issue.at, { source: true })} 로 가기</Link></> : null}
    </li>
  );
}

export function InspectionResult({ inspection, input, enums }: { inspection: InspectionState | undefined; input: InspectInput; enums: readonly EnumDef[] }) {
  if (!inspection) return null;
  const stale = !sameInspectInput(inspection.input, input);
  const enumLabel = (code: string) => enums.find((e) => e.code === code)?.label;
  if (inspection.result === undefined) {
    return (
      <div className="ts-inspection" aria-live="polite">
        <p className="ts-l2-side-title">검사 결과</p>
        <p className="ts-error-banner">{inspection.error}</p>
      </div>
    );
  }
  const { result } = inspection;
  return (
    <div className="ts-inspection" aria-live="polite">
      <p className="ts-l2-side-title">
        검사 결과 <span className="ts-count">오류 <b>{result.errors.length}</b> · 경고 {result.warnings.length}</span>
      </p>
      {stale ? <p className="ts-form-hint ts-inspection-stale">검사 결과가 오래되었습니다 — 다시 검사</p> : null}
      <p className="ts-form-hint">추론 타입: {inferredLabel(result.inferred, enumLabel)}</p>
      {result.errors.length > 0 ? (
        <ul className="ts-issues">{result.errors.map((issue, i) => <IssueRow key={`e${i}`} issue={issue} severity="error" selfCode={input.code} />)}</ul>
      ) : null}
      {result.warnings.length > 0 ? (
        <ul className="ts-issues">{result.warnings.map((issue, i) => <IssueRow key={`w${i}`} issue={issue} severity="warning" selfCode={input.code} />)}</ul>
      ) : null}
      {result.errors.length === 0 && result.warnings.length === 0 ? <p className="ts-form-hint">오류 · 경고 없음 — 저장할 수 있다.</p> : null}
      {result.errors.length > 0 ? <p className="ts-form-hint">오류가 있으면 저장이 거부된다. 경고는 저장되고 배지로 남는다.</p> : null}
    </div>
  );
}
