/**
 * 메뉴 구성 — 작업 순서대로 묶은 다섯 단계(기본정보 → 담보 설계 → 정적 마스터 → 약관 조문 → 상품) + 점검.
 * 좌측 내비(단계 제목 아래 항목)와 홈(다섯 열 + 점검 띠)이 같은 구성을 쓴다 — 한쪽만 바꾸지 않게 여기 둔다.
 * 항목 하나 = 기능 하나 = route 하나 (ADR-0073). 상세 · 생성 화면의 경로 첫 마디도 여기 이름을 쓴다(`menuCrumb`).
 */
import { ENTITY_LABEL } from "@/app/_lib/labels";

export type MenuItem = { href: string; label: string; desc: string };
export type MenuGroup = { title: string; items: MenuItem[] };

/** 「기본정보」 그룹의 셋 — 순서가 곧 참조 방향이다: 폼 필드가 열거형을, 구분자 식이 폼 필드를 참조한다. */
export const ENUMS_MENU = { href: "/enums", label: "열거형", desc: "선택지 목록 — 목록값 타입이 고르는 값" } as const satisfies MenuItem;
export const FORMS_MENU = { href: "/master", label: "폼", desc: "약관이 참조하는 코드 폼과 필드" } as const satisfies MenuItem;
export const DISCRIMINATORS_MENU = { href: "/catalog", label: ENTITY_LABEL.discriminator, desc: "마스터 필드에 건 식 — 조문을 가르는 조건" } as const satisfies MenuItem;

/** 상세 · 생성 화면의 경로 첫 마디 — 메뉴 이름이 그 조회 화면으로 돌아간다. */
export function menuCrumb(item: MenuItem): { label: string; href: string } {
  return { label: item.label, href: item.href };
}

/** 앞 단계가 뒤 단계의 재료가 되는 흐름. 홈은 이 순서로 열을 세우고 사이에 화살표를 놓는다. */
export const MENU_FLOW: MenuGroup[] = [
  {
    title: "기본정보",
    items: [ENUMS_MENU, FORMS_MENU, DISCRIMINATORS_MENU],
  },
  {
    title: "담보 설계",
    items: [
      { href: "/coverages", label: ENTITY_LABEL.coverage, desc: "담보 · 세부보장 · 급부 구조" },
      { href: "/attributes", label: ENTITY_LABEL.attribute, desc: "담보 유형과 상품담보명 템플릿" },
    ],
  },
  {
    // 참조를 품지 않는 고정 내용 — 조문이 가리키거나(별표) 그 자리에 편다(박스). 조문의 재료라 약관 조문 앞 (최종 결정 9)
    title: ENTITY_LABEL.staticMaster,
    items: [
      { href: "/appendices", label: ENTITY_LABEL.appendix, desc: "약관 끝에 싣는 표 — 조문은 가리키기만" },
      { href: "/boxes", label: ENTITY_LABEL.box, desc: "놓인 자리에 그대로 들어가는 고정 글" },
    ],
  },
  {
    title: "약관 조문",
    items: [
      { href: "/clauses", label: ENTITY_LABEL.clause, desc: "여러 약관이 함께 쓰는 조항" },
      { href: "/documents?kind=general", label: ENTITY_LABEL.generalTemplate, desc: "보통약관 조문 작성" },
      { href: "/documents?kind=coverage", label: ENTITY_LABEL.coverageTemplate, desc: "담보별 특별약관 조문 작성" },
    ],
  },
  {
    title: "상품",
    items: [{ href: "/products", label: ENTITY_LABEL.product, desc: "재료를 탑재해 상품 약관을 완성" }],
  },
];

/** 단계가 아니라 전체를 가로지르는 확인 도구. */
export const MENU_CHECK: MenuGroup = {
  title: "점검",
  items: [{ href: "/relations", label: ENTITY_LABEL.relation, desc: "무엇이 무엇을 참조하는지 · 끊긴 참조 확인" }],
};
