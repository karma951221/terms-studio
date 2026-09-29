/**
 * 관통 1 축약 픽스처 (공통/기술/아키텍처 「시드와 초기 데이터」) — 조립 입력(`AssemblyInput`)을 도메인 객체로.
 *
 * 실물(알파Plus)을 본뜬 축약: 상품 「알파Plus(축약)」 = 일반상해사망 × {기본} · × {추가}, 기본계약 = 기본,
 * 그룹 「상해 관련 특별약관」, 보통약관 1벌(4개 조 · 별표 참조 1), 공용조항 2건(소멸 block + 옵션 · 준용 inline),
 * 별표 마스터 2건(참조되는 것은 1건). B3 `surgeryFixture` 와 코드 체계를 맞췄다:
 *   마스터: 상품 기본{고지유형(enum E0001)} · 담보 기본{갱신여부 · 감액기간 · 감액기간문구} · 급부 보험금지급{면책여부 · 지급률} ·
 *   세목 납입면제{적용여부 · 면제개월} · 무저해지{유형(enum E0002)} · 계약전환{전환여부 — 선택지 없음(빈 범위용)}
 *   구분자(전부 식): D0001 갱신여부 · D0002 고지유형 · D0003 지급률 · D0004 평균공시이율(리터럴) ·
 *   D0005 면책여부합(집계) · D0006 감액기간 · D0007 감액기간문구 ·
 *   세목 레벨 D0008 납입면제적용 · D0009 무저해지형여부 · D0010 1종여부(내장 경로) · D0011 장기미면제(D0008 참조) · D0012 두 폼 읽기(정의 검사가 거부하는 꼴)
 *   담보속성 A0001 갱신유형 {V01 비갱신형 · V02 갱신형} · A0002 부가유형 {V01 기본 · V02 추가}
 *   세목 선택지(유효 조합에 등장하는 것): 1종(면제 · 12) · 2종(미면제 · 24) · 1형(지급형) · 2형(무저해지형)
 * id 는 읽기 쉬운 고정 문자열 — 스냅샷 안정성. 시드(D3)·서비스 통합 테스트가 같은 모양을 DB 로 만든다.
 *
 * 기대 (계획 §5): 특약 2벌 본문 동일(제목만 다름) · 준용규정 조 생략 · 별표 번호 1 · issues 0 · complete.
 */

import type { Discriminator, EnumDef, SlotPath } from "../catalog/types";
import type { Clause } from "../clause/types";
import type { Appendix } from "../document/appendix";
import type { DocumentNode } from "../document/nodes";
import type { MasterForm } from "../master";
import type { AttributeKind, ProductCoverageSnapshot, SpecialGroup } from "../product/types";
import type { PlanAxis } from "../product/types";
import { type Code, entered, type Id, type Value, type ValueSlot } from "../types";
import type { AssemblyCoverage, AssemblyInput, AssemblyPlanOption } from "./types";

// ───────────────────────────── 카탈로그 ─────────────────────────────

export const alphaEnums: EnumDef[] = [
  {
    code: "E0001",
    label: "고지유형",
    values: [
      { code: "V01", label: "일반심사", order: 0 },
      { code: "V02", label: "간편심사", order: 1 },
    ],
  },
  {
    code: "E0002",
    label: "무저해지유형",
    values: [
      { code: "V01", label: "지급형", order: 0 },
      { code: "V02", label: "무저해지형", order: 1 },
    ],
  },
];

/**
 * 픽스처 마스터 (입력 마스터의 축약본 — ADR-0037 · 기능/마스터 §3.1: 폼 › 필드, 경로는 `폼키.필드키`).
 * 마스터가 코드라는 것은 「유저가 정의하지 않는다」는 뜻이고, 픽스처가 자기 어휘를 갖는 것은 막지 않는다.
 * MVP 정본은 `src/domain/master/catalog.ts` 다.
 */
export const alphaMaster: MasterForm[] = [
  {
    key: "product_basic",
    label: "상품 기본",
    level: "product",
    fields: [{ key: "notice", label: "고지유형", type: { kind: "enum", enumCode: "E0001" } }],
  },
  {
    key: "waiver",
    label: "납입면제",
    level: "plan",
    fields: [
      { key: "applies", label: "적용여부", type: { kind: "boolean" } },
      { key: "months", label: "면제개월", type: { kind: "number" } },
    ],
  },
  {
    key: "no_surrender",
    label: "무저해지",
    level: "plan",
    fields: [{ key: "type", label: "유형", type: { kind: "enum", enumCode: "E0002" } }],
  },
  {
    key: "conversion",
    label: "계약전환",
    level: "plan",
    fields: [{ key: "converts", label: "전환여부", type: { kind: "boolean" } }],
  },
  {
    key: "coverage_basic",
    label: "담보 기본",
    level: "coverage",
    fields: [
      { key: "renewal", label: "갱신여부", type: { kind: "boolean" } },
      { key: "reduction_months", label: "감액기간", type: { kind: "number" } },
      { key: "reduction_text", label: "감액기간문구", type: { kind: "string" } },
    ],
  },
  {
    key: "pay",
    label: "보험금지급",
    level: "benefit",
    fields: [
      { key: "exempt", label: "면책여부", type: { kind: "boolean" } },
      { key: "rate", label: "지급률", type: { kind: "number" } },
    ],
  },
];

/** 문면이 보는 것은 구분자뿐이다 — 전부 식 하나 (ADR-0037). 코드는 옛 픽스처 그대로 둔다. */
export const alphaCatalog: Discriminator[] = [
  { code: "D0001", label: "갱신여부", description: "", level: "coverage", expression: "coverage_basic.renewal" },
  { code: "D0002", label: "고지유형", description: "", level: "product", expression: "product_basic.notice" },
  { code: "D0003", label: "지급률", description: "", level: "benefit", expression: "pay.rate" },
  // 옛 const 구분자 — 값이 마스터에 사는 게 아니라 식이 리터럴이다
  { code: "D0004", label: "평균공시이율", description: "", level: "product", expression: "'2.5%'" },
  { code: "D0005", label: "면책여부합", description: "", level: "coverage", expression: "any(pay.exempt)" },
  { code: "D0006", label: "감액기간", description: "", level: "coverage", expression: "coverage_basic.reduction_months" },
  { code: "D0007", label: "감액기간문구", description: "", level: "coverage", expression: "coverage_basic.reduction_text" },
  // 세목 레벨 — 선택지마다 평가된다 (설계 §2.3). 상위(상품 · 보통약관)에서는 집계로만 부른다.
  { code: "D0008", label: "납입면제적용", description: "", level: "plan", expression: "waiver.applies" },
  { code: "D0009", label: "무저해지형여부", description: "", level: "plan", expression: "no_surrender.type = 'V02'" },
  { code: "D0010", label: "1종여부", description: "", level: "plan", expression: "builtin.plan.name = '1종'" },
  { code: "D0011", label: "장기미면제", description: "", level: "plan", expression: "not D0008 and waiver.months > 20" },
  // 두 폼을 읽는 식 — 정의 검사(`checkReferenceRules`)가 거부하는 꼴. 평가 경로의 자리 없음을 시험하려고 둔다.
  { code: "D0012", label: "두폼읽기", description: "", level: "plan", expression: "waiver.applies and no_surrender.type = 'V01'" },
];

// ───────────────────────────── 세목 선택지 ─────────────────────────────

/** 세목 선택지 하나 — 값은 그 유형(폼)의 자리. */
export function planOption(id: Id, axis: PlanAxis, number: number, name: string, planTypeCode: Code, values: Record<SlotPath, Value>): AssemblyPlanOption {
  return { id, axis, number, name, planTypeCode, values: new Map(Object.entries(values).map(([p, v]) => [p, entered(v)])) };
}

/** 유효 조합 (1종,1형) · (1종,2형) · (2종,1형) 에 등장하는 선택지 합집합 — 계약전환 폼의 선택지는 없다 (빈 범위). */
export const alphaPlanOptions: AssemblyPlanOption[] = [
  planOption("opt-type-1", "type", 1, "1종", "waiver", { "waiver.applies": true, "waiver.months": 12 }),
  planOption("opt-type-2", "type", 2, "2종", "waiver", { "waiver.applies": false, "waiver.months": 24 }),
  planOption("opt-form-1", "form", 1, "1형", "no_surrender", { "no_surrender.type": "V01" }),
  planOption("opt-form-2", "form", 2, "2형", "no_surrender", { "no_surrender.type": "V02" }),
];

export const alphaAttributeKinds: AttributeKind[] = [
  {
    code: "A0001",
    label: "갱신유형",
    order: 0,
    values: [
      { code: "1", label: "비갱신형", fragment: "" },
      { code: "2", label: "갱신형", fragment: "갱신형" },
    ],
  },
  {
    code: "A0002",
    label: "부가유형",
    order: 1,
    values: [
      { code: "1", label: "기본", fragment: "" },
      { code: "2", label: "추가", fragment: "추가" },
    ],
  },
];

// ───────────────────────────── 공용조항 · 별표 ─────────────────────────────

export const alphaClauses: Clause[] = [
  {
    code: "C0001",
    label: "특별약관의 소멸",
    mode: "block",
    body: [
      {
        id: "c1-par",
        kind: "paragraph",
        children: [
          { id: "c1-t1", kind: "text", text: "이 특별약관은 " },
          { id: "c1-opt", kind: "optionSlot", optionCode: "O01" },
          { id: "c1-t2", kind: "text", text: " 소멸합니다." },
        ],
      },
    ],
    options: [
      {
        code: "O01",
        label: "소멸 사유",
        order: 0,
        values: [
          { code: "V01", label: "일반", order: 0, body: [{ id: "c1-o-gen", kind: "text", text: "보험기간이 끝난 때" }] },
          { code: "V02", label: "사망", order: 1, body: [{ id: "c1-o-death", kind: "text", text: "피보험자가 사망한 때" }] },
        ],
      },
    ],
    required: { discriminators: [], attributes: [] },
  },
  {
    code: "C0002",
    label: "준용 문구",
    mode: "inline",
    body: [
      { id: "c2-t1", kind: "text", text: "이 약관에서 정하지 않은 사항은 " },
      { id: "c2-ref", kind: "articleRef", targets: [{ articleId: "g-art-def" }], connector: "및" },
      { id: "c2-t2", kind: "text", text: " 및 관계 법령을 따릅니다." },
    ],
    options: [],
    required: { discriminators: [], attributes: [] },
  },
  {
    code: "C0003",
    label: "보통약관 면책 보충",
    mode: "block",
    body: [{ id: "c3-par", kind: "paragraph", children: [{ id: "c3-text", kind: "text", text: "법령에 따라 보험금 지급이 제한되는 경우에는 보험금을 지급하지 않습니다." }] }],
    options: [],
    required: { discriminators: [], attributes: [] },
  },
];

export const alphaAppendices: Appendix[] = [
  { code: "APX_DISABILITY", name: "장해분류표", description: "" },
  { code: "APX_BURN", name: "화상 분류표", description: "" },
];

// ───────────────────────────── 문서 ─────────────────────────────

export function alphaGeneralDocumentLegacy(): DocumentNode {
  return {
    id: "g-doc",
    kind: "document",
    title: "알파Plus 보통약관",
    children: [
      { id: "g-art-def", kind: "article", title: "용어의 정의", children: [{ id: "g-par-def", kind: "paragraph", children: [{ id: "g-txt-def", kind: "text", text: "이 계약에서 사용하는 용어의 정의는 다음과 같습니다." }] }] },
      {
        id: "g-art-pay",
        kind: "article",
        title: "보험금의 지급사유",
        children: [
          {
            id: "g-par-pay-1",
            kind: "paragraph",
            children: [
              { id: "g-txt-pay-1", kind: "text", text: "회사는 피보험자가 " },
              {
                id: "g-inl-renew",
                kind: "inlineCond",
                branches: [
                  { id: "g-inl-renew-if", when: "D0001 = true", children: [{ id: "g-txt-pay-2", kind: "text", text: "최초계약일" }] },
                  { id: "g-inl-renew-else", children: [{ id: "g-txt-pay-3", kind: "text", text: "계약일" }] },
                ],
              },
              { id: "g-txt-pay-4", kind: "text", text: " 이후 기본계약의 보험금 지급사유가 발생한 때 보험금을 지급합니다." },
            ],
          },
          {
            id: "g-cond-notice",
            kind: "condBlock",
            branches: [
              {
                id: "g-cond-notice-if",
                when: "D0002 = 'V02'",
                children: [
                  {
                    id: "g-par-pay-2",
                    kind: "paragraph",
                    children: [
                      { id: "g-txt-pay-5", kind: "text", text: "이 계약은 " },
                      { id: "g-slot-notice", kind: "slot", ref: "D0002" },
                      { id: "g-txt-pay-6", kind: "text", text: " 계약입니다." },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "g-art-disability",
        kind: "article",
        title: "장해의 분류",
        children: [
          {
            id: "g-par-dis",
            kind: "paragraph",
            children: [
              { id: "g-txt-dis-1", kind: "text", text: "장해의 분류는 " },
              { id: "g-apx-disability", kind: "appendixRef", appendixCode: "APX_DISABILITY" },
              { id: "g-txt-dis-2", kind: "text", text: " 에 따릅니다." },
            ],
          },
        ],
      },
      { id: "g-art-apply", kind: "article", title: "준용규정", children: [{ id: "g-par-apply", kind: "paragraph", children: [{ id: "g-clause-apply", kind: "clauseInlineRef", clauseCode: "C0002", options: {} }] }] },
    ],
  };
}

export function alphaDeathDocumentLegacy(): DocumentNode {
  return {
    id: "s-doc-death",
    kind: "document",
    title: "일반상해사망 특별약관",
    children: [
      {
        id: "s-art-pay",
        kind: "article",
        title: "보험금의 지급사유",
        children: [
          {
            id: "s-par-pay-1",
            kind: "paragraph",
            children: [
              { id: "s-txt-pay-1", kind: "text", text: "회사는 피보험자가 " },
              {
                id: "s-inl-renew",
                kind: "inlineCond",
                branches: [
                  { id: "s-inl-renew-if", when: "exist(attr.A0001) and attr.A0001 = '2'", children: [{ id: "s-txt-pay-2", kind: "text", text: "최초계약일" }] },
                  { id: "s-inl-renew-else", children: [{ id: "s-txt-pay-3", kind: "text", text: "계약일" }] },
                ],
              },
              { id: "s-txt-pay-4", kind: "text", text: " 이후 상해로 사망한 경우 사망보험금을 지급합니다." },
            ],
          },
          {
            id: "s-par-pay-2",
            kind: "paragraph",
            children: [
              { id: "s-txt-pay-5", kind: "text", text: "사망보험금은 보험가입금액에 평균공시이율 " },
              { id: "s-slot-rate", kind: "slot", ref: "D0004" },
              { id: "s-txt-pay-6", kind: "text", text: " 을 적용하여 계산합니다." },
            ],
          },
        ],
      },
      {
        id: "s-cond-exempt",
        kind: "condBlock",
        branches: [
          {
            id: "s-cond-exempt-if",
            when: "D0005 = true",
            children: [
              {
                id: "s-art-exempt",
                kind: "article",
                title: "보험금을 지급하지 않는 사유",
                children: [
                  {
                    id: "s-par-exempt",
                    kind: "paragraph",
                    children: [{ id: "s-txt-exempt-1", kind: "text", text: "회사는 다음 중 어느 한 가지로 보험금 지급사유가 발생한 때에는 보험금을 지급하지 않습니다." }],
                    items: [
                      { id: "s-item-exempt-1", kind: "item", children: [{ id: "s-txt-exempt-2", kind: "text", text: "피보험자가 고의로 자신을 해친 경우" }] },
                      {
                        id: "s-item-exempt-2",
                        kind: "item",
                        children: [{ id: "s-txt-exempt-3", kind: "text", text: "보험수익자가 고의로 피보험자를 해친 경우" }],
                        subitems: [{ id: "s-sub-exempt", kind: "subitem", children: [{ id: "s-txt-exempt-4", kind: "text", text: "다만, 그 보험수익자가 보험금의 일부 보험수익자인 경우에는 다른 보험수익자에 대한 보험금은 지급합니다." }] }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "s-art-reduce",
        kind: "article",
        title: "보험금의 감액지급",
        children: [
          {
            id: "s-par-reduce",
            kind: "paragraph",
            children: [
              { id: "s-txt-reduce-1", kind: "text", text: "계약일부터 " },
              { id: "s-slot-reduce", kind: "slot", ref: "D0007" },
              { id: "s-txt-reduce-2", kind: "text", text: " 이내에 발생한 사망에 대해서는 사망보험금의 50%를 지급합니다." },
            ],
          },
        ],
      },
      {
        id: "s-art-lapse",
        kind: "article",
        title: "특별약관의 소멸",
        children: [
          { id: "s-par-lapse", kind: "paragraph", children: [{ id: "s-txt-lapse", kind: "text", text: "이 특별약관은 다음의 경우 소멸합니다." }] },
          { id: "s-clause-lapse", kind: "clauseBlockRef", clauseCode: "C0001", options: { O01: "V02" } },
        ],
      },
      {
        id: "s-art-apply",
        kind: "article",
        title: "준용규정",
        linkedArticleId: "g-art-apply",
        children: [{ id: "s-par-apply", kind: "paragraph", children: [{ id: "s-clause-apply", kind: "clauseInlineRef", clauseCode: "C0002", options: {} }] }],
      },
    ],
  };
}

/** 3차 관통 픽스처의 평평한 보통약관 — 기본계약 조가 제2·3조 본문을 대치한다. */
export function alphaGeneralDocument(): DocumentNode {
  return {
    id: "g-doc",
    kind: "document",
    title: "알파Plus 보통약관",
    children: [
      { id: "g-art-def", kind: "article", title: "용어의 정의", children: [{ id: "g-par-def", kind: "paragraph", children: [{ id: "g-txt-def", kind: "text", text: "이 계약에서 사용하는 용어의 정의는 다음과 같습니다." }] }] },
      { id: "g-art-pay", kind: "article", title: "보험금의 지급사유", children: [] },
      { id: "g-art-detail", kind: "article", title: "보험금 지급에 관한 세부규정", children: [] },
      {
        id: "g-art-exempt",
        kind: "article",
        title: "보험금을 지급하지 않는 사유",
        children: [
          { id: "g-par-exempt", kind: "paragraph", children: [{ id: "g-txt-exempt", kind: "text", text: "고의로 사고를 일으킨 경우에는 보험금을 지급하지 않습니다." }] },
          { id: "g-clause-exempt-extra", kind: "clauseBlockRef", clauseCode: "C0003", options: {}, excludeFromComparison: true },
        ],
      },
      {
        id: "g-art-disability",
        kind: "article",
        title: "장해의 분류",
        children: [{ id: "g-par-dis", kind: "paragraph", children: [{ id: "g-txt-dis-1", kind: "text", text: "장해의 분류는 " }, { id: "g-apx-disability", kind: "appendixRef", appendixCode: "APX_DISABILITY" }, { id: "g-txt-dis-2", kind: "text", text: " 에 따릅니다." }] }],
      },
      {
        id: "g-art-refund",
        kind: "article",
        title: "해약환급금",
        children: [
          { id: "g-par-refund-1", kind: "paragraph", code: "P0100", children: [{ id: "g-txt-refund-1", kind: "text", text: "계약이 해지된 경우 해약환급금을 지급합니다." }] },
          { id: "g-par-refund-2", kind: "paragraph", code: "P0200", children: [{ id: "g-txt-refund-2", kind: "text", text: "해약환급금은 산출방법서에 따라 계산합니다." }] },
        ],
      },
    ],
  };
}

/** 기본계약 담보 문면 — 두 조 모두 대응 보통약관 조에 연결되어 1개 모드에서 대치된다. */
export function alphaBaseDocument(): DocumentNode {
  return {
    id: "b-doc-death",
    kind: "document",
    title: "상해사망 기본계약 문면",
    children: [
      {
        id: "b-art-pay",
        kind: "article",
        title: "보험금의 지급사유",
        linkedArticleId: "g-art-pay",
        children: [{ id: "b-par-pay", kind: "paragraph", children: [{ id: "b-txt-pay", kind: "text", text: "피보험자가 보험기간 중 상해로 사망한 경우 보험금을 지급합니다." }] }],
      },
      {
        id: "b-art-detail",
        kind: "article",
        title: "보험금 지급에 관한 세부규정",
        linkedArticleId: "g-art-detail",
        children: [{ id: "b-par-detail", kind: "paragraph", children: [{ id: "b-txt-detail", kind: "text", text: "보험금 지급에 관한 세부사항은 산출방법서에 따릅니다." }] }],
      },
    ],
  };
}

/** 일반상해사망 특약 — 통째·생략·준용 세 갈래와 자동 준용규정을 모두 통과한다. */
export function alphaDeathDocument(): DocumentNode {
  return {
    id: "s-doc-death",
    kind: "document",
    title: "일반상해사망 특별약관",
    children: [
      {
        id: "s-art-pay",
        kind: "article",
        title: "보험금의 지급사유",
        linkedArticleId: "g-art-pay",
        children: [
          {
            id: "s-par-pay",
            kind: "paragraph",
            children: [
              { id: "s-txt-pay-1", kind: "text", text: "회사는 피보험자가 " },
              { id: "s-inl-renew", kind: "inlineCond", branches: [{ id: "s-inl-renew-if", when: "exist(attr.A0001) and attr.A0001 = '2'", children: [{ id: "s-txt-pay-2", kind: "text", text: "최초계약일" }] }, { id: "s-inl-renew-else", children: [{ id: "s-txt-pay-3", kind: "text", text: "계약일" }] }] },
              { id: "s-txt-pay-4", kind: "text", text: " 이후 상해로 사망한 경우 사망보험금을 지급합니다. 평균공시이율 " },
              { id: "s-slot-rate", kind: "slot", ref: "D0004" },
              { id: "s-txt-pay-5", kind: "text", text: "를 적용합니다." },
            ],
          },
        ],
      },
      {
        id: "s-cond-exempt",
        kind: "condBlock",
        branches: [{ id: "s-cond-exempt-if", when: "D0005 = true", children: [{ id: "s-art-exempt", kind: "article", title: "보험금을 지급하지 않는 사유", linkedArticleId: "g-art-exempt", children: [{ id: "s-par-exempt", kind: "paragraph", children: [{ id: "s-txt-exempt", kind: "text", text: "고의로 사고를 일으킨 경우에는 보험금을 지급하지 않습니다." }] }] }] }],
      },
      {
        id: "s-art-reduce",
        kind: "article",
        title: "보험금의 감액지급",
        linkedArticleId: "g-art-refund",
        children: [
          { id: "s-par-refund-1", kind: "paragraph", children: [{ id: "s-txt-refund-1", kind: "text", text: "계약이 해지된 경우 해약환급금을 지급합니다." }] },
          { id: "s-par-refund-2", kind: "paragraph", children: [{ id: "s-txt-refund-2", kind: "text", text: "해약환급금은 산출방법서에 따라 계산합니다." }] },
          {
            id: "s-par-reduce-extra",
            kind: "paragraph",
            children: [
              { id: "s-txt-reduce-1", kind: "text", text: "계약일부터 " },
              { id: "s-slot-reduce", kind: "slot", ref: "D0007" },
              { id: "s-txt-reduce-2", kind: "text", text: " 이내에는 감액 지급하며, " },
              { id: "s-ref-refund", kind: "articleRef", scope: "general", targets: [{ articleId: "g-art-refund", code: "P0100" }, { articleId: "g-art-refund", code: "P0200" }], connector: "및" },
              { id: "s-txt-reduce-3", kind: "text", text: "을 확인합니다." },
            ],
          },
        ],
      },
      {
        id: "s-art-lapse",
        kind: "article",
        title: "특별약관의 소멸",
        children: [{ id: "s-clause-lapse", kind: "clauseBlockRef", clauseCode: "C0001", options: { O01: "V02" } }],
      },
    ],
  };
}

// ───────────────────────────── 상품담보 조립 헬퍼 ─────────────────────────────

export interface CoverageSpec {
  id: Id;
  name: string;
  coverageId: Id;
  coverageName: string;
  attributes: { kindCode: Code; valueCode: Code }[];
  /** 세부보장 → 급부 (마스터 노드 id 는 `${id}` 그대로 쓴다 — 픽스처 단순화). */
  subCoverages: { id: Id; masterNodeId: Id; name: string; benefits: { id: Id; masterNodeId: Id; name: string }[] }[];
  /** owner id → 경로 → 값. */
  values: Record<Id, Record<SlotPath, Value>>;
  groupId?: Id;
}

export function coverageEntry(spec: CoverageSpec): AssemblyCoverage {
  const snapshot: ProductCoverageSnapshot = {
    id: spec.id,
    productId: "prod-alpha",
    coverageId: spec.coverageId,
    coverageName: spec.coverageName,
    name: spec.name,
    attributes: spec.attributes,
    subCoverages: spec.subCoverages.map((s, i) => ({
      id: s.id,
      productCoverageId: spec.id,
      kind: "sub",
      masterNodeId: s.masterNodeId,
      name: s.name,
      order: i,
      benefits: s.benefits.map((b, j) => ({ id: b.id, productCoverageId: spec.id, kind: "benefit", masterNodeId: b.masterNodeId, parentId: s.id, name: b.name, order: j })),
    })),
  };
  const values = new Map<Id, Map<SlotPath, ValueSlot>>();
  for (const [owner, slots] of Object.entries(spec.values)) {
    values.set(owner, new Map(Object.entries(slots).map(([p, v]) => [p, entered(v)])));
  }
  return {
    snapshot,
    values,
    plans: [],
    ...(spec.groupId !== undefined ? { groupId: spec.groupId } : {}),
  };
}

/** 일반상해사망 탑재분 하나 — 스냅샷 값은 마스터와 같다 (갱신여부 false · 면책 true · 지급률 100 · 감액기간 24). */
export function deathCoverage(id: Id, name: string, attributes: CoverageSpec["attributes"], groupId?: Id): AssemblyCoverage {
  return coverageEntry({
    id,
    name,
    coverageId: "cov-death",
    coverageName: "일반상해사망",
    attributes,
    subCoverages: [{ id: `${id}-sub`, masterNodeId: "sub-death", name: "일반상해사망", benefits: [{ id: `${id}-ben`, masterNodeId: "ben-death", name: "사망보험금" }] }],
    values: {
      [id]: { "coverage_basic.renewal": false, "coverage_basic.reduction_months": 24, "coverage_basic.reduction_text": "24개월" },
      [`${id}-ben`]: { "pay.exempt": true, "pay.rate": 100 },
    },
    groupId,
  });
}

export function baseDeathCoverage(): AssemblyCoverage {
  return coverageEntry({
    id: "pc-base",
    name: "상해사망(기본계약)",
    coverageId: "cov-base-death",
    coverageName: "상해사망(기본계약)",
    attributes: [],
    subCoverages: [{ id: "pc-base-sub", masterNodeId: "sub-base-death", name: "상해사망", benefits: [{ id: "pc-base-ben", masterNodeId: "ben-base-death", name: "사망보험금" }] }],
    values: {
      "pc-base": { "coverage_basic.renewal": false },
      "pc-base-ben": { "pay.exempt": false, "pay.rate": 100 },
    },
  });
}

export const alphaGroups: SpecialGroup[] = [{ id: "grp-injury", productId: "prod-alpha", title: "상해 관련 특별약관", order: 0 }];

// ───────────────────────────── 진입점 ─────────────────────────────

export function alphaPlusFixture(): AssemblyInput {
  return {
    product: {
      id: "prod-alpha",
      name: "알파Plus(축약)",
      values: new Map([["product_basic.notice", entered("V02")]]),
      planOptions: alphaPlanOptions,
      planOptionCount: alphaPlanOptions.length,
      baseContractIds: ["pc-base"],
      generalDocumentId: "g-doc",
      overrides: [],
      hiddenArticleIds: new Set(),
    },
    coverages: [
      baseDeathCoverage(),
      deathCoverage("pc-basic", "일반상해사망", [{ kindCode: "A0002", valueCode: "1" }], "grp-injury"),
      deathCoverage("pc-addon", "일반상해사망 추가", [{ kindCode: "A0002", valueCode: "2" }], "grp-injury"),
    ],
    generalDocuments: new Map([["g-doc", alphaGeneralDocument()]]),
    specialDocuments: new Map([["cov-base-death", alphaBaseDocument()], ["cov-death", alphaDeathDocument()]]),
    clauses: alphaClauses,
    appendices: alphaAppendices,
    catalog: alphaCatalog,
    enums: alphaEnums,
    attributeKinds: alphaAttributeKinds,
    groups: alphaGroups,
    master: alphaMaster,
  };
}
