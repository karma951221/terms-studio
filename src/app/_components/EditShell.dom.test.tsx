// @vitest-environment jsdom
/**
 * EditShell — shadcn 위젯으로 그려지는지 (편집 · 저장 버튼, 필드 입력, 확인 대화상자). 편집 모드 · 대화상자는 클릭해야 나오므로 jsdom.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }) }));
vi.mock("next/link", () => ({ default: ({ children, ...rest }: { children: unknown }) => <a {...(rest as object)}>{children as never}</a> }));

import type { EditOutcome } from "@/app/_lib/edit";
import { EditShell, Field } from "./EditShell";

afterEach(cleanup);

const impact = { valueRowsLost: 2, cascade: [], brokenRefs: [] } as never;

function shell(props: { initialMode?: "read" | "edit"; saveAction?: () => Promise<EditOutcome>; deleteAction?: () => Promise<EditOutcome> } = {}) {
  return render(
    <EditShell
      initial={{ label: "골절진단비", memo: "", kind: "a" }}
      title="골절진단비"
      path={[{ label: "담보", href: "/coverages" }]}
      saveAction={props.saveAction ?? (async () => ({ ok: true }))}
      deleteAction={props.deleteAction}
      initialMode={props.initialMode}
    >
      <Field name="label" label="이름" />
      <Field name="memo" label="메모" type="textarea" />
      <Field name="kind" label="종류" type="select" options={[{ value: "a", label: "가" }, { value: "b", label: "나" }]} />
    </EditShell>,
  );
}

describe("EditShell — 버튼", () => {
  it("읽기 모드: 「편집」은 shadcn Button", () => {
    shell();
    expect(screen.getByRole("button", { name: "편집" }).getAttribute("data-slot")).toBe("button");
  });

  it("편집 모드: 「저장」은 primary Button, 아무것도 안 고치면 잠겨 있다", () => {
    shell({ initialMode: "edit" });
    const save = screen.getByRole("button", { name: "저장" });
    expect(save.getAttribute("data-slot")).toBe("button");
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(save.className).toContain("text-mark");
  });
});

describe("EditShell — Field 입력", () => {
  it("편집 모드: 입력 · 텍스트영역 · 선택은 shadcn 위젯이고 ts-field-direct 훅을 유지한다", () => {
    shell({ initialMode: "edit" });
    const input = screen.getByDisplayValue("골절진단비");
    expect(input.getAttribute("data-slot")).toBe("input");
    expect(input.className).toContain("ts-field-direct");
    const textarea = document.querySelector("textarea")!;
    expect(textarea.getAttribute("data-slot")).toBe("textarea");
    expect(textarea.className).toContain("ts-field-direct");
    const select = document.querySelector("select")!;
    expect(select.getAttribute("data-slot")).toBe("native-select");
    expect(select.className).toContain("ts-field-direct");
  });
});

describe("EditShell — 나가기 확인", () => {
  async function openDiscard() {
    const user = userEvent.setup();
    shell({ initialMode: "edit" });
    await user.type(screen.getByDisplayValue("골절진단비"), "Ⅱ");
    await user.click(screen.getByRole("button", { name: "편집 취소" }));
    return user;
  }

  it("role=dialog 로 뜨고(alertdialog 아님) 초점은 「계속 수정」", async () => {
    await openDiscard();
    const dialog = await screen.findByRole("dialog");
    expect(dialog.tagName).not.toBe("DIALOG");
    expect(dialog.textContent).toContain("저장하지 않은 변경 사항이 있습니다");
    await waitFor(() => expect(document.activeElement?.textContent).toBe("계속 수정"));
  });

  it("Esc 는 「계속 수정」 — 닫히고 편집 모드가 남는다", async () => {
    const user = await openDiscard();
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "저장" })).toBeTruthy();
  });

  it("「저장하지 않고 나가기」는 읽기 모드로 돌린다", async () => {
    const user = await openDiscard();
    await user.click(await screen.findByRole("button", { name: "저장하지 않고 나가기" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "편집" })).toBeTruthy();
  });
});

describe("EditShell — 저장 · 삭제 확인", () => {
  const confirm = async (): Promise<EditOutcome> => ({ ok: "confirm", impact, token: "t" });

  it("저장이 확인을 요구하면 role=dialog — Esc 는 취소", async () => {
    const user = userEvent.setup();
    shell({ initialMode: "edit", saveAction: confirm });
    await user.type(screen.getByDisplayValue("골절진단비"), "Ⅱ");
    await user.click(screen.getByRole("button", { name: "저장" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.tagName).not.toBe("DIALOG");
    expect(dialog.textContent).toContain("사람이 입력한 값 2건이 사라진다");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("실행 중(pending)에는 Esc 로 닫히지 않는다 — 끝나면 닫힌다", async () => {
    const user = userEvent.setup();
    let finish: (outcome: EditOutcome) => void = () => undefined;
    const save = async (_data: unknown, confirmed?: boolean): Promise<EditOutcome> =>
      confirmed ? new Promise<EditOutcome>((resolve) => (finish = resolve)) : { ok: "confirm", impact, token: "t" };
    shell({ initialMode: "edit", saveAction: save as never });
    await user.type(screen.getByDisplayValue("골절진단비"), "Ⅱ");
    await user.click(screen.getByRole("button", { name: "저장" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: /타입 바꾸고/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "취소" }).hasAttribute("disabled")).toBe(true));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBe(dialog);
    finish({ ok: true });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("확인 대화상자 폭은 sm:max-w-md — DialogContent 의 sm:max-w-lg 를 이긴다", async () => {
    const user = userEvent.setup();
    shell({ deleteAction: confirm });
    await user.click(screen.getByRole("button", { name: "골절진단비 삭제" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.className.split(/\s+/)).toContain("sm:max-w-md");
    expect(dialog.className.split(/\s+/)).not.toContain("sm:max-w-lg");
  });

  it("삭제 확인 — 「취소」는 닫고, 실행 버튼은 destructive Button", async () => {
    const user = userEvent.setup();
    shell({ deleteAction: confirm });
    await user.click(screen.getByRole("button", { name: "골절진단비 삭제" }));
    const dialog = await screen.findByRole("dialog");
    const run = screen.getByRole("button", { name: "삭제" });
    expect(run.getAttribute("data-slot")).toBe("button");
    expect(run.className).toContain("hover:text-destructive");
    expect(dialog.textContent).toContain("골절진단비 삭제");
    await user.click(screen.getByRole("button", { name: "취소" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
