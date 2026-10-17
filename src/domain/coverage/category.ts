/**
 * 담보의 담보분류 (ADR-0090 결정 1 · 기능/담보 §3.1) — 순수.
 *
 * - 열거형 **「담보분류」(E0009)** 의 값 하나를 담보마다 고른다(필수) — 상해 · 질병 · 비용손해 · 배상책임 · 재물손해(값은 데이터로 는다).
 * - 담보분류가 **기본 특약 그룹**이다 — 상품이 사용자 그룹에 넣지 않은 담보의 특약은 이 값의 그룹에 묶인다(기능/상품 §3.7).
 *   그룹 제목은 값의 문자 필드 「그룹 제목」(`F01`), 기본 순서는 값 순서다.
 * - 뼈대 칸(`coverages.category`)이라 스냅샷 대상이 아니다 — 탑재한 상품은 지금 담보의 담보분류를 따른다.
 * - 코드는 열거형 값 코드라 이름을 바꿔도 깨지지 않는다(ADR-0005). 값을 지우면 코드가 남아 「없는 값」이다(기능/열거형 §3.2).
 * - 옛 「특약 그룹」(E0008 · `specialGroup`)은 없앴다 — 코드 E0008 은 다시 쓰지 않는다(ADR-0080 번복).
 */
import type { EnumDef } from "../catalog/types";
import { ok, reject, type Code, type Coordinate, type Result } from "../types";

import type { Coverage } from "./types";

/** 열거형 「담보분류」의 코드 — 시드가 만든다. 계약형태 E0007 처럼 코드가 가리키는 데이터다. */
export const COVERAGE_CATEGORY_ENUM: Code = "E0009";

/** 담보분류 값의 「그룹 제목」 필드 키 — 기본 그룹의 책자 제목 (ADR-0090 결정 2). 필드 키는 열거형 안에서 채번 · 불변이라 첫 필드다. */
export const CATEGORY_TITLE_FIELD: Code = "F01";

/** 담보의 담보분류 칸 좌표 — 담보 상세 담보 카드 맨 위 「담보분류」 줄. */
export function categoryCoordinate(tree: Pick<Coverage, "id" | "name">): Coordinate {
  return { document: "coverageMaster", ownerId: tree.id, ownerName: tree.name, refPath: "category" };
}

/** 담보의 담보분류를 정한다 — 열거형에 있는 값만, 비울 수 없다. */
export function setCoverageCategory(tree: Coverage, code: Code | undefined, categoryEnum: EnumDef | undefined): Result<Coverage> {
  if (code === undefined || code === "") {
    return reject({ reason: "invalid", issues: [{ kind: "notEntered", message: "담보분류를 고르세요", at: categoryCoordinate(tree) }] });
  }
  if (!categoryEnum?.values.some((v) => v.code === code)) {
    return reject({
      reason: "invalid",
      issues: [{ kind: "brokenRef", message: `담보분류에 없는 값입니다 — ${code} (열거형 「담보분류」 ${COVERAGE_CATEGORY_ENUM})`, at: categoryCoordinate(tree) }],
    });
  }
  return ok({ ...tree, category: code });
}

/** 담보분류 표시명 — 값 이름. 열거형에서 지워진 값은 「없는 값 V09」(화면이 이름을 지어내지 않는다). 미입력은 undefined. */
export function coverageCategoryLabel(code: Code | undefined, categoryEnum: EnumDef | undefined): string | undefined {
  if (code === undefined) return undefined;
  return categoryEnum?.values.find((v) => v.code === code)?.label ?? `없는 값 ${code}`;
}

/** 기본 그룹 제목 — 그 담보분류 값의 「그룹 제목」 필드. 비었거나 값 · 필드가 없으면 undefined(조립은 `notEntered`). */
export function categoryGroupTitle(categoryEnum: EnumDef | undefined, code: Code): string | undefined {
  const raw = categoryEnum?.values.find((v) => v.code === code)?.fields?.[CATEGORY_TITLE_FIELD];
  return typeof raw === "string" && raw.trim() !== "" ? raw : undefined;
}
