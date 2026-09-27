/**
 * ValueList — 폼 모델의 읽기 전용 뷰. 완결성 표시용.
 *
 * 입력률 요약 없이 저장된 값을 보여준다.
 *
 * 상태가 없어 서버 컴포넌트에서도 그대로 쓸 수 있다 ("use client" 없음).
 * 값은 표시명으로 보여준다 (ADR-0005). 기본값은 값이 아니므로 보여주지 않는다 (ADR-0004).
 * 2026-09-12 — 자리가 전부 「사람이 채우는 값」이라 출처 표식(파생 ƒ · const 자물쇠)이 사라졌다 (ADR-0037).
 */
import { formatValue, type FormModel } from "./model";

export interface ValueListProps {
  model: FormModel;
  /** 제목(레벨 표시명) 숨김. */
  hideTitle?: boolean;
}

export function ValueList({ model, hideTitle }: ValueListProps) {
  return (
    <section className="ts-values" data-level={model.level}>
      {!hideTitle && <h3 className="ts-values-title">{model.label}</h3>}
      <dl className="ts-values-list">
        {model.fields.map((f) => {
          const text = formatValue(f);
          return (
            <div
              key={f.path}
              className={`ts-values-row${text === undefined ? " is-not-entered" : ""}`}
              data-path={f.path}
              data-source={f.source}
            >
              <dt className="ts-values-label">{`${f.form.label} › ${f.label}`}</dt>
              <dd className="ts-values-value">
                {text === undefined ? <span className="ts-badge missing">미입력</span> : text}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
