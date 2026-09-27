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
 * `exist(attr.A0001) and attr.A0001 = '2'`. 가드 없는 `attr.X = '값'` 은 그 속성을 쓰지 않는
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

/**
 * 공용조항 정의 — 여러 담보약관이 되풀이하는 문구 (기능/공용조항 §3.1). 코드는 시스템 채번(`C0001`…)이라 배열 순서가 곧 코드다.
 * 본문은 평문(`text`, `{O01}` = 옵션 자리)에서 만들거나 원문 한 자리(`from`, 조건 오버레이가 얹힌 뒤)에서 딴다.
 * 공용조항 안의 조 참조는 **보통약관 마스터**만 — 사용처 자신의 조 · 항을 가리키는 구절은 사용처에 남긴다 (§3.5).
 */
export interface ClauseSpec {
  code: string;
  label: string;
  mode: "inline" | "block";
  description: string;
  text?: string;
  from?: { spec: string; article: string; paragraph: number };
  /** 옵션 — 선택지 문구는 평문 (§3.2). 코드는 O01 · V01 … 순. */
  options?: { label: string; values: { label: string; text: string }[] }[];
}

/**
 * 공용조항 쓰임 — 원문 조 번호 · 항 번호 자리를 참조로 바꾼다. 「문구」는 항 안 첫 등장 구간, 「항」은 항 전체.
 * `options` 는 옵션 코드 → 선택지 코드 (사용처 소유 선택, §3.2).
 */
export interface ClauseUse {
  article: string;
  paragraph: number;
  clause: string;
  options?: Record<string, string>;
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
  /** 공용조항 쓰임 — 슬롯 오버레이 뒤에 얹는다. */
  clauses?: ClauseUse[];
}

/**
 * 공용조항 11건 — 원문 11벌에서 셋 이상의 담보약관(또는 소멸 구조 유형)이 되풀이하는 문구 (모델명세 §3).
 * 「특별약관의 소멸」은 조 하나가 아니라 **구조 유형별 조합**이다 — 사용처 자신을 가리키는 항(「제1조(…)에서 정한 …」 ·
 * 「제1항에 따라」)은 담보약관에 남고, 공통 문장만 공용조항이다 (§3.5).
 *   T1 소멸 급부 없음            : ① 「이 특별약관의 피보험자가 」 + C0003
 *   T2 세부보장 1 · 급부가 소멸 급부 : ① 제1조 참조 + C0005 · ② 제1항 참조 + C0004 · ③ 「이 특별약관의 피보험자가 」 + C0003
 *   T3 세부보장 여럿 · 그중 하나가 소멸 : ① 「이 특별약관의 피보험자가 」 + C0003 · ②③ 그 세부보장의 소멸 (담보약관 직접)
 */
export const CLAUSES: ClauseSpec[] = [
  {
    code: "C0001",
    label: "제3자 판정",
    mode: "inline",
    description: "보험금 지급사유에 합의하지 못할 때 제3자(종합병원 전문의)의 의견에 따른다 — 「보험수익자와 회사가 제N조(보험금의 지급사유)의 」 뒤",
    text: "보험금 지급사유에 대해 합의하지 못할 때는 보험수익자와 회사가 함께 제3자를 정하고 그 제3자의 의견에 따를 수 있습니다. 제3자는 의료법 제3조(의료기관)에 규정한 종합병원 소속 전문의 중에 정하며, 보험금 지급사유 판정에 드는 의료비용은 회사가 전액 부담합니다.",
  },
  {
    code: "C0002",
    label: "준용규정",
    mode: "block",
    description: "특별약관에서 정하지 않은 사항은 보통약관을 따른다 — 제외 조 목록은 갱신형(담보속성 A0001 = 2)이면 다섯 조 무조건, 아니면 세 조 + 1종 가입 시 두 조",
    from: { spec: "surgery17-doc", article: "8", paragraph: 1 },
  },
  {
    code: "C0003",
    label: "사망 시 소멸",
    mode: "inline",
    description: "피보험자 사망으로 특별약관이 소멸하고 계약자적립액 · 미경과보험료를 지급한다 — 「이 특별약관의 피보험자가 」 뒤 (사망이 곧 지급사유인 담보는 그 사이에 「제1항 이외의 사유로 」)",
    text: "사망한 경우에는 이 특별약관은 그 때부터 소멸되며, 이 경우 회사는 그 때까지「보험료 및 해약환급금 산출방법서」에서 정한 이 특별약관의 사망 당시 계약자적립액 및 미경과보험료를 계약자에게 지급합니다.",
  },
  {
    code: "C0004",
    label: "소멸 시 해약환급금 미지급",
    mode: "inline",
    description: "지급사유 발생으로 특별약관이 소멸하면 해약환급금을 지급하지 않는다 — 「제1항에 따라 」 뒤",
    text: "이 특별약관이 {O01} 경우에는 회사는 이 특별약관의 해약환급금을 지급하지 않습니다.",
    options: [{ label: "소멸 표현", values: [{ label: "소멸된", text: "소멸된" }, { label: "소멸되는", text: "소멸되는" }] }],
  },
  {
    code: "C0005",
    label: "지급사유 발생 시 소멸",
    mode: "inline",
    description: "소멸 급부의 지급사유가 생기면 특별약관이 소멸한다 — 「제1조(보험금의 지급사유)에서 정한 <보험금명> 」 뒤",
    text: "지급사유가 발생한 경우에는 이 특별약관은 그 때부터 소멸됩니다.",
  },
  {
    code: "C0006",
    label: "수술의 정의",
    mode: "inline",
    description: "「수술」의 정의 — 뒤 항들이 이 항을 「제N항」으로 가리키므로 항은 사용처 소유, 문장만 공용조항",
    text: "이 특별약관에서「수술」이라 함은 의사, 치과의사 또는 한의사의 면허를 가진 자(이하「의사」라 합니다)가 치료가 필요하다고 인정한 경우로서 의사의 관리하에 치료를 직접적인 목적으로 기구를 사용하여 생체(生體)에 절단(切斷, 특정부위를 잘라 내는 것), 절제(切除, 특정부위를 잘라 없애는 것) 등의 조작을 가하는 것을 말합니다.",
  },
  {
    code: "C0007",
    label: "수술의 장소",
    mode: "inline",
    description: "수술은 국내외 의료기관에서 행한 것에 한한다 — 「제N항의」 뒤",
    text: "「수술」은 자택 등에서의 치료가 곤란하여 의료법 제3조(의료기관) 제2항에 정한 국내의 병원, 의원 또는 국외의 의료관련법에서 정한 의료기관에서 행한 것에 한합니다.",
  },
  {
    code: "C0008",
    label: "신의료기술 수술",
    mode: "inline",
    description: "신의료기술평가위원회 등이 인정한 최신 수술기법도 수술에 포함한다 — 「제N항의」 뒤",
    text: "「수술」에는 보건복지부 산하 신의료기술평가위원회 또는 이에 준하는 기관으로부터 안전성과 치료효과를 인정받은 최신 수술기법으로 생체에 절단, 절제 등의 조작을 가하는 수술도 포함됩니다.",
  },
  {
    code: "C0009",
    label: "장해지급률 확정 시기",
    mode: "inline",
    description: "장해지급률이 180일 안에 확정되지 않으면 180일째 진단으로 정한다 — 「제N조(보험금의 지급사유)에서 」 뒤",
    text: "장해지급률이 상해 발생일부터 180일 이내에 확정되지 않는 경우에는 상해 발생일부터 180일이 되는 날의 의사 진단에 기초하여 고정될 것으로 인정되는 상태를 장해지급률로 결정합니다. 다만, 【별표2(장해분류표)】에 장해판정시기를 별도로 정한 경우에는 그에 따릅니다.",
  },
  {
    code: "C0010",
    label: "분류표 외 후유장해",
    mode: "inline",
    description: "장해분류표에 없는 후유장해는 분류표의 구분에 준해 정한다 — 무엇을 정하는지(지급액 · 장해지급률)는 사용처가 고른다",
    text: "【별표2(장해분류표)】에 해당되지 않는 후유장해는 피보험자의 직업, 연령, 신분 또는 성별 등에 관계없이 신체의 장해정도에 따라【별표2(장해분류표)】의 구분에 준하여 {O01}을 결정합니다.",
    options: [{ label: "결정 대상", values: [{ label: "지급액", text: "지급액" }, { label: "장해지급률", text: "장해지급률" }] }],
  },
  {
    code: "C0011",
    label: "후유장해 합산",
    mode: "block",
    description: "같은 상해로 두 가지 이상의 후유장해가 생기면 지급률을 합산한다",
    text: "같은 상해로 두 가지 이상의 후유장해가 생긴 경우에는 후유장해 지급률을 합산하여 지급합니다. 다만, 【별표2(장해분류표)】의 각 신체부위별 판정기준에 별도로 정한 경우에는 그 기준에 따릅니다.",
  },
];

/** 쓰임 줄임말 — 원문 조 · 항 → 공용조항 (옵션 O01 선택). */
const at = (article: string, paragraph: number, clause: string, o01?: string): ClauseUse => ({ article, paragraph, clause, ...(o01 ? { options: { O01: o01 } } : {}) });

/** 갱신형 탑재분인가 — 담보속성 A0001(갱신유형) = V02. `exist` 가드는 속성을 쓰지 않는 탑재분을 위해 (식언어 §6). */
const RENEWAL = "exist(attr.A0001) and attr.A0001 = '2'";

export const GENERAL: GeneralSpec = { code: "alpha-general", file: "보통약관.md", idPrefix: "g", emptyArticles: [] };

export const SPECIALS: SpecialSpec[] = [
  {
    code: "base-disability80-doc",
    ownerCoverage: "base-disability80",
    idPrefix: "b",
    title: "일반상해80%이상후유장해 기본계약 문면",
    extractFrom: { file: "보통약관.md", articles: ["3", "4"], linkTo: ["3", "4"] },
    slots: [],
    clauses: [at("4", 1, "C0009"), at("4", 3, "C0010", "V01"), at("4", 4, "C0001"), at("4", 5, "C0011")],
  },
  {
    code: "death-doc",
    ownerCoverage: "death",
    idPrefix: "s1",
    file: "일반상해사망보장.md",
    // 제3조 ①의 보험금명은 담보 값(D0001 = 사망보험금) — 소멸 급부가 곧 사망이라 ③ 앞에 「제1항 이외의 사유로 」(T2 사망형)
    slots: [{ article: "3", find: "사망보험금", ref: "D0001" }],
    clauses: [at("2", 3, "C0001"), at("3", 1, "C0005"), at("3", 2, "C0004", "V02"), at("3", 3, "C0003"), at("4", 1, "C0002")],
  },
  {
    code: "living80-doc",
    ownerCoverage: "living80",
    idPrefix: "s2",
    file: "일반상해80%이상후유장해_생활자금보장.md",
    slots: [{ article: "1", find: "일반상해80%이상후유장해 생활자금", ref: "D0001" }],
    // 제3조 ①의 보험금명은 원문이 「일반상해 80%…」로 띄어 써 담보 값과 달라 평문으로 둔다
    clauses: [
      at("2", 1, "C0009"),
      at("2", 3, "C0010", "V01"),
      at("2", 4, "C0001"),
      at("2", 5, "C0011"),
      at("3", 1, "C0005"),
      at("3", 2, "C0004", "V01"),
      at("3", 3, "C0003"),
      at("4", 1, "C0002"),
    ],
  },
  {
    code: "fracture-doc",
    ownerCoverage: "fracture",
    idPrefix: "s3",
    file: "골절(치아파절_제외)진단비Ⅱ보장.md",
    slots: [{ article: "1", find: "골절(치아파절 제외)진단비", ref: "D0001" }],
    clauses: [at("2", 2, "C0001"), at("4", 1, "C0003"), at("5", 1, "C0002")],
  },
  {
    code: "living50-doc",
    ownerCoverage: "living50",
    idPrefix: "s4",
    file: "일반상해50%이상후유장해_생활자금보장.md",
    slots: [{ article: "1", find: "일반상해50%이상후유장해 생활자금", ref: "D0001" }],
    clauses: [
      at("2", 1, "C0009"),
      at("2", 3, "C0010", "V02"),
      at("2", 4, "C0001"),
      at("2", 5, "C0011"),
      at("3", 1, "C0005"),
      at("3", 2, "C0004", "V01"),
      at("3", 3, "C0003"),
      at("4", 1, "C0002"),
    ],
  },
  {
    code: "fracture-surgery-doc",
    ownerCoverage: "fracture-surgery",
    idPrefix: "s5",
    file: "골절수술비Ⅱ보장.md",
    slots: [{ article: "1", find: "골절수술비", ref: "D0001" }],
    clauses: [at("2", 2, "C0001"), at("3", 1, "C0006"), at("3", 2, "C0007"), at("3", 3, "C0008"), at("5", 1, "C0003"), at("6", 1, "C0002")],
  },
  {
    code: "major-injury-surgery-doc",
    ownerCoverage: "major-injury-surgery",
    idPrefix: "s6",
    file: "중대한특정상해수술비보장.md",
    slots: [
      { article: "1", find: "중대한특정상해수술비", ref: "D0001" },
      { article: "4", find: "중대한특정상해수술비", ref: "D0001" },
    ],
    clauses: [
      at("2", 2, "C0001"),
      at("3", 4, "C0006"),
      at("3", 5, "C0007"),
      at("3", 6, "C0008"),
      at("4", 1, "C0005"),
      at("4", 2, "C0004", "V01"),
      at("4", 3, "C0003"),
      at("5", 1, "C0002"),
    ],
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
    // 준용규정(④)은 공용조항 C0002 의 본문이 된다 — 조건은 공용조항 안으로 옮겨 가고 이 자리는 참조
    clauses: [at("2", 2, "C0007"), at("3", 8, "C0001"), at("7", 1, "C0003"), at("8", 1, "C0002")],
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
    // 소멸 T3 — 세부보장 셋 중 중증화상및부식진단비만 소멸 급부: ① 사망 소멸(공용) · ②③ 그 세부보장의 소멸(직접)
    clauses: [at("3", 3, "C0001"), at("5", 1, "C0006"), at("5", 2, "C0007"), at("5", 3, "C0008"), at("7", 1, "C0003"), at("8", 1, "C0002")],
  },
];

export const FIXTURE_DIR = "tests/fixtures/terms";
export const SEED_DIR = "src/db/seed/data";
