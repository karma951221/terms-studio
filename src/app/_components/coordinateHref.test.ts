import { describe, expect, it } from "vitest";

import { coordinateHref } from "./coordinateHref";

describe("coordinateHref — 상품 좌표", () => {
  it("nodePath[0] 이 상품담보면 그 상품담보 상세로", () => {
    expect(coordinateHref({ document: "product", ownerId: "p1", nodePath: ["pc1", "n2"] })).toBe("/products/p1/coverages/pc1");
  });

  it("아무 하위 좌표도 없으면 상품 상세로", () => {
    expect(coordinateHref({ document: "product", ownerId: "p1" })).toBe("/products/p1");
  });

  it("refPath baseContract — 고치는 자리인 보통약관 탭의 기본계약 블록으로 (0개·2개 이상 둘 다)", () => {
    expect(coordinateHref({ document: "product", ownerId: "p1", ownerName: "알파플러스", refPath: "baseContract" })).toBe("/products/p1?tab=general#base-contract");
  });

  it("ownerId 를 모르면 링크 없음", () => {
    expect(coordinateHref({ document: "product", refPath: "baseContract" })).toBeUndefined();
    expect(coordinateHref(undefined)).toBeUndefined();
  });
});

describe("coordinateHref — 구분자 편집기 · 담보약관 (ADR-0049 §4 「원천은 고치면 사라지는 곳」)", () => {
  it("catalog 좌표는 구분자 편집기로 — ownerId 가 구분자 코드", () => {
    expect(coordinateHref({ document: "catalog", ownerId: "D0002", ownerName: "장기면제", refPath: "D0001" })).toBe("/catalog/D0002");
  });

  it("special 좌표는 담보 상세로 — ownerId 는 담보 마스터 id (services/document `coordinateOf`). 담보 화면의 ?node= 는 담보 트리 키라 문서 노드는 싣지 않는다", () => {
    expect(coordinateHref({ document: "special", ownerId: "cov-1", ownerName: "수술비" })).toBe("/coverages/cov-1");
    expect(coordinateHref({ document: "special", ownerId: "cov-1", articleId: "a1", nodePath: ["a1", "n2"] })).toBe("/coverages/cov-1");
  });
});

describe("coordinateHref — 담보 마스터 · 담보약관 좌표 (ownerId 는 담보 id — 문서 id 가 아니다)", () => {
  it("documentId 를 알면 그 문서 화면으로 — ?node= 는 문면 노드(nodePath 마지막, 없으면 조 id)", () => {
    expect(coordinateHref({ document: "coverageMaster", ownerId: "cov-1", documentId: "doc-1", articleId: "a1", nodePath: ["doc-1", "a1", "n2"] })).toBe("/documents/doc-1?node=n2");
    expect(coordinateHref({ document: "coverageMaster", ownerId: "cov-1", documentId: "doc-1", articleId: "a1" })).toBe("/documents/doc-1?node=a1");
    expect(coordinateHref({ document: "coverageMaster", ownerId: "cov-1", documentId: "doc-1" })).toBe("/documents/doc-1");
    expect(coordinateHref({ document: "special", ownerId: "cov-1", documentId: "doc-1", nodePath: ["a1", "n2"] })).toBe("/documents/doc-1?node=n2");
  });

  it("값 소유 노드를 알면 담보 상세의 그 레벨 탭 · 그 노드 (`?tab=<level>&node=<level:id>`) — refPath 가 있으면 `?field=` 로 그 값 자리까지", () => {
    expect(coordinateHref({ document: "coverageMaster", ownerId: "cov-1", node: { level: "benefit", id: "ben-1" }, refPath: "pay.rate" })).toBe("/coverages/cov-1?tab=benefit&node=benefit%3Aben-1&field=pay.rate");
    expect(coordinateHref({ document: "coverageMaster", ownerId: "cov-1", node: { level: "coverage", id: "cov-1" } })).toBe("/coverages/cov-1?tab=coverage&node=coverage%3Acov-1");
    expect(coordinateHref({ document: "special", ownerId: "cov-1", node: { level: "subCoverage", id: "sub-1" } })).toBe("/coverages/cov-1?tab=subCoverage&node=subCoverage%3Asub-1");
  });

  it("문서도 노드도 모르면 담보 상세로 — 문서 노드 id 를 담보 화면의 ?node= 에 싣지 않는다", () => {
    expect(coordinateHref({ document: "coverageMaster", ownerId: "cov-1", ownerName: "수술비" })).toBe("/coverages/cov-1");
    expect(coordinateHref({ document: "coverageMaster", ownerId: "cov-1", articleId: "a1", nodePath: ["a1", "n2"] })).toBe("/coverages/cov-1");
  });

  it("documentId 와 node 를 둘 다 알면 문서 화면이 앞선다 — 문면 오류는 문면에서 고친다", () => {
    expect(coordinateHref({ document: "coverageMaster", ownerId: "cov-1", documentId: "doc-1", node: { level: "benefit", id: "ben-1" } })).toBe("/documents/doc-1");
  });

  it("general 은 그대로 — ownerId 가 곧 문서 id", () => {
    expect(coordinateHref({ document: "general", ownerId: "doc-g", nodePath: ["a1", "n2"] })).toBe("/documents/doc-g?node=n2");
    expect(coordinateHref({ document: "general", ownerId: "doc-g" })).toBe("/documents/doc-g");
  });
});
