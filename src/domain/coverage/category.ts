/**
 * 담보의 특약 그룹 (ADR-0080 · 기능/담보 §3.1) — 순수.
 *
 * - 그룹 목록은 열거형 **「특약 그룹」(E0008)** — 값 이름 = 책자의 그룹 제목, 값 순서 = 책자의 그룹 순서.
 * - 담보는 그 값 하나를 고르거나 고르지 않는다(`Coverage.specialGroup`). 고르지 않은 담보는 책자에서 그룹 제목 없이 찍힌다.
 * - 상품은 바꾸지 못한다 — 상품의 특약 그룹핑은 탑재한 상품담보의 담보 그룹이다 (기능/상품 §3.7).
 * - 코드는 열거형 값 코드라 이름을 바꿔도 깨지지 않는다(ADR-0005). 값을 지우면 코드가 남아 「없는 값」이다(기능/열거형 §3.2).
 */
import type { EnumDef } from "../catalog/types";
import { ok, reject, type Code, type Result } from "../types";

import type { Coverage } from "./types";

/** 열거형 「특약 그룹」의 코드 — 시드가 만든다. 계약형태 E0007 처럼 코드가 가리키는 데이터다. */
export const SPECIAL_GROUP_ENUM: Code = "E0008";

/** 담보의 특약 그룹을 정한다 — 열거형에 있는 값만. undefined 면 그룹 없음. */
export function setCoverageSpecialGroup(tree: Coverage, code: Code | undefined, groupEnum: EnumDef | undefined): Result<Coverage> {
  const { specialGroup: _dropped, ...rest } = tree;
  void _dropped;
  if (code === undefined) return ok(rest);
  if (!groupEnum?.values.some((v) => v.code === code)) {
    return reject({
      reason: "invalid",
      issues: [
        {
          kind: "brokenRef",
          message: `특약 그룹에 없는 값입니다 — ${code} (열거형 「특약 그룹」 ${SPECIAL_GROUP_ENUM})`,
          at: { document: "coverageMaster", ownerId: tree.id, ownerName: tree.name, refPath: "specialGroup" },
        },
      ],
    });
  }
  return ok({ ...rest, specialGroup: code });
}

/** 그룹 표시명 — 값 이름. 열거형에서 지워진 값은 「없는 값 V09」(화면이 이름을 지어내지 않는다). 없음은 undefined. */
export function specialGroupLabel(code: Code | undefined, groupEnum: EnumDef | undefined): string | undefined {
  if (code === undefined) return undefined;
  return groupEnum?.values.find((v) => v.code === code)?.label ?? `없는 값 ${code}`;
}
