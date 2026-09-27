import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Coverage, CoverageNodeRef, StructureDraftSub, UsageQuery } from "@/domain/coverage";
import { masterCatalog, masterEvalContext, structureDraftOf } from "@/domain/coverage";
import { evaluate, parse } from "@/domain/expression";
import type { Actor, Coordinate, Id, Impact } from "@/domain/types";

import { readSlots, type ValueOwner } from "@/db/repo/values";
import { createTestDb, type TestDb } from "@/db/test-utils";
import { createCatalogService } from "./catalog";
import { createServices, type Services } from "./container";
import { createCoverageService, type CoverageService } from "./coverage";

const admin: Actor = { userId: "00000000-0000-4000-8000-000000000001", role: "admin" };
const editor: Actor = { userId: "00000000-0000-4000-8000-000000000002", role: "editor" };

function unwrap<T>(r: { ok: true; value: T } | { ok: false; rejection: unknown }): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}
function rejection(r: { ok: boolean; rejection?: unknown }) {
  if (r.ok) throw new Error("기대: 거부, 실제: ok");
  return r.rejection as { reason: string; what?: string; impact?: Impact; issues?: { kind: string }[] };
}

describe("coverage 서비스 (PGlite)", () => {
  let t: TestDb;
  let svc: CoverageService;
  /** 사용처 흉내 — 질의를 기록하고, 「세부보장 삭제」에만 사용처를 돌려준다. */
  const queries: UsageQuery[] = [];
  const usage = {
    findUsages: async (q: UsageQuery): Promise<Coordinate[]> => {
      queries.push(q);
      if (q.node.level === "subCoverage") return [{ document: "coverageMaster", ownerId: q.coverageId, articleTitle: "보장범위" }];
      return [];
    },
  };

  let accident: Coverage;
  let surgery: Coverage;
  const cov = (c: Coverage): CoverageNodeRef => ({ level: "coverage", id: c.id });
  /** 노드 지시자 → 값 저장소 소유자 (repo/values 직접 검증용). */
  const own = (r: CoverageNodeRef): ValueOwner => ({ kind: r.level, id: r.id });

  beforeAll(async () => {
    t = await createTestDb();
    svc = createCoverageService(t.db, { usage });
    // 카탈로그 픽스처 — 값 자리는 MVP 마스터가 정한다 (담보 claim_name · 급부 pay.exempt · pay.rate).
    // 구분자는 문면이 보는 이름일 뿐이다: D0001 담보명(투영) · D0002 면책구분(집계).
    const catalog = createCatalogService(t.db);
    unwrap(await catalog.create(editor, { label: "담보명", level: "coverage", expression: "coverage_basic.claim_name" }));
    unwrap(await catalog.create(editor, { label: "면책구분", level: "coverage", expression: "any(pay.exempt)" }));
  });
  afterAll(async () => {
    await t.close();
  });

  describe("담보트리 S1·S2·S3 — 생성 · 추가 · 이름 · 순서 (편집자 가능)", () => {
    it("편집자가 담보 「일반상해사망」을 만들면 세부보장 1·급부 1 최소 트리가 저장된다", async () => {
      accident = unwrap(await svc.create(editor, { name: "일반상해사망", benefitName: "일반상해사망보험금" }));
      expect(accident.subCoverages).toHaveLength(1);
      expect(accident.subCoverages[0].benefits[0].name).toBe("일반상해사망보험금");
      expect(await svc.get(accident.id)).toEqual(accident);
    });

    it("담보명 중복은 DB 상태 기준으로 거부 (D-P2-2)", async () => {
      expect(rejection(await svc.create(editor, { name: "일반상해사망" })).reason).toBe("duplicate");
      expect((await svc.rename(editor, accident.id, "일반상해사망")).ok).toBe(true); // 자기 이름은 중복이 아니다

    });

    it("수술비: 세부보장 7개 순서대로 추가 → 각 급부 1개, 형제 순서 유지", async () => {
      surgery = unwrap(await svc.create(editor, { name: "수술비", subCoverageName: "1종수술", benefitName: "수술보험금" }));
      for (const n of ["2종수술", "3종수술", "4종수술", "5종수술", "6종수술", "7종수술"]) {
        surgery = unwrap(await svc.addSubCoverage(editor, surgery.id, { name: n, benefitName: "수술보험금" }));
      }
      expect(surgery.subCoverages.map((s) => s.name)).toEqual(["1종수술", "2종수술", "3종수술", "4종수술", "5종수술", "6종수술", "7종수술"]);
      expect(await svc.get(surgery.id)).toEqual(surgery);
    });

    it("형제 이름 중복 거부 · 다른 담보 아래 동명 허용 · 급부 추가/이름 변경", async () => {
      expect(rejection(await svc.addSubCoverage(editor, surgery.id, { name: "1종수술" })).reason).toBe("duplicate");
      expect(rejection(await svc.renameSubCoverage(editor, surgery.subCoverages[1].id, "1종수술")).reason).toBe("duplicate");
      accident = unwrap(await svc.addSubCoverage(editor, accident.id, { name: "1종수술" }));
      expect(accident.subCoverages).toHaveLength(2);
      const sub = surgery.subCoverages[0];
      surgery = unwrap(await svc.addBenefit(editor, sub.id, "입원보험금"));
      expect(surgery.subCoverages[0].benefits.map((b) => b.name)).toEqual(["수술보험금", "입원보험금"]);
      expect(rejection(await svc.addBenefit(editor, sub.id, "입원보험금")).reason).toBe("duplicate");
      surgery = unwrap(await svc.renameBenefit(editor, surgery.subCoverages[0].benefits[1].id, "통원보험금"));
      expect((await svc.get(surgery.id))?.subCoverages[0].benefits[1].name).toBe("통원보험금");
    });

    it("담보트리 S4 — 7종수술을 맨 앞으로 재배열하면 저장된 순서가 그대로 따른다", async () => {
      const ids = surgery.subCoverages.map((s) => s.id);
      surgery = unwrap(await svc.reorderSubCoverages(editor, surgery.id, [ids[6], ...ids.slice(0, 6)]));
      expect((await svc.get(surgery.id))?.subCoverages.map((s) => s.name)[0]).toBe("7종수술");
      const [b0, b1] = surgery.subCoverages[1].benefits.map((b) => b.id); // 1종수술
      surgery = unwrap(await svc.reorderBenefits(editor, surgery.subCoverages[1].id, [b1, b0]));
      expect(surgery.subCoverages[1].benefits.map((b) => b.name)).toEqual(["통원보험금", "수술보험금"]);
    });

    it("설명·문서 연결 자리 · 없는 id 는 notFound", async () => {
      const desc = unwrap(await svc.setDescription(editor, surgery.id, "수술 담보"));
      expect(desc.description).toBe("수술 담보");
      const doc = "33333333-3333-4333-8333-333333333333";
      expect(unwrap(await svc.setDocument(editor, surgery.id, doc)).documentId).toBe(doc);
      expect(unwrap(await svc.setDocument(editor, surgery.id, undefined)).documentId).toBeUndefined();
      expect(rejection(await svc.rename(editor, "44444444-4444-4444-8444-444444444444", "x")).reason).toBe("notFound");
      expect(rejection(await svc.addBenefit(editor, "44444444-4444-4444-8444-444444444444", "x")).reason).toBe("notFound");
    });

    it("listSummaries — L1 목록 요약이 이름·문서연결·최종수정을 담는다 (WP2, 리뷰 #38/#48)", async () => {
      const summaries = await svc.listSummaries();
      const found = summaries.find((s) => s.id === surgery.id)!;
      expect(found.name).toBe(surgery.name);
      expect(found.documentId).toBe(surgery.documentId);
      expect(found.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe("담보값입력 S1 — 값 자리는 마스터가 정한다 (ADR-0037)", () => {
    it("그 레벨 마스터 필드가 두 담보 모두의 폼에 그대로 뜬다 — 부착 조작이 없다", async () => {
      for (const c of [accident, surgery]) {
        const form = unwrap(await svc.form(cov(c)));
        expect(form.fields.map((f) => f.path)).toEqual(["coverage_basic.claim_name"]);
        expect(form.slots).toEqual({});
      }
    });

    it("급부 레벨은 보험금지급 세 자리 + 여는 폼(감액·면책) 여섯 자리 — 폼 정의는 열림 여부와 무관하게 전부 뜬다", async () => {
      const b: CoverageNodeRef = { level: "benefit", id: accident.subCoverages[0].benefits[0].id };
      expect(unwrap(await svc.form(b)).fields.map((f) => f.path)).toEqual([
        "pay.exempt", "pay.rate", "pay.first_only",
        "reduction.periods", "reduction.after_rate", "reduction.new_only",
        "exemption.months", "exemption.age15_only", "exemption.new_only",
      ]);
    });

    it("없는 실체의 폼은 notFound", async () => {
      expect(rejection(await svc.form({ level: "benefit", id: "44444444-4444-4444-8444-444444444444" })).reason).toBe("notFound");
    });
  });

  describe("담보값입력 S4 — 값 입력 · 미입력 상태 · 값 비우기", () => {
    it("타입 맞는 값은 저장되고 폼에 명시 값으로 보인다. 타입 위반은 invalid", async () => {
      unwrap(await svc.writeValue(editor, cov(surgery), "coverage_basic.claim_name", "수술보험금"));
      expect(unwrap(await svc.form(cov(surgery))).slots).toEqual({
        "coverage_basic.claim_name": { entered: true, value: "수술보험금" },
      });
      expect(rejection(await svc.writeValue(editor, cov(surgery), "coverage_basic.claim_name", true)).issues?.[0].kind).toBe("typeMismatch");
    });

    it("그 레벨의 자리가 아닌 경로 · 없는 경로에는 쓸 수 없다", async () => {
      expect(rejection(await svc.writeValue(editor, cov(accident), "pay.exempt", true)).reason).toBe("notFound");
      expect(rejection(await svc.writeValue(editor, cov(accident), "coverage.gone", "x")).reason).toBe("notFound");
    });

    it("급부 레벨 값 입력은 담보 레벨과 같은 규칙 (D-P2-12) · 값 비우기 → 미입력 (D-P2-10)", async () => {
      const b: CoverageNodeRef = { level: "benefit", id: accident.subCoverages[0].benefits[0].id };
      unwrap(await svc.writeValue(editor, b, "pay.exempt", false));
      unwrap(await svc.writeValue(editor, b, "pay.rate", 50));
      expect(unwrap(await svc.form(b)).slots).toEqual({
        "pay.exempt": { entered: true, value: false },
        "pay.rate": { entered: true, value: 50 },
      });
      unwrap(await svc.clearValue(editor, b, "pay.rate"));
      const form = unwrap(await svc.form(b));
      expect(form.slots).toEqual({ "pay.exempt": { entered: true, value: false } });
      // 여는 폼(감액·면책)의 기본값도 프리필에 뜬다 — 그 폼을 열지 않았어도 프리필은 폼 정의 전체를 본다.
      // (완결성 · exist 는 「자리 없음」으로 보되, 프리필은 화면이 실제로 열었을 때의 초깃값을 미리 보여준다.
      // Task 3 스코프 밖 — 화면이 감액·면책 폼을 열기 전에 이 프리필을 보여줄지는 Task 4/10 에서 정한다.)
      expect(form.prefill).toEqual({
        "pay.exempt": false,
        "reduction.after_rate": 100,
        "reduction.new_only": true,
        "exemption.age15_only": false,
        "exemption.new_only": true,
      });
    });
  });

  describe("담보값입력 S3 — 완결성 조회는 마스터 자리 전부가 대상", () => {
    it("일반상해사망: 담보명 + 급부 자리 미입력. 선택 필드(면책여부 · 지급률)는 값이 없으면 세지 않는다", async () => {
      const missing = unwrap(await svc.completeness(accident.id));
      expect(missing.map((m) => [m.owner.level, m.path])).toEqual([
        ["coverage", "coverage_basic.claim_name"],
        ["benefit", "pay.first_only"], // 첫 급부: exempt 입력됨 · rate 는 선택 필드
        ["benefit", "pay.first_only"], // 두 번째 세부보장(1종수술)의 급부
      ]);
    });

    it("수술비: 담보명이 입력돼 급부 자리만 남는다 (7 세부보장 · 급부 8개 × 최초1회한 — 선택 필드는 세지 않는다)", async () => {
      const missing = unwrap(await svc.completeness(surgery.id));
      expect(missing.filter((m) => m.owner.level === "coverage")).toEqual([]);
      expect(missing).toHaveLength(8);
    });

    it("완결성 요약은 분모를 함께 준다 — 「값 자리 N 중 M 입력」 (디자인원칙 §9.2·§9.6)", async () => {
      const summary = unwrap(await svc.completenessSummary(accident.id));
      // 담보명 1 + 첫 급부(입력한 면책여부 + 최초1회한) 2 + 둘째 급부 최초1회한 1 = 4 (세부보장 레벨 마스터는 비어 있다 · 값 없는 선택 필드는 세지 않는다)
      expect(summary.total).toBe(4);
      expect(summary.missing).toEqual(unwrap(await svc.completeness(accident.id)));
      expect(summary.total - summary.missing.length).toBe(1); // 첫 급부의 면책여부만 입력돼 있다
    });

    it("실행 기반 필터를 주입하면 그 결과가 조회 결과다", async () => {
      const filtered = createCoverageService(t.db, { usage, completenessFilter: (items) => items.slice(0, 1) });
      expect(unwrap(await filtered.completeness(surgery.id))).toHaveLength(1);
    });
  });

  describe("역할권한 S1·S3·S4 — 구조 삭제 (파괴적 · coverage.deleteNode)", () => {
    it("편집자의 세부보장 삭제는 역할로 거부 — 화면 우회해도 동일", async () => {
      expect(await svc.removeSubCoverage(editor, surgery.subCoverages[0].id)).toEqual({
        ok: false,
        rejection: { reason: "forbidden", role: "editor", action: "coverage.deleteNode" },
      });
    });

    it("최소 구조 위반(마지막 세부보장·마지막 급부)은 관리자도 거부", async () => {
      const only = accident.subCoverages[0];
      expect(rejection(await svc.removeBenefit(admin, only.benefits[0].id, { confirm: true })).reason).toBe("minimumStructure");
      const simple = unwrap(await svc.create(editor, { name: "단순담보" }));
      expect(rejection(await svc.removeSubCoverage(admin, simple.subCoverages[0].id, { confirm: true })).reason).toBe("minimumStructure");
    });

    it("관리자 1차: 영향 목록(소실 값 행 수 · cascade 이름 · 사용처) → 확인 요구. confirm 후 노드·값 행 연쇄 삭제", async () => {
      const seven = surgery.subCoverages[0]; // 7종수술 (맨 앞)
      const b: CoverageNodeRef = { level: "benefit", id: seven.benefits[0].id };
      unwrap(await svc.writeValue(editor, b, "pay.exempt", true));
      unwrap(await svc.writeValue(editor, b, "pay.rate", 10));
      queries.length = 0;

      const first = rejection(await svc.removeSubCoverage(admin, seven.id));
      expect(first.reason).toBe("needsConfirmation");
      expect(first.impact).toEqual({
        valueRowsLost: 2,
        cascade: ["급부 수술보험금"],
        brokenRefs: [{ document: "coverageMaster", ownerId: surgery.id, articleTitle: "보장범위" }],
      });
      expect(queries).toEqual([{ kind: "deleteNode", coverageId: surgery.id, node: { level: "subCoverage", id: seven.id } }]);
      expect((await svc.get(surgery.id))?.subCoverages).toHaveLength(7);

      surgery = unwrap(await svc.removeSubCoverage(admin, seven.id, { confirm: true }));
      expect(surgery.subCoverages.map((s) => s.name)).toEqual(["1종수술", "2종수술", "3종수술", "4종수술", "5종수술", "6종수술"]);
      expect(surgery.subCoverages.map((s) => s.order)).toEqual([0, 1, 2, 3, 4, 5]);
      expect((await readSlots(t.db, own(b))).size).toBe(0);
    });

    it("nodeDeleteImpact — 영향만 계산: 편집자 forbidden · 관리자는 마지막 형제여도 Impact (최소 구조 precheck 없음) · 트리 불변", async () => {
      const only = accident.subCoverages[0];
      const sole: CoverageNodeRef = { level: "benefit", id: only.benefits[0].id };
      expect(rejection(await svc.nodeDeleteImpact(editor, sole)).reason).toBe("forbidden");
      expect(rejection(await svc.removeBenefit(admin, sole.id)).reason).toBe("minimumStructure");
      queries.length = 0;
      const impact = unwrap(await svc.nodeDeleteImpact(admin, sole));
      expect(impact).toEqual({ valueRowsLost: 1, cascade: [], brokenRefs: [] }); // 첫 급부의 면책여부 하나
      expect(queries).toEqual([{ kind: "deleteNode", coverageId: accident.id, node: sole }]);
      expect(await svc.get(accident.id)).toEqual(accident);
      expect(rejection(await svc.nodeDeleteImpact(admin, { level: "benefit", id: "44444444-4444-4444-8444-444444444444" })).reason).toBe("notFound");
    });

    it("급부 삭제도 같은 결 — 통원보험금(1종수술) 삭제", async () => {
      const one = surgery.subCoverages[0];
      const target = one.benefits.find((x) => x.name === "통원보험금")!;
      expect(rejection(await svc.removeBenefit(admin, target.id)).reason).toBe("needsConfirmation");
      surgery = unwrap(await svc.removeBenefit(admin, target.id, { confirm: true }));
      expect(surgery.subCoverages[0].benefits.map((x) => x.name)).toEqual(["수술보험금"]);
    });

    it("담보 삭제도 같은 결 — 편집자 forbidden · 관리자 확인 후 트리·값 전부 삭제", async () => {
      const simple = (await svc.list()).find((c) => c.name === "단순담보")!;
      unwrap(await svc.writeValue(editor, cov(simple), "coverage_basic.claim_name", "단순"));
      expect(rejection(await svc.remove(editor, simple.id)).reason).toBe("forbidden");
      const first = rejection(await svc.remove(admin, simple.id));
      expect(first.impact).toMatchObject({ valueRowsLost: 1, cascade: ["세부보장 단순담보", "급부 단순담보"] });
      unwrap(await svc.remove(admin, simple.id, { confirm: true }));
      expect(await svc.get(simple.id)).toBeUndefined();
      expect((await readSlots(t.db, own(cov(simple)))).size).toBe(0);
      expect(rejection(await svc.remove(admin, simple.id, { confirm: true })).reason).toBe("notFound");
    });
  });

  describe("마스터 값 조회 → 평가 문맥 (B3 사전평가 · C2 조립 재사용)", () => {
    it("masterValues 로 만든 masterEvalContext 가 집계 구분자 any(급부.면책여부) 를 평가한다", async () => {
      for (const s of accident.subCoverages) {
        for (const b of s.benefits) {
          unwrap(await svc.writeValue(editor, { level: "benefit", id: b.id }, "pay.exempt", s.name === "1종수술"));
        }
      }
      const { tree, values } = unwrap(await svc.masterValues(accident.id));
      expect(tree.id).toBe(accident.id);
      const catalog = masterCatalog(await createCatalogService(t.db).list());
      const ctx = masterEvalContext(tree, values, catalog);
      expect(evaluate(unwrap(parse("D0002")), ctx)).toEqual({ kind: "value", value: true });
      // 담보명은 미입력 — 투영 구분자를 읽으면 그 자리가 미입력으로 보고된다
      expect(evaluate(unwrap(parse("D0001")), ctx)).toMatchObject({ kind: "error", issue: { kind: "notEntered" } });
      expect(rejection(await svc.masterValues("44444444-4444-4444-8444-444444444444")).reason).toBe("notFound");
    });
  });
});

/**
 * 구조 계획 적용 (ADR-0075 결정 2 · M04-b) — 조립 루트로 묶어 탑재 상품담보까지 실제로 둔다.
 * 계획 하나가 한 트랜잭션에서 (최종 트리로 검사해) 적용되고, 탑재 상품담보 스냅샷이 같은 트랜잭션에서 따라온다.
 */
describe("coverage 서비스 — applyStructurePlan · previewStructurePlan (조립 루트 · 탑재 상품담보 포함)", () => {
  let t: TestDb;
  let s: Services;
  let surgery: Coverage;
  let pcP: Id; // 상품 P 의 수술비
  let pcQ: Id; // 상품 Q 의 수술비
  const benefitOf = (tree: Coverage, subName: string, name: string) => tree.subCoverages.find((x) => x.name === subName)!.benefits.find((b) => b.name === name)!;
  const deep = (tree: Coverage): StructureDraftSub[] => structureDraftOf(tree).map((sub) => ({ ...sub, benefits: sub.benefits.map((b) => ({ ...b })) }));
  const shape = (tree: Coverage) => tree.subCoverages.map((sub) => [sub.name, sub.benefits.map((b) => b.name)]);
  const snapshotShape = async (pcId: Id) => {
    const snap = unwrap(await s.product.getSnapshot(pcId));
    return snap.subCoverages.map((sub) => [sub.name, sub.order, sub.benefits.map((b) => [b.name, b.order])]);
  };
  const snapshotRows = async (pcId: Id) => {
    let n = 0;
    for (const slots of (await s.product.getSnapshotValues(pcId)).values()) n += slots.size;
    return n;
  };

  beforeAll(async () => {
    t = await createTestDb();
    s = createServices(t.db);
    // 수술비: 1종수술 [수술보험금 · 입원보험금] · 2종수술 [수술보험금]. 마스터 값: 입원보험금 2행 · 2종 수술보험금 1행.
    surgery = unwrap(await s.coverage.create(editor, { name: "수술비", subCoverageName: "1종수술", benefitName: "수술보험금" }));
    surgery = unwrap(await s.coverage.addBenefit(editor, surgery.subCoverages[0]!.id, "입원보험금"));
    surgery = unwrap(await s.coverage.addSubCoverage(editor, surgery.id, { name: "2종수술", benefitName: "수술보험금" }));
    const stay: CoverageNodeRef = { level: "benefit", id: benefitOf(surgery, "1종수술", "입원보험금").id };
    unwrap(await s.coverage.writeValue(editor, stay, "pay.exempt", true));
    unwrap(await s.coverage.writeValue(editor, stay, "pay.rate", 10));
    unwrap(await s.coverage.writeValue(editor, { level: "benefit", id: benefitOf(surgery, "2종수술", "수술보험금").id }, "pay.rate", 5));
    // 두 상품에 탑재 — 스냅샷이 마스터 값을 복사한다 (ADR-0002). Q 의 입원보험금에는 스냅샷에서만 넣은 값을 하나 더.
    const p = unwrap(await s.product.createProduct(editor, { name: "상품 P" }));
    const q = unwrap(await s.product.createProduct(editor, { name: "상품 Q" }));
    pcP = unwrap(await s.product.mount(editor, p.id, surgery.id, [])).id;
    pcQ = unwrap(await s.product.mount(editor, q.id, surgery.id, [])).id;
    const stayQ = unwrap(await s.product.getSnapshot(pcQ)).subCoverages[0]!.benefits.find((b) => b.name === "입원보험금")!;
    unwrap(await s.product.setSnapshotValue(editor, pcQ, { kind: "productBenefit", id: stayQ.id }, "pay.first_only", true));
    expect(await snapshotRows(pcP)).toBe(3);
    expect(await snapshotRows(pcQ)).toBe(4);
  });
  afterAll(async () => {
    await t.close();
  });

  it("previewStructurePlan — 순서만 바꾼 계획: 삭제 영향 0 + 탑재 상품담보 목록(상품 · 상품담보 · 스냅샷 값 행 전체 · 소실 0). 아무것도 안 바꾼다", async () => {
    const draft = deep(surgery).reverse();
    const impact = unwrap(await s.coverage.previewStructurePlan(editor, surgery.id, draft));
    expect(impact).toEqual({
      valueRowsLost: 0,
      brokenRefs: [],
      cascade: [],
      mounts: [
        { productId: expect.any(String), productName: "상품 P", productCoverageId: pcP, productCoverageName: "수술비", snapshotValueRows: 3, snapshotValueRowsLost: 0 },
        { productId: expect.any(String), productName: "상품 Q", productCoverageId: pcQ, productCoverageName: "수술비", snapshotValueRows: 4, snapshotValueRowsLost: 0 },
      ],
    });
    expect(await s.coverage.get(surgery.id)).toEqual(surgery);
    expect(rejection(await s.coverage.previewStructurePlan(editor, "44444444-4444-4444-8444-444444444444", draft)).reason).toBe("notFound");
  });

  it("비파괴 계획(추가 · 이름 · 순서)은 편집자가 confirm 없이 — 한 번에 반영되고 탑재 스냅샷이 같은 트랜잭션에서 따라온다 (새 노드는 빈 값)", async () => {
    const draft = deep(surgery);
    draft[0]!.benefits.push({ key: "new:1", name: "통원보험금" });
    draft[1]!.name = "이종수술";
    draft.unshift({ key: "new:2", name: "0종수술", benefits: [{ key: "new:3", name: "특수수술보험금" }] });
    const next = unwrap(await s.coverage.applyStructurePlan(editor, surgery.id, draft));
    expect(shape(next)).toEqual([["0종수술", ["특수수술보험금"]], ["1종수술", ["수술보험금", "입원보험금", "통원보험금"]], ["이종수술", ["수술보험금"]]]);
    expect(next.subCoverages.map((sub) => sub.order)).toEqual([0, 1, 2]);
    expect(await s.coverage.get(surgery.id)).toEqual(next);
    // 스냅샷 — getSnapshot 은 동기화하지 않으므로, 여기 보이는 것은 applyStructurePlan 이 같은 트랜잭션에서 맞춘 것이다
    for (const pc of [pcP, pcQ]) {
      expect(await snapshotShape(pc)).toEqual([["0종수술", 0, [["특수수술보험금", 0]]], ["1종수술", 1, [["수술보험금", 0], ["입원보험금", 1], ["통원보험금", 2]]], ["이종수술", 2, [["수술보험금", 0]]]]);
    }
    expect(await snapshotRows(pcP)).toBe(3); // 추가 노드의 값 자리는 미입력 — 마스터 기본값 사후 복사 없음 (ADR-0002)
    expect(await snapshotRows(pcQ)).toBe(4);
    surgery = next;
  });

  it("삭제가 섞이면 편집자는 confirm 을 붙여도 forbidden — 트리 · 스냅샷 불변", async () => {
    const draft = deep(surgery);
    draft[1]!.benefits = draft[1]!.benefits.filter((b) => b.name !== "입원보험금");
    draft[0]!.name = "영종수술"; // 이름 변경이 섞여도 부분 저장 없음
    for (const confirm of [false, true]) {
      expect(await s.coverage.applyStructurePlan(editor, surgery.id, draft, { confirm })).toEqual({
        ok: false,
        rejection: { reason: "forbidden", role: "editor", action: "coverage.deleteNode" },
      });
    }
    expect(rejection(await s.coverage.previewStructurePlan(editor, surgery.id, draft)).reason).toBe("forbidden");
    expect(await s.coverage.get(surgery.id)).toEqual(surgery);
    expect(await snapshotRows(pcQ)).toBe(4);
  });

  it("관리자 1차: needsConfirmation — 마스터 값 행 · 탑재 상품담보별 스냅샷 소실 행 수 (무변경) → confirm 이면 마스터 값 행 정리 + 스냅샷 노드 · 값 행 제거", async () => {
    const draft = deep(surgery);
    draft[1]!.benefits = draft[1]!.benefits.filter((b) => b.name !== "입원보험금");
    const stayId = benefitOf(surgery, "1종수술", "입원보험금").id;
    const first = rejection(await s.coverage.applyStructurePlan(admin, surgery.id, draft));
    expect(first.reason).toBe("needsConfirmation");
    expect(first.impact).toEqual({
      valueRowsLost: 2,
      brokenRefs: [],
      cascade: [],
      mounts: [
        { productId: expect.any(String), productName: "상품 P", productCoverageId: pcP, productCoverageName: "수술비", snapshotValueRows: 3, snapshotValueRowsLost: 2 },
        { productId: expect.any(String), productName: "상품 Q", productCoverageId: pcQ, productCoverageName: "수술비", snapshotValueRows: 4, snapshotValueRowsLost: 3 },
      ],
    });
    expect(unwrap(await s.coverage.previewStructurePlan(admin, surgery.id, draft))).toEqual(first.impact);
    expect(await s.coverage.get(surgery.id)).toEqual(surgery);
    expect(await snapshotRows(pcQ)).toBe(4);

    const next = unwrap(await s.coverage.applyStructurePlan(admin, surgery.id, draft, { confirm: true }));
    expect(shape(next)).toEqual([["0종수술", ["특수수술보험금"]], ["1종수술", ["수술보험금", "통원보험금"]], ["이종수술", ["수술보험금"]]]);
    expect((await readSlots(t.db, { kind: "benefit", id: stayId })).size).toBe(0);
    expect(await snapshotShape(pcP)).toEqual([["0종수술", 0, [["특수수술보험금", 0]]], ["1종수술", 1, [["수술보험금", 0], ["통원보험금", 1]]], ["이종수술", 2, [["수술보험금", 0]]]]);
    expect(await snapshotRows(pcP)).toBe(1);
    expect(await snapshotRows(pcQ)).toBe(1);
    surgery = next;
  });

  it("세부보장 삭제 — 연쇄(cascade) · 스냅샷 소실 행은 하위 급부까지 센다", async () => {
    const draft = deep(surgery).filter((sub) => sub.name !== "이종수술");
    const first = rejection(await s.coverage.applyStructurePlan(admin, surgery.id, draft));
    expect(first.impact).toMatchObject({ valueRowsLost: 1, cascade: ["급부 수술보험금"] });
    expect(first.impact!.mounts!.map((m) => m.snapshotValueRowsLost)).toEqual([1, 1]);
    surgery = unwrap(await s.coverage.applyStructurePlan(admin, surgery.id, draft, { confirm: true }));
    expect(shape(surgery)).toEqual([["0종수술", ["특수수술보험금"]], ["1종수술", ["수술보험금", "통원보험금"]]]);
    expect(await snapshotRows(pcP)).toBe(0);
    expect((await snapshotShape(pcP)).map((row) => row[0])).toEqual(["0종수술", "1종수술"]);
  });

  it("드라이런 거부(최종 트리에서 남는 형제와 같은 이름의 새 급부 → duplicate) — 관리자 · confirm 이어도 무변경", async () => {
    // ✕ 한 형제의 이름을 새 급부에 다시 쓰는 것은 이제 허용이다 — 최종 상태로 검사 (점검 2026-09-27 H2 ③, plan.test)
    const draft = deep(surgery);
    draft[1]!.benefits = [...draft[1]!.benefits, { key: "new:1", name: draft[1]!.benefits[0]!.name }];
    expect(rejection(await s.coverage.applyStructurePlan(admin, surgery.id, draft, { confirm: true })).reason).toBe("duplicate");
    expect(rejection(await s.coverage.applyStructurePlan(admin, surgery.id, [], { confirm: true })).reason).toBe("minimumStructure");
    expect(await s.coverage.get(surgery.id)).toEqual(surgery);
    expect(rejection(await s.coverage.applyStructurePlan(admin, "44444444-4444-4444-8444-444444444444", draft)).reason).toBe("notFound");
  });

  it("변화 없는 계획은 그대로 ok — 저장도 동기화도 하지 않는다 (감사 컬럼 · 스냅샷 노드 불변)", async () => {
    const before = await s.coverage.audit(surgery.id);
    const nodesBefore = unwrap(await s.product.getSnapshot(pcQ));
    expect(unwrap(await s.coverage.applyStructurePlan(editor, surgery.id, structureDraftOf(surgery)))).toEqual(surgery);
    expect(await s.coverage.audit(surgery.id)).toEqual(before);
    expect(unwrap(await s.product.getSnapshot(pcQ))).toEqual(nodesBefore);
  });
});
