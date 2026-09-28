/**
 * 검색 입력 — 그려진 모양(ARIA · 강조 · 빈 상태 · 묶음 · 폼 칸). 동작 규칙(거르기 · 키보드 · 조회)은 comboModel.test.ts.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { COMBO_EMPTY_TEXT, ComboList, Combobox } from "./Combobox";
import type { ComboOption } from "./comboModel";

const OPTS: ComboOption[] = [
  { value: "A1", label: "부록 가", hint: "A0001" },
  { value: "A2", label: "부록 나", hint: "A0002", disabled: "쓰지 않음" },
];

describe("Combobox — 입력칸", () => {
  it("role=combobox · 닫힘 · 목록을 가리킨다, 폼 칸이면 숨은 칸에 값", () => {
    const html = renderToStaticMarkup(<Combobox id="pick" name="appendixCode" options={OPTS} defaultValue="A1" required />);
    expect(html).toMatch(/<input[^>]*role="combobox"/);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).toMatch(/aria-controls="[^"]+"/);
    expect(html).toContain('id="pick"');
    // 보이는 칸은 이름, 숨은 칸은 코드
    expect(html).toContain('value="부록 가"');
    expect(html).toContain('<input type="hidden" name="appendixCode" value="A1"/>');
    expect(html).toContain('required=""');
    expect(html).not.toContain('role="listbox"');
  });

  it("값이 후보에 없으면 valueLabel, 그것도 없으면 값 그대로", () => {
    expect(renderToStaticMarkup(<Combobox ariaLabel="x" options={OPTS} value="Z9" valueLabel="옛 부록" />)).toContain('value="옛 부록"');
    expect(renderToStaticMarkup(<Combobox ariaLabel="x" options={OPTS} value="D0003" />)).toContain('value="D0003"');
    expect(renderToStaticMarkup(<Combobox ariaLabel="x" options={OPTS} value="" placeholder="고르세요" />)).toContain('placeholder="고르세요"');
  });

  it("name 이 없으면 숨은 칸도 없다 (값 고르기 전용)", () => {
    expect(renderToStaticMarkup(<Combobox ariaLabel="x" options={OPTS} value="A1" />)).not.toContain('type="hidden"');
  });
});

describe("ComboList — 떠 있는 목록", () => {
  it("listbox · option · 활성 줄 aria-selected · 못 고르는 줄 aria-disabled + 사유 · 보조 글자", () => {
    const html = renderToStaticMarkup(<ComboList id="L" label="별표" items={OPTS} active={0} value="A1" query="" />);
    expect(html).toContain('role="listbox"');
    expect(html).toContain('aria-label="별표"');
    expect(html).toMatch(/<li id="L-o0" role="option" aria-selected="true" data-value="A1" class="is-active is-current">/);
    expect(html).toMatch(/<li id="L-o1" role="option" aria-selected="false" aria-disabled="true" data-value="A2" class="is-disabled">/);
    expect(html).toContain('<span class="ts-combo-hint">A0001</span>');
    expect(html).toContain('<span class="ts-combo-reason">쓰지 않음</span>');
  });

  it("맞은 글자를 강조한다 — 이름과 코드 둘 다", () => {
    const html = renderToStaticMarkup(<ComboList id="L" items={[OPTS[0]]} active={0} query="록 a00" />);
    expect(html).toContain('부<mark class="ts-combo-mark">록</mark> 가');
    expect(html).toContain('<mark class="ts-combo-mark">A00</mark>01');
  });

  it("빈 상태 · 찾는 중 · 실패", () => {
    expect(renderToStaticMarkup(<ComboList id="L" items={[]} active={-1} query="zz" />)).toContain(COMBO_EMPTY_TEXT);
    expect(COMBO_EMPTY_TEXT).toBe("일치하는 항목 없음");
    expect(renderToStaticMarkup(<ComboList id="L" items={[]} active={-1} query="zz" emptyText="별표 없음" />)).toContain("별표 없음");
    expect(renderToStaticMarkup(<ComboList id="L" items={[]} active={-1} query="" status="loading" />)).toContain("찾는 중…");
    expect(renderToStaticMarkup(<ComboList id="L" items={[]} active={-1} query="" status="error" />)).toContain("불러오지 못했습니다");
  });

  it("묶음은 role=group, 머리가 이름이 된다", () => {
    const html = renderToStaticMarkup(
      <ComboList
        id="L"
        items={[
          { value: "D1", label: "갱신여부", group: "담보 — 암진단" },
          { value: "D2@n1", label: "지급률 @급부1", group: "급부 — 급부1" },
        ]}
        active={0}
        query=""
      />,
    );
    expect(html).toContain('<ul role="group" aria-labelledby="L-g0"><li id="L-g0" role="presentation" class="ts-combo-group">담보 — 암진단</li>');
    expect(html).toContain('aria-labelledby="L-g1"');
  });
});
