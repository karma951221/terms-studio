/**
 * 메뉴 구성 — 작업 순서대로 묶은 네 단계(기준 데이터 → 담보 설계 → 약관 조문 → 상품) + 점검.
 * 좌측 내비(단계 제목 아래 항목)와 홈(네 열 + 점검 띠)이 같은 구성을 쓴다 — 한쪽만 바꾸지 않게 여기 둔다.
 */
import { ENTITY_LABEL } from "@/app/_lib/labels";

export type MenuItem = { href: string; label: string; desc: string };
export type MenuGroup = { title: string; items: MenuItem[] };

/** 앞 단계가 뒤 단계의 재료가 되는 흐름. 홈은 이 순서로 열을 세우고 사이에 화살표를 놓는다. */
export const MENU_FLOW: MenuGroup[] = [
  {
    title: "기준 데이터",
    items: [
      { href: "/master", label: "마스터", desc: "약관이 참조하는 코드 폼과 필드" },
      { href: "/types", label: "유형", desc: "선택지 목록(열거형 변수)" },
      { href: "/catalog", label: ENTITY_LABEL.discriminator, desc: "마스터 필드에 건 식 — 조문을 가르는 조건" },
    ],
  },
  {
    title: "담보 설계",
    items: [
      { href: "/coverages", label: ENTITY_LABEL.coverage, desc: "담보 · 세부보장 · 급부 구조" },
      { href: "/attributes", label: ENTITY_LABEL.attribute, desc: "담보 유형과 상품담보명 템플릿" },
    ],
  },
  {
    title: "약관 조문",
    items: [
      { href: "/clauses", label: ENTITY_LABEL.clause, desc: "여러 약관이 함께 쓰는 조항" },
      { href: "/documents?kind=general", label: ENTITY_LABEL.generalTemplate, desc: "보통약관 조문 작성" },
      { href: "/documents?kind=coverage", label: ENTITY_LABEL.coverageTemplate, desc: "담보별 특별약관 조문 작성" },
      { href: "/appendices", label: ENTITY_LABEL.appendix, desc: "약관에 붙는 표" },
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
