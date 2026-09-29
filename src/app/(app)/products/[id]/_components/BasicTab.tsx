"use client";

/**
 * 기본정보 탭 — 상품정보(상품명 · 평균공시이율 · 상품특성) · 세목 두 탭(보험종목 정의 · 종·형 조합)
 * (와이어프레임 §20.2 A·B·C · 기능/상품 §4.4, 2026-09-28 「안 2」).
 *
 * - 읽기로 시작한다. 편집·취소·저장 버튼은 헤더(`ProductHeadActions`)에 있고, 이 컴포넌트는 마운트 시
 *   제 begin · cancel · save · dirty 를 `ProductEditProvider` 에 등록한다. 저장 하나가 상품명 · 상품 레벨 값 · 종목 정의 ·
 *   세목 값 · 사용할 조합을 함께 반영한다.
 * - 보험종목은 표다. 값 열은 표시되는 종목들의 세목유형 폼 필드의 합집합. 편집 중에는 셀 안에서 바로
 *   입력한다 — 필드 상태 전이는 StructForm 과 같은 `formReducer` 를 쓴다.
 * - 조합은 체크만 한다. 두 세목 탭을 오가도 초안은 유지된다.
 */
import { Fragment, useEffect, useId, useState } from "react";

import { PLAN_AXIS_LABEL, planCombinationKey, planOptionLabel, type PlanAxis, type PlanOption, type ProductPlan } from "@/domain/product";
import { FieldInput, FieldReadValue, formReducer, initFormState, toSubmission, type FieldView, type FormAction, type FormModel, type FormState } from "@/forms";
import type { EditOutcome } from "@/app/_lib/edit";
import type { ProductBasicInput } from "@/services/product";

import { saveProductBasicAction } from "../../actions";
import { basicDraftDirty } from "../../lib";
import { useProductEdit } from "./ProductEdit";

type OptionDraft = Omit<ProductBasicInput["options"][number], "values">;
type Confirmation = Extract<EditOutcome, { ok: "confirm" }>;

export interface BasicTabProps {
  productId: string;
  productName: string;
  productForm: FormModel;
  productHighlight?: string;
  planOptions: PlanOption[];
  plans: ProductPlan[];
  planOptionForms: { option: PlanOption; model: FormModel }[];
  planTypeForms: { code: string; label: string; model: FormModel }[];
  highlightOption?: string;
  highlightField?: string;
}

/** 값 열 — 표시되는 종목들의 폼 필드 합집합 (경로 기준 · 처음 나온 순서). */
interface ValueColumn {
  path: string;
  label: string;
}

function valueColumns(models: FormModel[]): ValueColumn[] {
  const seen = new Map<string, FieldView>();
  for (const model of models) for (const field of model.fields) if (!seen.has(field.path)) seen.set(field.path, field);
  const fields = [...seen.values()];
  // 폼이 둘 이상 섞이면 「적용여부」 같은 라벨이 겹친다 — 폼 이름을 앞에 붙여 구분한다
  const forms = new Set(fields.map((f) => f.form.key));
  return fields.map((f) => ({ path: f.path, label: forms.size > 1 ? `${f.form.label} ${f.label}` : f.label }));
}

/** 종·형 칸 — 「제1종」. 이름은 제 열에 따로 있다. */
const axisLabel = (o: Pick<PlanOption, "axis" | "number">) => `제${o.number}${PLAN_AXIS_LABEL[o.axis]}`;
const combinationLabel = (items: Pick<PlanOption, "axis" | "number" | "name">[]) => items.map(planOptionLabel).join(" · ");

export function BasicTab(props: BasicTabProps) {
  const { productId, productName, productForm, planOptions, plans, planOptionForms, planTypeForms, highlightOption, highlightField, productHighlight } = props;
  const { editing, pending, register, save: requestSave } = useProductEdit();
  const idBase = useId();

  const savedModelOf = (optionId: string) => planOptionForms.find((f) => f.option.id === optionId)?.model;
  const modelFor = (option: OptionDraft): FormModel => savedModelOf(option.id) ?? planTypeForms.find((f) => f.code === option.planTypeCode)?.model ?? planTypeForms[0].model;
  const initialOptions = (): OptionDraft[] => planOptions.map((o) => ({ ...o, isNew: false }));
  const initialForms = (): Record<string, FormState> => Object.fromEntries(planOptions.map((o) => [o.id, initFormState(modelFor({ ...o, isNew: false }))]));
  const initialCombinations = (): string[][] => plans.map((p) => p.options.map((o) => o.id));

  const [name, setName] = useState(productName);
  const [options, setOptions] = useState<OptionDraft[]>(initialOptions);
  const [forms, setForms] = useState<Record<string, FormState>>(initialForms);
  const [productState, setProductState] = useState<FormState>(() => initFormState(productForm));
  const [combinations, setCombinations] = useState<string[][]>(initialCombinations);
  const [selected, setSelected] = useState<string[]>([]);
  const [subTab, setSubTab] = useState<"definitions" | "combinations">("definitions");
  const [error, setError] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>();

  // ── 편집 손잡이 — 헤더의 편집 · 취소 · 저장이 부른다 ────────────────────
  const begin = () => {
    setName(productName);
    setOptions(initialOptions());
    setForms(initialForms());
    setProductState(initFormState(productForm));
    setCombinations(initialCombinations());
    setSelected([]);
    setError("");
    setAttempted(false);
    setConfirmation(undefined);
  };
  const cancel = () => {
    setError("");
    setAttempted(false);
    setConfirmation(undefined);
    setSelected([]);
  };
  const submit = async (confirmed: boolean): Promise<"done" | "stay"> => {
    setAttempted(true);
    const product = toSubmission(productState);
    const optionSubmissions = options.map((o) => toSubmission(forms[o.id] ?? initFormState(modelFor(o))));
    const issues = [...product.issues, ...optionSubmissions.flatMap((s) => s.issues)];
    if (!name.trim() || options.some((o) => !o.name.trim() || !Number.isInteger(o.number) || o.number < 1)) {
      setError("비어 있는 항목이 있습니다. 상품명과 보험종목의 번호·이름을 채워 주세요.");
      return "stay";
    }
    if (issues.length) {
      setError("값을 해석할 수 없는 항목이 있습니다. 표시된 셀을 고쳐 주세요.");
      return "stay";
    }
    try {
      const input: ProductBasicInput = {
        name,
        values: product.values,
        options: options.map((o, i) => ({ ...o, values: optionSubmissions[i].values })),
        combinations,
      };
      const result = await saveProductBasicAction(productId, input, confirmed);
      if (result.ok === "confirm") {
        setConfirmation(result);
        setError("");
        return "stay";
      }
      if (!result.ok) {
        setError(result.message);
        setConfirmation(undefined);
        return "stay";
      }
      setError("");
      setConfirmation(undefined);
      setAttempted(false);
      setSelected([]);
      return "done";
    } catch {
      setError("저장하지 못했습니다. 입력한 내용은 유지됩니다. 다시 시도해 주세요.");
      return "stay";
    }
  };
  /** 초안이 편집 시작(= 서버 값)과 달라졌나 — ✕ · 탭 링크 · 경로 링크의 「버립니까?」 판정 (점검 M21). */
  const dirty = () =>
    basicDraftDirty(
      { name: productName, options: initialOptions(), product: initFormState(productForm), forms: initialForms(), combinations: initialCombinations() },
      { name, options, product: productState, forms, combinations },
    );
  // 매 렌더 등록 — 손잡이가 최신 초안을 닫아 두도록
  useEffect(() => {
    register({ begin, cancel, save: submit, dirty });
    return () => register(null);
  });

  // 마스터 사용처에서 건너온 강조 행은 화면 가운데로
  useEffect(() => {
    if (highlightOption) document.getElementById(`plan-option-${highlightOption}`)?.scrollIntoView?.({ block: "center" });
  }, [highlightOption]);

  // ── 초안 조작 ────────────────────────────────────────────────────────────
  const updateOption = (id: string, patch: Partial<OptionDraft>) => setOptions((current) => current.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  const dispatchOption = (id: string, action: FormAction) => setForms((current) => ({ ...current, [id]: formReducer(current[id], action) }));
  const changePlanType = (id: string, planTypeCode: string) => {
    const model = planTypeForms.find((f) => f.code === planTypeCode)?.model;
    if (!model) return;
    updateOption(id, { planTypeCode });
    setForms((current) => ({ ...current, [id]: initFormState(model) }));
  };
  const addOption = () => {
    const axis: PlanAxis = "type";
    const id = crypto.randomUUID();
    const planTypeCode = planTypeForms[0].code;
    setOptions((current) => [...current, { id, isNew: true, axis, number: Math.max(0, ...current.filter((o) => o.axis === axis).map((o) => o.number)) + 1, name: "", planTypeCode }]);
    setForms((current) => ({ ...current, [id]: initFormState(planTypeForms[0].model) }));
    setSubTab("definitions");
  };
  const removeSelected = () => {
    const gone = new Set(selected);
    setOptions((current) => current.filter((o) => !gone.has(o.id)));
    setCombinations((current) => current.filter((c) => !c.some((id) => gone.has(id))));
    setForms((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !gone.has(id))));
    setSelected([]);
  };
  const toggleSelected = (id: string, on: boolean) => setSelected((current) => (on ? [...current, id] : current.filter((s) => s !== id)));
  const toggleCombination = (ids: string[], on: boolean) => {
    const key = planCombinationKey(ids);
    setCombinations((current) => (on ? [...current.filter((c) => planCombinationKey(c) !== key), ids] : current.filter((c) => planCombinationKey(c) !== key)));
  };

  // ── 표에 그릴 것 — 읽기는 저장된 것, 편집은 초안 ─────────────────────────
  const shownOptions: OptionDraft[] = editing ? options : initialOptions();
  const shownCombinations = editing ? combinations : initialCombinations();
  const columns = valueColumns(shownOptions.map(modelFor));
  const types = shownOptions.filter((o) => o.axis === "type");
  const formsAxis = shownOptions.filter((o) => o.axis === "form");
  const candidates: OptionDraft[][] = types.length && formsAxis.length ? types.flatMap((t) => formsAxis.map((f) => [t, f])) : shownOptions.map((o) => [o]);
  const combinationRows: OptionDraft[][] = editing
    ? candidates
    : shownCombinations.map((ids) => ids.map((id) => shownOptions.find((o) => o.id === id)).filter((o): o is OptionDraft => !!o)).filter((items) => items.length > 0);
  const showPlanType = editing && planTypeForms.length > 1;
  /** 상품 레벨 필드를 폼(공시이율 · 상품특성)별로 — 선언 순서 그대로. */
  const productGroups = productForm.fields.reduce<{ key: string; label: string; fields: FieldView[] }[]>((groups, field) => {
    const last = groups.at(-1);
    if (last && last.key === field.form.key) last.fields.push(field);
    else groups.push({ key: field.form.key, label: field.form.label, fields: [field] });
    return groups;
  }, []);
  const nameMissing = attempted && !name.trim();

  // ── 값 셀 ────────────────────────────────────────────────────────────────
  const readCell = (model: FormModel, path: string) => {
    const field = model.fields.find((f) => f.path === path);
    if (!field) return null;
    // 빈 list<enum> 은 "" 로 나온다 — 없는 값은 전부 「—」. 지운 열거값 코드는 「없는 값」 칩 (ADR-0078 결정 5)
    return <FieldReadValue field={field} />;
  };
  const editCell = (ownerId: string, state: FormState | undefined, path: string, label: string) => {
    const field = state?.fields[path];
    if (!field) return null;
    const id = `${idBase}-${ownerId}-${path.replace(".", "-")}`;
    return (
      <>
        <span id={`${id}-label`} className="sr-only">
          {label}
        </span>
        <FieldInput id={id} field={field} name={`${ownerId}:${path}`} className="ts-field-direct" onEdit={(draft) => dispatchOption(ownerId, { type: "edit", path, draft })} />
        {field.error !== undefined && (
          <span className="ts-form-error" role="alert">
            {field.error}
          </span>
        )}
      </>
    );
  };
  const productCell = (path: string, label: string) => {
    const field = productState.fields[path];
    if (!field) return null;
    const id = `${idBase}-product-${path.replace(".", "-")}`;
    return (
      <>
        <span id={`${id}-label`} className="sr-only">
          {label}
        </span>
        <FieldInput id={id} field={field} name={`product:${path}`} className="ts-field-direct" onEdit={(draft) => setProductState((s) => formReducer(s, { type: "edit", path, draft }))} />
        {field.error !== undefined && (
          <span className="ts-form-error" role="alert">
            {field.error}
          </span>
        )}
      </>
    );
  };

  return (
    <div className="ts-basic-editor">
      {error && (
        <p role="alert" className="ts-error-banner">
          {error}
        </p>
      )}
      {confirmation && (
        <section className="ts-confirm">
          <p className="ts-confirm-title">저장하면 아래 항목이 삭제된다</p>
          <ul className="ts-confirm-loss">
            {confirmation.impact.valueRowsLost > 0 && <li>사람이 입력한 값 {confirmation.impact.valueRowsLost}건이 사라진다</li>}
            {confirmation.impact.cascade.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
            {confirmation.impact.brokenRefs.length > 0 && <li>깨질 참조 {confirmation.impact.brokenRefs.length}건</li>}
          </ul>
          <div className="ts-confirm-actions ts-basic-confirm-actions">
            <button type="button" className="danger" disabled={pending} onClick={() => requestSave(true)}>
              삭제 반영 후 저장
            </button>
            <button type="button" disabled={pending} onClick={() => setConfirmation(undefined)}>
              돌아가기
            </button>
          </div>
        </section>
      )}
      <fieldset className="ts-basic-body" disabled={pending || !!confirmation}>
        <section className="ts-basic-product-values" id="product-values" aria-label="상품정보">
          <h3>상품정보</h3>
          <div className="ts-basic-table-wrap">
            <table className="ts-table ts-basic-table ts-basic-info">
              <tbody>
                <tr>
                  <th scope="row">
                    <label htmlFor={`${idBase}-name`}>상품명</label>
                  </th>
                  <td className="col-flex">
                    <span className="ts-basic-name-control">
                      <input
                        id={`${idBase}-name`}
                        aria-label="상품명"
                        type="text"
                        value={editing ? name : productName}
                        readOnly={!editing}
                        required
                        aria-invalid={nameMissing || undefined}
                        onChange={(e) => setName(e.target.value)}
                      />
                      {nameMissing && (
                        <span className="ts-form-error" role="alert">
                          상품명은 비울 수 없습니다
                        </span>
                      )}
                    </span>
                  </td>
                </tr>
                {/* 상품 레벨 마스터 폼마다 — 공시이율 · 상품특성 (기능/상품 §3.1 · 2026-09-28). 폼이 둘 이상이면 폼 이름 줄을 끼운다 */}
                {productGroups.map((group) => (
                  <Fragment key={group.key}>
                    {productGroups.length > 1 && group.fields.length > 1 && (
                      <tr className="ts-basic-group">
                        <th scope="rowgroup" colSpan={2}>
                          {group.label}
                        </th>
                      </tr>
                    )}
                    {group.fields.map((field) => (
                      <tr key={field.path} className={field.path === productHighlight ? "is-highlighted" : undefined} data-path={field.path}>
                        <th scope="row">{field.label}</th>
                        <td className="col-flex">{editing ? productCell(field.path, field.label) : <FieldReadValue field={field} />}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="ts-basic-plans">
          <h3>세목</h3>
          <div className="ts-basic-tabs" role="tablist" aria-label="세목">
            <button type="button" role="tab" id="definitions-tab" aria-selected={subTab === "definitions"} aria-controls="definitions-panel" onClick={() => setSubTab("definitions")}>
              보험종목 정의
            </button>
            <button type="button" role="tab" id="combinations-tab" aria-selected={subTab === "combinations"} aria-controls="combinations-panel" onClick={() => setSubTab("combinations")}>
              종·형 조합
            </button>
          </div>

          <div role="tabpanel" id="definitions-panel" aria-labelledby="definitions-tab" hidden={subTab !== "definitions"}>
            {editing && (
              <div className="ts-basic-toolbar">
                {selected.length > 0 && (
                  <button type="button" className="danger" onClick={removeSelected}>
                    선택 삭제
                  </button>
                )}
                <button type="button" onClick={addOption} disabled={!planTypeForms.length}>
                  보험종목 추가
                </button>
              </div>
            )}
            {shownOptions.length === 0 ? (
              <p className="ts-basic-empty">{editing ? "보험종목 추가로 첫 행을 만든다." : "정의된 보험종목이 없다. 편집을 눌러 추가한다."}</p>
            ) : (
              <div className="ts-basic-table-wrap">
                <table className="ts-table ts-basic-table">
                  <thead>
                    <tr>
                      {editing && (
                        <th scope="col" className="ts-basic-col-select">
                          선택
                        </th>
                      )}
                      {editing ? (
                        <>
                          <th scope="col">구분</th>
                          <th scope="col">번호</th>
                        </>
                      ) : (
                        <th scope="col">종·형</th>
                      )}
                      <th scope="col" className="ts-basic-col-name">
                        보험종목명
                      </th>
                      {showPlanType && <th scope="col">세목유형</th>}
                      {columns.map((col) => (
                        <th key={col.path} scope="col">
                          {col.label}
                        </th>
                      ))}
                      {columns.length === 0 && <th scope="col" className="col-flex" aria-hidden="true" />}
                    </tr>
                  </thead>
                  <tbody>
                    {shownOptions.map((option) => {
                      const model = modelFor(option);
                      const rowHighlighted = option.id === highlightOption;
                      const numberMissing = attempted && (!Number.isInteger(option.number) || option.number < 1);
                      const optionNameMissing = attempted && !option.name.trim();
                      return (
                        <tr key={option.id} id={`plan-option-${option.id}`} className={rowHighlighted && !highlightField ? "is-highlighted" : undefined}>
                          {editing && (
                            <td className="ts-basic-col-select">
                              <input type="checkbox" aria-label={`${option.name.trim() || `${axisLabel(option)} 행`} 선택`} checked={selected.includes(option.id)} onChange={(e) => toggleSelected(option.id, e.target.checked)} />
                            </td>
                          )}
                          {editing ? (
                            <>
                              <td>
                                <select aria-label="종·형 구분" value={option.axis} disabled={!option.isNew} onChange={(e) => updateOption(option.id, { axis: e.target.value as PlanAxis })}>
                                  <option value="type">종</option>
                                  <option value="form">형</option>
                                </select>
                              </td>
                              <td>
                                <input
                                  aria-label="번호"
                                  type="number"
                                  min={1}
                                  step={1}
                                  required
                                  className="ts-basic-number"
                                  value={option.number || ""}
                                  aria-invalid={numberMissing || undefined}
                                  onChange={(e) => updateOption(option.id, { number: Number(e.target.value) })}
                                />
                              </td>
                            </>
                          ) : (
                            <td>{axisLabel(option)}</td>
                          )}
                          <td className="ts-basic-col-name">
                            {editing ? (
                              <>
                                <input aria-label="보험종목명" type="text" required placeholder="보험료납입면제미적용형" value={option.name} aria-invalid={optionNameMissing || undefined} onChange={(e) => updateOption(option.id, { name: e.target.value })} />
                                {optionNameMissing && (
                                  <span className="ts-form-error" role="alert">
                                    이름을 입력해 주세요
                                  </span>
                                )}
                              </>
                            ) : (
                              option.name
                            )}
                          </td>
                          {showPlanType && (
                            <td>
                              <select aria-label="세목유형" value={option.planTypeCode} disabled={!option.isNew} onChange={(e) => changePlanType(option.id, e.target.value)}>
                                {planTypeForms.map((t) => (
                                  <option key={t.code} value={t.code}>
                                    {t.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                          )}
                          {columns.map((col) => {
                            const cellHighlighted = rowHighlighted && highlightField === col.path;
                            return (
                              <td key={col.path} className={cellHighlighted ? "is-highlighted" : undefined} data-path={col.path}>
                                {editing ? editCell(option.id, forms[option.id], col.path, col.label) : readCell(model, col.path)}
                              </td>
                            );
                          })}
                          {columns.length === 0 && <td className="col-flex" />}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div role="tabpanel" id="combinations-panel" aria-labelledby="combinations-tab" hidden={subTab !== "combinations"}>
            {candidates.length === 0 ? (
              <p className="ts-basic-empty">보험종목을 먼저 정의한다.</p>
            ) : combinationRows.length === 0 ? (
              <p className="ts-basic-empty">사용하는 조합이 없다. 편집을 눌러 조합을 고른다.</p>
            ) : (
              <div className="ts-basic-table-wrap">
                <table className="ts-table ts-basic-table">
                  <thead>
                    <tr>
                      {editing && (
                        <th scope="col" className="ts-basic-col-select">
                          사용
                        </th>
                      )}
                      <th scope="col" className="col-flex">
                        종·형 조합
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {combinationRows.map((items) => {
                      const ids = items.map((o) => o.id);
                      const key = planCombinationKey(ids);
                      const used = shownCombinations.some((c) => planCombinationKey(c) === key);
                      const label = combinationLabel(items);
                      return (
                        <tr key={key}>
                          {editing && (
                            <td className="ts-basic-col-select">
                              <input type="checkbox" aria-label={`${label} 사용`} checked={used} onChange={(e) => toggleCombination(ids, e.target.checked)} />
                            </td>
                          )}
                          <td className="col-flex">{label}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </fieldset>
    </div>
  );
}
