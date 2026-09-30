import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MODE_OPTIONS } from "@/app/_lib/labels";

import { blankBody } from "./ClauseAuthoring";
import { OptionsPane } from "./OptionsPane";

const option = { code: "O01", label: "소멸 사유", values: [{ code: "V1", label: "사망", text: "사망한 경우" }, { code: "V2", label: "해지", text: "" }] };

describe("옵션 목록 (기능/함수조항 §4.3)", () => {
  it("편집 — 옵션명 · 선택지 이름 · 문구 칸, 빼기는 ⊖, 더하기는 「+ 선택지」 · 「+ 옵션 추가」", () => {
    const html = renderToStaticMarkup(<OptionsPane options={[option]} editing used={new Set()} onChange={() => undefined} newCode={() => "new:1"} />);
    expect(html).toContain('aria-label="옵션명"');
    expect(html).toContain('aria-label="소멸 사유 — 선택지 1 이름"');
    expect(html).toContain('aria-label="소멸 사유 — 선택지 2 문구"');
    expect(html).toContain('aria-label="소멸 사유 빼기"');
    expect(html).toContain('aria-label="소멸 사유에 선택지 추가"');
    expect(html).toContain("옵션 추가");
    expect(html).toContain("툴바 「옵션 자리 ▾」");
  });

  it("본문이 쓰는 옵션은 뺄 수 없다 — ⊖ 가 잠기고 사유를 보인다", () => {
    const html = renderToStaticMarkup(<OptionsPane options={[option]} editing used={new Set(["O01"])} onChange={() => undefined} newCode={() => "new:1"} />);
    expect(html).toMatch(/aria-label="본문이 쓰는 옵션은 뺄 수 없다[^"]*"[^>]*disabled=""|disabled=""[^>]*aria-label="본문이 쓰는 옵션은 뺄 수 없다/);
  });

  it("읽기 — 입력 칸 없이 이름과 문구, 옵션이 없으면 「옵션 없음」", () => {
    const html = renderToStaticMarkup(<OptionsPane options={[option]} editing={false} used={new Set()} onChange={() => undefined} newCode={() => "new:1"} />);
    expect(html).not.toContain("<input");
    expect(html).toContain("〔소멸 사유〕");
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
