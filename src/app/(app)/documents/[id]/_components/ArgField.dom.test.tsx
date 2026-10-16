// @vitest-environment jsdom
/**
 * 함수조항 인자 칸(문자 · 숫자 · 날짜 · 구분자 연결) 폼 왕복 — 후보에 없는 지금 연결은 고를 수 없는 「(지금 연결 — 고칠 것)」 줄 +
 * 숨은 `argkeep:<이름>` 으로 지킨다. 실제 컴포넌트를 jsdom 에 그려 `new FormData(form)` 을 거친다 — 다만 jsdom 은 고른 줄이 disabled 여도 select 값을 싣는다.
 * HTML 명세(브라우저)는 disabled 줄을 폼 항목에서 뺀다 — `browserFormData` 가 그 한 가지를 맞춘다.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { bindingLabel, bindingOptions, staleBindingOption } from "@/app/(app)/functions/_components/params";
import type { CtxDiscriminator } from "@/app/(app)/documents/[id]/_components/condition/types";
import type { Binding, ParamDef } from "@/domain/clause";

import { ScalarArgField, scalarBindingOf } from "./ArgField";

afterEach(cleanup);

const discs: CtxDiscriminator[] = [{ code: "D0001", label: "가입금액", level: "product", type: { kind: "number" }, forms: [] }];
const param: ParamDef = { name: "한도", type: { kind: "number" }, default: { kind: "const", value: 100 } };
/** 저장된 연결 — 지금은 없는 구분자(후보에 없다). */
const saved: Binding = { kind: "discriminator", code: "D0009" };

/** 브라우저와 같은 폼 항목 — 고른 줄이 disabled 인 select 는 싣지 않는다(HTML 명세 「constructing the entry list」). */
function browserFormData(form: HTMLFormElement): FormData {
  const fd = new FormData(form);
  for (const select of form.querySelectorAll("select")) if (select.selectedOptions[0]?.disabled) fd.delete(select.name);
  return fd;
}

function mount(seed: Binding | undefined) {
  const stale = staleBindingOption(seed, param.type, discs, [], []);
  const { container } = render(
    <form>
      <ScalarArgField
        param={param}
        seed={seed}
        defaultLabel={`기본 연결 — ${bindingLabel(param.default, param.type, discs, [], [])}`}
        options={bindingOptions(param.type, discs, [], [], true)}
        stale={stale}
      />
    </form>,
  );
  const form = container.querySelector("form")!;
  const select = form.querySelector<HTMLSelectElement>(`select[name="arg:${param.name}"]`)!;
  const constant = form.querySelector<HTMLInputElement>(`input[name="argc:${param.name}"]`)!;
  return { form, select, constant, submit: () => scalarBindingOf(browserFormData(form), param) };
}

describe("함수조항 인자 칸 — 후보에 없는 지금 연결의 폼 왕복", () => {
  it("고를 수 없는 「(지금 연결 — 고칠 것)」 줄이 처음 골라져 있다", () => {
    const { select } = mount(saved);
    expect(select.selectedOptions[0]).toMatchObject({ value: "d:D0009", disabled: true });
    expect(select.selectedOptions[0].textContent).toContain("(지금 연결 — 고칠 것)");
  });

  it("손대지 않고 적용 = 지금 연결 그대로(select 는 폼에 없고 argkeep 이 넘긴다)", () => {
    const { form, submit } = mount(saved);
    expect(browserFormData(form).get(`arg:${param.name}`)).toBeNull();
    expect(browserFormData(form).get(`argkeep:${param.name}`)).toBe("d:D0009");
    expect(submit()).toEqual(saved);
  });

  it("「기본 연결」을 고르면 연결을 지운다(기본 연결로)", () => {
    const { select, submit } = mount(saved);
    select.value = "";
    expect(submit()).toBeUndefined();
  });

  it("다른 후보를 고르면 그것이 이긴다", () => {
    const { select, submit } = mount(saved);
    select.value = "d:D0001";
    expect(submit()).toEqual({ kind: "discriminator", code: "D0001" });
  });

  it("상수 직접 입력을 채우면 상수가 이긴다", () => {
    const { constant, submit } = mount(saved);
    constant.value = "5,000";
    expect(submit()).toEqual({ kind: "const", value: 5000 });
  });

  it("후보에 있는 연결이면 숨은 칸이 없고 그대로 왕복한다", () => {
    const { form, submit } = mount({ kind: "discriminator", code: "D0001" });
    expect(form.querySelector(`input[name="argkeep:${param.name}"]`)).toBeNull();
    expect(submit()).toEqual({ kind: "discriminator", code: "D0001" });
  });
});
