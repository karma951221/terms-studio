/**
 * 박스 마스터 — 정적 마스터의 하위 (기능/박스 · ADR-0076 결정 11 · 최종 결정 9).
 *
 * - 박스 = 놓인 자리에 내용이 그대로 들어가는 고정 글(직접참조). 코드 · 이름 · 제목 · 줄뿐이다.
 *   **안에 참조 · 슬롯 · 옵션을 두지 않는다** — 줄은 글 한 줄(string). 박스 안 「제2항」은 고정 글이다(기존 한계).
 * - 문서 · 함수조항 본문은 박스 참조 노드(`boxRef`)에 코드만 저장하고, 조립이 이 마스터에서 내용을 읽어 그 자리에 편다.
 * - 코드는 **시스템 자동 채번 · 등록 후 불변** — `BX000001` 부터. 순번은 `code_sequences` kind `box`(별표와 같은 방식).
 * - 이름은 비울 수 없고 **중복을 허용하지 않는다** — 넣을 때 이름으로 고르므로(별표는 중복 허용).
 * - 줄은 하나 이상. 가운데 빈 줄은 간격으로 남는다(실물 박스에 있다). 제목은 비워도 된다(실물 박스에 있다).
 */

import { ok, reject } from "../types";
import type { Code, Result } from "../types";

export interface Box {
  code: Code;
  name: string;
  /** 박스 머리 제목 — 비울 수 있다. */
  title: string;
  /** 줄 — 글 한 줄씩. 하나 이상. */
  lines: string[];
}

/** 생성 입력에 code 는 없다 — 코드는 시스템이 채번한다 (타입으로 강제). */
export interface NewBox {
  name: string;
  title?: string;
  lines: readonly string[];
}

/** 상세 저장 한 번의 최종 상태 — 이름 · 제목 · 줄 (디자인원칙: 편집 화면 하나 = 저장 하나). */
export interface BoxRevision {
  name: string;
  title: string;
  lines: readonly string[];
}

function invalid<T>(message: string): Result<T> {
  return reject({ reason: "invalid", issues: [{ kind: "typeMismatch", message, at: {} }] });
}

/* ── 채번 ─────────────────────────────────────────────────────────────────── */

export const BOX_CODE_PREFIX = "BX";
export const BOX_CODE_MIN_WIDTH = 6;
export const BOX_CODE_PATTERN = /^BX(\d+)$/;

/** 순번의 출처 — 저장소가 구현한다 (`code_sequences` 의 kind `box` · scope 전역). */
export type BoxNextSeq = () => Promise<number> | number;

export function formatBoxCode(seq: number): Code {
  if (!Number.isInteger(seq) || seq < 1) throw new RangeError(`코드 순번은 1 이상의 정수여야 합니다: ${seq}`);
  return BOX_CODE_PREFIX + String(seq).padStart(BOX_CODE_MIN_WIDTH, "0");
}

export function isValidBoxCode(code: string): boolean {
  return BOX_CODE_PATTERN.test(code);
}

/* ── 규칙 ─────────────────────────────────────────────────────────────────── */

/** 이름 · 줄 검사 — 통과하면 정리한 값. `takenNames` 는 다른 박스들의 이름(자기 것 제외). */
function checked(input: BoxRevision, takenNames: readonly string[]): Result<Omit<Box, "code">> {
  const name = input.name.trim();
  if (name === "") return invalid("박스 이름은 비울 수 없습니다");
  if (takenNames.some((n) => n.trim() === name)) return invalid(`이미 있는 박스 이름입니다: ${name}`);
  if (input.lines.length === 0) return invalid("박스에는 줄이 하나 이상 있어야 합니다");
  return ok({ name, title: input.title.trim(), lines: [...input.lines] });
}

/**
 * 박스 등록. 검사를 먼저 하고 채번한다 — 거절된 등록이 순번을 태우지 않게.
 * `takenNames` = 이미 있는 박스 이름들.
 */
export async function createBox(input: NewBox, takenNames: readonly string[], nextSeq: BoxNextSeq): Promise<Result<Box>> {
  const r = checked({ name: input.name, title: input.title ?? "", lines: input.lines }, takenNames);
  if (!r.ok) return r;
  return ok({ code: formatBoxCode(await nextSeq()), ...r.value });
}

/** 상세 저장 — 이름 · 제목 · 줄의 최종 상태를 한 번에 검사한다. `takenNames` 에 자기 이름이 있어도 된다. */
export function reviseBox(box: Box, input: BoxRevision, takenNames: readonly string[]): Result<Box> {
  const others = takenNames.filter((n) => n.trim() !== box.name.trim());
  const r = checked(input, others);
  if (!r.ok) return r;
  return ok({ code: box.code, ...r.value });
}

/* ── 줄 칸 ─────────────────────────────────────────────────────────────────── */

/** 줄 칸(여러 줄 글) → 줄 목록. 한 줄 = 한 줄, 가운데 빈 줄은 남기고 끝의 빈 줄 · 공백 줄은 버린다. */
export function boxLinesFromText(text: string): string[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  return lines;
}

/** 줄 목록 → 줄 칸 글. */
export function boxLinesText(lines: readonly string[]): string {
  return lines.join("\n");
}
