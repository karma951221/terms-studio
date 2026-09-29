/**
 * 실물 재현 화면 E2E 가 **따라 칠** 데이터 — 시드 JSON 정본(`src/db/seed/data/*.json`)을 그대로 읽는다.
 * 모델명세(docs/QA/실물재현/알파플러스_모델명세.md)가 「JSON 이 정본」이라 한 것을 E2E 도 따른다 — 명세를 손으로 옮기면 두 벌이 갈린다.
 *
 * 여기에는 규칙이 없다. 화면 조작은 `driver.ts`, 원문 대조는 `compare.ts`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { numberTree, referenceOutline, referenceTargetIndex, refKey, refTargetOf, type DocumentNode, type InlineNode, type Node } from "../../../../src/domain/document";

const DATA = path.join(process.cwd(), "src/db/seed/data");
const read = <T>(file: string): T => JSON.parse(readFileSync(path.join(DATA, file), "utf8")) as T;

export interface EnumSpec {
  code: string;
  label: string;
  values: { code: string; label: string }[];
}
export interface DiscriminatorSpec {
  code: string;
  label: string;
  level: string;
  expression: string;
}
export interface AttributeSpec {
  code: string;
  label: string;
  values: { code: string; label: string; fragment: string }[];
}
export interface CoverageSpec {
  key: string;
  code: string;
  name: string;
  benefitName: string;
  subCoverages?: { name: string; benefitName: string }[];
  coverageValues: { path: string; value: string }[];
}
/** 정적 마스터 박스 — 코드 · 이름 · 제목 · 줄 (기능/박스 §3.1). */
export interface BoxSpec {
  code: string;
  name: string;
  title: string;
  lines: string[];
}
export interface ClauseSpec {
  code: string;
  label: string;
  mode: "inline" | "block";
  body: (Node | InlineNode | { id: string; kind: "optionSlot"; optionCode: string })[];
  options: { code: string; label: string; values: { code: string; label: string; body: { kind: string; text?: string }[] }[] }[];
  /** 인자 — 구분자 직접 읽기를 기계 변환한 것(최종 결정 2). */
  params?: { name: string; type: { kind: string; enumCode?: string; form?: string }; default?: { kind: "discriminator"; code: string } }[];
}
export interface DocumentSpec {
  code: string;
  ownerCoverage: string;
  general: string;
  tree: DocumentNode;
}
export interface ProductSpec {
  code: string;
  name: string;
  general: string;
  namingTemplate: string;
  /** 상품 레벨 값 — 상품정보(공시이율 · 상품특성, 2026-09-28). */
  values: { path: string; value: unknown }[];
  planOptions: { code: string; axis: "type" | "form"; number: number; name: string; planTypeCode: string; values: { path: string; value: unknown }[] }[];
  plans: string[][];
  groups: { code: string; title: string }[];
  mounts: { code: string; coverage: string; section: "base" | "special"; attributes: { kindCode: string; valueCode: string }[]; group?: string }[];
}

export const SEED = {
  enums: read<EnumSpec[]>("enums.json"),
  discriminators: read<DiscriminatorSpec[]>("discriminators.json"),
  attributes: read<AttributeSpec[]>("attributes.json"),
  coverages: read<CoverageSpec[]>("coverages.json"),
  boxes: read<BoxSpec[]>("boxes.json"),
  clauses: read<ClauseSpec[]>("clauses.json"),
  documents: read<DocumentSpec[]>("documents.json"),
  generals: read<{ code: string; tree: DocumentNode }[]>("generals.json"),
  products: read<ProductSpec[]>("products.json"),
};

/**
 * 조 참조 고르기 트리의 줄 표기 경로 — 대상 열쇠(`refKey` — 조 id · 조#P코드) → [「제1조(…)」, 「제1항」, 「제2호」].
 * 화면(`RefTargetTree`)과 같은 도메인 함수로 짓는다. 같은 코드의 분기 짝은 첫 줄.
 */
export function outlinePaths(tree: DocumentNode): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const walk = (rows: ReturnType<typeof referenceOutline>[number]["rows"], prefix: string[]) => {
    for (const row of rows) {
      const p = [...prefix, row.label];
      const key = refKey(refTargetOf(row.target));
      if (!out.has(key)) out.set(key, p);
      walk(row.children, p);
    }
  };
  for (const group of referenceOutline(referenceTargetIndex(tree, numberTree(tree)))) walk(group.rows, []);
  return out;
}

/** 보통약관 참조 대상 → 고를 줄 id · 펴야 할 조상 줄 id. */
export interface GeneralRow {
  row: string;
  chain: string[];
}

/** 보통약관 참조 대상 열쇠(`refKey`) → 줄 · 조상 줄 — 보통약관은 시드가 id 를 그대로 넣어 화면 줄 id 와 같다. 같은 코드의 분기 짝은 첫 줄. */
export function generalAncestors(tree: DocumentNode): Map<string, GeneralRow> {
  const out = new Map<string, GeneralRow>();
  for (const [id, t] of referenceTargetIndex(tree, numberTree(tree))) {
    const chain: string[] = [];
    if (t.kind !== "article") chain.push(t.article.id);
    if ((t.kind === "item" || t.kind === "subitem") && t.paragraph) chain.push(t.paragraph.id);
    if (t.kind === "subitem" && t.item) chain.push(t.item.id);
    const key = refKey(refTargetOf(t));
    if (!out.has(key)) out.set(key, { row: id, chain });
  }
  return out;
}

/** 보통약관 시드 코드 → 트리 (알파Plus · 메리츠 두 벌 — 바탕 DB 에 시드로 들어 있다). */
export const GENERALS = new Map(SEED.generals.map((g) => [g.code, g.tree]));

export function generalTreeOf(code: string): DocumentNode {
  const tree = GENERALS.get(code);
  if (!tree) throw new Error(`보통약관 ${code} 없음`);
  return tree;
}

/** 보통약관 두 벌의 참조 대상 줄 — 조 id 가 벌마다 다르다(`g-…` · `m-…`) — 공용조항 조 참조는 보통약관 전부가 후보다. */
export const ALL_GENERAL_ANCESTORS = new Map(SEED.generals.flatMap((g) => [...generalAncestors(g.tree)]));

/**
 * 보통약관이 쓰는 공용조항 — 바탕 DB(`SEED_PROFILE=base`)가 보통약관과 함께 시드로 넣는다(C0001~, 보통약관 가져오기 전에 있어야 한다).
 * 화면 E2E 는 이것들을 치지 않는다.
 */
export const BASE_CLAUSE_CODES = new Set(SEED.generals.flatMap((g) => [...JSON.stringify(g.tree).matchAll(/"clauseCode":"(C\d+)"/g)].map((m) => m[1])));

/** 보통약관이 놓는 박스 — 바탕 DB 가 보통약관과 함께 시드로 넣는다(BX000001~). 화면 E2E 는 그 뒤 코드부터 박스 화면으로 친다. */
export const BASE_BOX_CODES = new Set(SEED.generals.flatMap((g) => [...JSON.stringify(g.tree).matchAll(/"boxCode":"(BX\d+)"/g)].map((m) => m[1])));

/** 상품마다 원문 대조 짝 — 픽스처 폴더 · 특약(책자 제목 → 픽스처) · 미리보기 별표 수와 1번 (real.test.ts 와 같은 짝). */
export const REAL_FIXTURES: Record<string, { dir: string; appendices: number; firstAppendix: string; specials: [string, string][] }> = {
  "alpha-plus": {
    dir: "",
    appendices: 14,
    firstAppendix: "장해분류표",
    specials: [
      ["일반상해사망보장 특별약관", "일반상해사망보장.md"],
      ["일반상해사망보장 추가 특별약관", "일반상해사망보장_추가.md"],
      ["일반상해80%이상후유장해 생활자금보장 특별약관", "일반상해80%이상후유장해_생활자금보장.md"],
      ["골절(치아파절 제외)진단비Ⅱ보장 특별약관", "골절(치아파절_제외)진단비Ⅱ보장.md"],
      ["일반상해50%이상후유장해 생활자금보장 특별약관", "일반상해50%이상후유장해_생활자금보장.md"],
      ["골절수술비Ⅱ보장 특별약관", "골절수술비Ⅱ보장.md"],
      ["중대한특정상해수술비보장 특별약관", "중대한특정상해수술비보장.md"],
      ["수술비(1-7종, 연간3회한)[상해]보장 특별약관", "수술비(1-7종,_연간3회한)[상해]보장.md"],
      ["갱신형 수술비(1-7종, 연간3회한)[상해]보장 특별약관", "갱신형_수술비(1-7종,_연간3회한)[상해]보장.md"],
      ["신화상치료비보장 특별약관", "신화상치료비보장.md"],
    ],
  },
  meritz: {
    dir: "메리츠",
    appendices: 9,
    firstAppendix: "장해분류표",
    specials: [
      ["갱신형 일반상해80%이상후유장해(통합간편가입)보장 특별약관", "갱신형_일반상해80%이상후유장해(통합간편가입)보장.md"],
      ["갱신형 수술비(1-7종, 연간3회한)[상해](통합간편가입)보장 특별약관", "갱신형_수술비(1-7종,_연간3회한)[상해](통합간편가입)보장.md"],
      ["갱신형 골절(치아파절 제외)진단비Ⅱ(통합간편가입)보장 특별약관", "갱신형_골절(치아파절_제외)진단비Ⅱ(통합간편가입)보장.md"],
      ["갱신형 신화상치료비(통합간편가입)보장 특별약관", "갱신형_신화상치료비(통합간편가입)보장.md"],
      ["갱신형 골절수술비Ⅱ(통합간편가입)보장 특별약관", "갱신형_골절수술비Ⅱ(통합간편가입)보장.md"],
      ["갱신형 질병사망(통합간편가입)보장 특별약관", "갱신형_질병사망(통합간편가입)보장.md"],
      ["갱신형 질병80%이상후유장해(통합간편가입)보장 특별약관", "갱신형_질병80%이상후유장해(통합간편가입)보장.md"],
      ["갱신형 수술비(1-7종, 연간3회한)[질병](통합간편가입)보장 특별약관", "갱신형_수술비(1-7종,_연간3회한)[질병](통합간편가입)보장.md"],
    ],
  },
};
