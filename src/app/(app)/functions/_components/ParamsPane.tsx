"use client";

/**
 * 인자 표 — 본문 옆 단, 옵션 목록 위 (최종 결정 2 · 기능/함수조항 §4.3).
 *
 * 인자 = 본문이 `arg.<이름>` 으로 읽는 입력 선언(이름 · 타입 · 기본 연결). 본문의 조건 · 슬롯 고르기 맨 앞 「인자」 묶음에 곧바로 선다.
 * 기본 연결은 넣는 자리에서 저절로 걸리는 연결이다 — 비우면 넣는 자리마다 연결해야 한다(연결 누락 = 문서 저장 오류).
 * 더하기 `+`, 빼기 ⊖ — 옵션 목록과 같은 문법.
 */
import { IconButton, IconMinusCircle, IconPlus } from "@/app/_components/icons";
import type { ParamDef } from "@/domain/clause";

import type { CtxDiscriminator } from "@/app/(app)/documents/[id]/_components/condition/types";

import { bindingLabel, bindingOfValue, bindingOptions, bindingValue, SCALAR_TYPES, typeLabel, typeOfValue, typeValue, type EnumChoice, type PlanFormChoice } from "./params";

export function ParamsPane({
  params,
  editing,
  onChange,
  discriminators,
  enums,
  forms,
}: {
  params: readonly ParamDef[];
  editing: boolean;
  onChange: (next: ParamDef[]) => void;
  discriminators: readonly CtxDiscriminator[];
  enums: readonly EnumChoice[];
  forms: readonly PlanFormChoice[];
}) {
  const patch = (i: number, next: ParamDef) => onChange(params.map((p, idx) => (idx === i ? next : p)));
  return (
    <section className="ts-clause-params" aria-label="인자">
      <h2 className="ts-clause-sec">인자</h2>
      <p className="ts-muted ts-clause-sec-note">본문이 읽는 입력 — 조건 · 슬롯은 구분자 대신 인자를 고른다. 넣는 자리에서 인자마다 구분자 · 상수를 댄다(기본 연결은 저절로).</p>
      {params.length === 0 && !editing ? <p className="ts-muted">인자 없음 — 고정 문장이다.</p> : null}
      {params.length > 0 && (
        <table className="ts-table ts-clause-params-table">
          <thead>
            <tr>
              <th scope="col">이름</th>
              <th scope="col">타입</th>
              <th scope="col">기본 연결</th>
              {editing && <th scope="col" aria-label="빼기" />}
            </tr>
          </thead>
          <tbody>
            {params.map((p, i) => {
              const n = i + 1;
              return (
                <tr key={i}>
                  {editing ? (
                    <>
                      <td>
                        <input className="ts-field-direct" aria-label={`인자 ${n} 이름`} placeholder="예: 갱신형" value={p.name} onChange={(e) => patch(i, { ...p, name: e.target.value })} />
                      </td>
                      <td>
                        <select
                          aria-label={`인자 ${n} 타입`}
                          value={typeValue(p.type)}
                          onChange={(e) => {
                            const { default: _dropped, ...rest } = p;
                            void _dropped;
                            patch(i, { ...rest, type: typeOfValue(e.target.value) }); // 타입이 바뀌면 기본 연결은 맞지 않는다 — 비운다
                          }}
                        >
                          {SCALAR_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                          {enums.map((e) => (
                            <option key={`e-${e.code}`} value={`enum:${e.code}`}>
                              열거형 — {e.label}
                            </option>
                          ))}
                          {enums.map((e) => (
                            <option key={`l-${e.code}`} value={`list<enum>:${e.code}`}>
                              열거형 목록 — {e.label}
                            </option>
                          ))}
                          {forms.map((f) => (
                            <option key={`f-${f.key}`} value={`planOptions:${f.key}`}>
                              세목 선택지 목록 — {f.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          aria-label={`인자 ${n} 기본 연결`}
                          value={bindingValue(p.default)}
                          onChange={(e) => {
                            const b = bindingOfValue(e.target.value, p.type);
                            const { default: _dropped, ...rest } = p;
                            void _dropped;
                            patch(i, b ? { ...rest, default: b } : rest);
                          }}
                        >
                          <option value="">없음 — 넣는 자리에서 연결</option>
                          {bindingOptions(p.type, discriminators, enums, forms, false).map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <IconButton icon={<IconMinusCircle />} danger label={`인자 ${p.name || n} 빼기`} onClick={() => onChange(params.filter((_x, idx) => idx !== i))} />
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="ts-mono">{p.name}</td>
                      <td>{typeLabel(p.type, enums, forms)}</td>
                      <td>{bindingLabel(p.default, p.type, discriminators, enums, forms)}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {editing ? (
        <button type="button" className="ts-cov-add-tile ts-option-add" onClick={() => onChange([...params, { name: "", type: { kind: "boolean" } }])}>
          <IconPlus /> 인자 추가
        </button>
      ) : null}
    </section>
  );
}
