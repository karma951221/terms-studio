/**
 * 약관 에디터 툴바 — 넣기 · 조작의 입구 (기능/문면 §4.3, 2026-09-27). 순수 — React 없음 (`tools.test.ts`).
 *
 * 버튼은 늘 같은 자리에 서 있고, 켜짐 · 꺼짐만 자리(`Place`)를 따른다. 버튼이 하는 일은 그 자리의 조작 목록
 * (`placeMenu` — 오른쪽 클릭 메뉴와 같은 목록)에서 이름이 맞는 항목을 찾아 그대로 돌리는 것이다 — 규칙은 목록이 들고 있다.
 * 목록의 모든 항목은 버튼 하나에 대응한다(`toolFor` — 테스트가 지킨다).
 *
 * 「조건식」은 하나의 버튼이 자리대로 넣는다 — 팝업 없이 곧바로 선다(2026-09-28). 문장에서 글을 골랐으면 그 글을 문장 안 조건으로,
 * 아니면 지금 블록(항 · 조 제목 · 관 …)을 조건 블록으로 감싸고, 고른 블록이 없는 자리(조 본문 · 공용조항 본문)면 빈 항을 든 새 조건 블록.
 * 어느 쪽이든 빈 IF 줄 하나가 서고 첫 칸에 초점이 간다 — 식은 그 머리 줄에서 고른다. 감쌀 블록도 넣을 자리도 없으면(「문구」 공용조항 ·
 * 문장 안 조건 가지) 커서 자리에 문장 안 조건.
 */
import type { MenuItem, MenuSections } from "./menus";

export type ToolId =
  | "article"
  | "section"
  | "paragraph"
  | "item"
  | "subitem"
  | "table"
  | "box"
  | "clauseBlock"
  | "slot"
  | "articleRef"
  | "appendixRef"
  | "clauseInline"
  | "structKey"
  | "optionSlot"
  | "cond"
  | "elif"
  | "else"
  | "unwrap"
  | "removeBranch"
  | "edit"
  | "tableProps"
  | "repeat"
  | "link"
  | "up"
  | "down"
  | "duplicate"
  | "remove";

export interface Tool {
  id: ToolId;
  /** 버튼 글자 — 짧게. */
  label: string;
  /** tooltip · 접근성 이름의 설명. */
  title: string;
  /** 이 버튼이 맡는 목록 항목 이름. */
  match: (label: string) => boolean;
  /** 맞는 항목이 여럿이면 버튼 아래 작은 메뉴로 고른다 (옵션 자리 — 옵션마다 한 줄). */
  multi?: boolean;
}

export interface ToolGroup {
  name: string;
  tools: Tool[];
}

const oneOf =
  (...labels: string[]) =>
  (label: string) =>
    labels.includes(label);

const COND_INSERT = oneOf("조건으로 감싸기", "조건 블록 넣기", "문장 안 조건");

/** 문면 저작 툴바 — 묶음 순서가 곧 화면 순서. */
export const DOC_TOOLS: ToolGroup[] = [
  {
    name: "구조 넣기",
    tools: [
      { id: "article", label: "조", title: "조 추가 — 지금 조 아래(관 머리면 그 관 끝)", match: oneOf("아래에 조 추가", "이 관에 조 추가", "조 추가", "이 가지에 조 추가") },
      { id: "section", label: "관", title: "관 추가 — 지금 조 · 관 아래", match: oneOf("아래에 관 추가", "관 추가") },
      { id: "paragraph", label: "항", title: "항 추가 — 지금 항 아래(조 제목이면 그 조 끝)", match: oneOf("아래에 항 추가", "항 추가", "이 가지에 항 추가") },
      { id: "item", label: "호", title: "호 추가 — 지금 호 아래(항이면 그 항 안)", match: oneOf("아래에 호 추가", "호 추가", "이 가지에 호 추가") },
      { id: "subitem", label: "목", title: "목 추가 — 지금 목 아래(호면 그 호 안)", match: oneOf("아래에 목 추가", "목 추가", "이 가지에 목 추가") },
      { id: "table", label: "표", title: "표 추가 — 지금 블록 아래", match: oneOf("아래에 표 추가…", "이 가지에 표 추가…") },
      { id: "box", label: "박스", title: "박스 추가 — 지금 블록 아래", match: oneOf("아래에 박스 추가") },
      { id: "clauseBlock", label: "공용조항", title: "공용조항(조 단위) 추가 — 지금 항 아래", match: oneOf("아래에 공용조항(조 단위) 추가…", "아래에 공용조항 참조 추가…", "공용조항 참조 추가…") },
    ],
  },
  {
    name: "문장에 넣기",
    tools: [
      { id: "slot", label: "슬롯", title: "치환 슬롯 — 커서 자리에", match: oneOf("치환 슬롯…") },
      { id: "articleRef", label: "조 참조", title: "조 참조 — 커서 자리에", match: oneOf("조 참조…") },
      { id: "appendixRef", label: "별표 참조", title: "별표 참조 — 커서 자리에", match: oneOf("별표 참조…") },
      { id: "clauseInline", label: "공용조항(문장)", title: "공용조항(문장 안) — 커서 자리에", match: oneOf("공용조항(문장 안)…") },
      { id: "structKey", label: "구조 표기", title: "구조 표기 — 반복 표 템플릿 셀의 커서 자리에", match: oneOf("구조 표기…") },
      { id: "optionSlot", label: "옵션 자리", title: "옵션 자리 — 커서 자리에 옵션 하나의 자리", match: (l) => l.startsWith("옵션 자리 — "), multi: true },
    ],
  },
  {
    name: "조건",
    tools: [
      { id: "cond", label: "조건식", title: "조건식 블록 넣기 — 지금 블록을 감싸거나(없으면 새 블록) 빈 IF 줄이 선다. 글을 골랐으면 문장 안 조건", match: COND_INSERT },
      { id: "elif", label: "가지 추가", title: "가지 추가(ELIF) — 고른 조건 블록에", match: oneOf("가지 추가(ELIF)") },
      { id: "else", label: "ELSE", title: "ELSE 가지 추가 — 고른 조건 블록에", match: oneOf("ELSE 가지 추가") },
      { id: "unwrap", label: "조건 풀기", title: "조건 풀기 — 고른 가지(문장 안 조건은 첫 가지) 내용만 남긴다", match: (l) => l.startsWith("조건 풀기") },
      { id: "removeBranch", label: "가지 삭제", title: "이 가지 삭제 — 가지가 하나면 잠긴다", match: oneOf("이 가지 삭제") },
    ],
  },
  {
    name: "속성",
    tools: [
      { id: "edit", label: "고치기", title: "고치기 — 고른 칩 · 공용조항 참조의 속성", match: oneOf("고치기…", "옵션 고치기…") },
      { id: "tableProps", label: "표 속성", title: "표 속성 — 고른 표", match: oneOf("표 속성…") },
      { id: "repeat", label: "행 반복", title: "행 반복 — 고른 표(담보약관)", match: oneOf("행 반복…") },
      { id: "link", label: "조연결", title: "조연결 — 고른 조(담보약관)", match: oneOf("조연결…") },
    ],
  },
  {
    name: "배치",
    tools: [
      { id: "up", label: "위로", title: "위로 — 같은 부모 안에서 한 칸", match: oneOf("위로") },
      { id: "down", label: "아래로", title: "아래로 — 같은 부모 안에서 한 칸", match: oneOf("아래로") },
      { id: "duplicate", label: "복제", title: "복제 — 바로 뒤에 사본", match: oneOf("복제") },
      { id: "remove", label: "삭제", title: "삭제 — 고른 자리(조건 머리면 조건 블록)", match: oneOf("삭제", "조건 블록 삭제") },
    ],
  },
];

/** 공용조항 본문에 없는 도구 — 공용조항 툴바에서 빠진다 (기능/공용조항 §4.3). 조 · 관 · 공용조항은 남고 잠긴다(사유 tooltip). */
const CLAUSE_HIDDEN = new Set<ToolId>(["table", "box", "structKey", "tableProps", "repeat", "link"]);

export const CLAUSE_TOOLS: ToolGroup[] = DOC_TOOLS.map((g) => ({ ...g, tools: g.tools.filter((t) => !CLAUSE_HIDDEN.has(t.id)) })).filter((g) => g.tools.length > 0);

/** 「문구」 공용조항 — 문장 한 줄뿐이라 구조 넣기 묶음이 없다. */
export const CLAUSE_LINE_TOOLS: ToolGroup[] = CLAUSE_TOOLS.filter((g) => g.name !== "구조 넣기");

/** 문면 툴바에는 옵션 자리가 없다(공용조항만). */
export const DOCUMENT_TOOLS: ToolGroup[] = DOC_TOOLS.map((g) => ({ ...g, tools: g.tools.filter((t) => t.id !== "optionSlot") }));

export function allTools(groups: readonly ToolGroup[]): Tool[] {
  return groups.flatMap((g) => g.tools);
}

/** 목록 항목 하나를 맡는 버튼 — 없으면 undefined (테스트: 모든 항목에 버튼이 있다). */
export function toolFor(groups: readonly ToolGroup[], label: string): Tool | undefined {
  return allTools(groups).find((t) => t.match(label));
}

/** 그 자리 목록에서 이 버튼이 맡는 항목들 — 목록 순서대로. */
export function itemsFor(tool: Tool, sections: MenuSections): MenuItem[] {
  return sections.flat().filter((item) => tool.match(item.label));
}

/**
 * 「조건식」이 넣을 항목 — 글을 골랐으면(`selected`) 문장 안 조건, 아니면 감싸기, 감쌀 블록이 없으면 새 조건 블록, 그것도 없으면 문장 안 조건.
 */
export function condItem(sections: MenuSections, selected: boolean): MenuItem | undefined {
  const items = sections.flat().filter((i) => !i.refusal);
  const inline = items.find((i) => i.label === "문장 안 조건");
  const wrap = items.find((i) => i.label === "조건으로 감싸기");
  const block = items.find((i) => i.label === "조건 블록 넣기");
  if (selected && inline) return inline;
  return wrap ?? block ?? inline;
}

export interface ToolState {
  tool: Tool;
  /** 누르면 돌릴 항목(여럿이면 메뉴) — 없으면 잠김. */
  items: MenuItem[];
  disabled: boolean;
  /** tooltip — 막힌 도구면 그 사유. */
  title: string;
}

/** 버튼 하나의 켜짐 — 맞는 항목이 있고 잠기지 않았으면 켜진다. 막힌 도구(`refusal`)는 잠그고 사유를 보인다. */
export function toolState(tool: Tool, sections: MenuSections): ToolState {
  const items = tool.id === "cond" ? [condItem(sections, false)].filter((i): i is MenuItem => i !== undefined) : itemsFor(tool, sections);
  const refused = items.find((i) => i.refusal);
  const usable = items.filter((i) => !i.disabled && !i.refusal);
  if (refused && usable.length === 0) return { tool, items: [], disabled: true, title: `${tool.label} 잠김 — ${refused.refusal}` };
  return { tool, items: usable, disabled: usable.length === 0, title: tool.title };
}
