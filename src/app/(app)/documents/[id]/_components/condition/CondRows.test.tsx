/**
 * 조건 머리 줄 — 결합이 섞였을 때만 보이는 화면 괄호 (기능/문면 §3.3 · §4.3, 2026-09-30).
 * 괄호 수 규칙은 `joinParens`(conditionRows.test.ts) — 여기선 그 괄호가 줄의 어느 자리에 그려지는지 본다.
 * 괄호가 하나라도 있으면 모든 줄이 여는 자리(변수 앞) · 닫는 자리(값 뒤)를 갖고(빈 글자일 수 있다), 없으면 자리도 없다.
 * 이 리포 단위 테스트는 DOM 없는 정적 렌더라, 결합을 바꾼 뒤의 다시 그림은 `when`(저장 식)을 바꿔 그린다. 실제 결합 고르기는 E2E(editor-toolbar.spec.ts).
 * 저장 식은 우선순위 그대로라 `or` 뒤 `and` 로 이어지는 줄은 원문에 괄호가 있다 — `(A or B) and C`.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CondRows } from "./CondRows";
import type { ConditionContext } from "./types";

const CONTEXT: ConditionContext = {
  discriminators: [
    { code: "D0009", label: "감액여부", level: "coverage", type: { kind: "boolean" }, forms: [] },
    { code: "D0001", label: "담보명", level: "coverage", type: { kind: "string" }, forms: [] },
  ],
  openedForms: {},
  quick: [],
};

const render = (when: string) => renderToStaticMarkup(<CondRows label="IF" when={when} context={CONTEXT} onCommit={() => undefined} />);

/** 줄마다 칸 순서 — 여는 자리 `open:글자` · 변수 · 값 · 닫는 자리 `close:글자`. */
function lines(when: string): string[][] {
  const html = render(when);
  expect(html).not.toContain("ts-cond-raw");
  return html
    .split('class="ts-cond-line"')
    .slice(1)
    .map((line) =>
      [...line.matchAll(/class="ts-cond-paren ts-cond-paren-(open|close)" aria-hidden="true">([^<]*)<|class="[^"]*\b(ts-cond-var|ts-cond-value)\b/g)].map((m) =>
        m[1] ? `${m[1]}:${m[2]}` : m[3] === "ts-cond-var" ? "변수" : "값",
      ),
    );
}

const opens = (when: string) => lines(when).map((l) => l.find((t) => t.startsWith("open:"))?.slice(5));
const closes = (when: string) => lines(when).map((l) => l.find((t) => t.startsWith("close:"))?.slice(6));

describe("CondRows — 화면 괄호 (기능/문면 §3.3)", () => {
  it("A or B and C → 첫 줄 변수 앞 ( · 둘째 줄 값 뒤 ) — 모든 줄이 여는 자리 · 닫는 자리를 갖는다", () => {
    const when = "(D0009 = true or D0001 = '암') and D0009 = false";
    expect(opens(when)).toEqual(["(", "", ""]);
    expect(closes(when)).toEqual(["", ")", ""]);
    for (const line of lines(when)) expect(line.map((t) => t.replace(/:.*/, ""))).toEqual(["open", "변수", "값", "close"]);
  });

  it("A and B or C → 같은 자리 (저장 식에 괄호가 없어도)", () => {
    const when = "D0009 = true and D0001 = '암' or D0009 = false";
    expect(opens(when)).toEqual(["(", "", ""]);
    expect(closes(when)).toEqual(["", ")", ""]);
  });

  it("A or B and C or D → 첫 줄 (( · 둘째 줄 ) · 셋째 줄 )", () => {
    const when = "((D0009 = true or D0001 = '암') and D0009 = false) or D0001 = '수술비'";
    expect(opens(when)).toEqual(["((", "", "", ""]);
    expect(closes(when)).toEqual(["", ")", ")", ""]);
  });

  it("모두 and · 모두 or 면 괄호 자리가 없다 — 결합을 같게 바꾸면 사라진다", () => {
    for (const when of ["D0009 = true and D0001 = '암' and D0009 = false", "D0009 = true or D0001 = '암' or D0009 = false"]) {
      expect(render(when)).not.toContain("ts-cond-paren");
      expect(lines(when)).toEqual([["변수", "값"], ["변수", "값"], ["변수", "값"]]);
    }
  });

  it("괄호는 읽는 칸이 아니다 — 모든 자리가 aria-hidden", () => {
    const html = render("(D0009 = true or D0001 = '암') and D0009 = false");
    const slots = [...html.matchAll(/<span class="ts-cond-paren[^"]*"([^>]*)>/g)].map((m) => m[1]);
    expect(slots).toHaveLength(6);
    expect(slots.every((a) => a === ' aria-hidden="true"')).toBe(true);
  });
});
