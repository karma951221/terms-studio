/**
 * 계약일 ↔ 최초계약일 — 데이터가 가른다 (개발 도구 — 제품 기능 아님). 근거: ADR-0086 결정 6.
 *
 * 연만기(갱신형) 상품의 보통약관 · 갱신형 담보의 담보약관은 「최초계약일」, 세만기 상품의 보통약관 · 비갱신 담보는 「계약일」이다 —
 * 작성자가 고르는 옵션이 아니라 상품 · 담보 속성이 정한다.
 * - 구분자 「갱신형 상품」(상품 레벨) · 「갱신형 담보」(담보 레벨) — discriminators.json(손으로 쓰는 시드).
 * - 문구 함수조항 「기준일 문구」 — 인자 갱신(기본 연결 = 갱신형 상품), 프리셋 ‘담보’(갱신 ← 갱신형 담보). 담보약관은 프리셋 ‘담보’로 넣는다.
 * - 함수조항 안에는 함수조항을 끼울 수 없어(중첩 금지) 같은 인자 갱신 + 문장 안 조건(`basisWord`)으로 쓴다 — 부활 문구(waiver.ts).
 */
import type { Inline } from "../../src/domain/clause/nodes";
import type { ParamDef } from "../../src/domain/clause/params";
import type { Id } from "../../src/domain/types";

import type { ClauseRecord } from "./clauses";

/** 「갱신형 담보」 — 담보 레벨 `exist(attr.A0001) and attr.A0001 = '2'`(담보속성 갱신유형 = 갱신형). 「기준일 문구」 프리셋 ‘담보’가 읽는다. */
export const RENEWABLE_COVERAGE = "D0005";

/**
 * 「갱신형 상품」 — 상품 레벨 `feature.renewable`(상품특성 갱신형여부). 인자 갱신의 기본 연결.
 * 보통약관이 쓰는 함수조항(부활 문구)이 읽어 바탕 시드에 들어가므로, 바탕 시드가 앞에서부터 만드는 구분자 코드에서 「갱신형 담보」 뒤다.
 */
export const RENEWABLE_PRODUCT = "D0006";

/** 인자 갱신 — 참이면 「최초계약일」, 거짓이면 「계약일」. 기본 연결 = 갱신형 상품. */
export const RENEWAL_PARAM: ParamDef = { name: "갱신", type: { kind: "boolean" }, default: { kind: "discriminator", code: RENEWABLE_PRODUCT } };

/** 「최초계약일 · 계약일」 문장 안 조건 — 화면 조건 줄(좌변 · 연산자 · 값)로 풀리는 모양으로 쓴다(맨 인자는 줄이 되지 않는다). */
export function basisWord(id: Id): Inline {
  return {
    id,
    kind: "inlineCond",
    branches: [
      { id: `${id}-t`, when: `arg.${RENEWAL_PARAM.name} = true`, children: [{ id: `${id}-t-x1`, kind: "text", text: "최초계약일" }] },
      { id: `${id}-e`, children: [{ id: `${id}-e-x1`, kind: "text", text: "계약일" }] },
    ],
  } as Inline;
}

/** 「기준일 문구」 함수조항의 key — 문구 함수조항 오버레이(config.ts `inlineClauses`)가 이것으로 가리킨다. */
export const BASIS_DATE = "basis-date";

/** 「기준일 문구」 프리셋 ‘담보’ 코드 — 담보약관이 쓴다. */
export const BASIS_DATE_COVERAGE_PRESET = "S01";

/** 문구 함수조항 「기준일 문구」 — 코드는 변환기가 적재 순서로 매긴다. */
export function basisDateClause(): { key: string; record: ClauseRecord } {
  return {
    key: BASIS_DATE,
    record: {
      code: "",
      label: "기준일 문구",
      mode: "inline",
      description: "계약일 ↔ 최초계약일 — 갱신형이면 「최초계약일」, 아니면 「계약일」. 인자 갱신의 기본 연결은 갱신형 상품(보통약관), 담보약관은 프리셋 ‘담보’(갱신 ← 갱신형 담보)로 넣는다 (ADR-0086 결정 6)",
      body: [basisWord(`c-${BASIS_DATE}-c1`)],
      options: [],
      params: [RENEWAL_PARAM],
      presets: [{ code: BASIS_DATE_COVERAGE_PRESET, name: "담보", bindings: { [RENEWAL_PARAM.name]: { kind: "discriminator", code: RENEWABLE_COVERAGE } } }],
    },
  };
}
