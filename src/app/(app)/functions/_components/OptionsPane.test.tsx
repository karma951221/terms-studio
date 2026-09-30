import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MODE_OPTIONS } from "@/app/_lib/labels";

import { blankBody } from "./ClauseAuthoring";
import { OptionsPane, optionValueLabel } from "./OptionsPane";

const option = { code: "O01", label: "소멸 사유", values: [{ code: "V1", label: "사망한 경우", text: "사망한 경우" }, { code: "V2", label: "(빈 문구)", text: "" }] };

describe("옵션 목록 (기능/함수조항 §4.3)", () => {
  it("편집 — 옵션마다 카드: 머리 = ⊖ + 옵션명, 몸 = 「선택지」 + 줄마다 ⊖ · 문구 칸 하나, 마지막 줄 아래 ⊕, 맨 아래 「옵션 추가」", () => {
    const html = renderToStaticMarkup(<OptionsPane options={[option]} editing used={new Set()} onChange={() => undefined} newCode={() => "new:1"} />);
    expect(html).toContain('aria-label="옵션명"');
    expect(html).toContain('placeholder="예: 소멸 사유"');
    expect(html).toContain('aria-label="옵션 삭제 · 소멸 사유"');
    expect(html).toContain('aria-label="소멸 사유 — 선택지 1"');
    expect(html).toContain('aria-label="소멸 사유 — 선택지 2"');
    expect(html).not.toContain("선택지 1 이름");
    expect(html).toContain('aria-label="선택지 삭제 · 2"');
    expect(html).toContain('aria-label="선택지 추가 · 소멸 사유"');
    expect(html).toContain("옵션 추가");
    // 옵션명 칸 · ⊖ 는 선택지 줄보다 앞(카드 머리)
    expect(html.indexOf('aria-label="옵션 삭제 · 소멸 사유"')).toBeLessThan(html.indexOf('aria-label="옵션명"'));
    expect(html.indexOf('aria-label="옵션명"')).toBeLessThan(html.indexOf("선택지 1"));
  });

  it("단 설명은 제목 옆 ⓘ — 제목 아래 안내 줄이 없다", () => {
    const html = renderToStaticMarkup(<OptionsPane options={[option]} editing used={new Set()} onChange={() => undefined} newCode={() => "new:1"} />);
    expect(html).toMatch(/<h2 class="ts-clause-sec">옵션<span class="ts-infotip"[^>]*툴바 「옵션 자리 ▾」/);
    expect(html).not.toContain("ts-clause-sec-note");
  });

  it("선택지 이름은 문구에서 — 다듬은 글, 30자를 넘으면 말줄임, 빈 문구는 「(빈 문구)」", () => {
    expect(optionValueLabel("  사망한   경우 ")).toBe("사망한 경우");
    expect(optionValueLabel("")).toBe("(빈 문구)");
    const long = "가".repeat(40);
    expect(optionValueLabel(long)).toBe(`${"가".repeat(29)}…`);
    expect(optionValueLabel(long)).toHaveLength(30);
  });

  it("본문이 쓰는 옵션은 뺄 수 없다 — ⊖ 가 잠기고 사유를 보인다", () => {
    const html = renderToStaticMarkup(<OptionsPane options={[option]} editing used={new Set(["O01"])} onChange={() => undefined} newCode={() => "new:1"} />);
    expect(html).toMatch(/aria-label="본문이 쓰는 옵션은 뺄 수 없다[^"]*"[^>]*disabled=""|disabled=""[^>]*aria-label="본문이 쓰는 옵션은 뺄 수 없다/);
  });

  it("선택지가 2개 미만이면 그 카드에 오류 — ⊕ 「선택지 추가」로 더한다", () => {
    const one = { ...option, values: [option.values[0]!] };
    const html = renderToStaticMarkup(<OptionsPane options={[one]} editing used={new Set()} onChange={() => undefined} newCode={() => "new:1"} />);
    expect(html).toContain("선택지가 2개 이상이어야 옵션이 성립한다");
  });

  it("읽기 — 입력 칸 없이 옵션명과 번호 붙은 문구, 옵션이 없으면 「옵션 없음」", () => {
    const html = renderToStaticMarkup(<OptionsPane options={[option]} editing={false} used={new Set()} onChange={() => undefined} newCode={() => "new:1"} />);
    expect(html).not.toContain("<input");
    expect(html).toContain("〔소멸 사유〕");
    expect(html).toContain("사망한 경우");
    expect(html).toContain("(빈 문구)");
    expect(renderToStaticMarkup(<OptionsPane options={[]} editing={false} used={new Set()} onChange={() => undefined} newCode={() => "new:1"} />)).toContain("옵션 없음");
  });
});

describe("생성 화면 — 쓴 것이 없는 본문 (유형 잠금 · 빈 항은 저장하지 않음)", () => {
  it("빈 항 하나 · 빈 본문 · 빈 문장은 비었다, 글이나 칩이 있으면 아니다", () => {
    expect(blankBody([])).toBe(true);
    expect(blankBody([{ id: "p", kind: "paragraph", children: [] }])).toBe(true);
    expect(blankBody([{ id: "t", kind: "text", text: " " }])).toBe(true);
    expect(blankBody([{ id: "p", kind: "paragraph", children: [{ id: "t", kind: "text", text: "항" }] }])).toBe(false);
    expect(blankBody([{ id: "s", kind: "slot", ref: "D0001" }])).toBe(false);
  });
});

describe("유형 (기능/함수조항 §3.1)", () => {
  it("생성 화면 유형 라디오 · 목록 필터 · `+` 메뉴는 출력 모양 넷(문구 · 항 · 호 · 목) — 박스는 정적 마스터에서 만든다", () => {
    expect(MODE_OPTIONS.map((o) => o.label)).toEqual(["문구", "항", "호", "목"]);
  });
});
