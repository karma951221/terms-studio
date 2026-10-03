/**
 * 특약 그룹 안 순서 (기능/상품 §3.7) — 순수. 그룹 자체는 담보 마스터의 「특약 그룹」 열거값이다 (ADR-0080 · `coverage/specialGroup.ts`).
 *
 * - 그룹 안 순서는 자동: **담보 → 담보속성 종류(order) → 유효값(코드 순) 오름차순.**
 *   담보가 1차 키라 같은 담보의 탑재분 뭉침은 정렬의 귀결. 미사용 속성은 사용한 것보다 앞.
 */
import type { Id } from "../types";
import { attributeValueRank } from "./attributes";
import type { AttributeKind, ProductCoverage } from "./types";

/** 담보의 정렬 순서 — B1 담보 마스터의 순서(또는 이름순 등)를 주입. 없으면 담보 id 문자열 순. */
export type CoverageOrder = (coverageId: Id) => number;

export function sortInGroup<T extends ProductCoverage>(
  members: readonly T[],
  kinds: readonly AttributeKind[],
  coverageOrder?: CoverageOrder,
): T[] {
  const orderedKinds = [...kinds].sort((a, b) => a.order - b.order || a.code.localeCompare(b.code));
  const valueOrder = (m: ProductCoverage, kind: AttributeKind): number => {
    const sel = m.attributes.find((s) => s.kindCode === kind.code);
    if (!sel) return -1; // 미사용 속성이 앞
    const v = kind.values.find((x) => x.code === sel.valueCode);
    return v ? attributeValueRank(v.code) : Number.MAX_SAFE_INTEGER; // 코드 순이 곧 값 순서 · 깨진 값은 뒤
  };
  return [...members].sort((a, b) => {
    if (a.coverageId !== b.coverageId) {
      if (coverageOrder) {
        const d = coverageOrder(a.coverageId) - coverageOrder(b.coverageId);
        if (d !== 0) return d;
      }
      return a.coverageId.localeCompare(b.coverageId);
    }
    for (const kind of orderedKinds) {
      const d = valueOrder(a, kind) - valueOrder(b, kind);
      if (d !== 0) return d;
    }
    return a.id.localeCompare(b.id);
  });
}
