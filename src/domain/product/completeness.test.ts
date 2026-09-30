import { describe, expect, it } from "vitest";

import { entered } from "../types";
import { BASE_CONTRACT_REF, baseContractCountIssue, baseContractDesignationIssues, checkGeneralAttachment, missingSlotsOf, missingToIssues, slotCountOf } from "./completeness";

describe("완결성 — 값 자리는 레벨의 마스터 필드 전부다 (ADR-0037)", () => {
  it("레벨만 알면 자리 수가 정해진다 — 부착을 묻지 않는다", () => {
    expect(slotCountOf("coverage")).toBe(1);
    expect(slotCountOf("benefit")).toBe(8); // pay 2(선택 필드) + 여는 폼 reduction 3 · exemption 3 (연 폼도 포함한 raw 카운트 — ADR-0065 §4)
    expect(slotCountOf("subCoverage")).toBe(0);
  });
});

describe("폼입력 S3 · 담보값입력 S3 — 상품담보 완결성 (스냅샷 실체 기준)", () => {
  it("급부 스냅샷의 지급률만 입력됐으면 미입력이 없다 — 선택 필드 면책여부는 값이 없으면 세지 않는다", () => {
    const slots = new Map([["pay.rate", entered(50)]]);
    expect(missingSlotsOf({ kind: "productBenefit", id: "n2" }, "1종수술급부", "benefit", (p) => slots.get(p))).toEqual([]);
  });

  it("면책 폼을 열고(신규만) 기간을 비워 두면 그 자리가 미입력으로 잡힌다", () => {
    const slots = new Map([["exemption.new_only", entered(true)]]);
    const missing = missingSlotsOf({ kind: "productBenefit", id: "n2" }, "1종수술급부", "benefit", (p) =>
      slots.get(p),
    );
    expect(missing.map((m) => m.path)).toEqual(["exemption.months", "exemption.age15_only"]);
    expect(missing[0]).toEqual({
      owner: { kind: "productBenefit", id: "n2" },
      ownerName: "1종수술급부",
      level: "benefit",
      path: "exemption.months",
    });
  });

  it("전부 입력되면 빈 목록", () => {
    const slots = new Map([["coverage_basic.claim_name", entered("수술비")]]);
    expect(
      missingSlotsOf({ kind: "productCoverage", id: "pc1" }, "수술비", "coverage", (p) => slots.get(p)),
    ).toEqual([]);
  });

  it("미입력은 조립 오류 패널의 notEntered 로 옮겨진다", () => {
    const missing = missingSlotsOf({ kind: "productCoverage", id: "pc1" }, "수술비", "coverage", () => undefined);
    expect(missingToIssues(missing)).toEqual([
      {
        kind: "notEntered",
        message: "수술비 의 coverage_basic.claim_name 이(가) 미입력입니다",
        at: {
          document: "special",
          ownerId: "pc1",
          ownerName: "수술비",
          refPath: "coverage_basic.claim_name",
        },
      },
    ]);
  });

  it("세목 선택지의 미입력은 상품 화면(document product)으로 보낸다 — 선택지 값은 상품 화면에서 입력한다", () => {
    const missing = missingSlotsOf({ kind: "plan", id: "opt-1" }, "1종", "plan", () => undefined);
    expect(missing.map((m) => m.path)).toEqual(["waiver.applies", "waiver.reasons", "no_surrender.type", "conversion.converts", "business_type.applies"]);
    expect(missingToIssues(missing)[0].at).toEqual({ document: "product", ownerId: "opt-1", ownerName: "1종", refPath: "waiver.applies" });
  });
});

describe("기능/상품 §3.5 — 기본계약 지정 순간 보통약관 요구 참조 검사", () => {
  it("보통약관이 요구하는 구분자가 카탈로그에 있으면 통과, 없으면 brokenRef 좌표", () => {
    const known = ["D0001", "D0003"];
    expect(
      checkGeneralAttachment(
        [
          { level: "coverage", discriminatorCode: "D0001" },
          { level: "benefit", discriminatorCode: "D0003", at: { document: "general", articleTitle: "보험금의 지급사유" } },
        ],
        known,
        { id: "pc1", name: "일반상해사망" },
      ),
    ).toEqual([]);

    const bad = checkGeneralAttachment(
      [{ level: "coverage", discriminatorCode: "D0005", at: { document: "general", articleTitle: "감액" } }],
      known,
      { id: "pc1", name: "일반상해사망" },
    );
    expect(bad).toHaveLength(1);
    expect(bad[0].kind).toBe("brokenRef");
    expect(bad[0].at).toMatchObject({
      document: "general",
      articleTitle: "감액",
      ownerId: "pc1",
      ownerName: "일반상해사망",
      refPath: "D0005",
    });
  });
});

describe("기본계약 수 규칙 — MVP 정확히 1개 (기능/상품 §3.5)", () => {
  const product = { id: "prod-1", name: "알파플러스" };
  const at = { document: "product", ownerId: "prod-1", ownerName: "알파플러스", refPath: BASE_CONTRACT_REF };

  it("0개 → noBaseContract · 좌표는 상품 + refPath baseContract (링크가 보통약관 탭 기본계약 블록에 닿는다)", () => {
    expect(baseContractCountIssue(0, product)).toEqual({ kind: "noBaseContract", severity: "error", message: "기본계약이 지정되지 않았습니다", at, source: at });
  });

  it("2개 이상 → unsupported · 「하나만 남기고 해제하세요」 — 복구 동선을 문구가 말한다", () => {
    expect(baseContractCountIssue(2, product)).toEqual({ kind: "unsupported", severity: "error", message: "기본계약이 2개입니다 — 하나만 남기고 해제하세요 (MVP 는 1개)", at, source: at });
    expect(baseContractCountIssue(3, product)?.message).toBe("기본계약이 3개입니다 — 하나만 남기고 해제하세요 (MVP 는 1개)");
  });

  it("1개면 오류 없음", () => {
    expect(baseContractCountIssue(1, product)).toBeUndefined();
  });

  it("두 번째 지정은 거부 — 이미 하나 있으면 unsupported 「먼저 현재 기본계약을 해제하세요」 · 없으면 통과", () => {
    expect(baseContractDesignationIssues(0, product)).toEqual([]);
    expect(baseContractDesignationIssues(1, product)).toEqual([{ kind: "unsupported", message: "기본계약은 하나만 지정할 수 있습니다 — 먼저 현재 기본계약을 해제하세요 (MVP)", at }]);
    expect(baseContractDesignationIssues(2, product)).toHaveLength(1);
  });

  it("독립특약(계약형태 E0007) — 0개가 정상, 1개 이상은 unsupported · 지정은 수와 무관하게 거부 (기능/상품 §3.1 · 2026-10-01)", () => {
    expect(baseContractCountIssue(0, product, true)).toBeUndefined();
    expect(baseContractCountIssue(1, product, true)).toEqual({ kind: "unsupported", severity: "error", message: "독립특약 상품은 기본계약을 두지 않습니다 — 기본계약을 해제하세요", at, source: at });
    expect(baseContractDesignationIssues(0, product, true)).toEqual([{ kind: "unsupported", message: "독립특약 상품은 기본계약을 두지 않습니다", at }]);
  });
});
