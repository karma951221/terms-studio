/**
 * 실물 재현 화면 E2E 가 **따라 칠** 데이터 — 시드 JSON 정본(`src/db/seed/data/*.json`)을 그대로 읽는다.
 * 모델명세(docs/QA/실물재현/알파플러스_모델명세.md)가 「JSON 이 정본」이라 한 것을 E2E 도 따른다 — 명세를 손으로 옮기면 두 벌이 갈린다.
 *
 * 여기에는 규칙이 없다. 화면 조작은 `driver.ts`, 원문 대조는 `compare.ts`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { numberTree, referenceOutline, referenceTargetIndex, type DocumentNode, type InlineNode, type Node } from "../../../../src/domain/document";

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
export interface ClauseSpec {
  code: string;
  label: string;
  mode: "inline" | "block";
  body: (Node | InlineNode | { id: string; kind: "optionSlot"; optionCode: string })[];
  options: { code: string; label: string; values: { code: string; label: string; body: { kind: string; text?: string }[] }[] }[];
}
export interface DocumentSpec {
  code: string;
  ownerCoverage: string;
  general: string;
  tree: DocumentNode;
}
export interface ProductSpec {
  name: string;
  namingTemplate: string;
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
  clauses: read<ClauseSpec[]>("clauses.json"),
  documents: read<DocumentSpec[]>("documents.json"),
  generals: read<{ code: string; tree: DocumentNode }[]>("generals.json"),
  products: read<ProductSpec[]>("products.json"),
};

/** 조 참조 고르기 트리의 줄 표기 경로 — 대상 id → [「제1조(…)」, 「제1항」, 「제2호」]. 화면(`RefTargetTree`)과 같은 도메인 함수로 짓는다. */
export function outlinePaths(tree: DocumentNode): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const walk = (rows: ReturnType<typeof referenceOutline>[number]["rows"], prefix: string[]) => {
    for (const row of rows) {
      const p = [...prefix, row.label];
      out.set(row.id, p);
      walk(row.children, p);
    }
  };
  for (const group of referenceOutline(referenceTargetIndex(tree, numberTree(tree)))) walk(group.rows, []);
  return out;
}

/** 보통약관 참조 대상의 조상 id (펴야 할 줄) — 보통약관은 시드가 id 를 그대로 넣어 화면 줄 id 와 같다. */
export function generalAncestors(tree: DocumentNode): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [id, t] of referenceTargetIndex(tree, numberTree(tree))) {
    const chain: string[] = [];
    if (t.kind !== "article") chain.push(t.article.id);
    if ((t.kind === "item" || t.kind === "subitem") && t.paragraph) chain.push(t.paragraph.id);
    if (t.kind === "subitem" && t.item) chain.push(t.item.id);
    out.set(id, chain);
  }
  return out;
}

export const GENERAL_TREE = SEED.generals[0].tree;
export const GENERAL_TITLE = GENERAL_TREE.title;
