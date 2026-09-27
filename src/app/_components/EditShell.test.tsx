/**
 * EditShell 헤더 🗑 — 즉시 실행 명령은 편집 모드에서 비활성 (디자인원칙 §2 L2 · 점검 P2).
 * 편집 중 🗑 가 켜져 있으면 미저장 변경과 즉시 삭제가 한 화면에 겹친다. 서버 렌더 문자열로 본다.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }) }));

import { EditShell, EDIT_MODE_LOCKED_TIP } from "./EditShell";

function render(initialMode: "read" | "edit") {
  return renderToStaticMarkup(
    <EditShell
      initial={{ label: "골절진단비" }}
      title="골절진단비"
      path={[{ label: "담보", href: "/coverages" }]}
      saveAction={async () => ({ ok: true })}
      deleteAction={async () => ({ ok: true })}
      deleteTooltip="담보 골절진단비 삭제"
      initialMode={initialMode}
    >
      <p>본문</p>
    </EditShell>,
  );
}

/** 헤더 🗑 버튼 태그 — `.danger` 아이콘 버튼. */
function trashTag(html: string): string {
  const tag = html.match(/<button[^>]*class="ts-iconbtn danger"[^>]*>/)?.[0];
  if (!tag) throw new Error("헤더 🗑 가 없다");
  return tag;
}

describe("EditShell — 헤더 🗑 (P2)", () => {
  it("읽기 모드: 켜져 있고 tooltip 은 삭제 대상", () => {
    const tag = trashTag(render("read"));
    expect(tag).not.toMatch(/disabled/);
    expect(tag).toContain('title="담보 골절진단비 삭제"');
  });

  it("편집 모드: 꺼지고 tooltip 이 「저장하거나 취소한 뒤 실행」", () => {
    const tag = trashTag(render("edit"));
    expect(tag).toMatch(/disabled=""/);
    expect(EDIT_MODE_LOCKED_TIP).toBe("저장하거나 취소한 뒤 실행");
    expect(tag).toContain(`title="${EDIT_MODE_LOCKED_TIP}"`);
  });
});
