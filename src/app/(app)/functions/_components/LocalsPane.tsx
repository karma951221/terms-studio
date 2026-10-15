"use client";

/**
 * 내부 변수 표 — 인자 표 아래 (최종 결정 2 · 기능/함수조항 §4.3).
 *
 * 내부 변수 = 인자를 가공한 값에 붙인 이름(이름 · 식). 본문과 뒤의 내부 변수가 `var.<이름>` 으로 읽고, 조건 · 슬롯 고르기의 「내부 변수」 묶음에 곧바로 선다.
 * 앞에 선언한 것만 읽는다. 연산은 타입별로 몇 개뿐이다(개수 연산 없음). 필드는 이름으로 적는다(저장은 키).
 * 편집 중이면 표 아래 **넣기 패널**(구분자 화면의 넣기 패널과 같은 방식 — 더블클릭 · Enter 로 마지막에 누른 식 칸의 커서 자리에):
 * 인자 · 그 줄보다 앞 내부 변수 · 연산 · 필드 (`localInsertGroups`). 자동완성은 없다.
 * 더하기 `+`, 빼기 ⊖ — 인자 표 · 옵션 목록과 같은 문법.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { IconButton, IconMinusCircle, IconPlus } from "@/app/_components/icons";
import { InfoTip } from "@/app/_components/InfoTip";
import type { LocalDef, ParamDef } from "@/domain/clause";

import { ExpressionInput, useExpressionInsert } from "@/app/(app)/catalog/_components/ExpressionField";

import { localInsertGroups, type LocalInsertGroup } from "./locals";
import type { EnumChoice } from "./params";

const NOTE = "인자를 가공한 이름 — 본문과 뒤의 내부 변수가 읽는다(앞에 선언한 것만). 개수 연산은 없다. 편집 중이면 표 아래 넣기 패널에서 더블클릭으로 식 칸 커서 자리에 넣는다.";

type Insert = (text: string, caret?: number) => void;

/** 식 칸 하나 — 커서 자리 삽입(`useExpressionInsert`)을 부모 패널에 맡긴다. */
function ExprCell({ value, n, onChange, onFocus, register }: { value: string; n: number; onChange: (next: string) => void; onFocus: () => void; register: (at: number, insert: Insert | undefined) => void }) {
  const { ref, insert } = useExpressionInsert(value, onChange);
  const latest = useRef(insert);
  useEffect(() => {
    latest.current = insert;
  });
  useEffect(() => {
    register(n - 1, (text, caret) => latest.current(text, caret));
    return () => register(n - 1, undefined);
  }, [register, n]);
  return (
    <span onFocus={onFocus}>
      <ExpressionInput inputRef={ref} value={value} onChange={onChange} className="ts-field-direct" ariaLabel={`내부 변수 ${n} 식`} placeholder="예: arg.종들.합치기(waiver.reasons)" />
    </span>
  );
}

/** 넣기 패널 — 묶음 탭(인자 · 내부 변수 · 연산 · 필드), 항목 더블클릭 · Enter 로 넣는다. */
function LocalInsertPanel({ groups, target, onInsert }: { groups: readonly LocalInsertGroup[]; target: string; onInsert: Insert }) {
  const [tab, setTab] = useState<LocalInsertGroup["group"]>("인자");
  const current = groups.find((g) => g.group === tab) ?? groups[0];
  return (
    <div className="ts-insert-panel ts-local-insert" aria-label="내부 변수 식 넣기">
      <p className="ts-l2-side-title">
        넣기 <span className="ts-count">더블클릭으로 {target} 식 커서 자리에</span>
      </p>
      <div className="ts-basic-tabs" role="tablist" aria-label="넣기">
        {groups.map((g) => (
          <button key={g.group} type="button" role="tab" id={`local-insert-tab-${g.group}`} aria-selected={tab === g.group} aria-controls="local-insert-body" onClick={() => setTab(g.group)}>
            {g.group}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="local-insert-body" aria-labelledby={`local-insert-tab-${tab}`} className="ts-insert-body">
        {current.items.length === 0 ? (
          <p className="ts-form-hint">{tab === "내부 변수" ? "이 줄보다 앞에 선언한 내부 변수가 없다." : "넣을 것이 없다."}</p>
        ) : (
          <ul className={`ts-insert-list${tab === "연산" ? " ts-insert-operators" : ""}`}>
            {current.items.map((item) => (
              <li key={item.text}>
                <button
                  type="button"
                  className="ts-insert-item"
                  title={`${item.hint} — 더블클릭으로 넣기: ${item.text}`}
                  onDoubleClick={() => onInsert(item.text, item.caret)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onInsert(item.text, item.caret);
                    }
                  }}
                >
                  <span className="ts-mono">{item.label}</span>
                  <span className="ts-insert-detail">{item.hint}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function LocalsPane({
  locals,
  editing,
  onChange,
  params = [],
  enums = [],
}: {
  locals: readonly LocalDef[];
  editing: boolean;
  onChange: (next: LocalDef[]) => void;
  /** 넣기 패널의 인자 · 필드 재료. */
  params?: readonly ParamDef[];
  enums?: readonly EnumChoice[];
}) {
  const patch = (i: number, next: LocalDef) => onChange(locals.map((l, idx) => (idx === i ? next : l)));
  // 마지막으로 누른 식 칸 — 넣기 패널이 그 칸의 커서 자리에 넣는다(없으면 마지막 줄)
  const [active, setActive] = useState<number>();
  const inserters = useRef(new Map<number, Insert>());
  const register = useCallback((at: number, insert: Insert | undefined) => {
    if (insert) inserters.current.set(at, insert);
    else inserters.current.delete(at);
  }, []);
  const target = active !== undefined && active < locals.length ? active : locals.length - 1;
  return (
    <section className="ts-clause-params" aria-label="내부 변수">
      <h2 className="ts-clause-sec">
        내부 변수
        <InfoTip text={NOTE} />
      </h2>
      {locals.length === 0 && !editing ? <p className="ts-muted">내부 변수 없음.</p> : null}
      {locals.length > 0 && (
        <table className="ts-table ts-clause-params-table">
          <thead>
            <tr>
              <th scope="col">이름</th>
              <th scope="col">식</th>
              {editing && <th scope="col" aria-label="빼기" />}
            </tr>
          </thead>
          <tbody>
            {locals.map((l, i) => {
              const n = i + 1;
              return (
                <tr key={i} className={editing && i === target ? "is-active" : undefined}>
                  {editing ? (
                    <>
                      <td>
                        <input className="ts-field-direct" aria-label={`내부 변수 ${n} 이름`} placeholder="예: 암있음" value={l.name} onChange={(e) => patch(i, { ...l, name: e.target.value })} onFocus={() => setActive(i)} />
                      </td>
                      <td>
                        <ExprCell value={l.expr} n={n} onChange={(expr) => patch(i, { ...l, expr })} onFocus={() => setActive(i)} register={register} />
                      </td>
                      <td>
                        <IconButton icon={<IconMinusCircle />} danger label={`내부 변수 ${l.name || n} 빼기`} onClick={() => onChange(locals.filter((_x, idx) => idx !== i))} />
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="ts-mono">{l.name}</td>
                      <td className="ts-mono">{l.expr}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {editing ? (
        <button type="button" className="ts-cov-add-tile ts-option-add" onClick={() => onChange([...locals, { name: "", expr: "" }])}>
          <IconPlus /> 내부 변수 추가
        </button>
      ) : null}
      {editing && locals.length > 0 ? (
        <LocalInsertPanel
          groups={localInsertGroups(params, locals, target, enums)}
          target={locals[target]?.name.trim() || `${target + 1}번째`}
          onInsert={(text, caret) => inserters.current.get(target)?.(text, caret)}
        />
      ) : null}
    </section>
  );
}
