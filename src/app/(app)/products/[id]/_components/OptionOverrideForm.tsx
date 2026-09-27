"use client";

/**
 * 옵션 오버라이드 설정 폼 — 노드 id·공용조항 코드·옵션 JSON 을 사람이 옮겨 적던 자리를 select 로 바꾼다
 * (리뷰 #7 · #65 · 디자인원칙 §9.1). 고르는 것은 둘뿐이다:
 *   ① 보통약관 문면의 공용조항 참조 자리 (「제4조(…) › 공용조항 …」)
 *   ② 그 공용조항이 가진 옵션마다의 선택지
 * 서버 액션은 그대로 `nodeId` · `clauseCode` · `options`(JSON) 를 받으므로 hidden 으로 조립해 넘긴다.
 *
 * **지금 저장된 선택(`current`)으로 채워서 연다** — 저장은 그 자리의 오버라이드 레코드를 통째로 덮어쓰므로
 * (`product.setOptionOverride` = upsert), 빈 폼에서 한 옵션만 고르면 먼저 고른 다른 옵션이 조용히 사라진다.
 * 빈 값(「— 마스터 기본으로 —」)은 그 옵션을 오버라이드에서 빼는 것이고, 조립은 마스터 기본으로 되돌아간다
 * (`resolveOptions` = `{...master, ...override}`).
 */
import { useState } from "react";

export interface OverrideOptionValue {
  code: string;
  label: string;
}

export interface OverrideOption {
  code: string;
  label: string;
  values: OverrideOptionValue[];
}

export interface OverrideTarget {
  nodeId: string;
  clauseCode: string;
  /** 「제4조(보험금의 지급사유) › 공용조항 면책 보충(C0002)」 */
  label: string;
  options: OverrideOption[];
}

export function OptionOverrideForm({
  targets,
  action,
  current,
  articleId,
}: {
  targets: OverrideTarget[];
  action: (formData: FormData) => void | Promise<void>;
  /** 이 자리에 이미 저장된 오버라이드 선택 — 폼의 시작값. */
  current?: Record<string, string>;
  /** 돌아갈 자리의 조 (약관 세 패널에서 부를 때). */
  articleId?: string;
}) {
  const [nodeId, setNodeId] = useState(targets[0]?.nodeId ?? "");
  const [selection, setSelection] = useState<Record<string, string>>(current ?? {});
  const target = targets.find((t) => t.nodeId === nodeId) ?? targets[0];

  if (!target) return null;

  const chosen = Object.fromEntries(Object.entries(selection).filter(([, v]) => v !== ""));

  return (
    <form action={action} className="ts-form">
      <h3 className="ts-form-title">오버라이드 설정</h3>
      <input type="hidden" name="nodeId" value={target.nodeId} />
      <input type="hidden" name="clauseCode" value={target.clauseCode} />
      <input type="hidden" name="options" value={JSON.stringify(chosen)} />
      {articleId && <input type="hidden" name="art" value={articleId} />}

      <label className="ts-field">
        <span>공용조항 자리</span>
        <select
          value={target.nodeId}
          onChange={(e) => {
            setNodeId(e.target.value);
            setSelection({});
          }}
        >
          {targets.map((t) => (
            <option key={t.nodeId} value={t.nodeId}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      {target.options.length === 0 ? (
        <p className="ts-form-empty">이 공용조항에는 고를 옵션이 없다.</p>
      ) : (
        target.options.map((o) => (
          <label key={o.code} className="ts-field">
            <span>{o.label}</span>
            <select value={selection[o.code] ?? ""} onChange={(e) => setSelection((prev) => ({ ...prev, [o.code]: e.target.value }))}>
              <option value="">— 마스터 기본으로 —</option>
              {o.values.map((v) => (
                <option key={v.code} value={v.code}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
        ))
      )}

      <div className="ts-form-actions">
        <button type="submit" className="primary" disabled={target.options.length === 0}>
          오버라이드 저장
        </button>
      </div>
    </form>
  );
}
