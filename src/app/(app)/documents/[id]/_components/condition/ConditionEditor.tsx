"use client";

/**
 * 조건식 칸 — 그 자리 팝업 안의 「조건식」 칸(문장 안 조건 넣기)이 쓴다 (ADR-0066 §4~§7). 조건 머리 · 칩은 `ConditionDialog` 를 바로 띄운다.
 * 화면은 소스 문자열을 든 숨은 `<input>` 하나로 보이고, 값 자체는 팝업(`ConditionDialog`)이 만든다.
 * 서버 액션은 그대로 이 `name` 필드로 받는다 — 팝업이 만든 소스를 hidden input 에 밀어넣을 뿐.
 */
import { useMemo, useRef, useState } from "react";

import { ConditionDialog } from "./ConditionDialog";
import { chipDisplay } from "./display";
import type { ConditionContext } from "./types";

export function ConditionEditor({
  name,
  initial,
  context,
  autoSubmit,
}: {
  name: string;
  initial?: string;
  context: ConditionContext;
  autoSubmit?: boolean;
}) {
  const [source, setSource] = useState(initial ?? "");
  const [open, setOpen] = useState(false);
  const hidden = useRef<HTMLInputElement>(null);
  const display = useMemo(() => chipDisplay(source, context), [source, context]);
  return (
    <span className="ts-cond-editor">
      <input ref={hidden} type="hidden" name={name} value={source} />
      <button type="button" className="ts-cond-chip-edit ts-mono" onClick={() => setOpen(true)}>
        {source ? display : "조건 없음 — 눌러서 만들기"}
      </button>
      {source && (
        <button type="button" onClick={() => setSource("")} aria-label="조건 비우기 (그 밖의 경우)">
          ⓧ
        </button>
      )}
      <ConditionDialog
        open={open}
        context={context}
        initial={source}
        onCancel={() => setOpen(false)}
        onConfirm={(s) => {
          setSource(s);
          setOpen(false);
          if (autoSubmit) hidden.current?.form?.requestSubmit();
        }}
      />
    </span>
  );
}
