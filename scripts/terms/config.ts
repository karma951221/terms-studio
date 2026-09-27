/**
 * 알파Plus 실물 변환 설정 — 별표 목록(실물 번호 순) · 보통약관 · 담보약관 원문 파일과 오버레이.
 *
 * 별표 코드는 시스템 채번값(`AX000001`…)과 같아야 한다 — 시드 적재가 채번 순서를 대조한다 (기능/별표 §3.1).
 * 별표 이름은 원문 본문의 참조 표기에서 얻었다. 본문이 참조하지 않는 번호(5·6·9·16~19)는 이름을 모른다 —
 * 「(미확인 별표 N)」 자리표시로 두고 실물 별표 목록을 확인하면 이름만 고친다 (코드는 불변).
 */

export interface AppendixSpec {
  number: number;
  code: string;
  name: string;
}

export const APPENDICES: AppendixSpec[] = [
  { number: 1, code: "AX000001", name: "보험금을 지급할 때의 적립이율 계산" },
  { number: 2, code: "AX000002", name: "장해분류표" },
  { number: 3, code: "AX000003", name: "1-7종 수술분류표" },
  { number: 4, code: "AX000004", name: "악성신생물(암) 분류표" },
  { number: 5, code: "AX000005", name: "(미확인 별표 5)" },
  { number: 6, code: "AX000006", name: "(미확인 별표 6)" },
  { number: 7, code: "AX000007", name: "뇌졸중대상질병 분류표" },
  { number: 8, code: "AX000008", name: "급성심근경색증대상질병 분류표" },
  { number: 9, code: "AX000009", name: "(미확인 별표 9)" },
  { number: 10, code: "AX000010", name: "말기폐질환" },
  { number: 11, code: "AX000011", name: "말기간경화" },
  { number: 12, code: "AX000012", name: "만성당뇨합병증 분류표" },
  { number: 13, code: "AX000013", name: "화상 분류표" },
  { number: 14, code: "AX000014", name: "골절(치아파절 제외)분류표 Ⅱ" },
  { number: 15, code: "AX000015", name: "중대한 특정상해 분류표" },
  { number: 16, code: "AX000016", name: "(미확인 별표 16)" },
  { number: 17, code: "AX000017", name: "(미확인 별표 17)" },
  { number: 18, code: "AX000018", name: "(미확인 별표 18)" },
  { number: 19, code: "AX000019", name: "(미확인 별표 19)" },
  { number: 20, code: "AX000020", name: "양성 뇌종양(경계성종양제외) 대상질병 분류표" },
  { number: 21, code: "AX000021", name: "골절분류표 Ⅱ" },
];

/** 원문 텍스트의 첫 등장을 값 슬롯으로 바꾼다 (담보 레벨 `담보명` 등). */
export interface SlotOverlay {
  /** 원문 조 번호. */
  article: string;
  find: string;
  ref: string;
}

/**
 * 담보속성 조건 오버레이 ① 문장 중간 어구 분기 — 지정 조에서 `find` 첫 등장을 `inlineCond` 로 바꾼다
 * (항·호·목 본문과 표 셀). 원문 **한 벌**에서 탑재분별로 갈리는 여러 벌을 낸다 (ADR-0003 「조 단위 on/off + 인라인 조건」).
 *
 * 식(`when`)은 데이터로 두고 변환기는 노드만 만든다. 담보속성 참조는 **가드를 붙여** 쓴다 —
 * `exist(attr.A0001) and attr.A0001 = 'V02'`. 가드 없는 `attr.X = '값'` 은 그 속성을 쓰지 않는
 * 탑재분에서 `unusedAttribute` 조립오류가 된다 (식언어 §6 · `assembly/scenarios.test.ts` S3).
 */
export interface InlineCondOverlay {
  /** 원문 조 번호. */
  article: string;
  /** 바꿀 평문. 조를 렌더 순서로 훑어 **처음 나오는 곳** 하나만 바꾼다 (바뀐 자리는 다음 오버레이가 다시 찾지 않는다). */
  find: string;
  when: string;
  /** `when` 이 참일 때 / 거짓일 때의 평문. 참조 평문(제N조 · 별표)은 가지 안에서도 참조 슬롯이 된다. */
  then: string;
  else: string;
}

/** 담보속성 조건 오버레이 ② 조 자리 on/off — 지정 조를 `condBlock` 으로 감싼다 (참일 때만 실린다. 뒤 조 번호는 자동으로 당겨진다). */
export interface ArticleCondOverlay {
  /** 원문 조 번호. */
  article: string;
  when: string;
}

export interface GeneralSpec {
  code: string;
  file: string;
  idPrefix: string;
  /**
   * 기본계약이 대치하는 조를 마스터에서 비울지. 비우지 않는다 — 마스터의 다른 조가 그 조의 항을 가리키므로
   * (실물 제8조 → 제4조 제4항) 편집기가 고를 id 가 있어야 하고, 조립은 순번 별칭으로 기본계약 항에 잇는다.
   */
  emptyArticles: string[];
}

export interface SpecialSpec {
  code: string;
  ownerCoverage: string;
  idPrefix: string;
  title?: string;
  /** 자기 원문 파일. */
  file?: string;
  /** 보통약관 원문에서 조를 뽑아 만드는 문서 (기본계약). `linkTo` 는 조연결할 보통약관 조 번호. */
  extractFrom?: { file: string; articles: string[]; linkTo: string[] };
  slots: SlotOverlay[];
  /** 담보속성 조건 오버레이 — 참조 변환 전에 얹는다 (가지 안의 참조도 슬롯이 된다). */
  inlineConds?: InlineCondOverlay[];
  /** 담보속성 조건 오버레이 — 조 자리 on/off. */
  articleConds?: ArticleCondOverlay[];
}

/** 갱신형 탑재분인가 — 담보속성 A0001(갱신유형) = V02. `exist` 가드는 속성을 쓰지 않는 탑재분을 위해 (식언어 §6). */
const RENEWAL = "exist(attr.A0001) and attr.A0001 = 'V02'";

export const GENERAL: GeneralSpec = { code: "alpha-general", file: "보통약관.md", idPrefix: "g", emptyArticles: [] };

export const SPECIALS: SpecialSpec[] = [
  {
    code: "base-disability80-doc",
    ownerCoverage: "base-disability80",
    idPrefix: "b",
    title: "일반상해80%이상후유장해 기본계약 문면",
    extractFrom: { file: "보통약관.md", articles: ["3", "4"], linkTo: ["3", "4"] },
    slots: [],
  },
  { code: "death-doc", ownerCoverage: "death", idPrefix: "s1", file: "일반상해사망보장.md", slots: [] },
  {
    code: "living80-doc",
    ownerCoverage: "living80",
    idPrefix: "s2",
    file: "일반상해80%이상후유장해_생활자금보장.md",
    slots: [{ article: "1", find: "일반상해80%이상후유장해 생활자금", ref: "D0001" }],
  },
  {
    code: "fracture-doc",
    ownerCoverage: "fracture",
    idPrefix: "s3",
    file: "골절(치아파절_제외)진단비Ⅱ보장.md",
    slots: [{ article: "1", find: "골절(치아파절 제외)진단비", ref: "D0001" }],
  },
  {
    code: "living50-doc",
    ownerCoverage: "living50",
    idPrefix: "s4",
    file: "일반상해50%이상후유장해_생활자금보장.md",
    slots: [{ article: "1", find: "일반상해50%이상후유장해 생활자금", ref: "D0001" }],
  },
  {
    code: "fracture-surgery-doc",
    ownerCoverage: "fracture-surgery",
    idPrefix: "s5",
    file: "골절수술비Ⅱ보장.md",
    slots: [{ article: "1", find: "골절수술비", ref: "D0001" }],
  },
  {
    code: "major-injury-surgery-doc",
    ownerCoverage: "major-injury-surgery",
    idPrefix: "s6",
    file: "중대한특정상해수술비보장.md",
    slots: [{ article: "1", find: "중대한특정상해수술비", ref: "D0001" }],
  },
  {
    // 비갱신형 · 갱신형 **두 벌을 내는 한 벌**이다 (ADR-0003 실증) — 원문은 갱신형 쪽(조 8개, 상위집합)을 싣고
    // 담보속성 A0001(갱신유형) 조건으로 비갱신형을 깎는다. 제목은 작명 템플릿 `[A0001] [담보명] [A0002]` 이 낸다.
    // 원문 두 벌의 차이는 제목을 빼면 다섯 자리뿐이다 (보고서 rr2-report-FG.md §4.1).
    code: "surgery17-doc",
    ownerCoverage: "surgery17",
    idPrefix: "s7",
    title: "수술비(1-7종, 연간3회한)[상해]보장 특별약관",
    file: "갱신형_수술비(1-7종,_연간3회한)[상해]보장.md",
    slots: [{ article: "1", find: "수술비", ref: "D0001" }],
    inlineConds: [
      // ① 제1조 제2항 · ②③ 예시표 (1)(2) 의 행 머리 — 「최초계약일」 ↔ 「계약일」
      { article: "1", find: "최초계약일부터", when: RENEWAL, then: "최초계약일부터", else: "계약일부터" },
      { article: "1", find: "최초계약일", when: RENEWAL, then: "최초계약일", else: "계약일" },
      { article: "1", find: "최초계약일", when: RENEWAL, then: "최초계약일", else: "계약일" },
      // ④ 준용규정의 제외 목록 — 갱신형은 다섯 조 무조건 제외, 비갱신형은 세 조 + 「1종으로 가입한 경우」 두 조
      {
        article: "8",
        find: "보통약관 제9조(적립부분 적립이율에 관한 사항), 제10조(만기환급금의 지급), 제27조의1(보험료의 납입면제), 제27조의2(납입면제에 관한 세부규정) 및 제38조(중도인출)은 제외합니다.",
        when: RENEWAL,
        then: "보통약관 제9조(적립부분 적립이율에 관한 사항), 제10조(만기환급금의 지급), 제27조의1(보험료의 납입면제), 제27조의2(납입면제에 관한 세부규정) 및 제38조(중도인출)은 제외합니다.",
        else: "보통약관 제9조(적립부분 적립이율에 관한 사항), 제10조(만기환급금의 지급) 및 제38조(중도인출)은 제외하며, 보통약관 1종(보험료 납입면제 미적용형)으로 가입한 경우 보통약관 제27조의1(보험료의 납입면제) 및 제27조의2(납입면제에 관한 세부규정)도 제외합니다.",
      },
    ],
    // ⑤ 제6조(보험기간) 은 갱신형에만 있다 — 꺼지면 뒤 조 번호가 당겨져 비갱신형 원문의 7조 구성이 된다
    articleConds: [{ article: "6", when: RENEWAL }],
  },
  {
    code: "burn-doc",
    ownerCoverage: "burn",
    idPrefix: "s9",
    file: "신화상치료비보장.md",
    // 3보장 중 화상진단비 급부의 지급명만 담보 레벨 값이 된다 — 두 번 등장하므로 오버레이도 두 벌.
    // 나머지 두 지급명(화상수술비 · 중증화상및부식진단비)은 급부 레벨 지급명 자리가 없어 문면에 굳어 있다.
    slots: [
      { article: "2", find: "화상진단비", ref: "D0001" },
      { article: "2", find: "화상진단비", ref: "D0001" },
    ],
  },
];

export const FIXTURE_DIR = "tests/fixtures/terms";
export const SEED_DIR = "src/db/seed/data";
