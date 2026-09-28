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
 * 공용조항 정의 — 여러 담보약관이 되풀이하는 문구 (기능/공용조항 §3.1). 코드는 시스템 채번(`C0001`…)이라 배열 순서가 곧 코드다.
 * 본문은 평문(`text`, `{O01}` = 옵션 자리)에서 만들거나 원문 한 자리(`from`, 조건 오버레이가 얹힌 뒤)에서 딴다.
 * 공용조항 안의 조 참조는 **보통약관 마스터**만 — 사용처 자신의 조 · 항을 가리키는 구절은 사용처에 남긴다 (§3.5).
 */
export interface ClauseSpec {
  /** 설정 안의 이름 — 쓰임(`ClauseUse.clause`)이 이것으로 가리킨다. 코드(`C0001`…)는 배열 순서로 매겨진다(시스템 채번과 같게). */
  key: string;
  code: string;
  label: string;
  mode: "inline" | "block";
  description: string;
  /** 평문 본문의 참조를 풀 상품(그 상품의 별표 번호 · 보통약관 색인) — 기본 알파Plus. 「항」 본문은 `\n` 으로 항을 가른다. */
  product?: string;
  text?: string;
  /** 원문 자리 — 문서 코드(보통약관 코드 포함) · 조 · 첫 항 · 잇닿은 항 수(기본 1). 호 · 목도 함께 딴다. */
  from?: { spec: string; article: string; paragraph: number; paragraphs?: number };
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
  /** 공용조항 쓰임 — 두 보통약관이 똑같이 쓰는 항 (참조 없는 항만 — 보통약관 조 참조는 보통약관마다 대상이 다르다). */
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
 * 공용조항 — 두 상품(알파Plus · 메리츠)의 원문이 되풀이하는 문구 (모델명세 §4 · 메리츠_모델명세 §4 · 기능/공용조항 §6.2).
 * 규칙 (2026-09-28):
 * - **같은 글**이면 한 공용조항을 두 상품이 함께 쓴다. **낱말만 다르면** 그 낱말을 옵션 자리로 두고 사용처가 고른다.
 *   띄어쓰기만 다른 곳(「다만, 【」↔「다만,【」)은 옵션으로 두지 않는다 — 고를 이유가 없는 선택지가 된다. 공용조항의 경계를 그 앞뒤로 둬
 *   공백은 사용처 텍스트가 갖는다(장해판정시기 별도 · 신체부위별 판정기준).
 * - 조 참조를 품은 문장은 공용조항이 될 수 없다 — 사용처 자신의 조 · 항(§3.5)은 물론, 보통약관 조 참조도 보통약관이 두 벌이라
 *   상품마다 대상이 다르다(준용규정은 상품마다 한 벌).
 * - 보통약관끼리 **조째 같은** 조(참조 없고 남이 가리키지 않는 항만)는 「항」 공용조항 하나로 두 보통약관이 쓴다 — 표 · 박스는 사용처에 남는다.
 *
 * 순서가 곧 코드다. **보통약관이 쓰는 공용조항이 맨 앞**(C0001~) — 시드 · 화면 E2E 바탕은 보통약관을 가져오기 전에 이것들을 만든다.
 * 보통약관 조를 가리키는 공용조항(준용규정 두 벌)은 맨 뒤 — 보통약관이 있어야 정의 검사 ① 을 통과한다. 변환기가 순서를 검사한다.
 *
 * 「특별약관의 소멸」은 조 하나가 아니라 **구조 유형별 조합**이다 — 사용처 자신을 가리키는 항(「제1조(…)에서 정한 …」 ·
 * 「제1항에 따라」)은 담보약관에 남고, 공통 문장만 공용조항이다 (§3.5).
 *   T1 소멸 급부 없음            : ① 「이 특별약관의 피보험자가 」 + 사망 시 소멸
 *   T2 세부보장 1 · 급부가 소멸 급부 : ① 제1조 참조 + 지급사유 발생 시 소멸 · ② 제1항 참조 + 소멸 시 해약환급금 미지급 · ③ 「이 특별약관의 피보험자가 」 + 사망 시 소멸
 *   T3 세부보장 여럿 · 그중 하나가 소멸 : ① 「이 특별약관의 피보험자가 」 + 사망 시 소멸 · ②③ 그 세부보장의 소멸 (담보약관 직접)
 */
type ClauseDraft = Omit<ClauseSpec, "code">;

/** 보통약관끼리 조째 같은 조 — 「항」 공용조항 한 건 = 그 조의 잇닿은 항들. 본문은 메리츠 원문 자리에서 딴다 (두 원문이 같다). */
const generalArticle = (key: string, label: string, meritz: string, paragraph = 1, paragraphs = 1): ClauseDraft => ({
  key,
  label,
  mode: "block",
  description: `보통약관 「${label.replace(/ [①-⑳]+$/, "")}」 — 두 상품 보통약관이 같은 글이다`,
  from: { spec: "meritz-general", article: meritz, paragraph, paragraphs },
});

const CLAUSE_DRAFTS: ClauseDraft[] = [
  // ── 보통약관 (두 벌 공통) — 조째 같은 조
  generalArticle("g-purpose", "목적", "1"),
  generalArticle("g-beneficiary", "보험수익자의 지정", "13"),
  generalArticle("g-representative", "대표자의 지정", "14", 1, 3),
  generalArticle("g-disclosure", "계약 전 알릴 의무", "15"),
  generalArticle("g-second-premium", "제2회 이후 보험료의 납입", "28"),
  generalArticle("g-dividend", "배당금의 지급", "42"),
  generalArticle("g-dispute", "분쟁의 조정", "44", 1, 2),
  generalArticle("g-court", "관할법원", "45"),
  generalArticle("g-prescription", "소멸시효", "46"),
  generalArticle("g-interpretation-1", "약관의 해석 ①", "47", 1, 1),
  generalArticle("g-interpretation-2", "약관의 해석 ②③", "47", 2, 2),
  generalArticle("g-explanation", "설명서 교부 및 보험안내자료 등의 효력", "48", 1, 3),
  generalArticle("g-privacy", "개인정보보호", "51", 1, 2),
  generalArticle("g-governing-law", "준거법", "52"),
  generalArticle("g-deposit-insurance", "예금보험에 의한 지급보장", "53"),
  // ── 보통약관 (두 벌 공통) — 낱말만 다른 항
  {
    key: "g-change-request",
    label: "계약내용 변경 신청",
    mode: "inline",
    description: "계약자가 회사 승낙으로 바꿀 수 있는 사항과 2형의 신청 제한 — 뒤 항이 이 항을 가리켜(제1항) 항은 보통약관 소유, 문장만 공용조항. 2형 이름이 상품마다 다르다",
    text: "계약자는 회사의 승낙을 얻어 다음의 사항을 변경할 수 있습니다. 이 경우 승낙을 서면 등으로 알리거나 보험증권의 뒷면에 기재하여 드립니다. 다만, 2형({O01})의 경우 보험기간, 보험료 납입기간, 피보험자의 변경 및 보험가입금액의 증액은 신청할 수 없습니다.",
    options: [{ label: "2형 이름", values: [{ label: "납입후50%", text: "해약환급금 미지급형(납입후50%)" }, { label: "미지급형", text: "해약환급금미지급형" }] }],
  },
  {
    key: "g-death-lapse",
    label: "사망에 따른 계약 소멸",
    mode: "block",
    description: "피보험자 사망으로 계약이 소멸하고 계약자적립액 · 미경과보험료를 지급한다 — 기본계약이 상해사망이면 「상해 이외의 사유로」 사망한 경우",
    text: "피보험자가 {O01} 경우에는 이 계약은 소멸되며, 이 경우 회사는 그 때까지「보험료 및 해약환급금 산출방법서」에서 정한 사망 당시 계약자적립액(중도인출이 있는 경우 중도인출 원금과 이자를 차감하고 적립한 금액을 말합니다) 및 미경과보험료를 계약자에게 지급합니다.",
    options: [{ label: "사망 사유", values: [{ label: "사망", text: "사망한" }, { label: "상해 이외 사망", text: "상해 이외의 사유로 사망한" }] }],
  },
  {
    key: "g-revival-cancer-start",
    label: "부활 시 암보장개시일",
    mode: "block",
    description: "부활(효력회복)일을 기준일로 암보장개시일을 다시 적용한다 — 기준일 이름(계약일 · 최초계약일)이 상품마다 다르다",
    text: "부활(효력회복)시 부활(효력회복)일을 {O01}로 하여 암보장개시일을 적용합니다.",
    options: [{ label: "기준일", values: [{ label: "계약일", text: "계약일" }, { label: "최초계약일", text: "최초계약일" }] }],
  },
  // ── 보통약관 · 담보약관 공통
  {
    key: "body-part-criteria",
    label: "신체부위별 판정기준",
    mode: "inline",
    description: "장해분류표의 신체부위별 판정기준이 따로 정하면 그에 따른다 — 후유장해 합산 · 가중 항의 「다만,」 뒤. 조사(에 · 에서)는 사용처가 고른다",
    text: "【별표2(장해분류표)】의 각 신체부위별 판정기준{O01} 별도로 정한 경우에는 그 기준에 따릅니다.",
    options: [{ label: "조사", values: [{ label: "에", text: "에" }, { label: "에서", text: "에서" }] }],
  },
  // ── 담보약관
  {
    key: "third-party",
    label: "제3자 판정",
    mode: "inline",
    description: "보험금 지급사유에 합의하지 못할 때 제3자(종합병원 전문의)의 의견에 따른다 — 「보험수익자와 회사가 제N조(보험금의 지급사유)의 」 뒤",
    text: "보험금 지급사유에 대해 합의하지 못할 때는 보험수익자와 회사가 함께 제3자를 정하고 그 제3자의 의견에 따를 수 있습니다. 제3자는 의료법 제3조(의료기관)에 규정한 종합병원 소속 전문의 중에 정하며, 보험금 지급사유 판정에 드는 의료비용은 회사가 전액 부담합니다.",
  },
  {
    key: "death-lapse",
    label: "사망 시 소멸",
    mode: "inline",
    description: "피보험자 사망으로 특별약관이 소멸하고 계약자적립액 · 미경과보험료를 지급한다 — 「이 특별약관의 피보험자가 」 뒤 (사망이 곧 지급사유인 담보는 그 사이에 「제1항 이외의 사유로 」)",
    text: "사망한 경우에는 이 특별약관은 그 때부터 소멸되며, 이 경우 회사는 그 때까지「보험료 및 해약환급금 산출방법서」에서 정한 이 특별약관의 사망 당시 계약자적립액 및 미경과보험료를 계약자에게 지급합니다.",
  },
  {
    key: "lapse-no-refund",
    label: "소멸 시 해약환급금 미지급",
    mode: "inline",
    description: "지급사유 발생으로 특별약관이 소멸하면 해약환급금을 지급하지 않는다 — 「제1항에 따라 」 뒤",
    text: "이 특별약관이 {O01} 경우에는 회사는 이 특별약관의 해약환급금을 지급하지 않습니다.",
    options: [{ label: "소멸 표현", values: [{ label: "소멸된", text: "소멸된" }, { label: "소멸되는", text: "소멸되는" }] }],
  },
  {
    key: "claim-lapse",
    label: "지급사유 발생 시 소멸",
    mode: "inline",
    description: "소멸 급부의 지급사유가 생기면 특별약관이 소멸한다 — 「제1조(보험금의 지급사유)에서 정한 <보험금명> 」 뒤. 「그 때부터」 유무가 상품마다 다르다",
    text: "지급사유가 발생한 경우에는 이 특별약관은 {O01}.",
    options: [{ label: "소멸 표현", values: [{ label: "그 때부터 소멸", text: "그 때부터 소멸됩니다" }, { label: "소멸", text: "소멸됩니다" }] }],
  },
  {
    key: "surgery-definition",
    label: "수술의 정의",
    mode: "inline",
    description: "「수술」의 정의 — 뒤 항들이 이 항을 「제N항」으로 가리키므로 항은 사용처 소유, 문장만 공용조항. 「에서」 · 「에 있어서」는 사용처가 고른다",
    text: "이 특별약관{O01}「수술」이라 함은 의사, 치과의사 또는 한의사의 면허를 가진 자(이하「의사」라 합니다)가 치료가 필요하다고 인정한 경우로서 의사의 관리하에 치료를 직접적인 목적으로 기구를 사용하여 생체(生體)에 절단(切斷, 특정부위를 잘라 내는 것), 절제(切除, 특정부위를 잘라 없애는 것) 등의 조작을 가하는 것을 말합니다.",
    options: [{ label: "조사", values: [{ label: "에서", text: "에서" }, { label: "에 있어서", text: "에 있어서" }] }],
  },
  {
    key: "surgery-place",
    label: "수술의 장소",
    mode: "inline",
    description: "수술은 국내외 의료기관에서 행한 것에 한한다 — 「제N항의」 뒤",
    text: "「수술」은 자택 등에서의 치료가 곤란하여 의료법 제3조(의료기관) 제2항에 정한 국내의 병원, 의원 또는 국외의 의료관련법에서 정한 의료기관에서 행한 것에 한합니다.",
  },
  {
    key: "surgery-new-tech",
    label: "신의료기술 수술",
    mode: "inline",
    description: "신의료기술평가위원회 등이 인정한 최신 수술기법도 수술에 포함한다 — 「제N항의」 뒤",
    text: "「수술」에는 보건복지부 산하 신의료기술평가위원회 또는 이에 준하는 기관으로부터 안전성과 치료효과를 인정받은 최신 수술기법으로 생체에 절단, 절제 등의 조작을 가하는 수술도 포함됩니다.",
  },
  {
    key: "disability-rate-timing",
    label: "장해지급률 확정 시기",
    mode: "inline",
    description: "장해지급률이 180일 안에 확정되지 않으면 180일째 진단으로 정한다 — 「제N조(보험금의 지급사유)에서 」 뒤. 기산일(상해 · 질병)과 어미는 사용처가 고른다",
    text: "장해지급률이 {O01}부터 180일 이내에 확정되지 {O02} 경우에는 {O01}부터 180일이 되는 날의 의사 진단에 기초하여 고정될 것으로 인정되는 상태를 장해지급률로 결정합니다.",
    options: [
      { label: "기산일", values: [{ label: "상해 발생일", text: "상해 발생일" }, { label: "질병 진단확정일", text: "질병의 진단확정일" }] },
      { label: "어미", values: [{ label: "않는", text: "않는" }, { label: "않은", text: "않은" }] },
    ],
  },
  {
    key: "disability-timing-exception",
    label: "장해판정시기 별도",
    mode: "inline",
    description: "장해분류표가 장해판정시기를 따로 정하면 그에 따른다 — 장해지급률 확정 시기 뒤 「다만,」 다음",
    text: "【별표2(장해분류표)】에 장해판정시기를 별도로 정한 경우에는 그에 따릅니다.",
  },
  {
    key: "unlisted-disability",
    label: "분류표 외 후유장해",
    mode: "inline",
    description: "장해분류표에 없는 후유장해는 분류표의 구분에 준해 정한다 — 무엇을 정하는지(지급액 · 장해지급률)는 사용처가 고른다",
    text: "【별표2(장해분류표)】에 해당되지 않는 후유장해는 피보험자의 직업, 연령, 신분 또는 성별 등에 관계없이 신체의 장해정도에 따라【별표2(장해분류표)】의 구분에 준하여 {O01}을 결정합니다.",
    options: [{ label: "결정 대상", values: [{ label: "지급액", text: "지급액" }, { label: "장해지급률", text: "장해지급률" }] }],
  },
  {
    key: "disability-sum",
    label: "후유장해 합산",
    mode: "inline",
    description: "같은 원인으로 두 가지 이상의 후유장해가 생기면 지급률을 합산한다 — 원인(상해 · 질병)은 사용처가 고른다. 「다만,」 뒤는 신체부위별 판정기준",
    text: "같은 {O01} 두 가지 이상의 후유장해가 생긴 경우에는 후유장해 지급률을 합산하여 지급합니다.",
    options: [{ label: "원인", values: [{ label: "상해", text: "상해로" }, { label: "질병", text: "질병으로" }] }],
  },
  {
    key: "surgery17-definition",
    label: "1-7종 수술의 정의",
    mode: "inline",
    description: "1-7종 수술비의 「수술」 — 수술분류표의 수술코드에 해당하는 의료행위. 뒤 항들이 이 항을 가리켜 문장만 공용조항. 원인(상해 · 질병)은 사용처가 고른다",
    text: "이 특별약관에서「수술」이라 함은 의사 또는 치과의사의 면허를 가진 자(이하「의사」라 합니다)가 피보험자의 {O01} 인한 치료를 직접적인 목적으로 필요하다고 인정한 경우로서 의료기관에서 의사의 관리하에 【별표3(1-7종 수술분류표)】에서 정한 수술코드(이하「수술코드」라 합니다.)에 해당하는 의료행위를 하는 것을 말합니다.",
    options: [{ label: "원인", values: [{ label: "상해", text: "상해로" }, { label: "질병", text: "질병으로" }] }],
  },
  {
    key: "surgery17-multiple",
    label: "1-7종 동시 수술",
    mode: "inline",
    description: "한 번의 입원 · 통원에서 두 가지 이상 수술을 받으면 하나의 수술코드에 한해 지급한다 — 뒤 항이 이 항을 가리켜 문장만 공용조항",
    text: "피보험자가 1회의 입원 또는 1회의 통원 중에 2가지 이상의 수술을 받은 경우 퇴원일 또는 통원일을 기준으로 진단서 및 진료비 세부내역서 등에서 확인되는 하나의 수술코드에 한하여 수술비를 지급합니다.",
  },
  {
    key: "surgery17-note2",
    label: "수술분류표 주2) 면책",
    mode: "block",
    description: "1-7종 수술분류표의 주2)에 해당하는 사항은 보상하지 않는다",
    text: "회사는【별표3(1-7종 수술분류표)】의 주2)에 해당하는 사항은 보상하지 않습니다.",
  },
  {
    key: "surgery17-other-cause",
    label: "다른 원인 수술 면책",
    mode: "block",
    description: "보장 원인이 아닌 원인(상해 수술비는 질병, 질병 수술비는 상해)으로 받은 수술코드는 보상하지 않는다 — 원인은 사용처가 고른다",
    text: "{O01} 원인으로 수술을 하여【별표3(1-7종 수술분류표)】에서 정한 수술코드를 받은 경우에는 보상하지 않습니다.",
    options: [{ label: "원인", values: [{ label: "질병", text: "질병을" }, { label: "상해", text: "상해를" }] }],
  },
  // ── 보통약관 조를 가리키는 공용조항 — 상품마다 한 벌 (맨 뒤)
  {
    key: "alpha-application",
    label: "준용규정(알파Plus)",
    mode: "block",
    description: "특별약관에서 정하지 않은 사항은 보통약관을 따른다 — 알파Plus 보통약관 조를 가리킨다. 제외 조 목록은 갱신형(담보속성 A0001 = 2)이면 다섯 조 무조건, 아니면 세 조 + 1종 가입 시 두 조",
    from: { spec: "surgery17-doc", article: "8", paragraph: 1 },
  },
  {
    key: "meritz-application",
    label: "준용규정(메리츠)",
    mode: "block",
    description: "특별약관에서 정하지 않은 사항은 보통약관을 따른다 — 메리츠 보통약관 조를 가리킨다(적립이율 · 만기환급금 · 중도인출 제외, 1종이면 납입면제 두 조도 제외). 질병사망은 제5조까지 빼는 다른 글이라 쓰지 않는다",
    from: { spec: "m-fracture-doc", article: "5", paragraph: 1 },
  },
];

const pad4 = (n: number) => String(n).padStart(4, "0");
export const CLAUSES: ClauseSpec[] = CLAUSE_DRAFTS.map((c, i) => ({ ...c, code: `C${pad4(i + 1)}` }));

/** 쓰임 줄임말 — 원문 조 · 항 → 공용조항 key (옵션 선택은 `{ O01: "V02" }` 또는 O01 하나면 선택지 코드 문자열). */
const at = (article: string, paragraph: number, clause: string, options?: string | Record<string, string>): ClauseUse => ({
  article,
  paragraph,
  clause,
  ...(options ? { options: typeof options === "string" ? { O01: options } : options } : {}),
});

/** 조째 같은 보통약관 조의 쓰임 — [key, 알파Plus 조 · 첫 항, 메리츠 조 · 첫 항]. */
const GENERAL_ARTICLES: [string, string, number, string, number][] = [
  ["g-purpose", "1", 1, "1", 1],
  ["g-beneficiary", "13", 1, "13", 1],
  ["g-representative", "14", 1, "14", 1],
  ["g-disclosure", "15", 1, "15", 1],
  ["g-second-premium", "27", 1, "28", 1],
  ["g-dividend", "37", 1, "42", 1],
  ["g-dispute", "39", 1, "44", 1],
  ["g-court", "40", 1, "45", 1],
  ["g-prescription", "41", 1, "46", 1],
  ["g-interpretation-1", "42", 1, "47", 1],
  ["g-interpretation-2", "42", 2, "47", 2],
  ["g-explanation", "43", 1, "48", 1],
  ["g-privacy", "46", 1, "51", 1],
  ["g-governing-law", "47", 1, "52", 1],
  ["g-deposit-insurance", "48", 1, "53", 1],
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
  clauses: [
    ...GENERAL_ARTICLES.map(([key, article, paragraph]) => at(article, paragraph, key)),
    at("23", 1, "g-change-request", "V01"),
    at("25", 3, "g-death-lapse", "V01"),
    at("27의2", 8, "body-part-criteria", "V01"),
    at("27의2", 9, "body-part-criteria", "V02"),
    at("30", 4, "g-revival-cancer-start", "V01"),
  ],
};

const ALPHA_SPECIALS: SpecialSpec[] = [
  {
    code: "base-disability80-doc",
    ownerCoverage: "base-disability80",
    idPrefix: "b",
    title: "일반상해80%이상후유장해 기본계약 문면",
    extractFrom: { file: "보통약관.md", articles: ["3", "4"], linkTo: ["3", "4"] },
    slots: [],
    clauses: [
      at("4", 1, "disability-rate-timing", { O01: "V01", O02: "V01" }),
      at("4", 1, "disability-timing-exception"),
      at("4", 3, "unlisted-disability", "V01"),
      at("4", 4, "third-party"),
      at("4", 5, "disability-sum", "V01"),
      at("4", 5, "body-part-criteria", "V01"),
      at("4", 6, "body-part-criteria", "V02"),
    ],
  },
  {
    code: "death-doc",
    ownerCoverage: "death",
    idPrefix: "s1",
    file: "일반상해사망보장.md",
    // 제3조 ①의 보험금명은 담보 값(D0001 = 사망보험금) — 소멸 급부가 곧 사망이라 ③ 앞에 「제1항 이외의 사유로 」(T2 사망형)
    slots: [{ article: "3", find: "사망보험금", ref: "D0001" }],
    clauses: [at("2", 3, "third-party"), at("3", 1, "claim-lapse", "V01"), at("3", 2, "lapse-no-refund", "V02"), at("3", 3, "death-lapse"), at("4", 1, "alpha-application")],
  },
  {
    code: "living80-doc",
    ownerCoverage: "living80",
    idPrefix: "s2",
    file: "일반상해80%이상후유장해_생활자금보장.md",
    slots: [{ article: "1", find: "일반상해80%이상후유장해 생활자금", ref: "D0001" }],
    // 제3조 ①의 보험금명은 원문이 「일반상해 80%…」로 띄어 써 담보 값과 달라 평문으로 둔다
    clauses: [
      at("2", 1, "disability-rate-timing", { O01: "V01", O02: "V01" }),
      at("2", 1, "disability-timing-exception"),
      at("2", 3, "unlisted-disability", "V01"),
      at("2", 4, "third-party"),
      at("2", 5, "disability-sum", "V01"),
      at("2", 5, "body-part-criteria", "V01"),
      at("2", 6, "body-part-criteria", "V02"),
      at("3", 1, "claim-lapse", "V01"),
      at("3", 2, "lapse-no-refund", "V01"),
      at("3", 3, "death-lapse"),
      at("4", 1, "alpha-application"),
    ],
  },
  {
    code: "fracture-doc",
    ownerCoverage: "fracture",
    idPrefix: "s3",
    file: "골절(치아파절_제외)진단비Ⅱ보장.md",
    slots: [{ article: "1", find: "골절(치아파절 제외)진단비", ref: "D0001" }],
    clauses: [at("2", 2, "third-party"), at("4", 1, "death-lapse"), at("5", 1, "alpha-application")],
  },
  {
    code: "living50-doc",
    ownerCoverage: "living50",
    idPrefix: "s4",
    file: "일반상해50%이상후유장해_생활자금보장.md",
    slots: [{ article: "1", find: "일반상해50%이상후유장해 생활자금", ref: "D0001" }],
    clauses: [
      at("2", 1, "disability-rate-timing", { O01: "V01", O02: "V01" }),
      at("2", 1, "disability-timing-exception"),
      at("2", 3, "unlisted-disability", "V02"),
      at("2", 4, "third-party"),
      at("2", 5, "disability-sum", "V01"),
      at("2", 5, "body-part-criteria", "V01"),
      at("2", 6, "body-part-criteria", "V02"),
      at("3", 1, "claim-lapse", "V01"),
      at("3", 2, "lapse-no-refund", "V01"),
      at("3", 3, "death-lapse"),
      at("4", 1, "alpha-application"),
    ],
  },
  {
    code: "fracture-surgery-doc",
    ownerCoverage: "fracture-surgery",
    idPrefix: "s5",
    file: "골절수술비Ⅱ보장.md",
    slots: [{ article: "1", find: "골절수술비", ref: "D0001" }],
    clauses: [
      at("2", 2, "third-party"),
      at("3", 1, "surgery-definition", "V01"),
      at("3", 2, "surgery-place"),
      at("3", 3, "surgery-new-tech"),
      at("5", 1, "death-lapse"),
      at("6", 1, "alpha-application"),
    ],
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
      at("2", 2, "third-party"),
      at("3", 4, "surgery-definition", "V01"),
      at("3", 5, "surgery-place"),
      at("3", 6, "surgery-new-tech"),
      at("4", 1, "claim-lapse", "V01"),
      at("4", 2, "lapse-no-refund", "V01"),
      at("4", 3, "death-lapse"),
      at("5", 1, "alpha-application"),
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
    // 준용규정(④)은 공용조항 「준용규정(알파Plus)」의 본문이 된다 — 조건은 공용조항 안으로 옮겨 가고 이 자리는 참조
    clauses: [
      at("2", 1, "surgery17-definition", "V01"),
      at("2", 2, "surgery-place"),
      at("3", 1, "surgery17-multiple"),
      at("3", 8, "third-party"),
      at("4", 3, "surgery17-note2"),
      at("4", 5, "surgery17-other-cause", "V01"),
      at("7", 1, "death-lapse"),
      at("8", 1, "alpha-application"),
    ],
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
    clauses: [
      at("3", 3, "third-party"),
      at("5", 1, "surgery-definition", "V01"),
      at("5", 2, "surgery-place"),
      at("5", 3, "surgery-new-tech"),
      at("7", 1, "death-lapse"),
      at("8", 1, "alpha-application"),
    ],
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
  clauses: [
    ...GENERAL_ARTICLES.map(([key, , , article, paragraph]) => at(article, paragraph, key)),
    at("23", 1, "g-change-request", "V02"),
    at("26", 3, "g-death-lapse", "V02"),
    at("31", 8, "body-part-criteria", "V01"),
    at("31", 9, "body-part-criteria", "V02"),
    at("35", 4, "g-revival-cancer-start", "V02"),
  ],
};

const MERITZ_SPECIALS: SpecialSpec[] = [
  {
    code: "m-base-death-doc",
    ownerCoverage: "m-base-death",
    idPrefix: "mb",
    title: "일반상해사망 기본계약 문면",
    extractFrom: { file: "보통약관.md", articles: ["3", "4"], linkTo: ["3", "4"] },
    slots: [],
    clauses: [at("4", 3, "third-party")],
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
    clauses: [
      at("2", 1, "disability-rate-timing", { O01: "V01", O02: "V02" }),
      at("2", 1, "disability-timing-exception"),
      at("2", 3, "unlisted-disability", "V02"),
      at("2", 4, "third-party"),
      at("2", 5, "disability-sum", "V01"),
      at("2", 5, "body-part-criteria", "V01"),
      at("2", 6, "body-part-criteria", "V02"),
      at("3", 1, "claim-lapse", "V02"),
      at("3", 2, "lapse-no-refund", "V01"),
      at("3", 3, "death-lapse"),
      at("4", 1, "meritz-application"),
    ],
  },
  {
    code: "m-surgery17-doc",
    ownerCoverage: "m-surgery17",
    idPrefix: "m2",
    file: "갱신형_수술비(1-7종,_연간3회한)[상해](통합간편가입)보장.md",
    title: "수술비(1-7종, 연간3회한)[상해](통합간편가입)보장 특별약관",
    slots: [{ article: "1", find: "수술비", ref: "D0001" }],
    clauses: [
      at("2", 1, "surgery17-definition", "V01"),
      at("2", 2, "surgery-place"),
      at("3", 1, "surgery17-multiple"),
      at("3", 8, "third-party"),
      at("4", 3, "surgery17-note2"),
      at("4", 5, "surgery17-other-cause", "V01"),
      at("6", 1, "death-lapse"),
      at("7", 1, "meritz-application"),
    ],
  },
  {
    code: "m-fracture-doc",
    ownerCoverage: "m-fracture",
    idPrefix: "m3",
    file: "갱신형_골절(치아파절_제외)진단비Ⅱ(통합간편가입)보장.md",
    title: "골절(치아파절 제외)진단비Ⅱ(통합간편가입)보장 특별약관",
    slots: [{ article: "1", find: "골절(치아파절 제외)진단비", ref: "D0001" }],
    clauses: [at("2", 2, "third-party"), at("4", 1, "death-lapse"), at("5", 1, "meritz-application")],
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
    // 소멸 T3 — 알파Plus 신화상과 같은 구성. 수술의 정의는 「이 특별약관에 있어서」
    clauses: [
      at("3", 3, "third-party"),
      at("4", 1, "surgery-definition", "V02"),
      at("4", 2, "surgery-place"),
      at("4", 3, "surgery-new-tech"),
      at("7", 1, "death-lapse"),
      at("8", 1, "meritz-application"),
    ],
  },
  {
    code: "m-fracture-surgery-doc",
    ownerCoverage: "m-fracture-surgery",
    idPrefix: "m5",
    file: "갱신형_골절수술비Ⅱ(통합간편가입)보장.md",
    title: "골절수술비Ⅱ(통합간편가입)보장 특별약관",
    slots: [{ article: "1", find: "골절수술비", ref: "D0001" }],
    clauses: [
      at("2", 2, "third-party"),
      at("3", 1, "surgery-definition", "V02"),
      at("3", 2, "surgery-place"),
      at("3", 3, "surgery-new-tech"),
      at("5", 1, "death-lapse"),
      at("6", 1, "meritz-application"),
    ],
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
    // T2 사망형 — ③ 「제1항 이외의 사유로 」. 준용규정은 제5조까지 빼는 다른 글이라 담보약관에 직접 둔다(보통약관 조 참조는 선택지 문구가 될 수 없다)
    clauses: [at("2", 2, "third-party"), at("3", 1, "claim-lapse", "V02"), at("3", 2, "lapse-no-refund", "V01"), at("3", 3, "death-lapse")],
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
    clauses: [
      at("2", 1, "disability-rate-timing", { O01: "V02", O02: "V02" }),
      at("2", 1, "disability-timing-exception"),
      at("2", 3, "unlisted-disability", "V01"),
      at("2", 4, "third-party"),
      at("2", 5, "disability-sum", "V02"),
      at("2", 5, "body-part-criteria", "V01"),
      at("2", 6, "body-part-criteria", "V02"),
      at("3", 1, "claim-lapse", "V02"),
      at("3", 2, "lapse-no-refund", "V01"),
      at("3", 3, "death-lapse"),
      at("4", 1, "meritz-application"),
    ],
  },
  {
    code: "m-disease-surgery17-doc",
    ownerCoverage: "m-disease-surgery17",
    idPrefix: "m8",
    file: "갱신형_수술비(1-7종,_연간3회한)[질병](통합간편가입)보장.md",
    title: "수술비(1-7종, 연간3회한)[질병](통합간편가입)보장 특별약관",
    slots: [{ article: "1", find: "수술비", ref: "D0001" }],
    clauses: [
      at("2", 1, "surgery17-definition", "V02"),
      at("2", 2, "surgery-place"),
      at("3", 1, "surgery17-multiple"),
      at("3", 8, "third-party"),
      at("4", 3, "surgery17-note2"),
      at("4", 5, "surgery17-other-cause", "V02"),
      at("6", 1, "death-lapse"),
      at("7", 1, "meritz-application"),
    ],
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
