"use client";

/**
 * 내부 변수 표 — 인자 표 아래 (최종 결정 2 · 기능/함수조항 §4.3).
 *
 * 내부 변수 = 인자를 가공한 값에 붙인 이름(이름 · 식). 본문과 뒤의 내부 변수가 `var.<이름>` 으로 읽고, 조건 · 슬롯 고르기의 「내부 변수」 묶음에 곧바로 선다.
 * 앞에 선언한 것만 읽는다. 연산은 타입별로 몇 개뿐이다(개수 연산 없음) — 식 칸의 툴팁(`OPS_HINT`). 필드는 이름으로 적는다(저장은 키).
 * 더하기 `+`, 빼기 ⊖ — 인자 표 · 옵션 목록과 같은 문법.
 */
import { IconButton, IconMinusCircle, IconPlus } from "@/app/_components/icons";
import { InfoTip } from "@/app/_components/InfoTip";
import type { LocalDef } from "@/domain/clause";

const NOTE = "인자를 가공한 이름 — 본문과 뒤의 내부 변수가 읽는다(앞에 선언한 것만). 개수 연산은 없다.";

/** 연산 안내 — 식 칸 툴팁 (기능/식언어 §12). */
const OPS_HINT =
  "연산: 세목 선택지 목록 .합치기(폼.필드)(사유합치기) · 목록 .있음('값', …) · .거르기(필드 = 값) · .비었음 · 열거값 .필드 · = '값' · 참거짓 and · or · not. 개수 연산은 없다.";

export function LocalsPane({ locals, editing, onChange }: { locals: readonly LocalDef[]; editing: boolean; onChange: (next: LocalDef[]) => void }) {
  const patch = (i: number, next: LocalDef) => onChange(locals.map((l, idx) => (idx === i ? next : l)));
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
                <tr key={i}>
                  {editing ? (
                    <>
                      <td>
                        <input className="ts-field-direct" aria-label={`내부 변수 ${n} 이름`} placeholder="예: 암있음" value={l.name} onChange={(e) => patch(i, { ...l, name: e.target.value })} />
                      </td>
                      <td>
                        <input className="ts-field-direct ts-mono" aria-label={`내부 변수 ${n} 식`} title={OPS_HINT} placeholder="예: arg.종들.합치기(waiver.reasons)" value={l.expr} onChange={(e) => patch(i, { ...l, expr: e.target.value })} />
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
    </section>
  );
}
