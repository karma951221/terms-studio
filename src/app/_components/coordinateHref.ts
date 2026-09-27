import { encodeNodeKey } from "@/domain/coverage";
import { BASE_CONTRACT_REF } from "@/domain/product";
import type { Coordinate } from "@/domain/types";

/**
 * 좌표 → 「고치러 가기」 링크. `IssueList`(원천 좌표)와 `Confirm`(깨질 참조 좌표)이 공유한다 —
 * 오류 패널이든 파괴적 확인이든, 사람이 문제를 고치러 갈 곳은 좌표의 소유 실체 화면이다.
 * 아는 만큼만 채워지는 `Coordinate`(기능/조립산출 §3 「오류 좌표」)이므로 무엇을 모르면 링크를 만들지 않는다.
 */
export function coordinateHref(coordinate: Coordinate | undefined): string | undefined {
  if (!coordinate?.ownerId) return undefined;
  const node = coordinate.nodePath?.at(-1) ?? coordinate.articleId;
  // 보통약관 좌표의 ownerId 는 곧 문서 id 다.
  if (coordinate.document === "general") return `/documents/${coordinate.ownerId}${node ? `?node=${node}` : ""}`;
  if (coordinate.document === "clause") return `/clauses/${coordinate.ownerId}${node ? `?node=${node}` : ""}`;
  // 구분자 식이 깨진 원천은 구분자 편집기, 그 구분자다 — 문면 편집기가 아니다 (ADR-0049 §4)
  if (coordinate.document === "catalog") return `/catalog/${coordinate.ownerId}`;
  // 담보 마스터 · 담보약관 좌표의 ownerId 는 **담보 id** 다 (문서 id 가 아니다 — `Coordinate` 주석).
  //   문서를 아는 생산자는 `documentId` 를 실어 준다 → 그 문서 화면의 그 노드로 (문면 오류는 문면에서 고친다).
  //   값 소유 노드를 아는 생산자는 `node` 를 실어 준다 → 담보 상세의 그 레벨 탭(탭 이름 = 노드 레벨) · 그 노드 값 폼으로
  //   (`?field=` 는 값 자리 `폼키.필드키` = refPath — 그 행을 강조한다, 기능/마스터 §3.5).
  //   둘 다 모르면 담보 상세로 (거기서 「담보약관 열기」). 담보 화면의 `?node=` 는 담보 트리 키(`level:id`)라 문서 노드 id 는 싣지 않는다.
  if (coordinate.document === "coverageMaster" || coordinate.document === "special") {
    if (coordinate.documentId) return `/documents/${coordinate.documentId}${node ? `?node=${node}` : ""}`;
    if (coordinate.node) {
      const key = encodeURIComponent(encodeNodeKey(coordinate.node.level, coordinate.node.id));
      const field = coordinate.refPath ? `&field=${encodeURIComponent(coordinate.refPath)}` : "";
      return `/coverages/${coordinate.ownerId}?tab=${coordinate.node.level}&node=${key}${field}`;
    }
    return `/coverages/${coordinate.ownerId}`;
  }
  if (coordinate.document === "product") {
    const coverageId = coordinate.nodePath?.[0];
    if (coverageId) return `/products/${coordinate.ownerId}/coverages/${coverageId}`;
    // 기본계약 0 · 2+ 오류 — 고치는 자리는 보통약관 탭(`?tab=general`)의 기본계약 블록이다 (상품 첫 화면이 아니라)
    if (coordinate.refPath === BASE_CONTRACT_REF) return `/products/${coordinate.ownerId}?tab=general#base-contract`;
    return `/products/${coordinate.ownerId}`;
  }
  return undefined;
}
