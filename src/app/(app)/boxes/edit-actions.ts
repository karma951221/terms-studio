"use server";

/**
 * 박스 상세의 저장 · 삭제 — 화면 하나에 저장은 하나다 (디자인원칙 §2 L2). 서비스 `saveBox` 가 이름 · 제목 · 줄을 한 트랜잭션에 검사 · 저장한다.
 */
import type { EditOutcome } from "@/app/_lib/edit";
import { describeRejection } from "@/app/_lib/rejection";
import { boxLinesFromText } from "@/domain/document/box";
import type { Code, Result } from "@/domain/types";
import { currentActor, getServices } from "@/lib/services";

import type { BoxEditData } from "./edit-types";

function failed<T>(result: Result<T>, token: string): EditOutcome | undefined {
  if (result.ok) return undefined;
  if (result.rejection.reason === "needsConfirmation") return { ok: "confirm", impact: result.rejection.impact, token };
  return { ok: false, message: describeRejection(result.rejection).message };
}

export async function saveBoxEditAction(code: Code, input: BoxEditData): Promise<EditOutcome> {
  const result = await getServices().document.saveBox(await currentActor(), code, { name: input.name, title: input.title, lines: boxLinesFromText(input.lines) });
  return failed(result, "save") ?? { ok: true };
}

export async function removeBoxEditAction(code: Code, confirm = false): Promise<EditOutcome> {
  const result = await getServices().document.removeBox(await currentActor(), code, { confirm });
  return failed(result, "delete") ?? { ok: true };
}
