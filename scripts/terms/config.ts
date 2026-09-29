/**
 * 실물 변환 설정 — 상품 두 벌(알파Plus · 메리츠)의 별표 · 보통약관 · 담보약관 원문 파일과 오버레이, 두 상품이 함께 쓰는 공용조항.
 *
 * 별표 코드는 시스템 채번값(`AX000001`…)과 같아야 한다 — 시드 적재가 채번 순서를 대조한다 (기능/별표 §3.1).
 * 별표 마스터는 **이름이 같으면 한 건**이다 — 상품마다 원문 번호가 달라(알파Plus 별표2 = 메리츠 별표14 = 장해분류표)
 * 상품 설정의 `appendixNumbers`(원문 번호 → 코드)가 잇는다. 책자 번호는 어차피 등장 순 계산값이다 (ADR-0063).
 * 알파Plus 별표 이름은 원문 본문의 참조 표기에서 얻었다. 본문이 참조하지 않는 번호(5·6·9·16~19)는 이름을 모른다 —
 * 「(미확인 별표 N)」 자리표시로 두고 실물 별표 목록을 확인하면 이름만 고친다 (코드는 불변).
 */

export interface AppendixSpec {
  /** 알파Plus 원문 번호 — 알파Plus 원문에 없는 별표(메리츠에서 처음 나온 것)는 없다. */
  number?: number;
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
 * 공용조항 정의 — 여러 문서가 되풀이하는 **조 · 여러 항 단위** (기능/함수조항 §3.1 · §6.2). 코드는 시스템 채번(`C0001`…) — 변환기가 적재 순서로 매긴다(`CLAUSES`).
 * 본문은 원문 한 자리(`from`, 조건 오버레이가 얹힌 뒤)에서 딴다 — 항 수를 안 주면 그 항부터 조 끝까지(조째). 평문(`text`)도 된다.
 * 원문 자리의 자기 조 참조는 딴 항 안이면 「이 공용조항」, 밖이면 「사용처」 위치가 된다 (§3.5).
 */
export interface ClauseSpec {
  /** 설정 안의 이름 — 쓰임(`ClauseUse.clause`)이 이것으로 가리킨다. 코드(`C0001`…)는 변환기가 적재 순서로 매긴다(시스템 채번과 같게). */
  key: string;
  label: string;
  mode: "inline" | "block";
  description: string;
  /** 평문 본문 · 선택지 문구의 참조를 풀 상품(그 상품의 별표 번호 · 보통약관 색인) — 기본 알파Plus. */
  product?: string;
  text?: string;
  /** 원문 자리 — 문서 코드(보통약관 코드 포함) · 조 · 첫 항(기본 1) · 잇닿은 항 수(기본 = 조 끝까지). 호 · 목도 함께 딴다. */
  from?: { spec: string; article: string; paragraph?: number; paragraphs?: number };
  /** 옵션 — 선택지 문구는 평문 (§3.2). 코드는 O01 · V01 … 순. */
  options?: { label: string; values: { label: string; text: string }[] }[];
  /** 원문 자리의 글에서 옵션 자리로 바꿀 낱말 — `within` 문맥(기본 = 낱말)이 나오는 모든 자리. 원문 자리 문서가 고른 선택지 문구와 같아야 한다. */
  place?: { option: string; text: string; within?: string }[];
}

/**
 * 공용조항 쓰임 — 원문 조 번호 · 첫 항 번호 자리부터 공용조항의 항 수만큼을 참조 하나로 바꾼다(「항」).
 * 「문구」는 항 안 첫 등장 구간 — 제품 기능으로 남아 있지만 실물 데이터는 쓰지 않는다(2026-09-28).
 * `options` 는 옵션 코드 → 선택지 코드 (사용처 소유 선택, §3.2).
 */
export interface ClauseUse {
  article: string;
  paragraph: number;
  /** 호 자리 — 「문구」를 항 문장이 아니라 그 항의 제N호 문장에서 찾는다. */
  item?: number;
  /** 공용조항 key (`ClauseSpec.key`). */
  clause: string;
  options?: Record<string, string>;
}

export interface GeneralSpec {
  code: string;
  file: string;
  idPrefix: string;
  /** 공용조항 쓰임 — 두 보통약관이 조째 같은 조. */
  clauses?: ClauseUse[];
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
 * 공용조항 — 두 상품(알파Plus · 메리츠)의 원문이 되풀이하는 조 (모델명세 §4 · 메리츠_모델명세 §4 · 기능/함수조항 §6.2).
 * 규칙 (2026-09-28 — 「불필요하게 너무 많은 공용조항」 유저 피드백으로 재편):
 * - 공용조항은 **조째**(그 조의 항 전부) 또는 **잇닿은 여러 항**이고, **두 곳 이상**에서 쓴다. 항 하나 · 문장 조각(문구)은 따지 않는다 —
 *   원문 글 그대로 문면에 남는다. 조 제목은 사용처 소유다.
 * - 낱말만 다르면 옵션(선택지 문구는 평문), 항 구성이 다르면 공용조항을 따로 둔다(한 곳에서만 쓰일 변형은 문면에 남긴다).
 *   띄어쓰기만 다른 곳은 옵션으로 두지 않는다 — 두 상품의 같은 조가 띄어쓰기만 다르면 공유하지 않는다.
 * - 조 안의 자기 참조는 「이 공용조항」(제1항에 따라) · 「사용처」 위치(제1조(보험금의 지급사유)에서 정한)로 딴다 (§3.5).
 *   보통약관 조 참조는 보통약관이 두 벌이라 상품마다 대상이 다르다(준용규정은 상품마다 한 벌).
 * - 사이에 박스 · 표가 낀 조는 조째 딸 수 없다 — 박스 앞뒤의 잇닿은 여러 항만(약관의 해석 ②③), 항 하나만 남거나 남은 항을 조의
 *   다른 항이 가리키면(제1회 보험료 ③ → 제2항) 따지 않는다. 호 목록에 박스가 낀 항(보험금을 지급하지 않는 사유)도 딸 수 없다.
 *
 * 코드는 적재 순서다. **보통약관이 쓰는 공용조항이 맨 앞**(C0001~) — 시드 · 화면 E2E 바탕은 보통약관을 가져오기 전에 이것들을 만든다.
 * 보통약관 조를 가리키는 공용조항(준용규정 두 벌)은 맨 뒤 — 보통약관이 있어야 정의 검사 ① 을 통과한다. 변환기가 매기고 검사한다.
 * 박스는 여기 적지 않는다 — 원문의 박스는 모두 정적 마스터 박스가 된다(`boxes.ts`, 한 곳만 써도 — 기능/박스).
 *
 * 「특별약관의 소멸」은 담보 구조별로 조째 공용조항이 갈린다 (§3.1):
 *   사망            : ① 사망 시 소멸 (항 하나 — 조째)
 *   지급사유         : ① 제1조 지급사유 발생 시 소멸 ② 제1항에 따라 해약환급금 미지급 ③ 사망 시 소멸
 *   사망보험금       : ③ 이 「제1항 이외의 사유로」 사망 — 사망이 곧 지급사유인 담보
 *   생활자금         : ① 이 「제1조 제1항에서 정한 … 생활자금」 (보험금명이 담보 값과 띄어쓰기가 달라 슬롯이 아니다)
 *   중증화상및부식    : ① 사망 시 소멸 ②③ 세부보장 하나의 소멸 · 해약환급금 미지급
 */
type ClauseDraft = ClauseSpec;

/** 보통약관끼리 조째 같은 조 — 「항」 공용조항 한 건 = 그 조의 항 전부(또는 첫 항부터 잇닿은 항). 본문은 메리츠 원문 자리에서 딴다 (두 원문이 같다). */
const generalArticle = (key: string, label: string, meritz: string, paragraph = 1): ClauseDraft => ({
  key,
  label,
  mode: "block",
  description: `보통약관 「${label.replace(/ [①-⑳]+$/, "")}」 — 두 상품 보통약관이 같은 글이다`,
  from: { spec: "meritz-general", article: meritz, paragraph },
});

/** 담보약관의 조째 공용조항 — 본문은 `spec` 원문 자리의 조 전부. */
const specialArticle = (key: string, label: string, spec: string, article: string, description: string, extra: Partial<ClauseDraft> = {}): ClauseDraft => ({
  key,
  label,
  mode: "block",
  description,
  from: { spec, article },
  ...extra,
});

/** 옵션 선택지 — [이름, 문구]. */
const values = (...pairs: [string, string][]) => pairs.map(([label, text]) => ({ label, text }));

const CLAUSE_DRAFTS: ClauseDraft[] = [
  // ── 보통약관 (두 벌 공통) — 조째 같은 조
  generalArticle("g-purpose", "목적", "1"),
  generalArticle("g-claim", "보험금 등의 청구", "7"),
  generalArticle("g-address", "주소변경통지", "12"),
  generalArticle("g-beneficiary", "보험수익자의 지정", "13"),
  generalArticle("g-representative", "대표자의 지정", "14"),
  generalArticle("g-disclosure", "계약 전 알릴 의무", "15"),
  generalArticle("g-fraud", "사기에 의한 계약", "18"),
  generalArticle("g-second-premium", "제2회 이후 보험료의 납입", "28"),
  generalArticle("g-dividend", "배당금의 지급", "42"),
  generalArticle("g-dispute", "분쟁의 조정", "44"),
  generalArticle("g-court", "관할법원", "45"),
  generalArticle("g-prescription", "소멸시효", "46"),
  // ① 과 ② 사이에 박스(신의성실의 원칙)가 있어 조째가 아니라 ②③ 두 항
  generalArticle("g-interpretation", "약관의 해석 ②③", "47", 2),
  generalArticle("g-explanation", "설명서 교부 및 보험안내자료 등의 효력", "48"),
  generalArticle("g-law-change", "법령 등의 개정에 따른 계약내용의 변경", "49"),
  generalArticle("g-liability", "회사의 손해배상책임", "50"),
  generalArticle("g-privacy", "개인정보보호", "51"),
  generalArticle("g-governing-law", "준거법", "52"),
  generalArticle("g-deposit-insurance", "예금보험에 의한 지급보장", "53"),
  // ── 담보약관 — 같은 담보의 두 상품 조
  specialArticle("burn-scope", "보장의 범위(신화상치료비)", "burn-doc", "1", "신화상치료비의 세 보장 — 두 상품이 같은 글이다(뒤 박스는 사용처 소유)"),
  specialArticle("fracture-cause", "보험금의 지급사유(골절진단비)", "fracture-doc", "1", "골절(치아파절 제외)진단비의 지급사유 — 두 상품이 같은 글이다. 보험금명은 담보 값(D0001)"),
  specialArticle("fracture-surgery-cause", "보험금의 지급사유(골절수술비)", "fracture-surgery-doc", "1", "골절수술비의 지급사유 — 두 상품이 같은 글이다. 보험금명은 담보 값(D0001)"),
  specialArticle("fracture-detail", "보험금 지급에 관한 세부규정(골절진단비)", "fracture-doc", "2", "골절 여럿이면 1회 · 제3자 판정 — 두 상품이 같은 글이다. 「제1조」는 사용처 위치"),
  specialArticle("fracture-surgery-detail", "보험금 지급에 관한 세부규정(골절수술비)", "fracture-surgery-doc", "2", "골절 수술 여럿이면 하나 · 제3자 판정 — 두 상품이 같은 글이다. 「제1조」는 사용처 위치"),
  specialArticle("living-detail", "보험금 지급에 관한 세부규정(생활자금)", "living80-doc", "2", "알파Plus 후유장해 생활자금 두 담보의 장해지급률 · 합산 · 가중 규정 — 분류표 외 후유장해로 정하는 것(지급액 · 장해지급률)만 다르다", {
    options: [{ label: "결정 대상", values: values(["지급액", "지급액"], ["장해지급률", "장해지급률"]) }],
    place: [{ option: "O01", text: "지급액", within: "구분에 준하여 지급액을" }],
  }),
  specialArticle("disability-detail", "보험금 지급에 관한 세부규정(후유장해)", "m-disability80-doc", "2", "메리츠 80%이상후유장해 두 담보(상해 · 질병)의 장해지급률 · 합산 · 가중 규정 — 기산일 · 원인 · 분류표 외 결정 대상이 다르다", {
    product: "meritz",
    options: [
      { label: "기산일", values: values(["상해 발생일", "상해 발생일"], ["질병 진단확정일", "질병의 진단확정일"]) },
      { label: "원인", values: values(["상해", "상해로"], ["질병", "질병으로"]) },
      { label: "결정 대상", values: values(["지급액", "지급액"], ["장해지급률", "장해지급률"]) },
    ],
    place: [
      { option: "O01", text: "상해 발생일" },
      { option: "O02", text: "상해로", within: "같은 상해로" },
      { option: "O02", text: "상해로", within: "다른 상해로" },
      { option: "O03", text: "장해지급률", within: "구분에 준하여 장해지급률을" },
    ],
  }),
  specialArticle("burn-definition", "중증화상및부식진단의 정의 및 진단확정", "burn-doc", "6", "중증화상및부식의 정의 · 진단확정 — 두 상품이 조사 두 곳만 다르다", {
    options: [
      { label: "정의 조사", values: values(["에서", "에서"], ["에 있어", "에 있어"]) },
      { label: "의료기관 근거", values: values(["규정한", "에 규정한"], ["정한", "에서 정한"]) },
    ],
    place: [
      { option: "O01", text: "에서", within: "이 특별약관에서「중증화상" },
      { option: "O02", text: "에 규정한", within: "의료법 제3조에 규정한" },
    ],
  }),
  // ── 담보약관 — 특별약관의 소멸 (담보 구조별)
  specialArticle("lapse-death", "특별약관의 소멸(사망)", "fracture-doc", "4", "소멸 급부가 없는 담보 — 피보험자 사망으로 소멸하고 계약자적립액 · 미경과보험료를 지급한다"),
  specialArticle("lapse-claim", "특별약관의 소멸(지급사유 발생)", "major-injury-surgery-doc", "4", "소멸 급부가 담보 전체 — 제1조의 지급사유가 생기면 소멸 · 해약환급금 미지급 · 사망 시 소멸. 보험금명은 담보 값(D0001), 「그 때부터」 유무가 상품마다 다르다", {
    options: [{ label: "소멸 표현", values: values(["그 때부터 소멸", "그 때부터 소멸됩니다"], ["소멸", "소멸됩니다"]) }],
    place: [{ option: "O01", text: "그 때부터 소멸됩니다" }],
  }),
  specialArticle("lapse-claim-death", "특별약관의 소멸(사망보험금)", "death-doc", "3", "사망이 곧 지급사유인 담보 — 「지급사유 발생」 조에서 ③ 이 「제1항 이외의 사유로」 사망한 경우", {
    options: [
      { label: "소멸 표현", values: values(["그 때부터 소멸", "그 때부터 소멸됩니다"], ["소멸", "소멸됩니다"]) },
      { label: "해약환급금 미지급 표현", values: values(["소멸되는", "소멸되는"], ["소멸된", "소멸된"]) },
    ],
    place: [
      { option: "O01", text: "그 때부터 소멸됩니다" },
      { option: "O02", text: "소멸되는" },
    ],
  }),
  specialArticle("lapse-living", "특별약관의 소멸(생활자금)", "living80-doc", "3", "알파Plus 후유장해 생활자금 두 담보 — 제1조 제1항의 생활자금 지급사유가 생기면 소멸. 장해율(80% · 50%)만 다르다", {
    options: [{ label: "장해율", values: values(["80%", "80%"], ["50%", "50%"]) }],
    place: [{ option: "O01", text: "80%" }],
  }),
  specialArticle("lapse-burn", "특별약관의 소멸(중증화상및부식)", "burn-doc", "7", "세부보장 하나(중증화상및부식진단비)가 소멸 급부 — ① 사망 시 소멸 ②③ 그 세부보장의 소멸 · 해약환급금 미지급"),
  // ── 보통약관 조를 가리키는 공용조항 — 상품마다 한 벌 (맨 뒤)
  {
    key: "alpha-application",
    label: "준용규정(알파Plus)",
    mode: "block",
    description: "특별약관에서 정하지 않은 사항은 보통약관을 따른다 — 알파Plus 보통약관 조를 가리킨다. 제외 조 목록은 갱신형(담보속성 A0001 = 2)이면 다섯 조 무조건, 아니면 세 조 + 1종 가입 시 두 조",
    from: { spec: "surgery17-doc", article: "8" },
  },
  {
    key: "meritz-application",
    label: "준용규정(메리츠)",
    mode: "block",
    description: "특별약관에서 정하지 않은 사항은 보통약관을 따른다 — 메리츠 보통약관 조를 가리킨다(적립이율 · 만기환급금 · 중도인출 제외, 1종이면 납입면제 두 조도 제외). 질병사망은 제5조까지 빼는 다른 글이라 쓰지 않는다",
    from: { spec: "m-fracture-doc", article: "5" },
  },
];

/**
 * 조 · 여러 항 공용조항 — 코드는 변환기가 적재 순서로 매긴다: 보통약관이 쓰는 것 → 담보약관만 쓰는 것 →
 * 보통약관 조를 가리키는 것(준용규정) — 각각 이 배열 순.
 */
export const CLAUSES: readonly ClauseSpec[] = CLAUSE_DRAFTS;

/** 쓰임 줄임말 — 원문 조 · 첫 항 → 공용조항 key (옵션 선택은 `{ O01: "V02" }` 또는 O01 하나면 선택지 코드 문자열). */
const at = (article: string, paragraph: number, clause: string, options?: string | Record<string, string>): ClauseUse => ({
  article,
  paragraph,
  clause,
  ...(options ? { options: typeof options === "string" ? { O01: options } : options } : {}),
});

/** 조째 공용조항의 쓰임 — 원문 조 첫 항부터. */
const whole = (article: string, clause: string, options?: string | Record<string, string>) => at(article, 1, clause, options);

/** 조째 같은 보통약관 조의 쓰임 — [key, 알파Plus 조, 메리츠 조, 첫 항]. */
const GENERAL_ARTICLES: [string, string, string, number][] = [
  ["g-purpose", "1", "1", 1],
  ["g-claim", "7", "7", 1],
  ["g-address", "12", "12", 1],
  ["g-beneficiary", "13", "13", 1],
  ["g-representative", "14", "14", 1],
  ["g-disclosure", "15", "15", 1],
  ["g-fraud", "18", "18", 1],
  ["g-second-premium", "27", "28", 1],
  ["g-dividend", "37", "42", 1],
  ["g-dispute", "39", "44", 1],
  ["g-court", "40", "45", 1],
  ["g-prescription", "41", "46", 1],
  ["g-interpretation", "42", "47", 2],
  ["g-explanation", "43", "48", 1],
  ["g-law-change", "44", "49", 1],
  ["g-liability", "45", "50", 1],
  ["g-privacy", "46", "51", 1],
  ["g-governing-law", "47", "52", 1],
  ["g-deposit-insurance", "48", "53", 1],
];

/** 갱신형 탑재분인가 — 담보속성 A0001(갱신유형) = V02. `exist` 가드는 속성을 쓰지 않는 탑재분을 위해 (식언어 §6). */
const RENEWAL = "exist(attr.A0001) and attr.A0001 = '2'";

/** 상품 한 벌의 원문 — 픽스처 폴더 · 별표 번호 표 · 보통약관 · 담보약관. */
export interface ProductTerms {
  code: string;
  /** `tests/fixtures/terms` 아래 폴더 (알파Plus 는 뿌리). */
  fixtureDir: string;
  /** 원문 별표 번호 → 별표 코드. */
  appendixNumbers: Map<number, string>;
  general: GeneralSpec;
  specials: SpecialSpec[];
}

const ALPHA_GENERAL: GeneralSpec = {
  code: "alpha-general",
  file: "보통약관.md",
  idPrefix: "g",
  emptyArticles: [],
  clauses: GENERAL_ARTICLES.map(([key, article, , paragraph]) => at(article, paragraph, key)),
};

const ALPHA_SPECIALS: SpecialSpec[] = [
  {
    code: "base-disability80-doc",
    ownerCoverage: "base-disability80",
    idPrefix: "b",
    title: "일반상해80%이상후유장해 기본계약 문면",
    extractFrom: { file: "보통약관.md", articles: ["3", "4"], linkTo: ["3", "4"] },
    slots: [],
  },
  {
    code: "death-doc",
    ownerCoverage: "death",
    idPrefix: "s1",
    file: "일반상해사망보장.md",
    // 제3조 ①의 보험금명은 담보 값(D0001 = 사망보험금) — 소멸 급부가 곧 사망이라 ③ 앞에 「제1항 이외의 사유로 」(T2 사망형)
    slots: [{ article: "3", find: "사망보험금", ref: "D0001" }],
    clauses: [whole("3", "lapse-claim-death", { O01: "V01", O02: "V01" }), whole("4", "alpha-application")],
  },
  {
    code: "living80-doc",
    ownerCoverage: "living80",
    idPrefix: "s2",
    file: "일반상해80%이상후유장해_생활자금보장.md",
    slots: [{ article: "1", find: "일반상해80%이상후유장해 생활자금", ref: "D0001" }],
    // 제3조 ①의 보험금명은 원문이 「일반상해 80%…」로 띄어 써 담보 값과 달라 평문으로 둔다
    clauses: [whole("2", "living-detail", "V01"), whole("3", "lapse-living", "V01"), whole("4", "alpha-application")],
  },
  {
    code: "fracture-doc",
    ownerCoverage: "fracture",
    idPrefix: "s3",
    file: "골절(치아파절_제외)진단비Ⅱ보장.md",
    slots: [{ article: "1", find: "골절(치아파절 제외)진단비", ref: "D0001" }],
    clauses: [whole("1", "fracture-cause"), whole("2", "fracture-detail"), whole("4", "lapse-death"), whole("5", "alpha-application")],
  },
  {
    code: "living50-doc",
    ownerCoverage: "living50",
    idPrefix: "s4",
    file: "일반상해50%이상후유장해_생활자금보장.md",
    slots: [{ article: "1", find: "일반상해50%이상후유장해 생활자금", ref: "D0001" }],
    clauses: [whole("2", "living-detail", "V02"), whole("3", "lapse-living", "V02"), whole("4", "alpha-application")],
  },
  {
    code: "fracture-surgery-doc",
    ownerCoverage: "fracture-surgery",
    idPrefix: "s5",
    file: "골절수술비Ⅱ보장.md",
    slots: [{ article: "1", find: "골절수술비", ref: "D0001" }],
    clauses: [whole("1", "fracture-surgery-cause"), whole("2", "fracture-surgery-detail"), whole("5", "lapse-death"), whole("6", "alpha-application")],
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
    clauses: [whole("4", "lapse-claim", "V01"), whole("5", "alpha-application")],
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
    // 준용규정(④)은 공용조항 「준용규정(알파Plus)」의 본문이 된다 — 조건은 공용조항 안으로 옮겨 가고 이 자리는 참조
    clauses: [whole("7", "lapse-death"), whole("8", "alpha-application")],
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
    // 소멸 — 세부보장 셋 중 중증화상및부식진단비만 소멸 급부(①사망 · ②③ 그 세부보장)
    clauses: [whole("1", "burn-scope"), whole("6", "burn-definition", { O01: "V01", O02: "V01" }), whole("7", "lapse-burn"), whole("8", "alpha-application")],
  },
];

export const ALPHA: ProductTerms = {
  code: "alpha",
  fixtureDir: "tests/fixtures/terms",
  appendixNumbers: new Map(APPENDICES.filter((a) => a.number !== undefined).map((a) => [a.number!, a.code])),
  general: ALPHA_GENERAL,
  specials: ALPHA_SPECIALS,
};

/**
 * 메리츠 통합간편건강보험(연만기형) — 보통약관 + 기본계약(일반상해사망) + 특약 표본 8 (모델명세: QA/실물재현/메리츠_모델명세).
 * 특약은 모두 갱신형이다(탑재 담보속성 A0001 = 2). 별표는 알파Plus 마스터를 이름으로 다시 쓴다 — 번호만 다르다.
 */
const MERITZ_GENERAL: GeneralSpec = {
  code: "meritz-general",
  file: "보통약관.md",
  idPrefix: "m",
  emptyArticles: [],
  clauses: GENERAL_ARTICLES.map(([key, , article, paragraph]) => at(article, paragraph, key)),
};

const MERITZ_SPECIALS: SpecialSpec[] = [
  {
    code: "m-base-death-doc",
    ownerCoverage: "m-base-death",
    idPrefix: "mb",
    title: "일반상해사망 기본계약 문면",
    extractFrom: { file: "보통약관.md", articles: ["3", "4"], linkTo: ["3", "4"] },
    slots: [],
  },
  {
    code: "m-disability80-doc",
    ownerCoverage: "m-disability80",
    idPrefix: "m1",
    file: "갱신형_일반상해80%이상후유장해(통합간편가입)보장.md",
    title: "일반상해80%이상후유장해(통합간편가입)보장 특별약관",
    slots: [
      { article: "1", find: "일반상해80%이상후유장해보험금", ref: "D0001" },
      { article: "3", find: "일반상해80%이상후유장해보험금", ref: "D0001" },
    ],
    clauses: [whole("2", "disability-detail", { O01: "V01", O02: "V01", O03: "V02" }), whole("3", "lapse-claim", "V02"), whole("4", "meritz-application")],
  },
  {
    code: "m-surgery17-doc",
    ownerCoverage: "m-surgery17",
    idPrefix: "m2",
    file: "갱신형_수술비(1-7종,_연간3회한)[상해](통합간편가입)보장.md",
    title: "수술비(1-7종, 연간3회한)[상해](통합간편가입)보장 특별약관",
    slots: [{ article: "1", find: "수술비", ref: "D0001" }],
    clauses: [whole("6", "lapse-death"), whole("7", "meritz-application")],
  },
  {
    code: "m-fracture-doc",
    ownerCoverage: "m-fracture",
    idPrefix: "m3",
    file: "갱신형_골절(치아파절_제외)진단비Ⅱ(통합간편가입)보장.md",
    title: "골절(치아파절 제외)진단비Ⅱ(통합간편가입)보장 특별약관",
    slots: [{ article: "1", find: "골절(치아파절 제외)진단비", ref: "D0001" }],
    clauses: [whole("1", "fracture-cause"), whole("2", "fracture-detail"), whole("4", "lapse-death"), whole("5", "meritz-application")],
  },
  {
    code: "m-burn-doc",
    ownerCoverage: "m-burn",
    idPrefix: "m4",
    file: "갱신형_신화상치료비(통합간편가입)보장.md",
    title: "신화상치료비(통합간편가입)보장 특별약관",
    slots: [
      { article: "2", find: "화상진단비", ref: "D0001" },
      { article: "2", find: "화상진단비", ref: "D0001" },
    ],
    // 알파Plus 신화상과 같은 조 셋(보장의 범위 · 소멸 · 중증화상 정의 — 정의는 조사 두 곳이 다르다)
    clauses: [whole("1", "burn-scope"), whole("6", "burn-definition", { O01: "V02", O02: "V02" }), whole("7", "lapse-burn"), whole("8", "meritz-application")],
  },
  {
    code: "m-fracture-surgery-doc",
    ownerCoverage: "m-fracture-surgery",
    idPrefix: "m5",
    file: "갱신형_골절수술비Ⅱ(통합간편가입)보장.md",
    title: "골절수술비Ⅱ(통합간편가입)보장 특별약관",
    slots: [{ article: "1", find: "골절수술비", ref: "D0001" }],
    clauses: [whole("1", "fracture-surgery-cause"), whole("2", "fracture-surgery-detail"), whole("5", "lapse-death"), whole("6", "meritz-application")],
  },
  {
    code: "m-disease-death-doc",
    ownerCoverage: "m-disease-death",
    idPrefix: "m6",
    file: "갱신형_질병사망(통합간편가입)보장.md",
    title: "질병사망(통합간편가입)보장 특별약관",
    slots: [
      { article: "1", find: "질병사망보험금", ref: "D0001" },
      { article: "3", find: "질병사망보험금", ref: "D0001" },
    ],
    // 소멸은 사망보험금형(③ 「제1항 이외의 사유로」). 준용규정은 제5조까지 빼는 다른 글이라 담보약관에 직접 둔다
    clauses: [whole("3", "lapse-claim-death", { O01: "V02", O02: "V02" })],
  },
  {
    code: "m-disease-disability80-doc",
    ownerCoverage: "m-disease-disability80",
    idPrefix: "m7",
    file: "갱신형_질병80%이상후유장해(통합간편가입)보장.md",
    title: "질병80%이상후유장해(통합간편가입)보장 특별약관",
    slots: [
      { article: "1", find: "질병80%이상후유장해보험금", ref: "D0001" },
      { article: "3", find: "질병80%이상후유장해보험금", ref: "D0001" },
    ],
    clauses: [whole("2", "disability-detail", { O01: "V02", O02: "V02", O03: "V01" }), whole("3", "lapse-claim", "V02"), whole("4", "meritz-application")],
  },
  {
    code: "m-disease-surgery17-doc",
    ownerCoverage: "m-disease-surgery17",
    idPrefix: "m8",
    file: "갱신형_수술비(1-7종,_연간3회한)[질병](통합간편가입)보장.md",
    title: "수술비(1-7종, 연간3회한)[질병](통합간편가입)보장 특별약관",
    slots: [{ article: "1", find: "수술비", ref: "D0001" }],
    clauses: [whole("6", "lapse-death"), whole("7", "meritz-application")],
  },
];

export const MERITZ: ProductTerms = {
  code: "meritz",
  fixtureDir: "tests/fixtures/terms/메리츠",
  // 메리츠 원문 번호 → 알파Plus 마스터 (이름이 같은 별표). 1 적립이율 · 3 암 · 7 급성심근경색 · 14 장해 · 16 뇌졸중 · 26 골절(치아파절 제외)Ⅱ · 27 골절Ⅱ · 28 화상 · 29 1-7종 수술
  appendixNumbers: new Map([
    [1, "AX000001"],
    [3, "AX000004"],
    [7, "AX000008"],
    [14, "AX000002"],
    [16, "AX000007"],
    [26, "AX000014"],
    [27, "AX000021"],
    [28, "AX000013"],
    [29, "AX000003"],
  ]),
  general: MERITZ_GENERAL,
  specials: MERITZ_SPECIALS,
};

export const PRODUCTS: ProductTerms[] = [ALPHA, MERITZ];
export const SEED_DIR = "src/db/seed/data";
