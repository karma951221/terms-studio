import { describe, expect, it } from "vitest";

import type { EnumDef, EnumLookup } from "@/domain/catalog/types";
import type { MasterForm } from "@/domain/master";
import { entered, NOT_ENTERED, type ValueSlot } from "@/domain/types";

import {
  buildForm,
  formatValue,
  formProgress,
  formReducer,
  formSlotsOf,
  initFormState,
  isFieldAbsent,
  isFieldHidden,
  toSubmission,
  zodSchemaFor,
  zodValueSchema,
  type FormState,
} from "./model";

// ───────────────────────────── 픽스처 ─────────────────────────────

const 고지유형: EnumDef = {
  code: "E0001",
  label: "고지유형",
  values: [
    // order 역순으로 넣어 정렬을 검증한다
    { code: "V03", label: "건강고지", order: 2 },
    { code: "V01", label: "일반심사", order: 0 },
    { code: "V02", label: "간편심사", order: 1 },
  ],
};
const enums: EnumLookup = (c) => (c === "E0001" ? 고지유형 : undefined);

/**
 * 픽스처 마스터 — 급부 레벨에 6 타입을 모두 두고 폼 렌더러가 타입 매핑 하나로 그리는지 본다.
 * 마스터가 코드라는 것은 「유저가 정의하지 않는다」는 뜻이고, 픽스처가 자기 어휘를 갖는 것은 막지 않는다.
 */
const master: MasterForm[] = [
  {
    key: "coverage_basic",
    label: "담보 기본",
    level: "coverage",
    fields: [{ key: "renewal", label: "갱신여부", type: { kind: "boolean" }, defaultValue: false }],
  },
  {
    key: "pay",
    label: "보험금지급",
    level: "benefit",
    fields: [
      { key: "exempt", label: "면책여부", type: { kind: "boolean" } },
      { key: "rate", label: "지급률", type: { kind: "number" }, defaultValue: 100 },
      { key: "note", label: "비고", type: { kind: "string" } },
      { key: "since", label: "개시일", type: { kind: "date" } },
      { key: "notice", label: "고지유형", type: { kind: "enum", enumCode: "E0001" } },
      { key: "applied", label: "적용유형", type: { kind: "list<enum>", enumCode: "E0001" } },
    ],
  },
];

/** 없는 enum 을 가리키는 자리 — 폼이 죽지 않는지 본다. */
const brokenMaster: MasterForm[] = [
  { key: "broken", label: "x", level: "benefit", fields: [{ key: "gone", label: "x", type: { kind: "enum", enumCode: "E9999" } }] },
];

const empty = new Map<string, ValueSlot>();

function benefitForm(current: Map<string, ValueSlot> = empty, snapshot?: Parameters<typeof buildForm>[3]) {
  return buildForm("benefit", enums, current, snapshot, master);
}

function stateOf(current: Map<string, ValueSlot> = empty): FormState {
  return initFormState(benefitForm(current));
}

// ───────────────────────────── buildForm ─────────────────────────────

describe("buildForm — 마스터 메타만으로 폼 모델이 만들어진다 (ADR-0037)", () => {
  it("폼 하나 · 필드 하나뿐인 레벨 — 경로는 `폼키.필드키`, 필드는 자기 폼을 안다", () => {
    const form = buildForm("coverage", enums, empty, undefined, master);
    expect(form.level).toBe("coverage");
    expect(form.label).toBe("담보");
    expect(form.fields).toHaveLength(1);
    expect(form.fields[0].path).toBe("coverage_basic.renewal");
    expect(form.fields[0].label).toBe("갱신여부");
    expect(form.fields[0].type).toEqual({ kind: "boolean" });
    expect(form.fields[0].form).toEqual({ key: "coverage_basic", label: "담보 기본" });
  });

  it("buildForm — 그 레벨 폼마다 카드 하나, 필드는 폼 선언 순", () => {
    const model = buildForm("plan", () => undefined, new Map());
    expect(model.cards.map((c) => c.key)).toEqual(["waiver", "no_surrender", "conversion", "business_type"]);
    expect(model.cards[0].fields.map((f) => f.path)).toEqual(["waiver.applies", "waiver.reasons"]);
    expect(model.fields.map((f) => f.path)).toEqual(model.cards.flatMap((c) => c.fields.map((f) => f.path)));
    expect(model.fields[0].form).toEqual({ key: "waiver", label: "납입면제" });
  });

  it("buildForm — 카드는 폼의 설명을 싣고, 없으면 키 자체가 없다", () => {
    const model = buildForm("plan", () => undefined, new Map());
    expect(model.cards[0].description).toBe("납입면제 사유에 해당하면 이후 보험료를 받지 않는다");
    expect("description" in model.cards[1]).toBe(false);
  });

  it("buildForm — 폼이 없는 레벨은 카드 0 · 필드 0", () => {
    const model = buildForm("product", () => undefined, new Map());
    expect(model.cards).toEqual([]);
    expect(model.fields).toEqual([]);
  });

  it("폼 필드는 선언 순서대로 — 경로는 `폼키.필드키`, 폼 표시명을 함께 싣는다", () => {
    const form = benefitForm();
    expect(form.fields.map((f) => f.path)).toEqual([
      "pay.exempt",
      "pay.rate",
      "pay.note",
      "pay.since",
      "pay.notice",
      "pay.applied",
    ]);
    expect(form.fields.map((f) => f.label)).toEqual([
      "면책여부",
      "지급률",
      "비고",
      "개시일",
      "고지유형",
      "적용유형",
    ]);
    expect(form.fields.every((f) => f.form.label === "보험금지급")).toBe(true);
  });

  it("값 자리는 전부 직접값이다 (실선 테두리) — 식·마스터 소유 자리는 폼에 오지 않는다", () => {
    expect(buildForm("coverage", enums, empty, undefined, master).fields[0].source).toBe("direct");
    expect(benefitForm().fields.every((f) => f.source === "direct")).toBe(true);
    expect(formSlotsOf(benefitForm())).toHaveLength(6);
  });

  it("스냅샷 문맥 — 마스터와 달라진 자리만 「스냅샷 · 변경됨」이 되고 마스터 값을 tooltip 재료로 싣는다", () => {
    const master = new Map<string, ValueSlot>([
      ["pay.rate", entered(100)],
      ["pay.note", entered("마스터 메모")],
    ]);
    const form = benefitForm(
      new Map<string, ValueSlot>([
        ["pay.rate", entered(80)],
        ["pay.note", entered("마스터 메모")],
      ]),
      { masterLabel: "수술비(1~7종)[상해]", masterValues: master },
    );
    const 지급률 = form.fields.find((f) => f.path === "pay.rate")!;
    expect(지급률.source).toBe("snapshot");
    expect(지급률.masterValue).toBe(100);
    expect(지급률.masterLabel).toBe("수술비(1~7종)[상해]");
    // 마스터와 같은 값은 그냥 직접값 — 되돌릴 것이 없다
    expect(form.fields.find((f) => f.path === "pay.note")!.source).toBe("direct");
    // 마스터가 값을 갖지 않는 자리도 직접값
    expect(form.fields.find((f) => f.path === "pay.exempt")!.source).toBe("direct");
  });

  it("진행 카운트는 저장소 기준으로 「해낸 것」을 센다 (§9.2)", () => {
    expect(formProgress(benefitForm())).toEqual({ total: 6, entered: 0, percent: 0 });
    const form = benefitForm(
      new Map<string, ValueSlot>([
        ["pay.exempt", entered(true)],
        ["pay.rate", entered(80)],
        ["pay.note", entered("메모")],
      ]),
    );
    expect(formProgress(form)).toEqual({ total: 6, entered: 3, percent: 50 });
  });

  it("enum · list<enum> 필드는 선택지를 코드+표시명으로 갖는다 — order 순 (ADR-0005)", () => {
    const form = benefitForm();
    const 고지 = form.fields.find((f) => f.path === "pay.notice")!;
    const 적용 = form.fields.find((f) => f.path === "pay.applied")!;
    expect(고지.enumOptions).toEqual([
      { code: "V01", label: "일반심사" },
      { code: "V02", label: "간편심사" },
      { code: "V03", label: "건강고지" },
    ]);
    expect(적용.enumOptions).toEqual(고지.enumOptions);
    expect(form.fields.find((f) => f.path === "pay.note")!.enumOptions).toBeUndefined();
  });

  it("없는 enum 을 가리키는 필드는 선택지가 빈 목록이다 (깨진 참조 — 폼은 죽지 않는다)", () => {
    const form = buildForm("benefit", enums, empty, undefined, brokenMaster);
    expect(form.fields[0].enumOptions).toEqual([]);
  });

  it("값 자리는 기본값 지정 여부와 무관하게 「미입력」으로 태어난다 (ADR-0004)", () => {
    const form = benefitForm();
    const 지급률 = form.fields.find((f) => f.path === "pay.rate")!;
    expect(지급률.state).toBe("notEntered");
    expect(지급률.value).toBeUndefined();
    // 기본값은 prefill 로만 실린다
    expect(지급률.prefill).toBe(100);
    expect(form.fields.find((f) => f.path === "pay.exempt")!.prefill).toBeUndefined();
  });

  it("저장소에 명시 값이 있으면 entered + 값", () => {
    const current = new Map<string, ValueSlot>([
      ["pay.exempt", entered(true)],
      ["pay.rate", NOT_ENTERED],
    ]);
    const form = benefitForm(
      current);
    const 면책 = form.fields.find((f) => f.path === "pay.exempt")!;
    expect(면책.state).toBe("entered");
    expect(면책.value).toBe(true);
    // entered:false 도, 자리를 모르는 것도 미입력
    expect(form.fields.find((f) => f.path === "pay.rate")!.state).toBe("notEntered");
    expect(form.fields.find((f) => f.path === "pay.note")!.state).toBe("notEntered");
  });

  it("그룹 없는 필드의 기본값도 prefill 로만 — 저장 전엔 미입력", () => {
    const form = buildForm("coverage", enums, empty, undefined, master);
    expect(form.fields[0].state).toBe("notEntered");
    expect(form.fields[0].prefill).toBe(false);
  });
});

// ───────────────────────────── 리듀서 ─────────────────────────────

describe("initFormState — 편집 상태의 초기값", () => {
  it("저장 값이 있으면 draft 에 문자열로 실리고 entered", () => {
    const current = new Map<string, ValueSlot>([
      ["pay.rate", entered(80)],
      ["pay.exempt", entered(false)],
      ["pay.applied", entered(["V01", "V03"])],
    ]);
    const s = stateOf(current);
    expect(s.fields["pay.rate"]).toMatchObject({ draft: "80", entered: true, value: 80 });
    expect(s.fields["pay.exempt"]).toMatchObject({ draft: "false", entered: true, value: false });
    expect(s.fields["pay.applied"]).toMatchObject({
      draft: ["V01", "V03"],
      entered: true,
      value: ["V01", "V03"],
    });
  });

  it("시나리오 1 — 기본값은 폼이 열릴 때 이미 칸에 들어가 있다 (ADR-0004 프리필 · 리뷰 #3)", () => {
    const s = stateOf();
    const 지급률 = s.fields["pay.rate"];
    expect(지급률.view.prefill).toBe(100);
    expect(지급률.draft).toBe("100");
    expect(지급률.value).toBe(100);
    // 「제안값」 — 사람이 손대지도 저장하지도 않았다
    expect(지급률.proposed).toBe(true);
    expect(지급률.dirty).toBe(false);
    // 저장소 기준으로는 여전히 미입력
    expect(지급률.view.state).toBe("notEntered");
  });

  it("기본값이 없는 자리는 빈 칸으로 태어난다 — 제안값이 아니다", () => {
    const s = stateOf();
    expect(s.fields["pay.exempt"].draft).toBe("");
    expect(s.fields["pay.exempt"].proposed).toBe(false);
  });

  it("저장 값이 있으면 기본값이 아니라 저장 값이 칸에 들어간다", () => {
    const s = stateOf(new Map([["pay.rate", entered(80)]]));
    expect(s.fields["pay.rate"].draft).toBe("80");
    expect(s.fields["pay.rate"].proposed).toBe(false);
  });

  it("미입력 필드의 draft 는 빈 값 — list<enum> 은 빈 배열", () => {
    const s = stateOf();
    expect(s.fields["pay.note"].draft).toBe("");
    expect(s.fields["pay.applied"].draft).toEqual([]);
  });
});

describe("formReducer — edit: 문자열 입력을 타입에 맞게 파싱한다", () => {
  it("string 은 그대로", () => {
    const s = formReducer(stateOf(), { type: "edit", path: "pay.note", draft: "특약 비고" });
    expect(s.fields["pay.note"]).toMatchObject({ entered: true, value: "특약 비고", dirty: true });
    expect(s.fields["pay.note"].error).toBeUndefined();
  });

  it("number 는 숫자로 — 숫자가 아니면 필드 오류", () => {
    const ok = formReducer(stateOf(), { type: "edit", path: "pay.rate", draft: "80.5" });
    expect(ok.fields["pay.rate"]).toMatchObject({ entered: true, value: 80.5 });
    const bad = formReducer(stateOf(), { type: "edit", path: "pay.rate", draft: "팔십" });
    expect(bad.fields["pay.rate"].value).toBeUndefined();
    expect(bad.fields["pay.rate"].error).toBeTruthy();
    expect(bad.fields["pay.rate"].draft).toBe("팔십"); // 입력 원문은 남는다
  });

  it("date 는 YYYY-MM-DD 실제 날짜만", () => {
    const ok = formReducer(stateOf(), { type: "edit", path: "pay.since", draft: "2026-01-01" });
    expect(ok.fields["pay.since"].value).toBe("2026-01-01");
    const bad = formReducer(stateOf(), { type: "edit", path: "pay.since", draft: "2026-02-30" });
    expect(bad.fields["pay.since"].error).toBeTruthy();
  });

  it("boolean 은 'true' / 'false' 만", () => {
    const t = formReducer(stateOf(), { type: "edit", path: "pay.exempt", draft: "true" });
    expect(t.fields["pay.exempt"].value).toBe(true);
    const f = formReducer(stateOf(), { type: "edit", path: "pay.exempt", draft: "false" });
    expect(f.fields["pay.exempt"].value).toBe(false);
    const bad = formReducer(stateOf(), { type: "edit", path: "pay.exempt", draft: "yes" });
    expect(bad.fields["pay.exempt"].error).toBeTruthy();
  });

  it("enum 은 값 코드 — 선택지에 없는 코드는 오류 (표시명도 오류)", () => {
    const ok = formReducer(stateOf(), { type: "edit", path: "pay.notice", draft: "V02" });
    expect(ok.fields["pay.notice"].value).toBe("V02");
    const bad = formReducer(stateOf(), { type: "edit", path: "pay.notice", draft: "간편심사" });
    expect(bad.fields["pay.notice"].error).toBeTruthy();
  });

  it("list<enum> 은 코드 배열 — 중복·없는 코드는 오류, 빈 배열은 미입력", () => {
    const ok = formReducer(stateOf(), { type: "edit", path: "pay.applied", draft: ["V01", "V03"] });
    expect(ok.fields["pay.applied"]).toMatchObject({ entered: true, value: ["V01", "V03"] });
    const dup = formReducer(stateOf(), { type: "edit", path: "pay.applied", draft: ["V01", "V01"] });
    expect(dup.fields["pay.applied"].error).toBeTruthy();
    const unknown = formReducer(stateOf(), { type: "edit", path: "pay.applied", draft: ["V09"] });
    expect(unknown.fields["pay.applied"].error).toBeTruthy();
    const none = formReducer(ok, { type: "edit", path: "pay.applied", draft: [] });
    expect(none.fields["pay.applied"]).toMatchObject({ entered: false, value: undefined });
  });

  it("빈 입력은 값이 아니라 미입력이다 — 오류도 아니다 (null 없음)", () => {
    const typed = formReducer(stateOf(), { type: "edit", path: "pay.rate", draft: "80" });
    const erased = formReducer(typed, { type: "edit", path: "pay.rate", draft: "" });
    expect(erased.fields["pay.rate"]).toMatchObject({ entered: false, value: undefined });
    expect(erased.fields["pay.rate"].error).toBeUndefined();
  });

  it("모르는 경로는 무시한다 (상태 동일 객체)", () => {
    const s = stateOf();
    expect(formReducer(s, { type: "edit", path: "D9999", draft: "x" })).toBe(s);
  });
});

describe("formReducer — clear · applyPrefill", () => {
  it("clear: 값을 지워 미입력으로 만든다 — 저장 값이 있던 자리도", () => {
    const s = stateOf(new Map([["pay.rate", entered(80)]]));
    const cleared = formReducer(s, { type: "clear", path: "pay.rate" });
    expect(cleared.fields["pay.rate"]).toMatchObject({
      entered: false,
      value: undefined,
      draft: "",
      dirty: true,
    });
    const list = formReducer(stateOf(new Map([["pay.applied", entered(["V01"])]])), {
      type: "clear",
      path: "pay.applied",
    });
    expect(list.fields["pay.applied"].draft).toEqual([]);
  });

  it("clearAll: 폼 전체를 비운다 — 제안값도 걷어낸다 (버튼 「비우기」)", () => {
    const s = formReducer(stateOf(new Map([["pay.note", entered("메모")]])), { type: "clearAll" });
    expect(s.fields["pay.rate"]).toMatchObject({ draft: "", entered: false, proposed: false, dirty: true });
    expect(s.fields["pay.note"]).toMatchObject({ draft: "", entered: false });
    expect(s.fields["pay.applied"].draft).toEqual([]);
  });

  it("revertToMaster: 마스터 값을 draft 로 끌어온다 — 저장해야 확정된다 (§1.2)", () => {
    const model = benefitForm(
      new Map<string, ValueSlot>([["pay.rate", entered(80)]]),
      { masterLabel: "수술비[상해]", masterValues: new Map<string, ValueSlot>([["pay.rate", entered(100)]]) },
    );
    const s = formReducer(initFormState(model), { type: "revertToMaster", path: "pay.rate" });
    expect(s.fields["pay.rate"]).toMatchObject({ draft: "100", value: 100, dirty: true });
  });

  it("revertToMaster: 마스터 값이 없는 자리에는 아무 일도 없다", () => {
    const s = stateOf();
    expect(formReducer(s, { type: "revertToMaster", path: "pay.rate" })).toBe(s);
  });

  it("reset: 서버가 새 모델을 내려보내면 편집 상태를 새 진실로 다시 세운다", () => {
    let s = formReducer(stateOf(), { type: "edit", path: "pay.note", draft: "임시" });
    s = formReducer(s, { type: "reset", model: benefitForm(
      new Map([["pay.note", entered("저장됨")]])) });
    expect(s.fields["pay.note"]).toMatchObject({ draft: "저장됨", entered: true, dirty: false });
  });
});

// ───────────────────────────── 제출 ─────────────────────────────

describe("toSubmission — 저장할 값 목록 (자동 유입 없음 · 사람이 저장을 눌러야 값이 된다)", () => {
  it("시나리오 1 — 화면에 보인 제안값을 그대로 두고 저장하면 그때 명시 값 100 이 된다 (ADR-0004)", () => {
    const sub = toSubmission(stateOf());
    expect(sub.values).toEqual([{ path: "pay.rate", value: 100 }]);
    expect(sub.issues).toEqual([]);
  });

  it("시나리오 1 — 「비우기」로 제안을 걷어내고 저장하면 아무것도 제출되지 않는다 (미입력 유지)", () => {
    const sub = toSubmission(formReducer(stateOf(), { type: "clearAll" }));
    expect(sub.values).toEqual([]);
    expect(sub.issues).toEqual([]);
  });

  it("시나리오 2 — 일부만 입력하고 저장: 입력한 것만 제출, 나머지는 미입력으로 남는다", () => {
    let s = stateOf();
    s = formReducer(s, { type: "edit", path: "pay.exempt", draft: "true" });
    s = formReducer(s, { type: "edit", path: "pay.applied", draft: ["V02"] });
    expect(toSubmission(s).values).toEqual([
      { path: "pay.exempt", value: true },
      // 지급률은 화면에 제안값 100 이 보인 채로 저장됐다 — 사람이 보고 저장한 값이다
      { path: "pay.rate", value: 100 },
      { path: "pay.applied", value: ["V02"] },
    ]);
  });

  it("저장돼 있던 값을 지우면 value: undefined 로 제출된다 (값 지우기)", () => {
    const s = formReducer(stateOf(new Map([["pay.rate", entered(80)]])), {
      type: "clear",
      path: "pay.rate",
    });
    expect(toSubmission(s).values).toEqual([{ path: "pay.rate", value: undefined }]);
  });

  it("원래 미입력이던 자리를 지워도 제출하지 않는다", () => {
    const s = formReducer(stateOf(), { type: "clear", path: "pay.rate" });
    expect(toSubmission(s).values).toEqual([]);
  });

  it("D3 (c) — 저장 값 그대로인 칸(손대지 않음)은 제출하지 않는다: 변경 없음", () => {
    const s = formReducer(stateOf(new Map([["pay.note", entered("메모")]])), { type: "clear", path: "pay.rate" });
    expect(toSubmission(s).values).toEqual([]);
  });

  it("D3 (c) — 손댄 칸은 저장 값과 같게 되돌렸어도 제출된다 (사람이 보고 저장한 값)", () => {
    let s = formReducer(stateOf(new Map([["pay.note", entered("메모")]])), { type: "clear", path: "pay.rate" });
    s = formReducer(s, { type: "edit", path: "pay.note", draft: "메모" });
    expect(toSubmission(s).values).toEqual([{ path: "pay.note", value: "메모" }]);
  });

  it("H3 · T1 — 명시적 빈 목록 [] 은 값 폼을 한 번 거쳐도 지워지지 않는다 (ADR-0004 · 미입력과 다른 상태)", () => {
    const s = stateOf(new Map([["pay.applied", entered([])]]));
    // 손대지 않았으니 「값 지우기」(value 없음)가 실리면 안 된다 — 프리필 제안값 지급률만 실린다(시나리오 1)
    expect(toSubmission(s).values).toEqual([{ path: "pay.rate", value: 100 }]);
  });

  it("H3 — 명시적 빈 목록에서 사람이 고르면 그 값으로 · 다 끄면 미입력으로 (「(선택 없음)」 입력은 미결 D3 (a))", () => {
    const base = formReducer(stateOf(new Map([["pay.applied", entered([])]])), { type: "clear", path: "pay.rate" });
    expect(toSubmission(formReducer(base, { type: "edit", path: "pay.applied", draft: ["V01"] })).values).toEqual([
      { path: "pay.applied", value: ["V01"] },
    ]);
    expect(toSubmission(formReducer(base, { type: "edit", path: "pay.applied", draft: [] })).values).toEqual([
      { path: "pay.applied", value: undefined },
    ]);
  });

  it("H4 ③ — 노드를 보기만 하면: 저장 값뿐인 칸은 제출이 비고, 프리필 칸은 시나리오 1 대로 제출된다", () => {
    // 저장 값만 있는 노드 — 손대지 않으면 제출할 것이 없다
    const stored = stateOf(new Map([["pay.rate", entered(80)], ["pay.exempt", entered(false)], ["pay.applied", entered([])]]));
    expect(toSubmission(stored).values).toEqual([]);
    // 프리필 칸은 「보이는 제안을 그대로 두고 저장하면 명시 값」(ADR-0004 · 시나리오 1)이라 제출에 실린다 —
    // 「보기만 해도 저장」은 폼 모델이 아니라 embedded onChange(사람이 고쳤을 때만 올림) 쪽에서 막는다 (H4)
    expect(toSubmission(stateOf()).values).toEqual([{ path: "pay.rate", value: 100 }]);
  });

  it("파싱 오류가 있는 필드는 Issue(typeMismatch + refPath) 로 보고되고 값은 빠진다", () => {
    const s = formReducer(stateOf(), { type: "edit", path: "pay.rate", draft: "팔십" });
    const sub = toSubmission(s);
    expect(sub.values).toEqual([]);
    expect(sub.issues).toHaveLength(1);
    expect(sub.issues[0].kind).toBe("typeMismatch");
    expect(sub.issues[0].at.refPath).toBe("pay.rate");
  });

  it("저장소에서 온 값이 지금 enum 에 없으면 (값 삭제됨) brokenRef 로 보고된다", () => {
    const s = formReducer(stateOf(new Map([["pay.notice", entered("V99")]])), { type: "clear", path: "pay.rate" });
    const sub = toSubmission(s);
    expect(sub.issues[0].kind).toBe("brokenRef");
    expect(sub.issues[0].at.refPath).toBe("pay.notice");
    expect(sub.values).toEqual([]);
  });

  it("제출 순서는 폼 순서(order)를 따른다", () => {
    let s = stateOf();
    s = formReducer(s, { type: "edit", path: "pay.notice", draft: "V01" });
    s = formReducer(s, { type: "edit", path: "pay.exempt", draft: "false" });
    expect(toSubmission(s).values.map((v) => v.path)).toEqual(["pay.exempt", "pay.rate", "pay.notice"]);
  });
});

// ───────────────────────────── 표시 ─────────────────────────────

describe("formatValue — 읽기 전용 표시 문자열 (표시명으로, ADR-0005)", () => {
  it("enum 은 코드가 아니라 표시명, list<enum> 은 표시명 나열", () => {
    const form = benefitForm(
      new Map([
        ["pay.notice", entered("V02")],
        ["pay.applied", entered(["V03", "V01"])],
      ]),
    );
    expect(formatValue(form.fields.find((f) => f.path === "pay.notice")!)).toBe("간편심사");
    expect(formatValue(form.fields.find((f) => f.path === "pay.applied")!)).toBe("건강고지, 일반심사");
  });

  it("boolean 은 예/아니오, 나머지는 문자열 그대로", () => {
    const form = benefitForm(
      new Map([
        ["pay.exempt", entered(true)],
        ["pay.rate", entered(80)],
        ["pay.since", entered("2026-01-01")],
      ]),
    );
    expect(formatValue(form.fields.find((f) => f.path === "pay.exempt")!)).toBe("예");
    expect(formatValue(form.fields.find((f) => f.path === "pay.rate")!)).toBe("80");
    expect(formatValue(form.fields.find((f) => f.path === "pay.since")!)).toBe("2026-01-01");
  });

  it("미입력이면 undefined — 화면이 배지로 대신한다", () => {
    const form = benefitForm();
    expect(formatValue(form.fields[0])).toBeUndefined();
  });

  it("enum 값 코드가 선택지에 없으면 코드를 그대로 보여준다 (깨진 참조가 숨지 않게)", () => {
    const form = benefitForm(
      new Map([["pay.notice", entered("V99")]]));
    expect(formatValue(form.fields.find((f) => f.path === "pay.notice")!)).toBe("V99");
  });
});

// ───────────────────────────── zod ─────────────────────────────

describe("zodValueSchema — 타입 하나의 값 스키마", () => {
  it("6 타입 각각을 받아들이고 모양이 틀리면 거부한다", () => {
    expect(zodValueSchema({ kind: "string" }, enums).safeParse("a").success).toBe(true);
    expect(zodValueSchema({ kind: "string" }, enums).safeParse(1).success).toBe(false);
    expect(zodValueSchema({ kind: "number" }, enums).safeParse(1.5).success).toBe(true);
    expect(zodValueSchema({ kind: "number" }, enums).safeParse("1").success).toBe(false);
    expect(zodValueSchema({ kind: "number" }, enums).safeParse(Number.NaN).success).toBe(false);
    expect(zodValueSchema({ kind: "boolean" }, enums).safeParse(false).success).toBe(true);
    expect(zodValueSchema({ kind: "boolean" }, enums).safeParse(0).success).toBe(false);
    expect(zodValueSchema({ kind: "date" }, enums).safeParse("2026-01-01").success).toBe(true);
    expect(zodValueSchema({ kind: "date" }, enums).safeParse("2026-02-30").success).toBe(false);
    expect(zodValueSchema({ kind: "date" }, enums).safeParse("20260101").success).toBe(false);
    const e = zodValueSchema({ kind: "enum", enumCode: "E0001" }, enums);
    expect(e.safeParse("V01").success).toBe(true);
    expect(e.safeParse("일반심사").success).toBe(false);
    const l = zodValueSchema({ kind: "list<enum>", enumCode: "E0001" }, enums);
    expect(l.safeParse(["V01", "V02"]).success).toBe(true);
    expect(l.safeParse([]).success).toBe(true);
    expect(l.safeParse(["V01", "V01"]).success).toBe(false);
    expect(l.safeParse(["V09"]).success).toBe(false);
    expect(l.safeParse("V01").success).toBe(false);
  });

  it("없는 enum 을 가리키면 어떤 값도 받지 않는다", () => {
    expect(zodValueSchema({ kind: "enum", enumCode: "E9999" }, enums).safeParse("V01").success).toBe(
      false,
    );
  });
});

describe("zodSchemaFor — 제출 목록 스키마 (서버 액션 입력 검증)", () => {
  const schema = zodSchemaFor("benefit", enums, master);

  it("폼이 만든 제출 목록을 그대로 받아들인다", () => {
    let s = stateOf(new Map([["pay.note", entered("메모")]]));
    s = formReducer(s, { type: "edit", path: "pay.rate", draft: "80" });
    s = formReducer(s, { type: "edit", path: "pay.applied", draft: ["V01"] });
    s = formReducer(s, { type: "clear", path: "pay.note" });
    const sub = toSubmission(s);
    expect(schema.safeParse(sub.values).success).toBe(true);
  });

  it("경로마다 타입이 맞아야 한다 — 지급률에 문자열은 거부", () => {
    expect(schema.safeParse([{ path: "pay.rate", value: "80" }]).success).toBe(false);
    expect(schema.safeParse([{ path: "pay.notice", value: "V09" }]).success).toBe(false);
  });

  it("value 없음(undefined) 은 값 지우기로 허용한다", () => {
    expect(schema.safeParse([{ path: "pay.rate" }]).success).toBe(true);
    expect(schema.safeParse([{ path: "pay.rate", value: undefined }]).success).toBe(true);
  });

  it("이 레벨의 자리가 아닌 경로는 거부한다", () => {
    expect(schema.safeParse([{ path: "coverage_basic.renewal", value: true }]).success).toBe(false);
    expect(schema.safeParse([{ path: "pay.gone", value: "x" }]).success).toBe(false);
  });

  it("그룹 없는 필드 하나뿐인 레벨은 경로가 `레벨.필드` 하나", () => {
    const s = zodSchemaFor("coverage", enums, master);
    expect(s.safeParse([{ path: "coverage_basic.renewal", value: true }]).success).toBe(true);
    expect(s.safeParse([{ path: "coverage_basic.renewal", value: "true" }]).success).toBe(false);
  });

  it("마스터가 빈 레벨은 값 자리가 없다 — 빈 목록만 허용", () => {
    const s = zodSchemaFor("product", enums, master);
    expect(s.safeParse([]).success).toBe(true);
    expect(s.safeParse([{ path: "product.x", value: "x" }]).success).toBe(false);
  });
});

// ───────────────────────────── table · 여는 폼 ─────────────────────────────

describe("table 필드 · 여는 폼", () => {
  const master: MasterForm[] = [
    {
      key: "reduction", label: "감액", level: "benefit", optional: true,
      fields: [
        { key: "periods", label: "구간", type: { kind: "table", columns: [{ key: "end", label: "기간", type: "period" }, { key: "rate", label: "지급률", type: "percent" }] } },
        { key: "new_only", label: "신규계약만", type: { kind: "boolean" }, defaultValue: true },
      ],
    },
  ];
  const enums: EnumLookup = () => undefined;

  it("안 연 폼은 카드가 닫혀 있고 제출에 아무것도 없다 · 저장값이 있으면 열려 있다", () => {
    const closed = initFormState(buildForm("benefit", enums, new Map(), undefined, master));
    expect(closed.open.reduction).toBe(false);
    expect(toSubmission(closed).values).toEqual([]);
    const opened = initFormState(buildForm("benefit", enums, new Map([["reduction.periods", entered([{ end: 12, rate: 50 }])]]), undefined, master));
    expect(opened.open.reduction).toBe(true);
    expect(opened.fields["reduction.periods"].draft).toEqual([["1Y", "50"]]);
  });
  it("열면 프리필이 들어오고 · 표 초안을 편집하면 행으로 파싱 · 닫으면 저장돼 있던 값은 지우기로 제출", () => {
    let s = initFormState(buildForm("benefit", enums, new Map([["reduction.periods", entered([{ end: 12, rate: 50 }])]]), undefined, master));
    s = formReducer(s, { type: "edit", path: "reduction.periods", draft: [["3M", "10%"], ["1Y", "50"]] });
    expect(s.fields["reduction.periods"].value).toEqual([{ end: 3, rate: 10 }, { end: 12, rate: 50 }]);
    s = formReducer(s, { type: "edit", path: "reduction.periods", draft: [["1Y", "50"], ["3M", "10"]] });
    expect(s.fields["reduction.periods"].error).toContain("2행"); // 구간 규칙(validateSlotValue)
    s = formReducer(s, { type: "closeForm", form: "reduction" });
    expect(s.open.reduction).toBe(false);
    expect(toSubmission(s).values).toEqual([{ path: "reduction.periods", value: undefined }]);
    s = formReducer(s, { type: "openForm", form: "reduction" });
    expect(s.fields["reduction.new_only"].proposed).toBe(true);
  });
  it("formatValue 는 표를 「n행」으로", () => {
    const view = buildForm("benefit", enums, new Map([["reduction.periods", entered([{ end: 12, rate: 50 }])]]), undefined, master).fields[0];
    expect(formatValue(view)).toBe("1행");
  });
});

describe("기본 숨김 필드 (hiddenByDefault) — 감액 「이후 지급률」 (기능/담보 §3.4)", () => {
  const master: MasterForm[] = [
    {
      key: "reduction", label: "감액", level: "benefit", optional: true,
      fields: [
        { key: "periods", label: "구간", type: { kind: "table", columns: [{ key: "end", label: "기간", type: "period" }, { key: "rate", label: "지급률", type: "percent" }] } },
        { key: "after_rate", label: "이후 지급률", type: { kind: "number" }, defaultValue: 100, hiddenByDefault: true },
        { key: "new_only", label: "신규계약만", type: { kind: "boolean" }, defaultValue: true },
      ],
    },
  ];
  const enums: EnumLookup = () => undefined;
  const periods = ["reduction.periods", entered([{ end: 12, rate: 50 }])] as const;
  const stateWith = (...slots: (readonly [string, ValueSlot])[]) =>
    initFormState(buildForm("benefit", enums, new Map(slots), undefined, master));

  it("폼 모델이 필드 속성을 옮긴다 — 붙인 필드만", () => {
    const model = buildForm("benefit", enums, new Map(), undefined, master);
    expect(model.fields.find((f) => f.path === "reduction.after_rate")?.hiddenByDefault).toBe(true);
    expect(model.fields.find((f) => f.path === "reduction.new_only")?.hiddenByDefault).toBeUndefined();
  });

  it("프리필 제안(100) 그대로면 숨긴다 · 숨긴 채 저장하면 100 이 명시 값으로 실린다", () => {
    let s = stateWith();
    s = formReducer(s, { type: "openForm", form: "reduction" });
    expect(isFieldHidden(s, "reduction.after_rate")).toBe(true);
    expect(isFieldHidden(s, "reduction.new_only")).toBe(false);
    expect(toSubmission(s).values).toContainEqual({ path: "reduction.after_rate", value: 100 });
  });

  it("저장된 값이 100 이면 숨김 유지 · 100 이 아니면 보인다", () => {
    expect(isFieldHidden(stateWith(periods, ["reduction.after_rate", entered(100)]), "reduction.after_rate")).toBe(true);
    expect(isFieldHidden(stateWith(periods, ["reduction.after_rate", entered(80)]), "reduction.after_rate")).toBe(false);
  });

  it("펼치면(reveal) 보인다 — 제출은 바뀌지 않는다", () => {
    const s = stateWith(periods, ["reduction.after_rate", entered(100)]);
    const revealed = formReducer(s, { type: "reveal", path: "reduction.after_rate" });
    expect(isFieldHidden(revealed, "reduction.after_rate")).toBe(false);
    expect(toSubmission(revealed)).toEqual(toSubmission(s));
  });
});

describe("선택 필드 (optional) — 면책여부 · 지급률, 필요할 때만 「⊕」로 더한다 (2026-09-27)", () => {
  const master: MasterForm[] = [
    {
      key: "pay", label: "보험금지급", level: "benefit",
      fields: [
        { key: "exempt", label: "면책여부", type: { kind: "boolean" }, optional: true },
        { key: "rate", label: "지급률", type: { kind: "number" }, optional: true, defaultValue: 100 },
        { key: "note", label: "비고", type: { kind: "string" } },
      ],
    },
  ];
  const enums: EnumLookup = () => undefined;
  const stateWith = (...slots: [string, ValueSlot][]) => initFormState(buildForm("benefit", enums, new Map(slots), undefined, master));

  it("폼 모델이 필드 속성 optional 을 옮긴다 — 붙인 필드만", () => {
    const model = buildForm("benefit", enums, new Map(), undefined, master);
    expect(model.fields.map((f) => [f.path, f.optional])).toEqual([
      ["pay.exempt", true],
      ["pay.rate", true],
      ["pay.note", undefined],
    ]);
  });

  it("값이 없으면 자리가 없다 — 기본값이 있어도 프리필하지 않는다 · 제출에 없다", () => {
    const s = stateWith();
    expect(isFieldAbsent(s, "pay.exempt")).toBe(true);
    expect(isFieldAbsent(s, "pay.rate")).toBe(true);
    expect(isFieldAbsent(s, "pay.note")).toBe(false);
    expect(s.fields["pay.rate"].draft).toBe("");
    expect(s.fields["pay.rate"].proposed).toBe(false);
    expect(toSubmission(s).values).toEqual([]);
  });

  it("저장 값이 있으면 자리가 있다", () => {
    const s = stateWith(["pay.rate", entered(80)]);
    expect(isFieldAbsent(s, "pay.rate")).toBe(false);
    expect(s.fields["pay.rate"].draft).toBe("80");
  });

  it("addField — 자리가 생기고 기본값이 제안으로 채워진다 · 저장하면 실린다", () => {
    const s = formReducer(stateWith(), { type: "addField", path: "pay.rate" });
    expect(isFieldAbsent(s, "pay.rate")).toBe(false);
    expect(s.added["pay.rate"]).toBe(true);
    expect(s.fields["pay.rate"].draft).toBe("100");
    expect(s.fields["pay.rate"].proposed).toBe(true);
    expect(toSubmission(s).values).toEqual([{ path: "pay.rate", value: 100 }]);
  });

  it("더한 뒤 칸을 비워도 자리는 남는다 — 빼려면 removeField", () => {
    let s = formReducer(stateWith(), { type: "addField", path: "pay.exempt" });
    s = formReducer(s, { type: "edit", path: "pay.exempt", draft: "" });
    expect(isFieldAbsent(s, "pay.exempt")).toBe(false);
  });

  it("removeField — 자리를 감추고 저장돼 있던 값은 지우기로 제출한다", () => {
    const s = formReducer(stateWith(["pay.exempt", entered(true)]), { type: "removeField", path: "pay.exempt" });
    expect(isFieldAbsent(s, "pay.exempt")).toBe(true);
    expect(s.fields["pay.exempt"].entered).toBe(false);
    expect(toSubmission(s).values).toEqual([{ path: "pay.exempt", value: undefined }]);
  });

  it("더했다가 바로 빼면 제출할 것이 없다", () => {
    let s = formReducer(stateWith(), { type: "addField", path: "pay.rate" });
    s = formReducer(s, { type: "removeField", path: "pay.rate" });
    expect(isFieldAbsent(s, "pay.rate")).toBe(true);
    expect(toSubmission(s).values).toEqual([]);
  });

  it("선택 필드가 아니면 addField · removeField 는 아무것도 하지 않는다", () => {
    const s = stateWith();
    expect(formReducer(s, { type: "removeField", path: "pay.note" })).toBe(s);
    expect(formReducer(s, { type: "addField", path: "pay.note" })).toBe(s);
  });

  it("reset(저장 후 새 모델) 이면 더한 표시가 초기화된다", () => {
    let s = formReducer(stateWith(), { type: "addField", path: "pay.rate" });
    s = formReducer(s, { type: "reset", model: buildForm("benefit", enums, new Map(), undefined, master) });
    expect(s.added).toEqual({});
    expect(isFieldAbsent(s, "pay.rate")).toBe(true);
  });
});
