/**
 * 절 형태 — 형태 판별 · 제1절 판정(①잠정) · 위임 문구 · 블록 번호 머리 (기능/조립산출 §3.8 ~ §3.10 · ADR-0021 결정 1 · ADR-0082 · ADR-0090 결정 7 · 8).
 *
 * - 형태는 계약형태와 기본계약 수로 정한다(`planForm`): 주계약 기본계약 2+ · 독립특약 = 절 형태, 그 밖 = 대치 형태.
 *   블록 후보 = 주계약이면 기본계약 상품담보, 독립특약이면 탑재 상품담보 전부. 실제 블록은 문면이 있고 조건 해소 · 블록 빈 조 빼기 뒤 조가 남은 것이다(조립이 센다).
 * - 제1절 판정(`judgeFirstSection`) — 판정 대상은 블록이 하나라도 조연결한 템플릿 조. **①은 판정 없이 전부 위임**이다
 *   (ADR-0082 결정 7 의 블록 하나 규칙을 잠정으로 전부에 — ② 판정에서 연결 수 k/N · 함수조항 동일 가드 · 준용하기 옵션으로 바뀐다).
 * - 위임 문구 「제N조(조 제목)는 제2절 보장조항에서 정합니다.」(ADR-0082 결정 8) — N 은 그 조 자신의 제1절 번호. 항 열쇠는 P · PZ 밖 예약 열쇠라
 *   위임된 조의 항을 가리키는 참조는 `articleGone`, 조 단위 참조는 유효하다(조립산출 §6.2 결정 메모).
 * - 블록 번호 머리(`blockHeads`) — 「그룹 제목 표시」 끔: 블록 순서대로 「1.」 「2.」. 켬: 그룹 「Ⅰ.」 아래 「Ⅰ-1.」 — 로마 숫자는 블록이 있는 그룹만 센다.
 *
 * DB·React import 금지 (순수층).
 */
import { CONTRACT_KIND_PATH, isStandaloneContract } from "../master";
import { articleRefLabel } from "../document/numbering";
import type { Id } from "../types";
import type { AssemblyInput, NumberedDoc, RArticle, RParagraph, SInline, SubstitutedDoc } from "./types";
import { mapArticles } from "./walk";

// ───────────────────────────── 형태 ─────────────────────────────

export type FormPlan =
  | { form: "single" }
  | {
      form: "sectioned";
      /** 독립특약 — 블록 0 이면 `noBlock`, 특약 절은 없다(탑재 상품담보가 모두 블록). */
      standalone: boolean;
      /** 블록 후보 상품담보 id — 주계약: 기본계약 · 독립특약: 탑재 상품담보 전부. 순서는 조립이 그룹 순서로 정한다. */
      candidates: ReadonlySet<Id>;
    };

/** 형태 판별 (ADR-0021 결정 1 · ADR-0082 결정 2). 주계약 기본계약 0 · 1 은 대치 형태다(0 은 `noBaseContract` 오류를 따로 낸다). */
export function planForm(input: Pick<AssemblyInput, "product" | "coverages">): FormPlan {
  if (isStandaloneContract(input.product.values.get(CONTRACT_KIND_PATH))) {
    return { form: "sectioned", standalone: true, candidates: new Set(input.coverages.map((c) => c.snapshot.id)) };
  }
  if (input.product.baseContractIds.length >= 2) return { form: "sectioned", standalone: false, candidates: new Set(input.product.baseContractIds) };
  return { form: "single" };
}

// ───────────────────────────── 제1절 판정 (①잠정) ─────────────────────────────

/**
 * 템플릿 조 하나의 제1절 판정 결과. ①은 위임 하나다 — ② 가 마스터 · 특칙 · 공통 · 공통항 분리 · 전체항 합침을 더한다(ADR-0082 결정 5).
 * 판정 대상이 아닌 조(연결 0)는 결과가 없다 — 마스터.
 */
export interface FirstSectionVerdict {
  kind: "delegate";
  /** 이 템플릿 조에 조연결한 블록(상품담보 id) — 블록 순서. */
  linkedBlocks: Id[];
}

/**
 * 제1절 판정 — 템플릿 조 id → 결과. `links` = 블록(블록 순서)마다 조연결한 템플릿 조 id(조건 해소 · 블록 빈 조 빼기 뒤).
 * **잠정(①)**: 연결이 하나라도 있으면 위임 — ② 판정에서 바뀐다.
 */
export function judgeFirstSection(links: readonly { productCoverageId: Id; linkedArticleIds: ReadonlySet<Id> }[]): Map<Id, FirstSectionVerdict> {
  const out = new Map<Id, FirstSectionVerdict>();
  for (const { productCoverageId, linkedArticleIds } of links) {
    for (const articleId of linkedArticleIds) {
      const verdict = out.get(articleId) ?? { kind: "delegate" as const, linkedBlocks: [] };
      verdict.linkedBlocks.push(productCoverageId);
      out.set(articleId, verdict);
    }
  }
  return out;
}

// ───────────────────────────── 위임 문구 ─────────────────────────────

/** 위임 문구 항의 열쇠 — P · PZ 코드 영역 밖의 예약 열쇠. 템플릿이 어떤 코드를 가리켜도 이 항에 붙지 않는다. */
export const DELEGATION_KEY = "SD0100";

/** 「제2절 보장조항」 — 렌더 상수(참조 노드 없음, ADR-0082 결정 8). */
export const SECOND_SECTION_NAME = "제2절 보장조항";
/** 「제1절 일반조항」 — 렌더 상수. */
export const FIRST_SECTION_NAME = "제1절 일반조항";

export function delegationText(articleNumber: number, articleTitle: string): string {
  return `${articleRefLabel(articleNumber, articleTitle)}는 ${SECOND_SECTION_NAME}에서 정합니다.`;
}

/** 위임 조의 본문 한 항 — 번호를 알기 전이라 글은 비워 두고 `fillDelegation` 이 채운다. */
function delegationParagraph(articleId: Id, text: string): RParagraph<SInline> {
  return { kind: "paragraph", id: `${articleId}::delegation`, key: DELEGATION_KEY, children: [{ kind: "text", id: `${articleId}::delegation-text`, text }] };
}

/** 위임 조의 본문을 위임 문구 한 항으로 바꾼다 — 빈 조 빼기 · 번호 **전**(조가 빠지지 않고 항 번호가 서게). */
export function withDelegation(doc: SubstitutedDoc, delegated: ReadonlySet<Id>): SubstitutedDoc {
  return mapArticles(doc, (a): RArticle<SInline> => (delegated.has(a.id) ? { ...a, children: [delegationParagraph(a.id, "")] } : a));
}

/** 번호가 선 뒤 위임 문구의 글을 채운다 — N = 그 조 자신의 제1절 번호. */
export function fillDelegation(numbered: NumberedDoc, delegated: ReadonlySet<Id>): NumberedDoc {
  const doc = mapArticles(numbered.doc, (a): RArticle<SInline> => {
    const n = numbered.numbers.get(a.id)?.n;
    return delegated.has(a.id) && n !== undefined ? { ...a, children: [delegationParagraph(a.id, delegationText(n, a.title))] } : a;
  });
  return { ...numbered, doc };
}

// ───────────────────────────── 블록 번호 머리 ─────────────────────────────

const ROMAN = ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ", "Ⅶ", "Ⅷ", "Ⅸ", "Ⅹ", "Ⅺ", "Ⅻ"];

/** 로마 숫자 — 1 ~ 12 는 한 글자(Ⅰ ~ Ⅻ), 그 너머는 라틴 문자 조합. */
export function romanNumeral(n: number): string {
  if (n >= 1 && n <= ROMAN.length) return ROMAN[n - 1];
  const table: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let rest = n;
  let out = "";
  for (const [value, letters] of table) while (rest >= value) {
    out += letters;
    rest -= value;
  }
  return out;
}

/**
 * 블록 번호 머리 — 그룹(블록이 있는 것만, 그룹 순) × 블록 수 → 그룹 머리 · 블록 머리.
 * 끔: 그룹 머리 없음 · 블록은 전체 순번 「1.」. 켬: 그룹 「Ⅰ.」 · 블록 「Ⅰ-1.」(그룹마다 1 부터).
 */
export function blockHeads(blockCounts: readonly number[], showGroupTitles: boolean): { group?: string; blocks: string[] }[] {
  let serial = 0;
  return blockCounts.map((count, g) => {
    if (!showGroupTitles) return { blocks: Array.from({ length: count }, () => `${++serial}.`) };
    const roman = romanNumeral(g + 1);
    return { group: `${roman}.`, blocks: Array.from({ length: count }, (_, i) => `${roman}-${i + 1}.`) };
  });
}

/** 오류 좌표의 절 이름공간 (기능/조립산출 §3.4) — 「제1절」 · 「제2절 {블록 머리}」. */
export const FIRST_SECTION_COORDINATE = { kind: "general", label: "제1절" } as const;
export function blockCoordinate(head: string): { kind: "benefit"; label: string } {
  return { kind: "benefit", label: `제2절 ${head}` };
}
