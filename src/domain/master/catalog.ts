/**
 * MVP 입력 마스터 **정본** (ADR-0037 §6 · 기능/마스터 §3.3).
 *
 * 여기 있는 것이 전부다 — 시드가 실제로 쓰는 폼만 옮겼다. 폼을 더하는 것은 배포 + 마이그레이션이다.
 *
 * 레벨 배치의 근거:
 * - 공시이율{평균공시이율} · 상품특성{갱신형여부 · 태아보장여부 · 단체계약여부 · 간편심사유형 · 건강고지유형}은 **상품(product)** —
 *   상품 한 권에 하나인 사실이라 세목 축을 타지 않는다. 기본정보 탭의 상품정보에서 상품명과 함께 편집 한 번 · 저장 한 번 (2026-09-28).
 *   고지유형을 상품 레벨 enum 으로 둔 결정(ADR-0006)의 구현이다. 간편심사유형 E0003 · 건강고지유형 E0004 는 열거형(데이터)이다.
 * - 납입면제 · 무저해지 · 계약전환 · 영위업종적용은 **세목(plan)** — 값을 갖는 것이 세목 선택지라
 *   상품 레벨로 올리면 종 · 형 축이 성립하지 않는다.
 * - 담보 기본{보험금명}은 **담보(coverage)** — 문면 값 슬롯이 투영 구분자로 이 자리를 찍는다.
 *   갱신유형은 담보속성(A0001)이라 마스터에 없다 (기능/담보 §4 「상세」 — 담보속성은 어느 탭에도 없다).
 * - 보험금지급{면책여부 · 지급률}은 **급부(benefit)** — 기능/구분자 §3.2 가 집계의 본보기로 드는 자리
 *   (`면책구분 = any(pay.exempt)`). 하위 레벨 자리가 하나도 없으면 집계 규칙이 죽은 길이 된다. 둘 다 선택 필드다.
 *   최초1회한(`pay.first_only`)은 2026-09-27 뺐다 — 필요 없는 칸 (기능/마스터 §6.2 · 마이그레이션 0016 이 값 행을 지운다).
 *
 * enum 코드(E0001 · E0002)는 데이터(열거형변수)를 가리킨다 — 값은 배포 없이 늘어난다 (ADR-0037 §5).
 */
import type { MasterForm } from "./types";

export const MASTER: readonly MasterForm[] = [
  {
    key: "disclosure",
    label: "공시이율",
    level: "product",
    fields: [{ key: "avg_rate", label: "평균공시이율", type: { kind: "number" }, description: "% — 이 계약 체결 시점의 평균공시이율 (예: 2.5 = 2.50%)" }],
  },
  {
    key: "feature",
    label: "상품특성",
    level: "product",
    fields: [
      { key: "renewable", label: "갱신형여부", type: { kind: "boolean" } },
      { key: "fetal", label: "태아보장여부", type: { kind: "boolean" } },
      { key: "group_contract", label: "단체계약여부", type: { kind: "boolean" } },
      { key: "review_type", label: "간편심사유형", type: { kind: "enum", enumCode: "E0003" } },
      { key: "notice_type", label: "건강고지유형", type: { kind: "enum", enumCode: "E0004" } },
    ],
  },
  {
    key: "waiver",
    label: "납입면제",
    level: "plan",
    description: "납입면제 사유에 해당하면 이후 보험료를 받지 않는다",
    fields: [
      { key: "applies", label: "적용여부", type: { kind: "boolean" } },
      { key: "reasons", label: "납입면제사유", type: { kind: "list<enum>", enumCode: "E0001" } },
    ],
    rules: [
      {
        // 납입면제종 = 적용여부 = 예 인 선택지 — 사유 없는 종은 펼칠 항이 없다 (결정 16 · 기능/상품 §3.9)
        description: "적용여부 = 예면 납입면제사유를 1개 이상 고른다",
        check: (read) => {
          const applies = read("applies");
          if (!applies?.entered || applies.value !== true) return undefined;
          const reasons = read("reasons");
          const count = reasons?.entered && Array.isArray(reasons.value) ? reasons.value.length : 0;
          return count > 0 ? undefined : { field: "reasons", message: "적용여부가 「예」면 납입면제사유를 1개 이상 고르세요" };
        },
      },
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
    key: "business_type",
    label: "영위업종적용",
    level: "plan",
    fields: [{ key: "applies", label: "적용여부", type: { kind: "boolean" } }],
  },
  {
    key: "coverage_basic",
    label: "담보 기본",
    level: "coverage",
    fields: [
      {
        key: "claim_name",
        label: "보험금명",
        type: { kind: "string" },
        description: "조문의 지급 문장에 찍히는 보험금 이름 — 담보명과 다를 수 있다 (예: 「보험가입금액을 사망보험금으로 지급합니다」)",
      },
    ],
  },
  {
    key: "pay",
    label: "보험금지급",
    level: "benefit",
    description: "급부 하나의 지급 조건 — 담보 레벨 구분자가 집계로 읽는 자리",
    fields: [
      // 선택 필드 — 필요한 급부만 「⊕ 면책여부」 · 「⊕ 지급률」로 더한다 (2026-09-27)
      { key: "exempt", label: "면책여부", type: { kind: "boolean" }, optional: true },
      { key: "rate", label: "지급률", type: { kind: "number" }, optional: true },
    ],
  },
  {
    key: "reduction",
    label: "감액",
    level: "benefit",
    optional: true,
    system: true,
    description: "급부의 감액 구간 — 보장개시 후 n개월 미만은 지급률을 낮춘다. 폼을 열지 않으면 감액 없음",
    fields: [
      {
        key: "periods",
        label: "구간",
        system: true,
        type: {
          kind: "table",
          columns: [
            { key: "end", label: "기간", type: "period" },
            { key: "rate", label: "지급률", type: "percent" },
          ],
        },
        description: "행 = 「직전 경계 ~ 이 경계 미만」. 기간은 3M · 1Y, 지급률은 % 정수. 엄격 오름차순",
      },
      {
        key: "after_rate",
        label: "이후 지급률",
        system: true,
        type: { kind: "number" },
        defaultValue: 100,
        hiddenByDefault: true,
        description: "마지막 구간 이후의 지급률(%). 보통 100 — 100 이면 입력 화면에서 숨긴다",
      },
      { key: "new_only", label: "신규계약만 적용", system: true, type: { kind: "boolean" }, defaultValue: true },
    ],
  },
  {
    key: "exemption",
    label: "면책",
    level: "benefit",
    optional: true,
    system: true,
    description: "급부의 면책 기간 — 보장개시 후 n개월은 지급하지 않는다. 폼을 열지 않으면 면책 없음",
    fields: [
      { key: "months", label: "기간", system: true, type: { kind: "number" }, description: "개월 수. 화면은 3M · 1Y 로 받는다" },
      { key: "age15_only", label: "15세 이상만 적용", system: true, type: { kind: "boolean" }, defaultValue: false },
      { key: "new_only", label: "신규계약만 적용", system: true, type: { kind: "boolean" }, defaultValue: true },
    ],
  },
];

export const REDUCTION_FORM = "reduction";
export const EXEMPTION_FORM = "exemption";
