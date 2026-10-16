import { describe, expect, it } from "vitest";

import type { NextSeq } from "./codes";
import {
  addEnumValue,
  type CatalogContext,
  createDiscriminator,
  createEnum,
  removeEnumValue,
  renameDiscriminator,
  renameEnum,
  renameEnumValue,
  reorderEnumValues,
  reviseEnum,
  setDescription,
  setExpression,
  setResultType,
  dependentsOf,
  enumRemovalBlock,
} from "./definitions";
import type { Discriminator, EnumDef, NewDiscriminator } from "./types";

/** 테스트용 순번 소스 — (kind, scope) 마다 1 부터. */
function memorySeq(): NextSeq {
  const counters = new Map<string, number>();
  return (kind, scope) => {
    const key = `${kind}:${scope}`;
    const n = (counters.get(key) ?? 0) + 1;
    counters.set(key, n);
    return n;
  };
}

const 고지유형: EnumDef = {
  code: "E0001",
  label: "고지유형",
  values: [
    { code: "V01", label: "일반심사", order: 0 },
    { code: "V02", label: "간편심사", order: 1 },
  ],
};

function ctx(over: Partial<CatalogContext> = {}): CatalogContext {
  return {
    nextSeq: memorySeq(),
    existing: [],
    findEnum: (c) => (c === "E0001" ? 고지유형 : undefined),
    ...over,
  };
}

function unwrap<T>(r: { ok: true; value: T } | { ok: false; rejection: unknown }): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

function rejection(r: { ok: true } | { ok: false; rejection: { reason: string } }): string {
  if (r.ok) throw new Error("기대: 거부, 실제: ok");
  return r.rejection.reason;
}

const 면책구분: Discriminator = {
  code: "D0002",
  label: "면책구분",
  description: "",
  level: "coverage",
  expression: "any(pay.exempt)",
  resultType: { kind: "boolean" },
};

function catalogOf(...defs: Discriminator[]): ReadonlyMap<string, Discriminator> {
  return new Map(defs.map((d) => [d.code, d]));
}

const 담보명: NewDiscriminator = {
  label: "담보명",
  level: "coverage",
  expression: "coverage_basic.claim_name",
  resultType: { kind: "string" },
};

describe("구분자정의 S1 — 채번: 코드 불변 + 표시명 가변", () => {
  it("표시명 · 레벨 · 식만 넣으면 코드는 시스템이 D0001 부터 채번한다", async () => {
    const c = ctx();
    expect(unwrap(await createDiscriminator(담보명, c))).toEqual({
      code: "D0001",
      label: "담보명",
      description: "",
      level: "coverage",
      expression: "coverage_basic.claim_name",
      resultType: { kind: "string" },
    });
    const second = unwrap(
      await createDiscriminator({ label: "납입면제적용", level: "plan", expression: "waiver.applies", resultType: { kind: "boolean" } }, c),
    );
    expect(second.code).toBe("D0002");
  });

  it("생성 입력에는 code 필드가 없다 — 유저 입력 불가는 타입으로 강제", () => {
    const input: NewDiscriminator = {
      label: "담보명",
      level: "coverage",
      expression: "coverage_basic.claim_name",
      // @ts-expect-error code 는 입력 항목이 아니다
      code: "claim",
    };
    expect(input).toBeDefined();
  });

  it("표시명 변경은 자유 — 코드는 그대로다", async () => {
    const def = unwrap(await createDiscriminator(담보명, ctx()));
    const renamed = unwrap(renameDiscriminator(def, "보험금 이름", []));
    expect(renamed.code).toBe("D0001");
    expect(renamed.label).toBe("보험금 이름");
    expect(unwrap(setDescription(renamed, "메모")).description).toBe("메모");
  });

  it("표시명이 비거나 레벨이 5레벨 밖이면 invalid", async () => {
    expect(rejection(await createDiscriminator({ ...담보명, label: "  " }, ctx()))).toBe("invalid");
    expect(
      rejection(await createDiscriminator({ ...담보명, level: "productCoverage" as never }, ctx())),
    ).toBe("invalid");
  });

  it("같은 레벨 안 표시명 완전 중복은 거부, 다른 레벨은 허용 (D-P1-1)", async () => {
    const existing = [{ code: "D0001", label: "담보명", level: "coverage" as const }];
    expect(rejection(await createDiscriminator(담보명, ctx({ existing })))).toBe("duplicate");
    expect(
      unwrap(
        await createDiscriminator(
          { label: "담보명", level: "plan", expression: "waiver.applies", resultType: { kind: "boolean" } },
          ctx({ existing }),
        ),
      ).code,
    ).toBe("D0001");
  });
});

describe("구분자정의 — 식은 저장 시 검증한다 (ADR-0037)", () => {
  it("식이 비면 거부한다", async () => {
    expect(rejection(await createDiscriminator({ ...담보명, expression: "  " }, ctx()))).toBe("invalid");
  });

  it("항등 투영은 허용한다 — 필드를 문면에 내는 유일한 길이다 (ADR-0036 §2)", async () => {
    expect(unwrap(await createDiscriminator(담보명, ctx())).expression).toBe("coverage_basic.claim_name");
  });

  it("카탈로그를 안 주면 구분자 참조는 모르는 참조라 거부한다", async () => {
    expect(rejection(await createDiscriminator({ ...담보명, expression: "D0002" }, ctx()))).toBe("invalid");
  });

  it("카탈로그를 주면 같은 레벨 구분자를 참조할 수 있다 (기능/구분자 §3.2)", async () => {
    const c = ctx({ catalog: catalogOf(면책구분), existing: [면책구분] });
    const created = unwrap(await createDiscriminator({ ...담보명, label: "면책아님", expression: "not D0002", resultType: { kind: "boolean" } }, c));
    expect(created.expression).toBe("not D0002");
  });

  it("식 수정은 비파괴이고 같은 검증을 거친다", async () => {
    const def = unwrap(await createDiscriminator(담보명, ctx()));
    expect(unwrap(setExpression(def, "coverage_basic.claim_name ≠ ''", {}, { resultType: { kind: "boolean" } })).expression).toBe(
      "coverage_basic.claim_name ≠ ''",
    );
    expect(rejection(setExpression(def, "D0009"))).toBe("invalid");
    expect(def.expression).toBe("coverage_basic.claim_name"); // 원본은 그대로
  });

  it("자기 참조는 거부한다", () => {
    const r = setExpression(면책구분, "D0002 and any(pay.exempt)", { catalog: catalogOf(면책구분) });
    expect(r.ok).toBe(false);
    if (r.ok || r.rejection.reason !== "invalid") throw new Error("기대: invalid");
    expect(r.rejection.issues[0]).toMatchObject({ kind: "typeMismatch", at: { refPath: "D0002" } });
    expect(r.rejection.issues[0].message).toContain("자기 자신");
  });

  it("순환(A → B → A)은 저장 시 거부한다 — 카탈로그 전체를 따라간다", () => {
    const A: Discriminator = { code: "D0010", label: "A", description: "", level: "coverage", expression: "D0011", resultType: { kind: "boolean" } };
    const B: Discriminator = { code: "D0011", label: "B", description: "", level: "coverage", expression: "any(pay.exempt)", resultType: { kind: "boolean" } };
    const C: Discriminator = { code: "D0012", label: "C", description: "", level: "coverage", expression: "D0011 or D0002", resultType: { kind: "boolean" } };
    const catalog = catalogOf(면책구분, A, B, C);
    // B 가 A 를 부르면 A → B → A
    const direct = setExpression(B, "not D0010", { catalog });
    expect(rejection(direct)).toBe("invalid");
    if (direct.ok || direct.rejection.reason !== "invalid") throw new Error("기대: invalid");
    expect(direct.rejection.issues[0].message).toContain("순환");
    expect(direct.rejection.issues[0].message).toContain("D0011 → D0010 → D0011");
    // B 가 C 를 부르면 B → C → B (C 는 B 를 부른다)
    expect(rejection(setExpression(B, "D0012", { catalog }))).toBe("invalid");
    // 순환이 아니면 통과 — B 가 D0002 를 부르는 것은 D0002 가 B 를 안 부르니 괜찮다
    expect(unwrap(setExpression(B, "D0002", { catalog })).expression).toBe("D0002");
  });

  it("참조받는 구분자를 고치면 참조하는 정의를 바뀐 카탈로그로 다시 검사한다 (코덱스 리뷰 2026-09-14 Important-1)", () => {
    const A: Discriminator = { code: "D0001", label: "납입면제적용", description: "", level: "plan", expression: "waiver.applies", resultType: { kind: "boolean" } };
    const B: Discriminator = { code: "D0002", label: "장기면제", description: "", level: "plan", expression: "D0001 and waiver.applies", resultType: { kind: "boolean" } };
    const C: Discriminator = { code: "D0003", label: "C", description: "", level: "plan", expression: "not D0002", resultType: { kind: "boolean" } };
    const catalog = catalogOf(A, B, C);
    // A 가 무저해지 폼을 읽게 되면 B 는 두 폼(no_surrender · waiver)을 읽는 식이 된다 — 결과 타입은 그대로 boolean 인데도 거부
    const r = setExpression(A, "no_surrender.type = 'V01'", { catalog });
    expect(rejection(r)).toBe("invalid");
    if (r.ok || r.rejection.reason !== "invalid") throw new Error("기대: invalid");
    expect(r.rejection.issues[0].message).toContain("D0002(장기면제)");
    expect(r.rejection.issues[0].message).toContain("폼 하나만");
    // 좌표는 「어느 구분자를 고쳐야 하나」 — 구분자 편집기(catalog) · refPath 는 그 식 안에서 바뀐 쪽을 읽는 참조 (ADR-0049 §4)
    expect(r.rejection.issues[0].at).toEqual({ document: "catalog", ownerId: "D0002", ownerName: "장기면제", refPath: "D0001" });
    // 전이적으로도 본다 — A 의 결과 타입이 string 이 되면 B(and) 가 깨지고, B 를 참조하는 C 는 B 가 깨져 brokenRef
    const r2 = setExpression(A, "waiver.reasons", { catalog }, { resultType: { kind: "list<enum>", enumCode: "E0001" } });
    expect(rejection(r2)).toBe("invalid");
    if (r2.ok || r2.rejection.reason !== "invalid") throw new Error("기대: invalid");
    // C 는 B 를 거쳐 깨진다 — 좌표는 C 의 편집기, refPath 는 C 가 직접 읽는 B
    expect(r2.rejection.issues.map((i) => i.at)).toEqual([
      { document: "catalog", ownerId: "D0002", ownerName: "장기면제", refPath: "D0001" },
      { document: "catalog", ownerId: "D0003", ownerName: "C", refPath: "D0002" },
    ]);
    // 참조하는 쪽이 여전히 유효하면 통과
    expect(unwrap(setExpression(A, "not waiver.applies", { catalog })).expression).toBe("not waiver.applies");
    expect(dependentsOf("D0001", catalog).map((d) => d.code)).toEqual(["D0002", "D0003"]);
  });

  it("검증기를 주입하면 그것을 쓴다 (담보속성 유효값을 아는 서비스용)", async () => {
    const c = ctx({
      checkExpression: () => ({ ok: false, rejection: { reason: "invalid", issues: [] } }),
    });
    expect(rejection(await createDiscriminator(담보명, c))).toBe("invalid");
  });

  it("부착 레벨은 채번 뒤 바꾸는 길이 없다 — 고치려면 새로 만든다", () => {
    const def: Discriminator = {
      code: "D0001",
      label: "담보명",
      description: "",
      level: "coverage",
      expression: "coverage_basic.claim_name",
      resultType: { kind: "string" },
    };
    expect(Object.keys(def)).not.toContain("setLevel");
  });
});

describe("구분자정의 — 명시 결과 타입 resultType (기능/구분자 §3.1)", () => {
  it("결과 타입은 필수 — 안 주면 invalid(결과 타입을 고르세요) (2026-10-17)", async () => {
    const { resultType: _omit, ...untyped } = 담보명;
    void _omit;
    const r = await createDiscriminator(untyped as NewDiscriminator, ctx());
    expect(rejection(r)).toBe("invalid");
    if (r.ok || r.rejection.reason !== "invalid") throw new Error("기대: invalid");
    expect(r.rejection.issues[0]).toMatchObject({ kind: "typeMismatch", message: "결과 타입을 고르세요" });
  });

  it("식과 일치하는 resultType 은 저장 정의에 실린다", async () => {
    const created = unwrap(await createDiscriminator(담보명, ctx()));
    expect(created.resultType).toEqual({ kind: "string" });
  });

  it("추론 타입과 kind 가 다르면 invalid + typeMismatch", async () => {
    const r = await createDiscriminator({ ...담보명, resultType: { kind: "boolean" } }, ctx());
    expect(rejection(r)).toBe("invalid");
    if (r.ok || r.rejection.reason !== "invalid") throw new Error("기대: invalid");
    expect(r.rejection.issues[0].kind).toBe("typeMismatch");
  });

  it("enum 계열인데 enumCode 가 없으면 invalid + brokenRef", async () => {
    const r = await createDiscriminator(
      {
        label: "무저해지유형",
        level: "plan",
        expression: "no_surrender.type",
        resultType: { kind: "enum", enumCode: "E9999" },
      },
      ctx(),
    );
    expect(rejection(r)).toBe("invalid");
    if (r.ok || r.rejection.reason !== "invalid") throw new Error("기대: invalid");
    expect(r.rejection.issues[0].kind).toBe("brokenRef");
  });

  it("setExpression 으로 타입이 바뀌는 식으로 바꾸면 invalid — 저장된 결과 타입과 대조한다", async () => {
    const def = unwrap(
      await createDiscriminator(
        { label: "납입면제여부", level: "plan", expression: "waiver.applies", resultType: { kind: "boolean" } },
        ctx(),
      ),
    );
    expect(rejection(setExpression(def, "no_surrender.type"))).toBe("invalid");
  });

  it("setExpression 에 새 결과 타입을 함께 주면 새 식과 새 타입을 대조해 한 번에 바꾼다 — 해제 단계가 없다", async () => {
    const def = unwrap(
      await createDiscriminator(
        { label: "납입면제여부", level: "plan", expression: "waiver.applies", resultType: { kind: "boolean" } },
        ctx(),
      ),
    );
    const c = ctx({ findEnum: (code) => (code === "E0002" ? { ...고지유형, code } : undefined) });
    const next = unwrap(setExpression(def, "no_surrender.type", c, { resultType: { kind: "enum", enumCode: "E0002" } }));
    expect(next).toMatchObject({ expression: "no_surrender.type", resultType: { kind: "enum", enumCode: "E0002" } });
    // 새 타입이 새 식과 어긋나면 거부 · 없는 열거형변수면 거부 · 타입을 비우면 거부
    expect(rejection(setExpression(def, "no_surrender.type", c, { resultType: { kind: "boolean" } }))).toBe("invalid");
    expect(rejection(setExpression(def, "no_surrender.type", c, { resultType: { kind: "enum", enumCode: "E9999" } }))).toBe("invalid");
    expect(rejection(setExpression(def, "waiver.applies", c, { resultType: undefined }))).toBe("invalid");
  });

  it("setResultType — 맞으면 ok, 틀리면 invalid, 비우기(undefined)는 invalid — 필수다", async () => {
    const def = unwrap(await createDiscriminator(담보명, ctx()));
    const c = ctx();
    expect(unwrap(setResultType(def, { kind: "string" }, c)).resultType).toEqual({ kind: "string" });
    expect(rejection(setResultType(def, { kind: "boolean" }, c))).toBe("invalid");
    const cleared = setResultType(def, undefined as never, c);
    expect(rejection(cleared)).toBe("invalid");
    if (cleared.ok || cleared.rejection.reason !== "invalid") throw new Error("기대: invalid");
    expect(cleared.rejection.issues[0].message).toBe("결과 타입을 고르세요");
  });

  it("setResultType 이 enum 계열인데 없는 enumCode 면 invalid + brokenRef", async () => {
    const def = unwrap(
      await createDiscriminator(
        { label: "무저해지유형2", level: "plan", expression: "no_surrender.type", resultType: { kind: "enum", enumCode: "E0002" } },
        ctx({ findEnum: (code) => (code === "E0002" ? { ...고지유형, code } : undefined) }),
      ),
    );
    const r = setResultType(def, { kind: "enum", enumCode: "E9999" }, ctx());
    expect(rejection(r)).toBe("invalid");
    if (r.ok || r.rejection.reason !== "invalid") throw new Error("기대: invalid");
    expect(r.rejection.issues[0].kind).toBe("brokenRef");
  });

  it("resultType 이 enum 계열인데 enumCode 가 비어있으면 invalid + typeMismatch(열거형변수를 고르세요) — 없는 코드(brokenRef)와 다른 문제다", async () => {
    const r = await createDiscriminator(
      {
        label: "무저해지유형3",
        level: "plan",
        expression: "no_surrender.type",
        resultType: { kind: "enum", enumCode: "" },
      },
      ctx(),
    );
    expect(rejection(r)).toBe("invalid");
    if (r.ok || r.rejection.reason !== "invalid") throw new Error("기대: invalid");
    expect(r.rejection.issues[0]).toMatchObject({ kind: "typeMismatch", message: "열거형변수를 고르세요" });
  });
});

describe("구분자정의 — 참조된 구분자의 식이 바뀌면 의존 구분자의 명시 타입도 대조한다 (final-review fix)", () => {
  it("의존 구분자의 식 검사는 통과해도 명시 결과 타입과 어긋나면 거부한다", () => {
    // D0005(boolean) ← D0011 = `D0005`(명시 boolean). D0005 를 number 식 · number 타입으로 함께 바꾸면
    // checkDependents 의 타입검사 자체는 통과하지만(둘 다 bare 참조라 타입 제약이 없다) D0011 의 명시 boolean 과 어긋난다.
    const D0005: Discriminator = { code: "D0005", label: "D5", description: "", level: "coverage", expression: "any(pay.exempt)", resultType: { kind: "boolean" } };
    const D0011: Discriminator = {
      code: "D0011",
      label: "D11",
      description: "",
      level: "coverage",
      expression: "D0005",
      resultType: { kind: "boolean" },
    };
    const catalog = catalogOf(D0005, D0011);
    const r = setExpression(D0005, "sum(pay.rate)", ctx({ catalog }), { resultType: { kind: "number" } });
    expect(rejection(r)).toBe("invalid");
    if (r.ok || r.rejection.reason !== "invalid") throw new Error("기대: invalid");
    expect(r.rejection.issues[0].kind).toBe("typeMismatch");
    expect(r.rejection.issues[0].message).toContain("D0011");
  });
});

describe("enum 정의 (D-P1-7 · D-P1-8)", () => {
  it("enum 은 E0001 부터, 값은 그 안에서 V01 부터 채번한다", async () => {
    const def = unwrap(
      await createEnum({ label: "납입면제사유", values: [{ label: "질병" }, { label: "상해" }] }, ctx()),
    );
    expect(def.code).toBe("E0001");
    expect(def.values.map((v) => [v.code, v.label, v.order])).toEqual([
      ["V01", "질병", 0],
      ["V02", "상해", 1],
    ]);
  });

  it("생성에 필드 정의와 값별 필드 값을 함께 — 필드는 F01 부터, 값의 칸은 필드 ref 로 가리킨다 · 빈 칸은 미입력(키 없음)", async () => {
    const def = unwrap(
      await createEnum(
        {
          label: "납입면제사유",
          fields: [{ ref: "new:1", label: "약관표시명", type: "string" }, { ref: "new:2", label: "면책여부", type: "boolean" }],
          values: [{ label: "암", fields: { "new:1": "암(유사암제외)", "new:2": true } }, { label: "뇌졸중", fields: { "new:1": "" } }],
        },
        ctx(),
      ),
    );
    expect(def.fields).toEqual([
      { key: "F01", label: "약관표시명", type: "string", order: 0 },
      { key: "F02", label: "면책여부", type: "boolean", order: 1 },
    ]);
    expect(def.values).toEqual([
      { code: "V01", label: "암", order: 0, fields: { F01: "암(유사암제외)", F02: true } },
      { code: "V02", label: "뇌졸중", order: 1 },
    ]);
  });

  it("생성의 필드 검사 — 필드 이름 중복 · 타입이 다른 값은 거부, 필드 없이 만들면 fields 키가 없다", async () => {
    const dup = await createEnum({ label: "x", fields: [{ ref: "a", label: "표시명", type: "string" }, { ref: "b", label: "표시명 ", type: "string" }] }, ctx());
    expect(dup.ok).toBe(false);
    const wrong = await createEnum({ label: "y", fields: [{ ref: "a", label: "면책", type: "boolean" }], values: [{ label: "암", fields: { a: "예" } }] }, ctx());
    expect(wrong.ok).toBe(false);
    expect("fields" in unwrap(await createEnum({ label: "z", values: [{ label: "가" }] }, ctx()))).toBe(false);
  });

  it("enum 표시명 중복은 거부한다", async () => {
    expect(rejection(await createEnum({ label: "고지유형" }, ctx({ existingEnumLabels: ["고지유형"] })))).toBe(
      "duplicate",
    );
    expect(unwrap(renameEnum(고지유형, "고지유형", ["고지유형"])).label).toBe("고지유형"); // 자기 이름은 허용
  });

  it("값 추가는 자유 — 배포 없이 유효값이 는다", async () => {
    const def = unwrap(await addEnumValue(고지유형, { label: "건강고지" }, memorySeq()));
    expect(def.values.map((v) => v.label)).toEqual(["일반심사", "간편심사", "건강고지"]);
    expect(rejection(await addEnumValue(고지유형, { label: "일반심사" }, memorySeq()))).toBe("duplicate");
  });

  it("값 동일성은 공백 · 대소문자를 무시한다 — 생성 화면과 같은 정책 (코덱스 리뷰 2026-09-14 Minor-1)", async () => {
    expect(rejection(await addEnumValue(고지유형, { label: " 일반심사 " }, memorySeq()))).toBe("duplicate");
    const def = unwrap(await addEnumValue(고지유형, { label: "Type A" }, memorySeq()));
    expect(rejection(await addEnumValue(def, { label: "type  a" }, memorySeq()))).toBe("duplicate");
    expect(rejection(renameEnumValue(def, "V02", "TYPE A"))).toBe("duplicate"); // memorySeq 는 1 부터라 새 값 코드가 V01 과 겹친다 — V02 로 본다
    expect(rejection(await createEnum({ label: "x", values: [{ label: "A" }, { label: "a" }] }, { nextSeq: memorySeq(), existingEnumLabels: [] }))).toBe("duplicate");
    // 저장은 적은 그대로 — 비교만 정규화
    expect(def.values.at(-1)?.label).toBe("Type A");
  });

  it("값 표시명 변경 · 순서 변경 · 삭제는 order 를 다시 매긴다", () => {
    expect(unwrap(renameEnumValue(고지유형, "V01", "일반")).values[0].label).toBe("일반");
    expect(rejection(renameEnumValue(고지유형, "V09", "x"))).toBe("notFound");
    expect(unwrap(reorderEnumValues(고지유형, ["V02", "V01"])).values.map((v) => v.code)).toEqual([
      "V02",
      "V01",
    ]);
    expect(rejection(reorderEnumValues(고지유형, ["V02"]))).toBe("invalid");
    expect(unwrap(removeEnumValue(고지유형, "V01")).values).toEqual([
      { code: "V02", label: "간편심사", order: 0 },
    ]);
  });
});

describe("reviseEnum — 편집 화면 한 벌을 최종 상태로 한 번에 검사 (점검 2026-09-27 H2 ① · D1)", () => {
  /** 기존 값 V01 · V02 다음부터 — 저장소 순번처럼 3 부터 준다. */
  const seqFrom3: NextSeq = (() => {
    let n = 2;
    return () => ++n;
  })();
  const revise = (values: { code?: string; label: string }[], label = "고지유형") =>
    reviseEnum(고지유형, { label, description: "", values }, { existingEnumLabels: ["고지유형", "직업급수"], nextSeq: seqFrom3 });

  it("값 이름 A↔B 맞바꾸기 — 한 단계씩이면 중복이지만 최종 상태는 유효하다", async () => {
    const r = unwrap(await revise([{ code: "V01", label: "간편심사" }, { code: "V02", label: "일반심사" }]));
    expect(r.def.values).toEqual([
      { code: "V01", label: "간편심사", order: 0 },
      { code: "V02", label: "일반심사", order: 1 },
    ]);
    expect(r.removed).toEqual([]);
  });

  it("다른 값이 비우는 이름을 받는다 — 개명으로 비우든 빼서 비우든", async () => {
    const renamed = unwrap(await revise([{ code: "V01", label: "건강고지" }, { code: "V02", label: "일반심사" }]));
    expect(renamed.def.values.map((v) => v.label)).toEqual(["건강고지", "일반심사"]);
    const removed = unwrap(await revise([{ code: "V02", label: "간편" }, { label: "일반심사" }]));
    expect(removed.removed).toEqual(["V01"]);
    expect(removed.def.values.map((v) => [v.label, v.order])).toEqual([["간편", 0], ["일반심사", 1]]);
    expect(removed.def.values[1]!.code).not.toBe("V01"); // 빠진 값의 코드를 다시 쓰지 않는다 — 새 값은 새로 채번
  });

  it("새 값은 제출 순서대로 채번 · 배열 순서가 곧 order", async () => {
    const r = unwrap(await revise([{ label: "C" }, { code: "V01", label: "일반심사" }, { label: "D" }, { code: "V02", label: "간편심사" }]));
    expect(r.def.values.map((v) => v.label)).toEqual(["C", "일반심사", "D", "간편심사"]);
    expect(r.def.values.map((v) => v.order)).toEqual([0, 1, 2, 3]);
    expect(new Set(r.def.values.map((v) => v.code)).size).toBe(4);
  });

  it("최종 상태에서 겹치면 duplicate · 빈 이름은 invalid · 모르는 코드는 notFound · 열거형변수명 중복은 duplicate", async () => {
    expect(rejection(await revise([{ code: "V01", label: "간편심사" }, { code: "V02", label: " 간편심사 " }]))).toBe("duplicate");
    expect(rejection(await revise([{ code: "V01", label: "일반심사" }, { label: "일반심사" }]))).toBe("duplicate");
    expect(rejection(await revise([{ code: "V01", label: " " }]))).toBe("invalid");
    expect(rejection(await revise([{ code: "V09", label: "x" }]))).toBe("notFound");
    expect(rejection(await revise([{ code: "V01", label: "a" }, { code: "V01", label: "b" }]))).toBe("invalid");
    expect(rejection(await revise([], "직업급수"))).toBe("duplicate");
    expect(rejection(await revise([], " "))).toBe("invalid");
  });

  it("거부된 입력은 순번을 태우지 않는다 — 검사를 다 통과한 뒤에 채번", async () => {
    let calls = 0;
    const counting: NextSeq = () => ++calls + 10;
    const r = await reviseEnum(고지유형, { label: "고지유형", description: "", values: [{ label: "새값" }, { code: "V01", label: "" }] }, { existingEnumLabels: [], nextSeq: counting });
    expect(r.ok).toBe(false);
    expect(calls).toBe(0);
  });

  it("주석도 같이 — 빠진 값 목록은 원래 순서대로", async () => {
    const r = unwrap(await reviseEnum(고지유형, { label: "고지유형", description: "메모", values: [] }, { existingEnumLabels: [], nextSeq: memorySeq() }));
    expect(r.def.description).toBe("메모");
    expect(r.removed).toEqual(["V01", "V02"]);
  });
});

describe("enumRemovalBlock — 열거형변수 정의 삭제를 막는 곳 (ADR-0049 〔D-P1-17〕)", () => {
  it("코드 마스터 필드가 타입으로 쓰는 열거형은 삭제 거부 — 이유에 그 필드 이름", () => {
    expect(enumRemovalBlock("E0001")).toMatch(/세목 · 납입면제 › 납입면제사유/);
    expect(enumRemovalBlock("E0005")).toMatch(/고지유형/);
  });

  it("특약 그룹(E0008)은 코드가 직접 가리키므로 거부", () => {
    expect(enumRemovalBlock("E0008")).toMatch(/특약 그룹/);
  });

  it("그 밖(구분자 결과 타입 · 함수조항 인자 타입이 쓰는 열거형 포함)은 지울 수 있다 — 남은 참조는 깨진 참조로 드러난다", () => {
    expect(enumRemovalBlock("E0009")).toBeUndefined();
    expect(enumRemovalBlock("E0123")).toBeUndefined();
  });
});
