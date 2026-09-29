import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { nodeBuilders, sequentialIds, type ClauseGate, type Command, type DocumentNode } from "@/domain/document";
import type { EvalContext } from "@/domain/expression";
import type { Actor, Id, Result } from "@/domain/types";

import { createTestDb, type TestDb } from "@/db/test-utils";
import { createCatalogService } from "./catalog";
import { createCoverageService } from "./coverage";
import { createDocumentService, type DocumentService } from "./document";

const admin: Actor = { userId: "00000000-0000-4000-8000-000000000001", role: "admin" };
const editor: Actor = { userId: "00000000-0000-4000-8000-000000000002", role: "editor" };
const covSurgery: Id = "11111111-1111-4111-8111-111111111111";
const covDeath: Id = "22222222-2222-4222-8222-222222222222";

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}
function rejection<T>(r: Result<T>) {
  if (r.ok) throw new Error("기대: 거부, 실제: ok");
  return r.rejection;
}

/** B2 흉내 — C001 만 존재, 옵션 tone 필수. */
const gate: ClauseGate = {
  clauseExists: (c) => c === "C001",
  requiredCodes: (c) => (c === "C001" ? ["D0001"] : []),
  missingRequired: () => [],
  validateOptions: (_c, o) => (o.tone === undefined ? [{ kind: "optionUnselected", message: "옵션 tone 미선택", at: {} }] : []),
};

/** B1 흉내 — 담보 마스터 문맥: D0001 = false 입력, 상품 레벨 미결. */
const masterCtx: EvalContext = {
  lookup: (ref) => {
    if (ref.kind !== "discriminator") return { kind: "undetermined" };
    if (ref.code === "D0001") return { kind: "slot", slot: { entered: true, value: false } };
    if (ref.code === "D0004") return { kind: "slot", slot: { entered: true, value: "2.5%" } };
    return { kind: "undetermined" };
  },
  attribute: () => ({ kind: "undetermined" }),
  children: () => undefined,
};

describe("document 서비스 (PGlite)", () => {
  let t: TestDb;
  let svc: DocumentService;
  const b = nodeBuilders(sequentialIds("n"));
  let generalId: Id;
  let specialId: Id;
  let artPay: Id;
  let artApply: Id;
  let gArtApply: Id;

  beforeAll(async () => {
    t = await createTestDb();
    // 카탈로그 — 구분자는 전부 식 하나다 (ADR-0037). 결과 타입은 식에서 추론된다.
    // D0001 갱신여부(boolean) · D0002 지급률(number) · D0003 면책구분(boolean) · D0004 평균공시이율(string 리터럴)
    const cat = createCatalogService(t.db);
    unwrap(await cat.create(editor, { label: "갱신여부", level: "coverage", expression: "attr.A0001 = '2'" }));
    unwrap(await cat.create(editor, { label: "지급률", level: "benefit", expression: "pay.rate" }));
    unwrap(await cat.create(editor, { label: "면책구분", level: "coverage", expression: "any(pay.exempt)" }));
    unwrap(await cat.create(editor, { label: "평균공시이율", level: "product", expression: "'2.5%'" }));
    svc = createDocumentService(t.db, { clauseGate: async () => gate });
  });
  afterAll(async () => {
    await t.close();
  });

  describe("문면작성 S7 · S1 — 문서 생성 · 목록", () => {
    it("보통약관 마스터 생성 — 빈 문서 트리, 이름 유일 (D-P4-1)", async () => {
      const g = unwrap(await svc.createGeneral(editor, "알파Plus 보통약관"));
      generalId = g.id;
      expect(g.kind).toBe("general");
      expect(g.tree).toMatchObject({ kind: "document", title: "알파Plus 보통약관", children: [] });
      expect(rejection(await svc.createGeneral(editor, "알파Plus 보통약관")).reason).toBe("duplicate");
    });

    it("담보 문면 생성 — 담보 1 : 문서 1", async () => {
      const s = unwrap(await svc.createSpecial(editor, covSurgery, "수술비 특별약관"));
      specialId = s.id;
      expect(s.ownerId).toBe(covSurgery);
      expect(rejection(await svc.createSpecial(editor, covSurgery, "다시")).reason).toBe("duplicate");
      expect((await svc.findByCoverage(covSurgery))?.id).toBe(specialId);
    });

    it("목록 — 종류 · 소유 · 제목 · updated 만", async () => {
      const list = await svc.list();
      expect(list.map((d) => [d.kind, d.title])).toEqual([
        ["general", "알파Plus 보통약관"],
        ["special", "수술비 특별약관"],
      ]);
      expect(list[0]).not.toHaveProperty("tree");
    });

    it("보통약관 이름 수정 — 트리 제목도 같이 · 중복 거부", async () => {
      unwrap(await svc.createGeneral(editor, "임시"));
      const tmp = (await svc.list("general")).find((d) => d.title === "임시")!;
      expect(rejection(await svc.setTitle(editor, tmp.id, "알파Plus 보통약관")).reason).toBe("duplicate");
      const g = unwrap(await svc.setTitle(editor, tmp.id, "베타 보통약관"));
      expect(g.tree.title).toBe("베타 보통약관");
    });
  });

  describe("문면작성 S1~S3 — 트리 커맨드 적용 = 저장 시 validateTree + 식 검사", () => {
    it("보통약관에 조·항 작성 → 저장되고 다시 읽힌다", async () => {
      const gApply = b.article("준용규정", [b.paragraph([b.text("이 약관에서 정하지 않은 사항은 관계 법령을 따릅니다.")])]);
      gArtApply = gApply.id;
      const cmds: Command[] = [
        { type: "insert", node: b.article("용어의 정의", [b.paragraph([b.text("용어의 정의")])]), at: { parentId: (await svc.get(generalId))!.tree.id } },
        { type: "insert", node: gApply, at: { parentId: (await svc.get(generalId))!.tree.id } },
      ];
      const g = unwrap(await svc.apply(editor, generalId, cmds));
      expect(g.tree.children.map((c) => c.kind)).toEqual(["article", "article"]);
      expect((await svc.get(generalId))?.tree).toEqual(g.tree);
    });

    it("담보약관에 조 · 인라인 조건 · const 슬롯 · 조 자리 조건 블록 작성", async () => {
      const root = (await svc.get(specialId))!.tree.id;
      const pay = b.article("보험금의 지급사유", [
        b.paragraph([
          b.text("회사는 피보험자가 "),
          b.inlineCond([b.inlineBranch("D0001 = true", [b.text("최초계약일")]), b.inlineBranch(undefined, [b.text("계약일")])]),
          b.text(" 이후 평균공시이율 "),
          b.slot("D0004"),
        ]),
      ]);
      artPay = pay.id;
      const term = b.condBlock([b.branch("D0001 = true", [b.article("보험기간", [b.paragraph([b.text("갱신형")])])])]);
      const s = unwrap(
        await svc.apply(editor, specialId, [
          { type: "insert", node: pay, at: { parentId: root } },
          { type: "insert", node: term, at: { parentId: root } },
        ]),
      );
      expect(s.tree.children.map((c) => c.kind)).toEqual(["article", "condBlock"]);
    });

    it("문법 오류 조건식 · boolean 아닌 조건식 · 없는 구분자 슬롯 → invalid, 저장 안 됨", async () => {
      const root = (await svc.get(specialId))!.tree.id;
      const before = (await svc.get(specialId))!.tree;
      for (const node of [
        b.condBlock([b.branch("D0001 = = true", [b.article("x", [])])]),
        b.condBlock([b.branch("D0004", [b.article("x", [])])]),
        b.article("x", [b.paragraph([b.slot("D0099")])]),
      ]) {
        const r = await svc.apply(editor, specialId, [{ type: "insert", node, at: { parentId: root } }]);
        expect(rejection(r).reason).toBe("invalid");
      }
      expect((await svc.get(specialId))!.tree).toEqual(before);
    });

    it("허용 자식 위반은 커맨드 단계에서 거부된다 (문서 아래 항)", async () => {
      const root = (await svc.get(specialId))!.tree.id;
      const r = await svc.apply(editor, specialId, [{ type: "insert", node: b.paragraph([]), at: { parentId: root } }]);
      const rej = rejection(r);
      expect(rej.reason).toBe("invalid");
      if (rej.reason === "invalid") expect(rej.issues[0].kind).toBe("structure");
    });

    it("번호 계산 · 참조 목록 · 요구 구분자 조회", async () => {
      const numbers = await svc.numbering(specialId);
      expect(numbers.get(artPay)?.label).toBe("제1조");
      const refs = await svc.refs(specialId);
      expect(refs.map((r) => r.kind)).toEqual(["discriminator", "discriminator", "discriminator"]);
      expect(refs[0].at).toMatchObject({ document: "special", ownerId: covSurgery, documentId: specialId });
      expect(await svc.requiredDiscriminators(specialId)).toEqual(["D0001", "D0004"]);
    });
  });

  describe("노드 한정자 @노드 — 담보 약관은 문맥 담보 트리로 검증 (ADR-0066 §2 §3)", () => {
    it("세부보장 노드 id 는 통과, 없는 id 는 brokenRef", async () => {
      const coverageSvc = createCoverageService(t.db);
      const coverage = unwrap(await coverageSvc.create(editor, { name: "노드한정자테스트", subCoverageName: "세부보장A", benefitName: "급부A" }));
      const subCoverageId = coverage.subCoverages[0].id;
      const disc = unwrap(await createCatalogService(t.db).create(editor, { label: "한정자테스트", level: "subCoverage", expression: "any(pay.exempt)" }));
      const doc = unwrap(await svc.createSpecial(editor, coverage.id, "노드한정자 특별약관"));
      const root = doc.tree.id;

      const okBranch = b.condBlock([b.branch(`${disc.code}@${subCoverageId} = true`, [b.article("x", [])])]);
      const saved = unwrap(await svc.apply(editor, doc.id, [{ type: "insert", node: okBranch, at: { parentId: root } }]));
      expect(saved.tree.children.map((c) => c.kind)).toEqual(["condBlock"]);

      const brokenBranch = b.condBlock([b.branch(`${disc.code}@nope = true`, [b.article("y", [])])]);
      const rej = rejection(await svc.apply(editor, doc.id, [{ type: "insert", node: brokenBranch, at: { parentId: root } }]));
      if (rej.reason !== "invalid") throw new Error("invalid 기대");
      expect(rej.issues[0].kind).toBe("brokenRef");
    });
  });

  describe("문면작성 S5 — 함수조항 참조 (게이트 주입 · 옵션 미선택은 저장 오류 · 기능/함수조항 §3.2)", () => {
    it("없는 함수조항 → 삽입 실패 · 옵션 미선택 → optionUnselected 저장 오류 · 선택하면 저장", async () => {
      const root = (await svc.get(specialId))!.tree.id;
      const lapse = b.article("특별약관의 소멸", [b.clauseBlock("C001", {})]);
      expect(rejection(await svc.apply(editor, specialId, [{ type: "insert", node: b.article("x", [b.clauseBlock("C999", {})]), at: { parentId: root } }])).reason).toBe("invalid");
      const r = await svc.apply(editor, specialId, [{ type: "insert", node: lapse, at: { parentId: root } }]);
      const rej = rejection(r);
      if (rej.reason !== "invalid") throw new Error("invalid 기대");
      expect(rej.issues[0].kind).toBe("optionUnselected");
      const saved = unwrap(
        await svc.apply(editor, specialId, [
          { type: "insert", node: lapse, at: { parentId: root } },
          { type: "setClauseOptions", nodeId: lapse.children[0].id, options: { tone: "death" } },
        ]),
      );
      expect(saved.tree.children).toHaveLength(3);
      expect(await svc.requiredDiscriminators(specialId)).toEqual(["D0001", "D0004"]); // C001 의 요구 D0001 은 이미 포함
    });
  });

  describe("검사 ② (a) — 요구 구분자가 카탈로그에 없으면 참조 추가 미성립 (기능/함수조항 §3.4)", () => {
    it("게이트가 없는 요구 구분자를 보고하면 옵션을 다 골랐어도 삽입이 brokenRef 로 거부된다 · 문서는 그대로", async () => {
      // C001 이 읽는 D0099 가 카탈로그에서 사라진 상황을 게이트로 흉내 낸다 (구분자 삭제 뒤 참조 추가 시도).
      const dangling: ClauseGate = { ...gate, missingRequired: (c) => (c === "C001" ? ["D0099"] : []) };
      const strict = createDocumentService(t.db, { clauseGate: async () => dangling });
      const before = (await svc.get(specialId))!.tree;
      const rej = rejection(await strict.apply(editor, specialId, [{ type: "insert", node: b.article("x", [b.clauseBlock("C001", { tone: "death" })]), at: { parentId: before.id } }]));
      if (rej.reason !== "invalid") throw new Error("invalid 기대");
      expect(rej.issues.map((i) => i.kind)).toEqual(["brokenRef"]);
      expect(rej.issues[0].message).toBe("함수조항 C001 의 요구 구분자 D0099 이(가) 카탈로그에 없습니다 — 참조 추가 미성립");
      expect(rej.issues[0].at).toMatchObject({ document: "special", ownerId: covSurgery, refPath: "D0099" });
      expect((await svc.get(specialId))!.tree).toEqual(before);
    });
  });

  describe("옵션 미결정 수 — 담보 마스터 경고의 재료 (기능/담보 §3.5)", () => {
    it("정의에 옵션이 늘어 미선택이 된 참조는 1, 고른 상태면 0", async () => {
      // 저장은 미선택을 거부하므로(기능/공용조항 §3.2) 미결정은 「저장 뒤 정의에 옵션이 늘었을 때」만 생긴다.
      // C001 정의에 옵션 mood 가 추가된 상황을 게이트로 흉내 낸다.
      const stricter: ClauseGate = {
        ...gate,
        validateOptions: (_c, o) => (o.mood === undefined ? [{ kind: "optionUnselected", message: "옵션 mood 미선택", at: {} }] : []),
      };
      const strict = createDocumentService(t.db, { clauseGate: async () => stricter });
      expect(await strict.unresolvedOptionCount(specialId)).toBe(1);
      expect(await svc.unresolvedOptionCount(specialId)).toBe(0); // tone 을 고른 원래 정의로는 미결정 없음
      expect(await svc.unresolvedOptionCount("99999999-9999-4999-8999-999999999999")).toBe(0); // 없는 문서
    });
  });

  describe("문면작성 S4 · S6 — 대응 보통약관 지정 · 조연결 · 보통약관 조 참조 · 별표", () => {
    it("대응 보통약관 미지정이면 조연결·보통약관 조 참조는 brokenRef", async () => {
      const root = (await svc.get(specialId))!.tree.id;
      const apply = b.article("준용규정", [b.paragraph([b.text("보통약관 "), b.articleRef(gArtApply, "general")])]);
      artApply = apply.id;
      const r = await svc.apply(editor, specialId, [{ type: "insert", node: apply, at: { parentId: root } }]);
      const rej = rejection(r);
      if (rej.reason !== "invalid") throw new Error("invalid 기대");
      expect(rej.issues[0].kind).toBe("brokenRef");
    });

    it("대응 보통약관 지정 → 조 참조·조연결이 그 마스터의 조로 검증된다 (D-P4-5)", async () => {
      expect(rejection(await svc.setGeneralDocument(editor, specialId, specialId)).reason).toBe("invalid"); // 보통약관이 아님
      expect(rejection(await svc.setGeneralDocument(editor, generalId, generalId)).reason).toBe("invalid"); // 보통약관 문서에는 지정 불가
      unwrap(await svc.setGeneralDocument(editor, specialId, generalId));
      const root = (await svc.get(specialId))!.tree.id;
      const apply = b.article("준용규정", [b.paragraph([b.text("보통약관 "), b.articleRef(gArtApply, "general")])]);
      artApply = apply.id;
      const s = unwrap(
        await svc.apply(editor, specialId, [
          { type: "insert", node: apply, at: { parentId: root } },
          { type: "link", articleId: artApply, linkedArticleId: gArtApply },
        ]),
      );
      const linked = s.tree.children.find((c) => c.id === artApply);
      expect(linked).toMatchObject({ linkedArticleId: gArtApply });
      expect(rejection(await svc.apply(editor, specialId, [{ type: "link", articleId: artApply, linkedArticleId: "ghost" }])).reason).toBe("invalid");
    });

    it("조연결이 남아 있으면 대응 보통약관 해제 불가", async () => {
      expect(rejection(await svc.setGeneralDocument(editor, specialId, undefined)).reason).toBe("invalid");
    });

    it("별표 등록(코드 시스템 채번 AX000001) · 별표 참조 슬롯은 마스터 코드로 검증", async () => {
      expect(unwrap(await svc.createAppendix(editor, { name: "화상 분류표" })).code).toBe("AX000001");
      expect(rejection(await svc.createAppendix(editor, { name: " " })).reason).toBe("invalid");
      unwrap(await svc.renameAppendix(editor, "AX000001", "화상분류표"));
      expect((await svc.listAppendices()).map((a) => [a.code, a.name])).toEqual([["AX000001", "화상분류표"]]);

      const root = (await svc.get(specialId))!.tree.id;
      expect(rejection(await svc.apply(editor, specialId, [{ type: "insert", node: b.article("x", [b.paragraph([b.appendixRef("AX000099")])]), at: { parentId: root } }])).reason).toBe("invalid");
      unwrap(await svc.apply(editor, specialId, [{ type: "insert", node: b.article("별표 참조", [b.paragraph([b.appendixRef("AX000001")])]), at: { parentId: root } }]));
      const usages = await svc.appendixUsages("AX000001");
      expect(usages).toHaveLength(1);
      expect(usages[0]).toMatchObject({ document: "special", ownerId: covSurgery, articleTitle: "별표 참조" });
    });

    it("박스 생성(코드 시스템 채번 BX000001) · 이름 중복 거부 · 저장 한 번 · 박스 참조는 정적 마스터 코드로 검증", async () => {
      expect(unwrap(await svc.createBox(editor, { name: "【용어풀이】 보험연도", title: "보험연도", lines: ["보험연도란 …"] })).code).toBe("BX000001");
      expect(rejection(await svc.createBox(editor, { name: "【용어풀이】 보험연도", lines: ["x"] })).reason).toBe("invalid");
      expect(rejection(await svc.createBox(editor, { name: "빈 박스", lines: [] })).reason).toBe("invalid");
      unwrap(await svc.saveBox(editor, "BX000001", { name: "보험연도", title: "보험연도", lines: ["보험연도란", "계약일부터 1년"] }));
      expect(await svc.getBox("BX000001")).toEqual({ code: "BX000001", name: "보험연도", title: "보험연도", lines: ["보험연도란", "계약일부터 1년"] });
      expect((await svc.listBoxes()).map((x) => x.code)).toEqual(["BX000001"]);

      const root = (await svc.get(specialId))!.tree.id;
      expect(rejection(await svc.apply(editor, specialId, [{ type: "insert", node: b.article("x", [b.paragraph([b.text("x")]), b.boxRef("BX000099")]), at: { parentId: root } }])).reason).toBe("invalid");
      unwrap(await svc.apply(editor, specialId, [{ type: "insert", node: b.article("박스 참조", [b.paragraph([b.text("본문")]), b.boxRef("BX000001")]), at: { parentId: root } }]));
      const usages = await svc.boxUsages("BX000001");
      expect(usages).toHaveLength(1);
      expect(usages[0]).toMatchObject({ document: "special", ownerId: covSurgery, articleTitle: "박스 참조" });
    });

    it("별표 삭제는 파괴적 — 편집자 forbidden · 관리자 1차 needsConfirmation(사용처) · confirm 후 삭제", async () => {
      expect(rejection(await svc.removeAppendix(editor, "AX000001")).reason).toBe("forbidden");
      const first = await svc.removeAppendix(admin, "AX000001");
      const rej = rejection(first);
      if (rej.reason !== "needsConfirmation") throw new Error("needsConfirmation 기대");
      expect(rej.impact.brokenRefs).toHaveLength(1);
      unwrap(await svc.removeAppendix(admin, "AX000001", { confirm: true }));
      expect(await svc.getAppendix("AX000001")).toBeUndefined();
      // 깨진 참조는 오류 상태로 남는다 — 저장 검증이 드러낸다
      expect((await svc.validate(specialId)).map((i) => i.kind)).toEqual(["brokenRef"]);
    });

    it("박스 삭제는 파괴적 — 편집자 forbidden · 관리자 1차 needsConfirmation(사용처 목록) · confirm 후 삭제, 참조는 깨진 참조로 남는다", async () => {
      expect(rejection(await svc.removeBox(editor, "BX000001")).reason).toBe("forbidden");
      const rej = rejection(await svc.removeBox(admin, "BX000001"));
      if (rej.reason !== "needsConfirmation") throw new Error("needsConfirmation 기대");
      expect(rej.impact.brokenRefs.map((c) => c.articleTitle)).toEqual(["박스 참조"]);
      unwrap(await svc.removeBox(admin, "BX000001", { confirm: true }));
      expect(await svc.getBox("BX000001")).toBeUndefined();
      expect((await svc.validate(specialId)).filter((i) => i.message.includes("BX000001")).map((i) => i.kind)).toEqual(["brokenRef"]);
    });
  });

  describe("사전평가 S1·S3 — 문맥 주입", () => {
    it("담보 마스터 문맥(D0001=false)으로 갱신형 가지 notTaken, 슬롯 값 실림", async () => {
      const r = await svc.preEvaluate(specialId, masterCtx);
      const states = [...r.branches.values()].map((s) => s.state);
      expect(states).toEqual(["notTaken", "taken", "notTaken"]);
      expect([...r.slots.values()]).toEqual([{ kind: "value", value: "2.5%" }]);
      const numbers = await svc.numbering(specialId, r.branches);
      expect(numbers.get(artPay)?.label).toBe("제1조");
      expect(numbers.get(artApply)?.label).toBe("제3조"); // 보험기간 조가 빠져 당겨진다
    });
  });

  describe("문서 복제 (D-P4-4) · 삭제 (파괴적)", () => {
    it("보통약관 벌 복제 — 새 이름, 새 노드 id · 담보약관 복제 — 문면 없는 담보로", async () => {
      const g2 = unwrap(await svc.duplicate(editor, generalId, { title: "알파Plus 보통약관 (2벌)" }));
      expect(g2.tree.children).toHaveLength(2);
      expect(g2.tree.id).not.toBe((await svc.get(generalId))!.tree.id);
      expect(rejection(await svc.duplicate(editor, generalId, { title: "알파Plus 보통약관" })).reason).toBe("duplicate");
      const s2 = unwrap(await svc.duplicate(editor, specialId, { coverageId: covDeath, title: "사망 특별약관" }));
      expect(s2.ownerId).toBe(covDeath);
      expect(s2.generalDocumentId).toBe(generalId);
      expect(rejection(await svc.duplicate(editor, specialId, { coverageId: covDeath, title: "x" })).reason).toBe("duplicate");
    });

    it("문서 삭제 — 편집자 forbidden · 관리자는 사용처(담보약관이 지정·조연결 중) 확인 후 삭제", async () => {
      expect(rejection(await svc.remove(editor, generalId)).reason).toBe("forbidden");
      const first = await svc.remove(admin, generalId);
      const rej = rejection(first);
      if (rej.reason !== "needsConfirmation") throw new Error("needsConfirmation 기대");
      expect(rej.impact.brokenRefs.length).toBeGreaterThan(0);
      unwrap(await svc.remove(admin, generalId, { confirm: true }));
      expect(await svc.get(generalId)).toBeUndefined();
      expect(await svc.remove(admin, generalId, { confirm: true })).toEqual({ ok: false, rejection: { reason: "notFound", what: `문서 ${generalId}` } });
    });
  });
});

describe("importTree — 트리 통째 적재 (시드 · E2E)", () => {
  it("앞 조가 뒤 조를 가리키는 트리를 한 번에 넣고 전체 검증한다 — 루트 id·제목은 문서 것을 유지", async () => {
    const t = await createTestDb();
    const svc = createDocumentService(t.db);
    const g = unwrap(await svc.createGeneral(editor, "가져오기 보통약관"));
    const tree: DocumentNode = {
      id: "x-doc",
      kind: "document",
      title: "무시되는 제목",
      children: [
        { id: "x-s1", kind: "section", title: "목적", children: [{ id: "x-a1", kind: "article", title: "목적", children: [{ id: "x-a1-p1", kind: "paragraph", children: [{ id: "x-a1-p1-r", kind: "articleRef", targets: [{ nodeId: "x-a2" }], connector: "및", scope: "self" }] }] }] },
        { id: "x-s2", kind: "section", title: "지급", children: [{ id: "x-a2", kind: "article", title: "지급", children: [{ id: "x-a2-p1", kind: "paragraph", children: [{ id: "x-a2-p1-t", kind: "text", text: "본문" }] }] }] },
      ],
    };
    const saved = unwrap(await svc.importTree(editor, g.id, tree));
    expect(saved.tree.id).toBe(g.tree.id);
    expect(saved.tree.title).toBe("가져오기 보통약관");
    expect(saved.tree.children.map((c) => c.id)).toEqual(["x-s1", "x-s2"]);
    await t.close();
  });

  it("깨진 참조가 있는 트리는 거부한다", async () => {
    const t = await createTestDb();
    const svc = createDocumentService(t.db);
    const g = unwrap(await svc.createGeneral(editor, "깨진 보통약관"));
    const r = await svc.importTree(editor, g.id, {
      id: "y-doc",
      kind: "document",
      title: "y",
      children: [{ id: "y-a1", kind: "article", title: "a", children: [{ id: "y-p", kind: "paragraph", children: [{ id: "y-r", kind: "articleRef", targets: [{ nodeId: "없음" }], connector: "및", scope: "self" }] }] }],
    });
    expect(rejection(r).reason).toBe("invalid");
    await t.close();
  });
});
