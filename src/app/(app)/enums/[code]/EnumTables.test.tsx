/**
 * 열거형 상세의 필드 표 · 값 × 필드 표 (ADR-0078 결정 2 · 기능/열거형 §4.3) — 서버 렌더 문자열로 본다.
 * 읽기는 잠긴 글, 편집은 문자열 = 입력칸 · 참거짓 = 미입력/예/아니오 고르기. 빈 칸 = 「—」.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }) }));

import { EditShell } from "@/app/_components/EditShell";

import type { EnumEditData } from "../edit-types";
import { FieldsEditor, ValuesEditor } from "./EnumTables";

const data: EnumEditData = {
  label: "납입면제사유",
  description: "",
  fields: [
    { key: "F01", label: "약관표시명", type: "string" },
    { key: "F02", label: "면책여부", type: "boolean" },
  ],
  values: [
    { code: "V01", label: "암·면책", fields: { F01: "암(유사암제외)", F02: true } },
    { code: "V02", label: "뇌졸중", fields: { F02: false } },
  ],
};

function render(mode: "read" | "edit", initial: EnumEditData = data) {
  return renderToStaticMarkup(
    <EditShell initial={initial} title="납입면제사유" path={[]} saveAction={async () => ({ ok: true })} initialMode={mode}>
      <FieldsEditor />
      <ValuesEditor usage={{}} />
    </EditShell>,
  );
}

describe("열거형 상세 — 필드 · 값 × 필드 표", () => {
  it("읽기: 필드 표는 이름 · 타입, 값 표 머리에 필드 이름이 서고 칸은 값 · 예 · 아니오 · —", () => {
    const html = render("read");
    expect(html).toContain("약관표시명");
    expect(html).toContain("참거짓");
    expect(html).toMatch(/<th[^>]*>면책여부<\/th>/);
    expect(html).toContain("암(유사암제외)");
    expect(html).toContain(">예<");
    expect(html).toContain(">아니오<");
    expect(html).toContain(">—<"); // 뇌졸중의 약관표시명 = 미입력
    expect(html).not.toContain("<select");
  });

  it("편집: 문자열 칸은 입력칸, 참거짓 칸은 미입력 · 예 · 아니오 고르기, 필드 행은 이름 · 타입 고르기 · 빼기", () => {
    const html = render("edit");
    expect(html).toContain('aria-label="암·면책 약관표시명"');
    expect(html).toMatch(/<select[^>]*aria-label="뇌졸중 면책여부"/);
    expect(html).toContain(">미입력</option>");
    expect(html).toContain('aria-label="필드 이름 약관표시명"');
    expect(html).toContain('aria-label="면책여부(F02) 빼기 — 저장할 때 삭제"');
  });

  it("필드가 없으면 읽기는 안내 한 줄, 값 표에는 필드 열이 없다 · 입력률 카운트는 두지 않는다", () => {
    const html = render("read", { ...data, fields: [], values: [{ code: "V01", label: "암" }] });
    expect(html).toContain("필드가 없다");
    expect(html).not.toContain("면책여부");
    expect(html).not.toMatch(/입력률|\d+ 중 \d+ 입력/);
  });
});
