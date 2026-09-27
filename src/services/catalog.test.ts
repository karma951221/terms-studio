import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ImpactSource, ImpactTarget } from "@/domain/catalog";
import type { Actor } from "@/domain/types";

import { nodeBuilders } from "@/domain/document";

import { insertDocument } from "@/db/repo/document";
import { createTestDb, type TestDb } from "@/db/test-utils";
import { createCatalogService, type CatalogService } from "./catalog";
import { loadGraph } from "./refs";

const admin: Actor = { userId: "00000000-0000-4000-8000-000000000001", role: "admin" };
const editor: Actor = { userId: "00000000-0000-4000-8000-000000000002", role: "editor" };

function unwrap<T>(r: { ok: true; value: T } | { ok: false; rejection: unknown }): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

/** 값 저장소 흉내 — 대상별 값 행 수를 미리 정해 두고, purge 호출을 기록한다. */
function fakeValueStore(counts: Record<string, number>) {
  const purged: ImpactTarget[] = [];
  const key = (t: ImpactTarget) => JSON.stringify(t);
  const source: ImpactSource = {
    countValueRows: async (t) => counts[key(t)] ?? 0,
    findBrokenRefs: async (t) =>
      t.kind === "discriminator" ? [{ document: "special", ownerName: "일반상해사망", refPath: t.code }] : [],
    purgeValueRows: async (t) => {
      purged.push(t);
    },
  };
  return { source, purged };
}

describe("catalog 서비스 (PGlite)", () => {
  let t: TestDb;
  let svc: CatalogService;
  const store = fakeValueStore({
    [JSON.stringify({ kind: "enumValue", enumCode: "E0001", valueCode: "V02" })]: 3,
    [JSON.stringify({ kind: "enum", enumCode: "E0001" })]: 7,
  });

  beforeAll(async () => {
    t = await createTestDb();
    svc = createCatalogService(t.db, { impact: store.source });
  });
  afterAll(async () => {
    await t.close();
  });

  describe("구분자정의 S1 — 채번 · 조회 · 표시명 변경", () => {
    it("편집자가 담보 레벨 「담보명」을 채번하면 D0001 을 받는다", async () => {
      const def = unwrap(
        await svc.create(editor, { label: "담보명", level: "coverage", expression: "coverage_basic.claim_name" }),
      );
      expect(def).toMatchObject({ code: "D0001", level: "coverage", expression: "coverage_basic.claim_name" });
      expect(await svc.get("D0001")).toEqual(def);
    });

    it("같은 레벨 표시명 중복은 DB 상태 기준으로 거부된다 (D-P1-1)", async () => {
      const r = await svc.create(editor, { label: "담보명", level: "coverage", expression: "coverage_basic.claim_name" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.rejection.reason).toBe("duplicate");
    });

    it("표시명 변경은 편집자도 자유 — 코드 불변, 저장된다", async () => {
      const r = unwrap(await svc.rename(editor, "D0001", "보험금 이름"));
      expect(r.code).toBe("D0001");
      expect((await svc.get("D0001"))?.label).toBe("보험금 이름");
    });

    it("없는 코드는 notFound", async () => {
      expect(await svc.rename(editor, "D9999", "x")).toEqual({ ok: false, rejection: { reason: "notFound", what: "구분자 D9999" } });
      expect(await svc.get("D9999")).toBeUndefined();
    });

    it("만든 사람·고친 사람이 기록된다 (created_by · updated_by)", async () => {
      const audit = await svc.audit("D0001");
      expect(audit?.createdBy).toBe(editor.userId);
      expect(audit?.updatedBy).toBe(editor.userId);
    });
  });

  describe("구분자정의 S2 — enum 정의와 값 추가 · 값 삭제(파괴적)", () => {
    it("enum 「고지유형」 E0001 + 값 V01·V02 등록", async () => {
      const e = unwrap(await svc.createEnum(editor, { label: "고지유형", values: [{ label: "일반심사" }, { label: "간편심사" }] }));
      expect(e.code).toBe("E0001");
      expect(e.values.map((v) => v.code)).toEqual(["V01", "V02"]);
      expect(await svc.getEnum("E0001")).toEqual(e);
    });

    it("값 추가 · 값 표시명 변경은 편집자 자유", async () => {
      const e = unwrap(await svc.addEnumValue(editor, "E0001", { label: "건강고지" }));
      expect(e.values[2]).toMatchObject({ code: "V03", label: "건강고지" });
      const e2 = unwrap(await svc.renameEnumValue(editor, "E0001", "V02", "간편고지심사"));
      expect(e2.values[1].label).toBe("간편고지심사");
      expect((await svc.getEnum("E0001"))?.values[1].label).toBe("간편고지심사");
    });

    it("enum 값 삭제 — 편집자는 forbidden, 관리자는 영향(값 행 3) 확인 후 삭제 + 값 행 purge", async () => {
      const denied = await svc.removeEnumValue(editor, "E0001", "V02");
      expect(denied).toEqual({ ok: false, rejection: { reason: "forbidden", role: "editor", action: "enum.deleteValue" } });

      const first = await svc.removeEnumValue(admin, "E0001", "V02");
      expect(first.ok).toBe(false);
      if (!first.ok && first.rejection.reason === "needsConfirmation") {
        expect(first.rejection.impact.valueRowsLost).toBe(3);
      } else throw new Error("needsConfirmation 기대");
      expect((await svc.getEnum("E0001"))?.values).toHaveLength(3);

      const done = unwrap(await svc.removeEnumValue(admin, "E0001", "V02", { confirm: true }));
      expect(done.values.map((v) => v.code)).toEqual(["V01", "V03"]);
      expect(store.purged).toContainEqual({ kind: "enumValue", enumCode: "E0001", valueCode: "V02" });
    });

    it("삭제된 값의 순번은 재사용하지 않는다 — 다음 값은 V04", async () => {
      const e = unwrap(await svc.addEnumValue(editor, "E0001", { label: "재추가" }));
      expect(e.values.at(-1)?.code).toBe("V04");
    });
  });

  describe("구분자정의 — 식은 저장 시 검증한다 (ADR-0037)", () => {
    it("집계 구분자를 채번하고 식을 고친다 — 둘 다 편집자 가능 (D-P1-12)", async () => {
      const def = unwrap(
        await svc.create(editor, { label: "면책구분", level: "coverage", expression: "any(pay.exempt)" }),
      );
      expect(def.code).toBe("D0002");
      const upd = unwrap(await svc.setExpression(editor, "D0002", "all(pay.exempt)"));
      expect(upd.expression).toBe("all(pay.exempt)");
      expect(await svc.get("D0002")).toEqual(upd);
    });

    it("항등 투영은 허용한다 — 필드를 문면에 내는 유일한 길 (ADR-0036 §2)", async () => {
      expect((await svc.create(editor, { label: "담보명투영", level: "coverage", expression: "coverage_basic.claim_name" })).ok).toBe(true);
    });

    it("구분자 → 구분자 참조 — 같은 레벨은 허용, 상위 · 자기 참조 · 순환은 거부 (기능/구분자 §3.2)", async () => {
      // 저장 전 검사(편집기)도 카탈로그를 읽어 참조를 푼다
      expect((await svc.checkExpression("D0001 ≠ '' and D0002", "coverage")).ok).toBe(true);
      expect((await svc.checkExpression("D0001 = true", "coverage")).ok).toBe(false); // string = boolean
      // 상위 레벨(담보) 구분자를 급부 레벨에서 — 거부
      expect((await svc.create(editor, { label: "상위참조", level: "benefit", expression: "D0002" })).ok).toBe(false);
      // 자기 참조 — 거부
      expect((await svc.setExpression(editor, "D0002", "D0002 and all(pay.exempt)")).ok).toBe(false);
      // 순환 — D0003 → D0002 를 만든 뒤 D0002 → D0003 은 거부
      expect((await svc.setExpression(editor, "D0003", "D0002 = true")).ok).toBe(true);
      expect((await svc.setExpression(editor, "D0002", "not D0003")).ok).toBe(false);
      expect((await svc.get("D0002"))?.expression).toBe("all(pay.exempt)"); // 원본 그대로
      // 참조받는 쪽을 고쳐 참조하는 쪽이 깨지면 거부 — D0003 = `D0002 = true` 인데 D0002 가 string 이 되면 비교가 깨진다
      // (코덱스 리뷰 2026-09-14 Important-1: 저장 경로가 역방향 사용처를 재검사한다)
      const broken = await svc.setExpression(editor, "D0002", "coverage_basic.claim_name");
      expect(broken.ok).toBe(false);
      if (!broken.ok && broken.rejection.reason === "invalid") expect(broken.rejection.issues[0].message).toContain("D0003");
      expect((await svc.get("D0002"))?.expression).toBe("all(pay.exempt)");
      // 투영으로 되돌린다 (다른 시나리오의 전제)
      unwrap(await svc.setExpression(editor, "D0003", "coverage_basic.claim_name"));
    });

    it("하위 레벨 자리를 집계 없이 부르면 거부한다", async () => {
      expect((await svc.create(editor, { label: "직접", level: "coverage", expression: "pay.exempt" })).ok).toBe(false);
    });

    it("담보속성 유효값을 주입하면 리터럴을 그 목록으로 검사한다", async () => {
      const strict = createCatalogService(t.db, {
        impact: store.source,
        attributeValues: async () => (code) => (code === "A0001" ? ["V01"] : undefined),
      });
      expect((await strict.create(editor, { label: "갱신", level: "coverage", expression: "attr.A0001 = 'V09'" })).ok).toBe(false);
      expect((await strict.checkExpression("attr.A0001 = 'V01'", "coverage")).ok).toBe(true);
    });
  });

  describe("구분자정의 S6 — 삭제 (관리자 · 2단)", () => {
    it("구분자 삭제 — 영향에 문면 사용처가 실리고 confirm 후 사라진다. 값 행은 없다 (식이라서)", async () => {
      expect((await svc.remove(editor, "D0002")).ok).toBe(false);
      const first = await svc.remove(admin, "D0002");
      if (first.ok || first.rejection.reason !== "needsConfirmation") throw new Error("needsConfirmation 기대");
      expect(first.rejection.impact.cascade).toEqual([]);
      expect(first.rejection.impact.valueRowsLost).toBe(0);
      expect(first.rejection.impact.brokenRefs[0]).toMatchObject({ refPath: "D0002" });
      unwrap(await svc.remove(admin, "D0002", { confirm: true }));
      expect(await svc.get("D0002")).toBeUndefined();
      expect(store.purged).toContainEqual({ kind: "discriminator", code: "D0002" });
    });

    it("삭제된 구분자 코드는 재사용되지 않는다 — 다음 채번은 D0004", async () => {
      const def = unwrap(await svc.create(editor, { label: "새것", level: "plan", expression: "waiver.applies" }));
      expect(def.code).toBe("D0004");
    });

    it("없는 구분자 삭제는 관리자에게도 notFound (영향 계산 전)", async () => {
      expect(await svc.remove(admin, "D9999")).toEqual({ ok: false, rejection: { reason: "notFound", what: "구분자 D9999" } });
    });

    it("enum 삭제 — 그 enum 을 타입으로 쓰는 마스터 자리가 깨질 참조로, 값들이 cascade 로 보인다", async () => {
      const first = await svc.removeEnum(admin, "E0001");
      if (first.ok || first.rejection.reason !== "needsConfirmation") throw new Error("needsConfirmation 기대");
      // MVP 마스터에서 E0001 을 쓰는 자리는 세목 · 납입면제 › 납입면제사유 하나다
      expect(first.rejection.impact.brokenRefs.map((r) => r.refPath)).toEqual(["waiver.reasons"]);
      expect(first.rejection.impact.cascade).toHaveLength(3);
      expect(first.rejection.impact.valueRowsLost).toBe(7);
      unwrap(await svc.removeEnum(admin, "E0001", { confirm: true }));
      expect(await svc.getEnum("E0001")).toBeUndefined();
      expect(await svc.listEnums()).toEqual([]);
    });

    it("목록 조회는 코드 순", async () => {
      const codes = (await svc.list()).map((d) => d.code);
      expect(codes).toEqual(["D0001", "D0003", "D0004"]);
    });
  });

  describe("구분자정의 — 명시 결과 타입 (기능/구분자 §3.1)", () => {
    it("resultType 을 주고 채번하면 조회에 그대로 실린다 — 없으면 키가 없다 (toEqual)", async () => {
      const withType = unwrap(
        await svc.create(editor, { label: "감액여부투영", level: "benefit", expression: "exist(reduction.periods)", resultType: { kind: "boolean" } }),
      );
      expect(withType.resultType).toEqual({ kind: "boolean" });
      expect(await svc.get(withType.code)).toEqual(withType);

      const withoutType = unwrap(
        await svc.create(editor, { label: "감액신규만투영", level: "benefit", expression: "reduction.new_only" }),
      );
      expect(withoutType).not.toHaveProperty("resultType");
      expect(await svc.get(withoutType.code)).toEqual(withoutType);
    });

    it("식과 다른 kind 를 명시하면 invalid + typeMismatch", async () => {
      const r = await svc.create(editor, {
        label: "타입불일치",
        level: "benefit",
        expression: "reduction.new_only", // boolean
        resultType: { kind: "number" },
      });
      expect(r.ok).toBe(false);
      if (!r.ok && r.rejection.reason === "invalid") expect(r.rejection.issues[0].kind).toBe("typeMismatch");
      else throw new Error("invalid 기대");
    });

    it("setResultType — 맞는 타입은 저장되고, 틀린 타입은 invalid, undefined 는 키를 제거한다 (편집자도 가능)", async () => {
      const def = unwrap(await svc.create(editor, { label: "면책개월수투영", level: "benefit", expression: "exemption.months" }));
      expect(def).not.toHaveProperty("resultType");

      const wrong = await svc.setResultType(editor, def.code, { kind: "boolean" });
      expect(wrong.ok).toBe(false);
      expect(await svc.get(def.code)).toEqual(def);

      const right = unwrap(await svc.setResultType(editor, def.code, { kind: "number" }));
      expect(right.resultType).toEqual({ kind: "number" });
      expect(await svc.get(def.code)).toEqual(right);

      const cleared = unwrap(await svc.setResultType(editor, def.code, undefined));
      expect(cleared).not.toHaveProperty("resultType");
      expect(await svc.get(def.code)).toEqual(cleared);
    });

    it("setExpression 으로 명시 타입과 어긋나는 식을 넣으면 invalid — 원본은 그대로", async () => {
      const def = unwrap(
        await svc.create(editor, { label: "면책여부투영2", level: "benefit", expression: "reduction.new_only", resultType: { kind: "boolean" } }),
      );
      const r = await svc.setExpression(editor, def.code, "exemption.months"); // number
      expect(r.ok).toBe(false);
      expect(await svc.get(def.code)).toEqual(def);
    });
  });

  describe("기타 비파괴 변경", () => {
    it("설명 · enum 표시명 · enum 값 순서", async () => {
      const def = unwrap(await svc.setDescription(editor, "D0004", "설명"));
      expect(def).toMatchObject({ description: "설명" });
      expect(await svc.get("D0004")).toEqual(def);

      const e = unwrap(await svc.createEnum(editor, { label: "갱신유형", values: [{ label: "비갱신형" }, { label: "갱신형" }] }));
      expect(e.code).toBe("E0002");
      unwrap(await svc.renameEnum(editor, e.code, "갱신 유형"));
      const re = unwrap(await svc.reorderEnumValues(editor, e.code, ["V02", "V01"]));
      expect(re.label).toBe("갱신 유형");
      expect(re.values.map((v) => v.code)).toEqual(["V02", "V01"]);
      expect(await svc.getEnum(e.code)).toEqual(re);
      expect((await svc.createEnum(editor, { label: "갱신 유형" })).ok).toBe(false); // D-P1-7
    });
  });

  describe("저장 전 「검사」 — 오류 · 경고 · 깨질 사용처 (기능/구분자 §3.3 · M02-b)", () => {
    let inspecting: CatalogService;
    let slotted: string; // 문면 슬롯이 읽는 구분자 (string)
    let conditioned: string; // 문면 조건식이 읽는 구분자 (boolean)
    let dependent: string; // conditioned 를 참조하는 구분자
    let slotAt: { articleTitle?: string };

    beforeAll(async () => {
      inspecting = createCatalogService(t.db, { impact: store.source, graph: () => loadGraph(t.db) });
      slotted = unwrap(await svc.create(editor, { label: "검사슬롯", level: "coverage", expression: "coverage_basic.claim_name" })).code;
      conditioned = unwrap(await svc.create(editor, { label: "검사조건", level: "coverage", expression: "any(pay.exempt)" })).code;
      dependent = unwrap(await svc.create(editor, { label: "검사의존", level: "coverage", expression: `${conditioned} and all(pay.exempt)` })).code;
      const b = nodeBuilders();
      const art = b.article("검사 대상 조", [b.paragraph([b.text("이름 "), b.slot(slotted)])]);
      const cond = b.condBlock([b.branch(`${conditioned} = true`, [b.article("조건부 조", [b.paragraph([b.text("면책")])])])]);
      await insertDocument(t.db, { kind: "general", title: "검사용 보통약관", tree: b.document("검사용 보통약관", [art, cond]) }, editor.userId);
      slotAt = { articleTitle: "검사 대상 조" };
    });

    it("code 없이(생성) — 오류 · 경고 · 추론만, breaks 는 빈 배열", async () => {
      const r = await inspecting.inspect({ expression: "coverage_basic.claim_name", level: "coverage" });
      expect(r.errors).toEqual([]);
      expect(r.warnings.map((i) => i.kind)).toEqual(["alias"]);
      expect(r.inferred).toEqual({ kind: "string" });
      expect(r.breaks).toEqual([]);
    });

    it("슬롯이 읽는 구분자의 식을 boolean 으로 바꾸면 — 슬롯 사용처가 깨진다는 경고 (at = 사용처 · source = 구분자)", async () => {
      const r = await inspecting.inspect({ code: slotted, expression: "any(pay.exempt)", level: "coverage" });
      expect(r.errors).toEqual([]);
      expect(r.breaks).toHaveLength(1);
      expect(r.breaks[0]).toMatchObject({
        kind: "typeMismatch",
        severity: "warning",
        at: expect.objectContaining({ document: "general", ...slotAt, refPath: slotted }),
        source: { document: "catalog", ownerId: slotted, ownerName: "검사슬롯" },
      });
      expect(r.breaks[0].message).toContain("슬롯 사용처");
      expect(r.breaks[0].message).toContain("string·enum 만 허용");
      // warnings 에도 같이 실린다 — 배지 · 경고 목록이 한 번에 본다
      expect(r.warnings).toEqual(expect.arrayContaining(r.breaks));
    });

    it("명시 타입이 있으면 슬롯 규칙은 그것을 본다 (기능/구분자 §3.1) — 식은 string 이어도 명시가 boolean 이면 깨진다", async () => {
      const r = await inspecting.inspect({ code: slotted, expression: "coverage_basic.claim_name", level: "coverage", resultType: { kind: "boolean" } });
      expect(r.errors.map((i) => i.kind)).toEqual(["typeMismatch"]); // 명시 ≠ 추론
      expect(r.breaks.map((i) => i.message)).toEqual([expect.stringContaining("슬롯 사용처")]);
    });

    it("타입이 그대로면 사용처는 깨지지 않는다 — 식만 바꿔도 경고 없음", async () => {
      const r = await inspecting.inspect({ code: slotted, expression: "coverage_basic.claim_name ≠ '' and false or coverage_basic.claim_name = 'x'", level: "coverage" });
      // 위 식은 boolean 이라 깨진다 — 같은 타입인 식으로 다시
      expect(r.breaks).toHaveLength(1);
      const same = await inspecting.inspect({ code: slotted, expression: "builtin.coverage.name", level: "coverage" });
      expect(same.errors).toEqual([]);
      expect(same.breaks).toEqual([]);
    });

    it("조건식이 읽는 구분자의 타입이 바뀌면 — 조건식 사용처 경고 + 참조하는 구분자가 깨진다는 오류", async () => {
      const r = await inspecting.inspect({ code: conditioned, expression: "coverage_basic.claim_name", level: "coverage" });
      expect(r.breaks).toHaveLength(1);
      expect(r.breaks[0]).toMatchObject({ severity: "warning", at: expect.objectContaining({ document: "general", ownerName: "검사용 보통약관", refPath: conditioned }) });
      expect(r.breaks[0].message).toContain("조건식 사용처");
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0].message).toContain(dependent);
      expect(r.errors[0].at).toMatchObject({ document: "catalog", ownerId: dependent });
    });

    it("명시 타입 없는 구분자를 거쳐 닿는 슬롯 — 원천의 타입 변경이 그 구분자의 추론 타입을 바꾸면 경유 사용처도 깨진다는 경고 (ADR-0049 §2 「구분자 → 구분자 → 문면」)", async () => {
      const origin = unwrap(await svc.create(editor, { label: "경유원천", level: "coverage", expression: "coverage_basic.claim_name" })).code;
      const alias = unwrap(await svc.create(editor, { label: "경유별칭", level: "coverage", expression: origin })).code; // resultType 없음 — 추론 string
      const b = nodeBuilders();
      const art = b.article("경유 대상 조", [b.paragraph([b.text("별칭 "), b.slot(alias)])]);
      await insertDocument(t.db, { kind: "general", title: "경유용 보통약관", tree: b.document("경유용 보통약관", [art]) }, editor.userId);

      const r = await inspecting.inspect({ code: origin, expression: "any(pay.exempt)", level: "coverage" });
      expect(r.errors).toEqual([]); // 별칭의 식 자체는 여전히 유효 — checkDependents 는 명시 타입이 없어 못 잡는다
      expect(r.breaks).toHaveLength(1);
      expect(r.breaks[0]).toMatchObject({
        kind: "typeMismatch",
        severity: "warning",
        at: expect.objectContaining({ document: "general", articleTitle: "경유 대상 조", refPath: alias }),
        source: { document: "catalog", ownerId: origin, ownerName: "경유원천" },
      });
      expect(r.breaks[0].message).toContain("슬롯 사용처");
      expect(r.breaks[0].message).toContain(alias); // 거쳐 온 구분자를 문구에

      // 같은 타입이면 경유 사용처도 그대로 선다
      const same = await inspecting.inspect({ code: origin, expression: "builtin.coverage.name", level: "coverage" });
      expect(same.breaks).toEqual([]);
    });

    it("문법 오류면 사용처 판정은 하지 않는다 — 오류만", async () => {
      const r = await inspecting.inspect({ code: slotted, expression: "any(", level: "coverage" });
      expect(r.errors.map((i) => i.kind)).toEqual(["syntax"]);
      expect(r.breaks).toEqual([]);
      expect(r.inferred).toBeUndefined();
    });

    it("그래프를 주입하지 않은 서비스도 검사는 된다 — breaks 만 비어 있다", async () => {
      const r = await svc.inspect({ code: slotted, expression: "any(pay.exempt)", level: "coverage" });
      expect(r.errors).toEqual([]);
      expect(r.breaks).toEqual([]);
    });

    it("listWarnings — 별칭인 구분자만 코드 → 경고 목록으로", async () => {
      const map = await svc.listWarnings();
      expect(map.get(slotted)?.map((i) => i.kind)).toEqual(["alias"]);
      expect(map.has(conditioned)).toBe(false);
      expect(map.has(dependent)).toBe(false);
    });
  });
});

describe("catalog.reviseEnum — 열거형변수 편집 한 벌 저장 (점검 2026-09-27 H2 ① · D1 · D2)", () => {
  let t: TestDb;
  let svc: CatalogService;
  const store = fakeValueStore({
    [JSON.stringify({ kind: "enumValue", enumCode: "E0001", valueCode: "V01" })]: 2,
    [JSON.stringify({ kind: "enumValue", enumCode: "E0001", valueCode: "V02" })]: 5,
  });

  beforeAll(async () => {
    t = await createTestDb();
    svc = createCatalogService(t.db, { impact: store.source });
    unwrap(await svc.createEnum(editor, { label: "고지유형", values: [{ label: "일반" }, { label: "간편" }, { label: "건강" }] }));
  });
  afterAll(async () => {
    await t.close();
  });

  it("편집자: 이름 A↔B 맞바꾸기 + 새 값 + 순서가 한 번에 저장된다", async () => {
    const r = unwrap(
      await svc.reviseEnum(editor, "E0001", {
        label: "고지 유형",
        description: "메모",
        values: [{ label: "기타" }, { code: "V02", label: "일반" }, { code: "V01", label: "간편" }, { code: "V03", label: "건강" }],
      }),
    );
    expect(r.values.map((v) => [v.code, v.label])).toEqual([["V04", "기타"], ["V02", "일반"], ["V01", "간편"], ["V03", "건강"]]);
    expect(await svc.getEnum("E0001")).toEqual(r);
  });

  it("값을 빼면 — 편집자 forbidden · 관리자 1차는 빠진 값 전부의 영향을 합쳐 묻고 아무것도 안 바뀐다 · 순번도 안 탄다", async () => {
    const before = await svc.getEnum("E0001");
    const revision = { label: "고지유형2", description: "", values: [{ label: "새값" }, { code: "V03", label: "건강" }, { code: "V04", label: "기타" }] };
    expect(await svc.reviseEnum(editor, "E0001", revision)).toEqual({ ok: false, rejection: { reason: "forbidden", role: "editor", action: "enum.deleteValue" } });
    const first = await svc.reviseEnum(admin, "E0001", revision);
    if (first.ok || first.rejection.reason !== "needsConfirmation") throw new Error("needsConfirmation 기대");
    expect(first.rejection.impact.valueRowsLost).toBe(7); // V01 2 + V02 5
    expect(await svc.getEnum("E0001")).toEqual(before);
    expect(store.purged).toEqual([]);

    const done = unwrap(await svc.reviseEnum(admin, "E0001", revision, { confirm: true }));
    expect(done.label).toBe("고지유형2");
    expect(done.values.map((v) => [v.code, v.label])).toEqual([["V05", "새값"], ["V03", "건강"], ["V04", "기타"]]); // 1차가 V05 를 태우지 않았다
    expect(store.purged).toEqual([
      { kind: "enumValue", enumCode: "E0001", valueCode: "V02" },
      { kind: "enumValue", enumCode: "E0001", valueCode: "V01" },
    ]);
  });
});
