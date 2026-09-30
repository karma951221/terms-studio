/**
 * 약관 에디터 툴바 — 넣기 · 조작의 입구 (기능/문면 §4.3, 2026-09-27 · 2026-10-01 정리). 순수 — React 없음 (`tools.test.ts`).
 *
 * 버튼이 하는 일은 그 자리의 조작 목록(`placeMenu` — 오른쪽 클릭 메뉴와 같은 목록)에서 이름이 맞는 항목을 찾아 그대로 돌리는 것이다 —
 * 규칙은 목록이 들고 있다. 목록의 모든 항목은 도구 하나에 대응한다(`toolFor` — 테스트가 지킨다). 도구가 **어디에 서는지**는 `at`:
 *
 * - `bar`(기본) — 툴바에 늘 선다. 켜짐 · 꺼짐만 자리를 따른다(구조 넣기 · 문장에 넣기 · 조건 넣기).
 * - `context` — 그 자리에서 켜질 때만 툴바에 선다(조건 편집 · 고른 것 속성 · 행 이름). 꺼진 버튼이 줄줄이 서지 않게 (2026-10-01).
 * - `more` — 툴바 끝 「더보기(⋯)」 안(관 · 문장 안 함수조항 — 드물게 쓴다).
 * - `block` — 툴바에 없다. 고른 블록 오른쪽 위의 작은 아이콘(복제 · 삭제, `DocBody` `BlockActs`) — 같은 명령 길(`runTool`)을 쓴다.
 * - `menu` — 툴바에 없다. 오른쪽 클릭 메뉴만(위로 · 아래로 — 블록은 손잡이로 끌어 옮긴다).
 *
 * 「조건식」은 **블록 조건**을 넣는다 — 팝업 없이 곧바로 선다(2026-09-28, 무엇을 넣을지 묻지 않는다). 글을 골랐으면(드래그) 그 선택이 걸친
 * 블록을 다 덮는 가장 작은 잇닿은 형제 블록들을 감싸고, 고른 글이 없으면 커서가 선 블록 바로 뒤에 빈 조건 블록 (`menus.condInsertItem`).
 * 어느 쪽이든 빈 IF 줄 하나가 서고 첫 칸에 초점이 간다 — 식은 그 머리 줄에서 고른다. 조건 블록을 둘 자리가 없으면(「문구」 함수조항)
 * 문장 안 조건. 문장 안 조건은 따로 「문장 안 조건」 버튼이 넣는다.
 *
 * 자리 남김(2026-10-01): 작업용 「글자색」 버튼 · 「수정 흔적 보기」 토글은 별도 과제 — 들어오면 `서식` 묶음(bar)과 툴바 끝(자리 글 앞)의 토글로 선다.
 */
import type { MenuItem, MenuSections } from "./menus";

export type ToolId =
  | "article"
  | "section"
  | "paragraph"
  | "item"
  | "subitem"
  | "table"
  | "bulletList"
  | "clauseBlock"
  | "box"
  | "forBlock"
  | "slot"
  | "articleRef"
  | "appendixRef"
  | "clauseInline"
  | "structKey"
  | "optionSlot"
  | "cond"
  | "inlineCond"
  | "switch"
  | "switchCase"
  | "inlineSwitch"
  | "elif"
  | "else"
  | "unwrap"
  | "removeBranch"
  | "edit"
  | "repeat"
  | "link"
  | "up"
  | "down"
  | "duplicate"
  | "remove";

/** 툴바 아이콘 이름 — 그림은 `EditorToolbar` 가 `icons.tsx` 에서 고른다(여기는 순수). */
export type ToolIcon = "table" | "bulletList" | "clauseBlock" | "box" | "repeat" | "slot" | "link" | "attach" | "branch";

/** 도구가 서는 곳 — 위 머리말. */
export type ToolAt = "bar" | "context" | "more" | "block" | "menu";

export interface Tool {
  id: ToolId;
  /** 버튼 이름 — 짧고 무엇을 하는지 바로 읽히게. 아이콘 버튼이면 접근성 이름(글자는 그리지 않는다). */
  label: string;
  /** tooltip — 무엇을 · 어디에 하는지. */
  title: string;
  /** 이 버튼이 맡는 목록 항목 이름(오른쪽 클릭 메뉴 이름 그대로). */
  match: (label: string) => boolean;
  /** 맞는 항목이 여럿이면 버튼 아래 작은 메뉴로 고른다 (옵션 자리 — 옵션마다 한 줄). */
  multi?: boolean;
  /** 있으면 아이콘을 그린다(tooltip 의무, 디자인원칙 §1.6). 없으면 글자 버튼. */
  icon?: ToolIcon;
  /**
   * 아이콘 옆 짧은 글자 — 이 시스템에만 있는 도구(참조 · 슬롯 · 함수조항 · 박스 · 반복 · 문장 안 조건)는 그림만으로 뜻이 서지 않아 글자를 붙인다.
   * 없으면 아이콘만 — 누구나 아는 모양(표 · 글머리 목록 · 더보기)만 (2026-10-01 유저 피드백).
   */
  short?: string;
  /** 서는 곳 — 기본 `bar`. */
  at?: ToolAt;
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
      { id: "article", label: "조", title: "조 넣기 — 지금 조 아래(관 머리면 그 관 끝)", match: oneOf("아래에 조 추가", "이 관에 조 추가", "조 추가", "이 가지에 조 추가") },
      { id: "section", label: "관", title: "관 넣기 — 지금 조 · 관 아래에 새 관", match: oneOf("아래에 관 추가", "관 추가"), at: "more" },
      { id: "paragraph", label: "항", title: "항 넣기 — 지금 항 아래(조 제목이면 그 조 끝)", match: oneOf("아래에 항 추가", "항 추가", "이 가지에 항 추가", "이 반복에 항 추가") },
      { id: "item", label: "호", title: "호 넣기 — 지금 호 아래(항이면 그 항 안)", match: oneOf("아래에 호 추가", "호 추가", "이 가지에 호 추가", "이 반복에 호 추가") },
      { id: "subitem", label: "목", title: "목 넣기 — 지금 목 아래(호면 그 호 안)", match: oneOf("아래에 목 추가", "목 추가", "이 가지에 목 추가") },
      { id: "table", label: "표", icon: "table", title: "표 넣기 — 지금 블록 아래", match: oneOf("아래에 표 추가…", "이 가지에 표 추가…") },
      {
        id: "bulletList",
        label: "글머리 목록",
        icon: "bulletList",
        title: "글머리 목록 넣기 — 지금 블록 아래(조 제목이면 그 조 끝)에 번호 없는 「-」 목록, 목록 안이면 아래에 항목",
        match: oneOf("아래에 글머리 목록 추가", "글머리 목록 추가", "이 가지에 글머리 목록 추가", "아래에 항목 추가", "이 가지에 항목 추가"),
      },
      {
        id: "clauseBlock",
        label: "함수조항",
        icon: "clauseBlock",
        short: "함수조항",
        title: "함수조항 넣기 — 목록에서 골라 지금 자리 아래에 그 자리 유형(항 · 호 · 목)으로(조 제목이면 그 조 끝)",
        match: oneOf("아래에 함수조항(조 단위) 추가…", "아래에 함수조항(호) 추가…", "아래에 함수조항(목) 추가…", "함수조항(호) 추가…", "함수조항(목) 추가…", "아래에 함수조항 참조 추가…", "함수조항 참조 추가…", "이 반복에 함수조항(조 단위) 추가…", "이 반복에 함수조항(호) 추가…"),
      },
      { id: "box", label: "박스", icon: "box", short: "박스", title: "박스 넣기 — 정적 마스터 박스를 골라 지금 블록 아래(조 제목이면 그 조 끝)에", match: oneOf("아래에 박스 추가…", "박스 추가…", "이 가지에 박스 추가…") },
      {
        id: "forBlock",
        label: "반복",
        icon: "repeat",
        short: "반복",
        title: "반복 블록 넣기 — 무엇마다 되풀이할지(납입면제종마다 · 현재 종의 사유마다 · 합집합) 골라 지금 블록 아래(조 제목이면 그 조 끝, 항이면 그 항의 호 목록)에. 반복 안 반복은 한 단계까지",
        match: oneOf("아래에 반복 블록 추가…", "반복 블록 추가…", "반복 블록(호) 추가…", "이 반복에 반복 블록 추가…"),
        multi: true,
      },
    ],
  },
  {
    name: "문장에 넣기",
    tools: [
      { id: "slot", label: "슬롯", icon: "slot", short: "슬롯", title: "슬롯 넣기 — 커서 자리에 구분자 값이 찍힐 자리", match: oneOf("치환 슬롯…") },
      { id: "articleRef", label: "조 참조", icon: "link", short: "참조", title: "조 참조 넣기 — 커서 자리에 다른 조 · 항 · 호 번호", match: oneOf("조 참조…") },
      { id: "appendixRef", label: "별표 참조", icon: "attach", short: "별표", title: "별표 참조 넣기 — 커서 자리에 <별표> 번호", match: oneOf("별표 참조…") },
      { id: "clauseInline", label: "문장 안 함수조항", title: "문장 안 함수조항 넣기 — 커서 자리에 「문구」 함수조항", match: oneOf("함수조항(문장 안)…"), at: "more" },
      { id: "structKey", label: "행 이름", title: "행 이름 넣기 — 반복 표 템플릿 셀의 커서 자리에, 행마다 그 행의 이름이 찍힌다", match: oneOf("구조 표기…"), at: "context" },
      { id: "optionSlot", label: "옵션 자리", title: "옵션 자리 넣기 — 커서 자리에 옵션 하나의 자리", match: (l) => l.startsWith("옵션 자리 — "), multi: true },
    ],
  },
  {
    name: "조건 넣기",
    tools: [
      { id: "cond", label: "조건식", title: "조건 블록 넣기 — 글을 골랐으면 그 글이 걸친 블록을 감싸고, 아니면 커서 자리 뒤에 빈 조건 블록", match: COND_INSERT },
      { id: "inlineCond", label: "문장 안 조건", icon: "branch", short: "문장 조건", title: "문장 안 조건 넣기 — 커서 자리에(고른 글이 있으면 그 글을 IF 가지 문장으로)", match: oneOf("문장 안 조건") },
      // 값별 분기(최종 결정 5) — 지금은 함수조항 편집기만(문면 툴바에서 빠진다)
      { id: "switch", label: "값별 분기", title: "값별 분기 넣기 — 목록값 인자 · 내부 변수의 값마다 칸(모든 값이 한 칸 · 「문구 없음」은 칸에서 켠다). 지금 블록 뒤, 본문 빈 자리면 끝에", match: oneOf("값별 분기 넣기") },
      { id: "inlineSwitch", label: "문장 안 값별 분기", title: "문장 안 값별 분기 넣기 — 커서 자리에 값마다 칸을 둔 칩(칸 문구는 그 팝업에서)", match: oneOf("문장 안 값별 분기") },
    ],
  },
  {
    // 조건 머리 · 칸 머리를 고른 때만 선다 — 같은 조작이 머리 줄 끝의 작은 버튼에도 있다
    name: "조건 편집",
    tools: [
      { id: "elif", label: "다른 조건 추가", title: "다른 조건 추가(ELIF) — 고른 조건 블록에, 위 조건이 아닐 때 볼 가지", match: oneOf("가지 추가(ELIF)"), at: "context" },
      { id: "else", label: "그 밖의 경우 추가", title: "그 밖의 경우 추가(ELSE) — 고른 조건 블록에, 어느 조건에도 맞지 않을 때의 가지", match: oneOf("ELSE 가지 추가"), at: "context" },
      { id: "unwrap", label: "조건 없애기", title: "조건 없애기 — 조건을 지우고 고른 가지(문장 안 조건은 첫 가지) 내용만 남긴다", match: (l) => l.startsWith("조건 풀기"), at: "context" },
      { id: "removeBranch", label: "이 가지 삭제", title: "이 가지(값별 분기면 이 칸) 삭제 — 하나면 잠긴다", match: oneOf("이 가지 삭제", "이 칸 삭제"), at: "context" },
      { id: "switchCase", label: "칸 추가", title: "칸 추가 — 고른 값별 분기에 칸 없는 값 첫째를 든 칸", match: oneOf("칸 추가"), at: "context" },
    ],
  },
  {
    // 고른 것(칩 · 함수조항 참조 · 표 · 반복 블록 · 조)에 속성이 있을 때만 선다
    name: "고른 것 속성",
    tools: [
      { id: "edit", label: "속성", title: "속성 — 고른 칩 · 함수조항 참조(옵션 · 인자) · 표 · 반복 블록(무엇마다 · 이름)의 속성 창", match: oneOf("고치기…", "옵션 고치기…", "표 속성…", "반복 원천…"), at: "context" },
      { id: "repeat", label: "행 반복", title: "행 반복 — 고른 표의 행을 무엇마다 되풀이할지(담보약관)", match: oneOf("행 반복…"), at: "context" },
      { id: "link", label: "보통약관 조 연결", title: "보통약관 조 연결 — 고른 조가 대응 보통약관의 어느 조를 따라가는가(담보약관)", match: oneOf("조연결…"), at: "context" },
    ],
  },
  {
    // 툴바에 서지 않는다 — 복제 · 삭제는 고른 블록 오른쪽 위 아이콘, 위로 · 아래로는 오른쪽 클릭 메뉴(블록은 손잡이로 끈다)
    name: "배치",
    tools: [
      { id: "up", label: "위로", title: "위로 — 같은 부모 안에서 한 칸", match: oneOf("위로"), at: "menu" },
      { id: "down", label: "아래로", title: "아래로 — 같은 부모 안에서 한 칸", match: oneOf("아래로"), at: "menu" },
      { id: "duplicate", label: "복제", title: "복제 — 바로 뒤에 사본", match: oneOf("복제"), at: "block" },
      { id: "remove", label: "삭제", title: "삭제 — 고른 자리(조건 머리면 조건 블록 · 칸 머리면 값별 분기)", match: oneOf("삭제", "조건 블록 삭제", "값별 분기 삭제"), at: "block" },
    ],
  },
];

/** 함수조항 본문에 없는 도구 — 함수조항 툴바에서 빠진다 (기능/함수조항 §4.3). 조 · 관 · 함수조항은 남고 잠긴다(사유 tooltip). */
const CLAUSE_HIDDEN = new Set<ToolId>(["table", "structKey", "repeat", "link", "forBlock"]);

export const CLAUSE_TOOLS: ToolGroup[] = DOC_TOOLS.map((g) => ({ ...g, tools: g.tools.filter((t) => !CLAUSE_HIDDEN.has(t.id)) })).filter((g) => g.tools.length > 0);

/** 「문구」 함수조항 — 문장 한 줄뿐이라 구조 넣기 묶음이 없다. */
export const CLAUSE_LINE_TOOLS: ToolGroup[] = CLAUSE_TOOLS.filter((g) => g.name !== "구조 넣기");

/** 문면 툴바에는 옵션 자리 · 값별 분기가 없다(함수조항만 — 값별 분기는 「지금은 함수조항 안에서만」, 최종 결정 5). */
const CLAUSE_ONLY = new Set<ToolId>(["optionSlot", "switch", "switchCase", "inlineSwitch"]);
export const DOCUMENT_TOOLS: ToolGroup[] = DOC_TOOLS.map((g) => ({ ...g, tools: g.tools.filter((t) => !CLAUSE_ONLY.has(t.id)) }));

export function allTools(groups: readonly ToolGroup[]): Tool[] {
  return groups.flatMap((g) => g.tools);
}

/** 툴바에 그리는 도구인가 — `bar` 는 늘, `context` 는 켜졌을 때만. `more` · `block` · `menu` 는 툴바 줄에 없다. */
export function onBar(tool: Tool, state: Pick<ToolState, "disabled">): boolean {
  const at = tool.at ?? "bar";
  return at === "bar" || (at === "context" && !state.disabled);
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
 * 「조건식」 버튼이 켜지는가를 정하는 항목 — 자리의 목록에서 감싸기 · 새 조건 블록 · (그것도 없으면) 문장 안 조건.
 * 누를 때 실제로 넣는 것은 선택 · 커서까지 보는 `menus.condInsertItem` 이 정한다.
 */
export function condItem(sections: MenuSections): MenuItem | undefined {
  const items = sections.flat().filter((i) => !i.refusal);
  return items.find((i) => i.label === "조건으로 감싸기") ?? items.find((i) => i.label === "조건 블록 넣기") ?? items.find((i) => i.label === "문장 안 조건");
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
  const items = tool.id === "cond" ? [condItem(sections)].filter((i): i is MenuItem => i !== undefined) : itemsFor(tool, sections);
  const refused = items.find((i) => i.refusal);
  const usable = items.filter((i) => !i.disabled && !i.refusal);
  if (refused && usable.length === 0) return { tool, items: [], disabled: true, title: `${tool.label} 잠김 — ${refused.refusal}` };
  return { tool, items: usable, disabled: usable.length === 0, title: tool.title };
}
