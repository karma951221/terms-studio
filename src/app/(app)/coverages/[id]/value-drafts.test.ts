/**
 * 담보 상세 값 탭의 노드별 초안 (점검 H4 ① ②).
 *
 * 화면은 `formKeyOf` 를 StructForm 의 key 로, `byNode[노드]` 를 initialState 로 쓴다.
 * 여기서는 그 상태 전이를 화면 없이 재현한다 — 급부1 · 급부2 가 같은 마스터 폼 · 같은 저장값(지문이 같음)인 경우.
 *
 * ③(노드를 보기만 해도 프리필이 제출됨)은 B 담당 — `src/forms/model.ts` 의 「손대지 않은 칸은 제출 안 함」으로 막는다. 여기서는 다루지 않는다.
 */
import { describe, expect, it } from "vitest";

import type { MasterForm } from "@/domain/master";
import { buildForm, formReducer, initFormState, toSubmission, type FormState } from "@/forms";

import { formKeyOf, initValueDrafts, valueDraftsReducer, type ValueDrafts } from "./value-drafts";

const master: MasterForm[] = [
  {
    key: "pay",
    label: "보험금지급",
    level: "benefit",
    fields: [
      { key: "rate", label: "지급률", type: { kind: "number" }, defaultValue: 100 },
      { key: "note", label: "비고", type: { kind: "string" } },
    ],
  },
];

const A = "benefit:b1";
const B = "benefit:b2";
// 두 급부 모두 저장값이 없다 — StructForm 의 저장값 지문이 같아 옛 코드는 인스턴스를 reset 하지 않았다.
const modelA = buildForm("benefit", () => undefined, new Map(), undefined, master);
const modelB = buildForm("benefit", () => undefined, new Map(), undefined, master);

/** 화면이 노드를 열 때 StructForm 이 갖는 편집 상태 — 보관된 초안이 있으면 그것, 없으면 저장값에서. */
function opened(drafts: ValueDrafts, node: string, model = node === A ? modelA : modelB): FormState {
  return drafts.byNode[node] ?? initFormState(model);
}

function edit(state: FormState, path: string, draft: string): FormState {
  return formReducer(state, { type: "edit", path, draft });
}

function rateOf(state: FormState) {
  return toSubmission(state).values.find((v) => v.path === "pay.rate")?.value;
}

describe("노드별 초안 — 한 편집 세션 동안 노드를 오가도 각 노드의 미저장 입력이 남는다 (점검 H4)", () => {
  it("① 같은 지문의 두 노드 — A 의 초안이 B 로 넘어가지 않고, 두 노드가 다른 인스턴스(key)로 뜬다", () => {
    let d = initValueDrafts("edit");
    const a = edit(opened(d, A), "pay.rate", "70");
    d = valueDraftsReducer(d, { type: "draft", node: A, state: a });

    // B 로 옮긴다 — B 는 자기 저장값(+프리필)에서 시작한다
    expect(formKeyOf(d, B)).not.toBe(formKeyOf(d, A));
    const b = opened(d, B);
    expect(rateOf(b)).toBe(100);
    expect(b.fields["pay.rate"]!.dirty).toBe(false);

    // B 를 고쳐도 A 초안은 A 에만 남는다
    d = valueDraftsReducer(d, { type: "draft", node: B, state: edit(b, "pay.note", "B 메모") });
    expect(rateOf(d.byNode[B]!)).toBe(100);
    expect(rateOf(d.byNode[A]!)).toBe(70);
    expect(toSubmission(d.byNode[A]!).values.some((v) => v.path === "pay.note")).toBe(false);
  });

  it("② A → B → A — A 로 돌아오면 A 에서 고친 값이 그대로 있다", () => {
    let d = initValueDrafts("edit");
    d = valueDraftsReducer(d, { type: "draft", node: A, state: edit(opened(d, A), "pay.rate", "70") });
    d = valueDraftsReducer(d, { type: "draft", node: B, state: opened(d, B) });

    const back = opened(d, A);
    expect(back.fields["pay.rate"]!.draft).toBe("70");
    expect(rateOf(back)).toBe(70);
  });

  it("탭을 오가도(값 탭이 내려갔다 다시 떠도) 같은 세션이면 key 가 같고 초안이 남는다", () => {
    let d = initValueDrafts("edit");
    const key = formKeyOf(d, A);
    d = valueDraftsReducer(d, { type: "draft", node: A, state: edit(opened(d, A), "pay.rate", "70") });
    expect(formKeyOf(d, A)).toBe(key);
    expect(rateOf(opened(d, A))).toBe(70);
  });

  it("취소로 끝나면(값 초안이 시작 때로 돌아감) 초안을 걷고 key 세대를 올린다 — 읽기 화면은 저장값을 보인다", () => {
    const start = {};
    let d = initValueDrafts("read");
    d = valueDraftsReducer(d, { type: "mode", mode: "edit", values: start });
    const editingKey = formKeyOf(d, A);
    const a = edit(opened(d, A), "pay.rate", "70");
    d = valueDraftsReducer(d, { type: "draft", node: A, state: a });

    d = valueDraftsReducer(d, { type: "mode", mode: "read", values: start });
    expect(d.byNode).toEqual({});
    expect(formKeyOf(d, A)).not.toBe(editingKey);
    expect(rateOf(opened(d, A))).toBe(100);
  });

  it("저장으로 끝나면(값 초안이 바뀜) 초안과 인스턴스를 그대로 둔다 — 새 저장값이 올 때까지 방금 저장한 값이 보인다", () => {
    let d = initValueDrafts("read");
    d = valueDraftsReducer(d, { type: "mode", mode: "edit", values: {} });
    const editingKey = formKeyOf(d, A);
    const a = edit(opened(d, A), "pay.rate", "70");
    d = valueDraftsReducer(d, { type: "draft", node: A, state: a });

    d = valueDraftsReducer(d, { type: "mode", mode: "read", values: { [A]: toSubmission(a) } });
    expect(formKeyOf(d, A)).toBe(editingKey);
    expect(rateOf(opened(d, A))).toBe(70);
  });

  it("편집에 들어갈 때는 세대를 올리지 않는다 — 읽기 화면의 인스턴스가 그대로 입력기가 된다", () => {
    let d = initValueDrafts("read");
    const key = formKeyOf(d, A);
    d = valueDraftsReducer(d, { type: "mode", mode: "edit", values: {} });
    expect(formKeyOf(d, A)).toBe(key);
  });

  it("읽기 모드에서 올라온 초안은 받지 않는다", () => {
    let d = initValueDrafts("read");
    d = valueDraftsReducer(d, { type: "draft", node: A, state: edit(opened(d, A), "pay.rate", "70") });
    expect(d.byNode).toEqual({});
  });
});
