/**
 * 절 형태 — 형태 판별 · 제1절 판정 · 위임 문구 · 블록 번호 머리 (기능/조립산출 §3.8 ~ §3.10 · ADR-0021 결정 1 · ADR-0082 · ADR-0090 결정 7 · 8).
 *
 * - 형태는 계약형태와 기본계약 수로 정한다(`planForm`): 주계약 기본계약 2+ · 독립특약 = 절 형태, 그 밖 = 대치 형태.
 *   블록 후보 = 주계약이면 기본계약 상품담보, 독립특약이면 탑재 상품담보 전부. 실제 블록은 문면이 있고 조건 해소 · 블록 빈 조 빼기 뒤 조가 남은 것이다(조립이 센다).
 * - 제1절 판정(`judgeFirstSection`, ADR-0082 결정 1 ~ 7) — 판정 대상은 블록이 하나라도 조연결한 템플릿 조. 연결 수 k/N 으로 먼저 가르고
 *   (마스터 · 블록 하나 위임 · 특칙), 전부 연결(k = N ≥ 2)만 「같다」(함수조항 동일 가드 · 항 단위 — `sameness.ts`)와 준용하기 옵션으로 공통 · 위임 · 공통항 분리 · 전체항 합침.
 *   조립 쪽(재료 모으기 · 제1절로 오르는 글 · 블록 조 처리 · 판정 기록)은 `firstSection.ts`.
 * - 위임 문구 「제N조(조 제목)는 제2절 보장조항에서 정합니다.」(ADR-0082 결정 8) — N 은 그 조 자신의 제1절 번호. 항 열쇠는 P · PZ 밖 예약 열쇠라
 *   위임된 조의 항을 가리키는 참조는 `articleGone`, 조 단위 참조는 유효하다(조립산출 §6.2 결정 메모).
 * - 블록 번호 머리는 `blockHeads.ts`(ADR-0090 결정 8) — 여기는 오류 좌표의 절 이름공간만.
 *
 * DB·React import 금지 (순수층).
 */
import { CONTRACT_KIND_PATH, isStandaloneContract } from "../master";
import { articleRefLabel } from "../document/numbering";
import type { Id } from "../types";
import type { JoinMode } from "../document/nodes";
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

// ───────────────────────────── 제1절 판정 ─────────────────────────────

/** 준용하기 옵션 — 없음(기본) · 공통항 모으기 · 전체항 모으기 (ADR-0082 결정 5). 템플릿 조 노드의 `joinMode`(없으면 none). */
export type JoinOption = "none" | JoinMode;

/** 판정 결과 6종 (ADR-0082 결정 5 표) — 마스터 · 특칙 · 공통 · 위임 · 공통항 분리 · 전체항 합침. */
export type VerdictKind = "master" | "special" | "common" | "delegate" | "commonSplit" | "joinAll";

/**
 * 판정 사유 — 블록 없음(N = 0, 복합 블록만) · 연결 없음(복합 블록만 연결) · 블록 하나 · 일부 연결 · 일부 연결 — 옵션 미적용 · 모두 같음 · 다름(공통 항 없음 · 있음).
 * 화면 사유 문구(기능/조립산출 §4 제1절 판정 패널)의 재료다.
 */
export type VerdictReason = "noBlock" | "unlinked" | "single" | "partial" | "partialOption" | "allSame" | "differentNoCommon" | "differentWithCommon";

/**
 * 블록 조 처리 (ADR-0082 결정 6) — 기재(자기 조 그대로) · 생략 · 분리(준용 문구 ① + 전용 항, `exclusive` = 남는 항 순번) · 통째(C1).
 */
export type BlockTreatment = { kind: "listed" } | { kind: "omitted" } | { kind: "split"; exclusive: number[] } | { kind: "whole" };

/**
 * 판정 단위 — 블록 조의 항(조 직속 자식) 하나. `sig` = 「같다」 서명(같은 함수조항 · 같은 옵션 · 같은 인자 — 자기 블록 조 참조는 대치한 값으로),
 * 없으면 일반 글 · 표 · 박스 등 — 늘 「다르다」(결정 4). `selfRefs` = 이 항이 가리키는 같은 조의 항 순번(C1 판정 재료).
 */
export interface JudgeUnit {
  sig?: string;
  selfRefs: number[];
}

/** 판정 재료 — 블록 하나(블록 순서). `articles` = 이 블록이 조연결한 템플릿 조 id → 그 블록 조(조건 해소 · 블록 빈 조 빼기 뒤)의 항 단위. */
export interface JudgeBlock {
  productCoverageId: Id;
  /** 복합 블록 — 판정 분모에서 빼고 경고(`compositeBlock`), 블록은 담보 문면 그대로 (결정 2). */
  composite?: boolean;
  articles: ReadonlyMap<Id, { articleId: Id; units: readonly JudgeUnit[] }>;
}

/** 템플릿 조 하나의 제1절 판정 결과 (ADR-0082 결정 11 판정 기록의 뼈대). */
export interface FirstSectionVerdict {
  kind: VerdictKind;
  /** 연결 수 k · 판정 분모 N(복합 블록 제외). */
  k: number;
  n: number;
  option: JoinOption;
  reason: VerdictReason;
  /** 조연결한 블록 · 안 한 블록(상품담보 id, 블록 순서 — 분모에 드는 블록만). */
  linkedBlocks: Id[];
  unlinkedBlocks: Id[];
  /** 블록별 처리 — 연결한 블록만. */
  blocks: Map<Id, BlockTreatment>;
  /** 제1절에 오르는 항(공통 · 공통항 분리 · 전체항 합침) — 블록 · 항 순번, 제1절 항 순서대로. */
  raised: { productCoverageId: Id; unit: number }[];
  /** 블록 항(`상품담보id#순번`) → 그 항과 같아 제1절에 오른 항의 `raised` 순번 — 블록에 남은 조가 오른 항을 가리킬 때의 별칭(C4). */
  raisedOf: Map<string, number>;
}

const unitKey = (productCoverageId: Id, unit: number) => `${productCoverageId}#${unit}`;

/**
 * 제1절 판정 (ADR-0082 결정 1 ~ 7) — 템플릿 조 id → 결과. 판정 대상 = 블록이 하나라도 조연결한 템플릿 조(복합 블록 포함 — 그 연결은 k 에 들지 않는다).
 * - N = 0(복합 블록만): 모두 마스터. N = 1: 판정 없이 위임(옵션 · 비교 없음).
 * - k = 0 마스터 · 0 < k < N 특칙(옵션과 무관) · k = N(N ≥ 2)만 「같다」 비교 → 옵션 표.
 * - 항 순서 = 블록 순서상 첫 블록의 항 순서, 전체항 합침의 새 항은 블록 순서대로 잇는다(조립산출 §3.9).
 */
export function judgeFirstSection(blocks: readonly JudgeBlock[], options: ReadonlyMap<Id, JoinOption>): Map<Id, FirstSectionVerdict> {
  const counted = blocks.filter((b) => !b.composite);
  const n = counted.length;
  const targets: Id[] = [];
  for (const b of blocks) for (const t of b.articles.keys()) if (!targets.includes(t)) targets.push(t);
  const out = new Map<Id, FirstSectionVerdict>();
  for (const t of targets) {
    const option = options.get(t) ?? "none";
    const linked = counted.filter((b) => b.articles.has(t));
    const base = {
      k: linked.length,
      n,
      option,
      linkedBlocks: linked.map((b) => b.productCoverageId),
      unlinkedBlocks: counted.filter((b) => !b.articles.has(t)).map((b) => b.productCoverageId),
      raised: [] as FirstSectionVerdict["raised"],
      raisedOf: new Map<string, number>(),
    };
    const each = (treatment: BlockTreatment) => new Map(linked.map((b) => [b.productCoverageId, treatment]));
    if (n === 0 || linked.length === 0) {
      out.set(t, { ...base, kind: "master", reason: n === 0 ? "noBlock" : "unlinked", blocks: new Map() });
      continue;
    }
    if (n === 1) {
      out.set(t, { ...base, kind: "delegate", reason: "single", blocks: each({ kind: "listed" }) });
      continue;
    }
    if (linked.length < n) {
      out.set(t, { ...base, kind: "special", reason: option === "none" ? "partial" : "partialOption", blocks: each({ kind: "listed" }) });
      continue;
    }
    out.set(t, compare(t, linked, base, option));
  }
  return out;
}

/** 전부 연결(k = N ≥ 2) — 「같다」 비교와 준용하기 옵션 표 (결정 4 · 5 · 6 · 9 C1). */
function compare(t: Id, linked: readonly JudgeBlock[], base: Omit<FirstSectionVerdict, "kind" | "reason" | "blocks">, option: JoinOption): FirstSectionVerdict {
  const unitsOf = (b: JudgeBlock) => b.articles.get(t)!.units;
  const [first, ...rest] = linked;
  const same = (a: JudgeUnit, b: JudgeUnit) => a.sig !== undefined && a.sig === b.sig;
  const allSame = rest.every((b) => unitsOf(b).length === unitsOf(first).length && unitsOf(b).every((u, i) => same(u, unitsOf(first)[i])));
  const omitAll = () => new Map(linked.map((b) => [b.productCoverageId, { kind: "omitted" } as BlockTreatment]));
  const raiseFrom = (picked: { productCoverageId: Id; unit: number }[]): Pick<FirstSectionVerdict, "raised" | "raisedOf"> => {
    const raisedOf = new Map<string, number>();
    const sigIndex = new Map<string, number>();
    picked.forEach((p, i) => {
      raisedOf.set(unitKey(p.productCoverageId, p.unit), i);
      const sig = unitsOf(linked.find((b) => b.productCoverageId === p.productCoverageId)!)[p.unit].sig;
      if (sig !== undefined && !sigIndex.has(sig)) sigIndex.set(sig, i);
    });
    // 같은 서명의 다른 블록 항도 그 오른 항을 가리킨다
    for (const b of linked) unitsOf(b).forEach((u, i) => {
      const at = u.sig !== undefined ? sigIndex.get(u.sig) : undefined;
      if (at !== undefined && !raisedOf.has(unitKey(b.productCoverageId, i))) raisedOf.set(unitKey(b.productCoverageId, i), at);
    });
    return { raised: picked, raisedOf };
  };

  if (allSame) {
    return { ...base, kind: "common", reason: "allSame", blocks: omitAll(), ...raiseFrom(unitsOf(first).map((_, unit) => ({ productCoverageId: first.productCoverageId, unit }))) };
  }
  // 공통 항 — 연결한 모든 블록 조에 같게(같은 서명) 들어 있는 항
  const common = new Set(unitsOf(first).flatMap((u) => (u.sig !== undefined && rest.every((b) => unitsOf(b).some((v) => v.sig === u.sig)) ? [u.sig] : [])));
  const reason: VerdictReason = common.size > 0 ? "differentWithCommon" : "differentNoCommon";
  const delegate = (): FirstSectionVerdict => ({ ...base, kind: "delegate", reason, blocks: new Map(linked.map((b) => [b.productCoverageId, { kind: "listed" } as BlockTreatment])) });

  if (option === "all") {
    const picked: { productCoverageId: Id; unit: number }[] = [];
    const seen = new Set<string>();
    for (const b of linked) unitsOf(b).forEach((u, unit) => {
      if (u.sig !== undefined && seen.has(u.sig)) return;
      if (u.sig !== undefined) seen.add(u.sig);
      picked.push({ productCoverageId: b.productCoverageId, unit });
    });
    return { ...base, kind: "joinAll", reason, blocks: omitAll(), ...raiseFrom(picked) };
  }
  if (option === "none" || common.size === 0) return delegate();

  // 공통항 분리
  const blocks = new Map<Id, BlockTreatment>();
  for (const b of linked) {
    const units = unitsOf(b);
    const isCommon = (u: JudgeUnit) => u.sig !== undefined && common.has(u.sig);
    const exclusive = units.flatMap((u, i) => (isCommon(u) ? [] : [i]));
    if (exclusive.length === 0) blocks.set(b.productCoverageId, { kind: "omitted" });
    else if (exclusive.some((i) => units[i].selfRefs.some((r) => units[r] !== undefined && isCommon(units[r])))) blocks.set(b.productCoverageId, { kind: "whole" });
    else blocks.set(b.productCoverageId, { kind: "split", exclusive });
  }
  const picked = unitsOf(first).flatMap((u, unit) => (u.sig !== undefined && common.has(u.sig) ? [{ productCoverageId: first.productCoverageId, unit }] : []));
  return { ...base, kind: "commonSplit", reason, blocks, ...raiseFrom(picked) };
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

/** 오류 좌표의 절 이름공간 (기능/조립산출 §3.4) — 「제1절」 · 「제2절 {블록 머리}」. */
export const FIRST_SECTION_COORDINATE = { kind: "general", label: "제1절" } as const;
/** 블록 머리가 없으면(그룹 제목 표시 켬 · 제목 없는 자리의 블록) 「제2절」만. */
export function blockCoordinate(head: string | undefined): { kind: "benefit"; label: string } {
  return { kind: "benefit", label: head === undefined ? "제2절" : `제2절 ${head}` };
}
