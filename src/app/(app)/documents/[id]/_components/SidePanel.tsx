/**
 * L3 우측 패널 — **모드에 종속된다. 탭이 없다** (디자인원칙 §2 L3).
 *
 * - 읽기 모드 → 사전평가/미리보기: 조건식마다 「식 · 참/거짓 · 채택 분기」 한 줄, 그 아래 명조로 렌더된 결과.
 * - 편집 모드 → 고르는 자리의 편집 폼. 아무것도 안 고르면 「템플릿 전체」(이름 · 대응 보통약관 · 여기에 추가 · 검증 목록).
 *
 * ADR-0074: 폼의 버튼은 「적용」이다 — 서버로 가지 않고 명령을 **편집본**에 적용한다(`ctx.apply`). 저장은 바의 `저장` 하나.
 * 폼 칸의 `name` 은 그대로라 FormData → 명령 변환(`formOps.ts`)이 예전 서버 액션의 파싱을 그대로 잇는다.
 */
import Link from "next/link";
import type { FormEvent, ReactNode } from "react";

import { IconButton, IconPlus, IconTrash } from "@/app/_components/icons";
import { SeverityGlyph } from "@/app/_components/IssueList";
import { DOC_KIND_LABEL, REPEAT_DEPTH_LABEL, STRUCT_KEY_CHIP } from "@/app/_lib/labels";
import type { Clause } from "@/domain/clause";
import { formatCoordinate } from "@/domain/coordinate";
import {
  referenceTargetLabel,
  repeatLevels,
  type Appendix,
  type BlockBranch,
  type BranchEvaluation,
  type DocumentNode,
  type EditOp,
  type InlineBranch,
  type Node,
  type NodeKind,
  type TreeIndex,
} from "@/domain/document";
import { ATTACH_LEVEL_LABEL, REFERENCE_CONNECTORS, type AttachLevel, type Id, type Issue } from "@/domain/types";

import { ConditionEditor } from "./condition/ConditionEditor";
import { SlotRefInput } from "./condition/SlotRefInput";
import type { ConditionContext } from "./condition/types";
import { NodeControls } from "./DocBody";
import { chipText, type DocCtx } from "./ctx";
import {
  addBranchOps,
  appendixRefOps,
  articleRefOps,
  boxOps,
  clauseOptionsOps,
  insertCellOps,
  insertOps,
  linkOps,
  slotOps,
  tableOps,
  textOps,
  titleOps,
  whenOps,
  type FormOps,
} from "./formOps";

const KIND_LABEL: Record<string, string> = {
  section: "관",
  article: "조",
  table: "표",
  box: "박스",
  paragraph: "항",
  item: "호",
  subitem: "목",
  text: "문장",
  slot: "치환 슬롯",
  inlineCond: "문장 안 조건",
  condBlock: "조건 블록",
  clauseBlockRef: "공용조항 (조 단위)",
  clauseInlineRef: "공용조항 (문장 안)",
  articleRef: "조 참조 슬롯",
  appendixRef: "별표 참조 슬롯",
  forBlock: "반복 블록",
  inlineFor: "문장 안 반복",
  structKey: "구조 표기",
};

const ADD_KINDS = {
  top: ["article", "section", "condBlock"],
  section: ["article", "condBlock"],
  block: ["paragraph", "condBlock", "clauseBlockRef", "table", "box"],
  inline: ["text", "slot", "inlineCond", "articleRef", "appendixRef", "clauseInlineRef"],
  /** 표 셀 — 문장 안 자리와 같고, 반복 표 템플릿 행이면 「구조 표기」가 붙는다. */
  cell: ["text", "slot", "inlineCond", "articleRef", "appendixRef", "clauseInlineRef", "structKey"],
  item: ["item", "condBlock", "table", "box"],
  subitem: ["subitem", "condBlock"],
} satisfies Record<string, readonly NodeKind[]>;

/**
 * 적용 폼 — 제출하면 FormData 를 명령으로 바꿔 편집본에 적용한다. 서버로 가지 않는다 (ADR-0074).
 * `build` 가 사유를 돌려주면(모르는 종류 등) 그 사유가 배너로 선다.
 */
function ApplyForm({ ctx, build, children }: { ctx: DocCtx; build: (formData: FormData) => FormOps | EditOp[]; children: ReactNode }) {
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const built = build(new FormData(event.currentTarget));
    if (Array.isArray(built)) ctx.apply(built);
    else if (built.ok) ctx.apply(built.ops);
    else ctx.fail(built.message);
  };
  return <form onSubmit={onSubmit}>{children}</form>;
}

/** 표 폼 필드 — 추가·수정 폼이 같이 쓴다 (값은 노드에서 역직렬화). */
function TableFields({ prefix, node, withTitle = true }: { prefix: string; node?: Node & { kind: "table" }; withTitle?: boolean }) {
  const headerRows = node ? node.rows.findIndex((r) => !r.header) : -1;
  // 셀에 참조 슬롯이 있으면 행을 텍스트로 되돌릴 수 없다 — 제목·너비만 고치게 한다 (행 칸이 없으면 행은 그대로 남는다)
  const textOnly = !node || node.rows.every((row) => row.cells.every((cell) => cell.every((n) => n.kind === "text")));
  const cellText = (cell: readonly Node[]) => cell.map((n) => (n.kind === "text" ? n.text : "")).join("");
  return (
    <>
      {withTitle && (
        <div className="ts-form-row">
          <label htmlFor={`${prefix}-title`}>표 제목</label>
          <input id={`${prefix}-title`} type="text" name="title" defaultValue={node?.title ?? ""} placeholder="없으면 비운다" />
        </div>
      )}
      <div className="ts-form-row">
        <label htmlFor={`${prefix}-widths`}>열 너비 %</label>
        <input id={`${prefix}-widths`} type="text" name="widths" className="ts-mono" defaultValue={node ? node.columns.map((c) => c.width ?? "").join(",") : ""} placeholder="예: 30,70 (빈칸은 자동)" />
      </div>
      {textOnly ? (
        <>
          <div className="ts-form-row">
            <label htmlFor={`${prefix}-header`}>제목줄 수</label>
            <input id={`${prefix}-header`} type="number" name="headerRows" min={0} defaultValue={node ? (headerRows < 0 ? node.rows.length : headerRows) : 1} />
          </div>
          <div className="ts-form-row ts-form-full">
            <label htmlFor={`${prefix}-rows`}>행 (한 줄 = 한 행 · 셀은 |)</label>
            <textarea
              id={`${prefix}-rows`}
              name="rows"
              rows={6}
              className="ts-mono"
              defaultValue={node ? node.rows.map((r) => r.cells.map(cellText).join("|")).join("\n") : ""}
              placeholder={"용어|정의\n계약자|회사와 계약을 체결하고…"}
            />
          </div>
        </>
      ) : (
        <p className="ts-muted">
          이 표의 셀에 참조 슬롯 · 구조 표기 같은 글자 아닌 자리가 있다 — 글자로 되돌리면 끊기므로 행은 여기서 고치지 않는다. 제목과 너비만 바꾸고, 셀 내용은 셀의 ＋ 로 넣는다.
        </p>
      )}
    </>
  );
}

/** 박스 폼 필드. */
function BoxFields({ prefix, node }: { prefix: string; node?: Node & { kind: "box" } }) {
  return (
    <>
      <div className="ts-form-row">
        <label htmlFor={`${prefix}-box-title`}>박스 제목</label>
        <input id={`${prefix}-box-title`} type="text" name="title" defaultValue={node?.title ?? ""} placeholder="예: 심신상실 (【】 없이)" />
      </div>
      <div className="ts-form-row ts-form-full">
        <label htmlFor={`${prefix}-box-lines`}>줄 (한 줄씩)</label>
        <textarea id={`${prefix}-box-lines`} name="lines" rows={5} defaultValue={node ? node.lines.join("\n") : ""} />
      </div>
    </>
  );
}

type AddMode = keyof typeof ADD_KINDS;

export interface PanelData {
  tree: DocumentNode;
  index: TreeIndex;
  appendices: readonly Appendix[];
  clauses: readonly Clause[];
  /** 조건 팝업 문맥 — `ConditionEditor` 가 좌변 트리 · 우변 입력을 그리는 데 쓴다. */
  condition: ConditionContext;
  slotCandidates: readonly { path: string; label: string }[];
  generals: readonly { id: Id; title: string }[];
  generalDocumentId?: Id;
  /** 이 담보약관이 아직 보통약관을 안 골랐을 때의 제안 (상품이 실제로 쓰는 템플릿). 저장해야 확정된다 (ADR-0004). */
  suggestedGeneralId?: Id;
  /** 편집본(읽기 모드면 원본)의 저장 검증 — 경고 포함. */
  issues: readonly Issue[];
  documentTitle: string;
  branchEval?: ReadonlyMap<Id, BranchEvaluation>;
  evalRan: boolean;
  evalAvailable: boolean;
  evalNote?: string;
  rendered?: ReactNode;
  /** 사전평가를 켜고 끈다 — 실시간이 아니라 눌러서 돈다. */
  toggleEval: () => void;
  /** 대응 보통약관 지정 — 그 보통약관을 받아 온 뒤 편집본에 적용한다 (조연결 후보가 바뀐다). */
  setGeneral: (generalDocumentId: Id | undefined) => void;
}

/* ── 추가 폼 ─────────────────────────────────────────────────────────────── */

/** 셀 추가 대상 — 표 셀 좌표와, 반복 표 템플릿 행이면 구조 표기로 고를 수 있는 레벨 (행 사슬). */
interface CellTarget {
  tableId: Id;
  row: number;
  col: number;
  structLevels: readonly Exclude<AttachLevel, "product">[];
}

function AddForm({ ctx, data, parentId, slot, mode, cell, open }: { ctx: DocCtx; data: PanelData; parentId: Id; slot?: "children" | "items" | "subitems"; mode: AddMode; cell?: CellTarget; open?: boolean }) {
  const kinds: readonly NodeKind[] = ADD_KINDS[mode].filter((k) => k !== "structKey" || (cell?.structLevels.length ?? 0) > 0);
  const build = (formData: FormData) => (cell ? insertCellOps(cell.tableId, cell.row, cell.col, formData) : insertOps(parentId, slot, formData));
  return (
    <details className="ts-insert-menu" open={open}>
      <summary>여기에 추가</summary>
      <ApplyForm ctx={ctx} build={build}>
        <div className="ts-form-row">
          <label htmlFor={`add-kind-${parentId}-${slot ?? "children"}`}>종류</label>
          <select id={`add-kind-${parentId}-${slot ?? "children"}`} name="kind" defaultValue={kinds[0]}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k] ?? k}
              </option>
            ))}
          </select>
        </div>
        {(kinds.includes("article") || kinds.includes("section") || kinds.includes("table") || kinds.includes("box")) && (
          <div className="ts-form-row">
            <label>제목</label>
            <input
              type="text"
              name="title"
              placeholder={kinds.includes("article") ? "조: 보험금의 지급사유 · 관: 목적 및 용어의 정의" : "표 제목(없으면 비움) · 박스 제목(【】 없이)"}
            />
          </div>
        )}
        {kinds.includes("table") && <TableFields prefix={`add-${parentId}-${slot ?? "children"}`} withTitle={false} />}
        {kinds.includes("box") && (
          <div className="ts-form-row ts-form-full">
            <label>박스 줄 (제목은 위 제목 칸 · 한 줄씩)</label>
            <textarea name="lines" rows={3} placeholder="박스 본문 줄" />
          </div>
        )}
        {kinds.includes("text") && (
          <div className="ts-form-row">
            <label>문장</label>
            <input type="text" name="text" placeholder="본문에 넣을 문장" />
          </div>
        )}
        {kinds.includes("slot") && (
          <div className="ts-form-row">
            <label htmlFor={`add-ref-${parentId}`}>슬롯 참조</label>
            <SlotRefInput id={`add-ref-${parentId}`} name="ref" context={data.condition} />
          </div>
        )}
        {kinds.includes("structKey") && cell && (
          <div className="ts-form-row">
            <label htmlFor={`add-struct-${parentId}`}>구조 표기</label>
            <select id={`add-struct-${parentId}`} name="structLevel" defaultValue={cell.structLevels[0]}>
              {cell.structLevels.map((l) => (
                <option key={l} value={l}>
                  {ATTACH_LEVEL_LABEL[l]} {STRUCT_KEY_CHIP[l]}
                </option>
              ))}
            </select>
          </div>
        )}
        {(kinds.includes("condBlock") || kinds.includes("inlineCond")) && (
          <div className="ts-form-row">
            <label>조건식</label>
            <ConditionEditor name="when" context={data.condition} />
          </div>
        )}
        {kinds.includes("inlineCond") && (
          <>
            <div className="ts-form-row">
              <label>참일 때</label>
              <input type="text" name="thenText" placeholder="조건이 맞을 때 문장" />
            </div>
            <div className="ts-form-row">
              <label>아닐 때</label>
              <input type="text" name="elseText" placeholder="그 밖의 경우 문장" />
            </div>
          </>
        )}
        {kinds.includes("articleRef") && (
          <div className="ts-form-row">
            <label>참조할 조</label>
            <select name="articleTarget" defaultValue="">
              <option value="">— 고르기 —</option>
              {[...ctx.references.self].map(([nodeId, target]) => (
                <option key={`self:${nodeId}`} value={`self:${nodeId}`}>
                  이 템플릿 › {referenceTargetLabel(target)}
                </option>
              ))}
              {[...ctx.references.general].map(([nodeId, target]) => (
                <option key={`general:${nodeId}`} value={`general:${nodeId}`}>
                  보통약관 › {referenceTargetLabel(target)}
                </option>
              ))}
            </select>
          </div>
        )}
        {kinds.includes("appendixRef") && (
          <div className="ts-form-row">
            <label>별표</label>
            <select name="appendixCode" defaultValue={data.appendices[0]?.code ?? ""}>
              {data.appendices.length === 0 && <option value="">별표 없음</option>}
              {data.appendices.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.name}({a.code})
                </option>
              ))}
            </select>
          </div>
        )}
        {(kinds.includes("clauseBlockRef") || kinds.includes("clauseInlineRef")) && (
          <div className="ts-form-row">
            <label>공용조항</label>
            <select name="clauseCode" defaultValue={data.clauses[0]?.code ?? ""}>
              {data.clauses.length === 0 && <option value="">공용조항 없음</option>}
              {data.clauses.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}({c.code})
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="ts-form-actions">
          <IconButton type="submit" label="고른 종류로 노드 추가" icon={<IconPlus />} />
          <span className="ts-muted">쓰지 않는 칸은 비워 둬도 된다. 편집본에 들어가고, 저장해야 반영된다.</span>
        </div>
      </ApplyForm>
    </details>
  );
}

/* ── 노드별 편집 폼 ──────────────────────────────────────────────────────── */

function OptionForm({ ctx, data, node }: { ctx: DocCtx; data: PanelData; node: Node & { kind: "clauseBlockRef" | "clauseInlineRef" } }) {
  const clause = data.clauses.find((c) => c.code === node.clauseCode);
  if (!clause) {
    return <p className="ts-error-banner">공용조항 {node.clauseCode} 이(가) 없다 — 깨진 참조다.</p>;
  }
  return (
    <ApplyForm ctx={ctx} build={(fd) => clauseOptionsOps(node.id, fd)}>
      {clause.options.length === 0 && <p className="ts-muted">고를 옵션이 없는 공용조항이다.</p>}
      {clause.options.map((o) => (
        <div key={o.code} className="ts-form-row">
          <label htmlFor={`opt-${node.id}-${o.code}`}>{o.label}</label>
          <select id={`opt-${node.id}-${o.code}`} name={`option:${o.code}`} defaultValue={node.options[o.code] ?? ""}>
            <option value="">— 미선택 —</option>
            {o.values.map((v) => (
              <option key={v.code} value={v.code}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
      ))}
      <div className="ts-form-actions">
        <button type="submit">옵션 적용</button>
      </div>
    </ApplyForm>
  );
}

function NodeForms({ ctx, data, node }: { ctx: DocCtx; data: PanelData; node: Node }) {
  switch (node.kind) {
    case "section":
      return (
        <>
          <ApplyForm ctx={ctx} build={(fd) => titleOps(node.id, fd)}>
            <div className="ts-form-row">
              <label htmlFor="sec-title">관 제목</label>
              <input id="sec-title" type="text" name="title" defaultValue={node.title} />
            </div>
            <div className="ts-form-actions">
              <button type="submit">관 제목 적용</button>
            </div>
          </ApplyForm>
          <AddForm ctx={ctx} data={data} parentId={node.id} mode="section" />
        </>
      );

    case "table": {
      const cell = ctx.selectedCell?.tableId === node.id ? ctx.selectedCell : undefined;
      const template = node.repeat !== undefined && cell !== undefined && !node.rows[cell.row]?.header;
      return (
        <>
          {cell && (
            <>
              <h3 className="ts-form-title">
                {cell.row + 1}행 {cell.col + 1}열 셀 {template && <span className="ts-muted">반복 템플릿 행</span>}
              </h3>
              <AddForm
                ctx={ctx}
                data={data}
                parentId={`${node.id}-r${cell.row}c${cell.col}`}
                mode="cell"
                cell={{ tableId: node.id, row: cell.row, col: cell.col, structLevels: template ? repeatLevels(node) : [] }}
                open
              />
              <h3 className="ts-form-title">표 속성</h3>
            </>
          )}
        <ApplyForm ctx={ctx} build={(fd) => tableOps(node.id, fd)}>
          <TableFields prefix={`edit-${node.id}`} node={node} />
          {ctx.docKind === "special" && (
            <div className="ts-form-row">
              <label htmlFor={`edit-${node.id}-repeat`}>행 반복</label>
              <select id={`edit-${node.id}-repeat`} name="repeat" defaultValue={node.repeat ? String(node.repeat.depth) : ""}>
                <option value="">없음</option>
                <option value="1">{REPEAT_DEPTH_LABEL[1].option}</option>
                <option value="2">{REPEAT_DEPTH_LABEL[2].option}</option>
              </select>
            </div>
          )}
          <div className="ts-form-actions">
            <button type="submit">표 적용</button>
            <span className="ts-muted">제목줄은 굵게·음영, 너비는 %. 행 반복은 머리글 아닌 행을 템플릿으로 복제한다.</span>
          </div>
        </ApplyForm>
        </>
      );
    }

    case "box":
      return (
        <ApplyForm ctx={ctx} build={(fd) => boxOps(node.id, fd)}>
          <BoxFields prefix={`edit-${node.id}`} node={node} />
          <div className="ts-form-actions">
            <button type="submit">박스 적용</button>
          </div>
        </ApplyForm>
      );

    case "article":
      return (
        <>
          <ApplyForm ctx={ctx} build={(fd) => titleOps(node.id, fd)}>
            <div className="ts-form-row">
              <label htmlFor="art-title">조 제목</label>
              <input id="art-title" type="text" name="title" defaultValue={node.title} />
            </div>
            <div className="ts-form-actions">
              <button type="submit">제목 적용</button>
            </div>
          </ApplyForm>
          {ctx.docKind === "special" && (
            <ApplyForm ctx={ctx} build={(fd) => linkOps(node.id, fd)}>
              <div className="ts-form-row">
                <label htmlFor="art-link">조연결</label>
                <select id="art-link" name="linkedArticleId" defaultValue={node.linkedArticleId ?? ""}>
                  <option value="">— 연결 없음 —</option>
                  {[...ctx.references.general]
                    .filter(([, t]) => t.kind === "article")
                    .map(([nodeId, target]) => (
                      <option key={nodeId} value={nodeId}>
                        {referenceTargetLabel(target)}
                      </option>
                    ))}
                </select>
              </div>
              <div className="ts-form-actions">
                <button type="submit">조연결 적용</button>
                {ctx.references.general.size === 0 && <span className="ts-muted">대응 보통약관을 먼저 골라야 조를 고를 수 있다.</span>}
              </div>
            </ApplyForm>
          )}
          <AddForm ctx={ctx} data={data} parentId={node.id} mode="block" />
        </>
      );

    case "paragraph":
      return (
        <>
          <AddForm ctx={ctx} data={data} parentId={node.id} slot="children" mode="inline" />
          <AddForm ctx={ctx} data={data} parentId={node.id} slot="items" mode="item" />
        </>
      );

    case "item":
      return (
        <>
          <AddForm ctx={ctx} data={data} parentId={node.id} slot="children" mode="inline" />
          <AddForm ctx={ctx} data={data} parentId={node.id} slot="subitems" mode="subitem" />
        </>
      );

    case "subitem":
      return <AddForm ctx={ctx} data={data} parentId={node.id} slot="children" mode="inline" />;

    case "text":
      return (
        <ApplyForm ctx={ctx} build={(fd) => textOps(node.id, fd)}>
          <div className="ts-form-row ts-form-full">
            <label htmlFor="node-text">문장</label>
            <textarea id="node-text" name="text" rows={4} defaultValue={node.text} />
          </div>
          <div className="ts-form-actions">
            <button type="submit">문장 적용</button>
          </div>
        </ApplyForm>
      );

    case "slot":
      return (
        <ApplyForm ctx={ctx} build={(fd) => slotOps(node.id, fd)}>
          <div className="ts-form-row">
            <label htmlFor="node-ref">참조 경로</label>
            <SlotRefInput id="node-ref" name="ref" initial={node.ref} context={data.condition} />
          </div>
          <div className="ts-form-actions">
            <button type="submit">슬롯 적용</button>
          </div>
        </ApplyForm>
      );

    case "articleRef":
      return (
        <ApplyForm ctx={ctx} build={(fd) => articleRefOps(node.id, fd)}>
          <div className="ts-form-row">
            <label htmlFor="ref-scope">범위</label>
            <select id="ref-scope" name="scope" defaultValue={node.scope}>
              <option value="self">이 템플릿</option>
              <option value="general">대응 보통약관</option>
            </select>
          </div>
          <div className="ts-form-row ts-form-full">
            <label htmlFor="ref-targets">참조 대상 (여럿 고를 수 있다)</label>
            <select id="ref-targets" name="targets" multiple size={8} defaultValue={node.targets.map((t) => t.nodeId)}>
              <optgroup label="이 템플릿">
                {[...ctx.references.self].map(([nodeId, target]) => (
                  <option key={`self:${nodeId}`} value={nodeId}>
                    {referenceTargetLabel(target)}
                  </option>
                ))}
              </optgroup>
              <optgroup label="대응 보통약관">
                {[...ctx.references.general].map(([nodeId, target]) => (
                  <option key={`general:${nodeId}`} value={nodeId}>
                    {referenceTargetLabel(target)}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
          <div className="ts-form-row">
            <span className="ts-form-label">연결어</span>
            <div>
              <div className="ts-radio-group" role="radiogroup" aria-label="연결어">
                {REFERENCE_CONNECTORS.map((c) => (
                  <label key={c} className="ts-form-radio">
                    <input type="radio" name="connector" value={c} defaultChecked={node.connector === c} />
                    {c}
                  </label>
                ))}
              </div>
              <p className="ts-form-hint">대상이 여럿일 때 마지막 앞에 붙는다. 번호가 잇달아 셋 이상이면 「제3조부터 제5조까지」로 묶이고, 분기로 빠진 대상은 산출 때 제외된다.</p>
            </div>
          </div>
          <div className="ts-form-actions">
            <button type="submit">조 참조 적용</button>
          </div>
        </ApplyForm>
      );

    case "appendixRef":
      return (
        <ApplyForm ctx={ctx} build={(fd) => appendixRefOps(node.id, fd)}>
          <div className="ts-form-row">
            <label htmlFor="node-appendix">별표</label>
            <select id="node-appendix" name="appendixCode" defaultValue={node.appendixCode}>
              {data.appendices.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.name}({a.code})
                </option>
              ))}
            </select>
          </div>
          <div className="ts-form-actions">
            <button type="submit">별표 적용</button>
          </div>
        </ApplyForm>
      );

    case "clauseBlockRef":
    case "clauseInlineRef":
      return <OptionForm ctx={ctx} data={data} node={node} />;

    case "condBlock":
    case "inlineCond":
      return (
        <>
          <p className="ts-muted">가지를 누르면 그 조건식을 여기서 고칠 수 있다.</p>
          <ul>
            {node.branches.map((br) => (
              <li key={br.id}>
                <button type="button" className="ts-doc-pick ts-mono" onClick={() => ctx.select({ node: br.id })}>
                  {chipText(br.when, "edit", ctx.refLabel).full}
                </button>
              </li>
            ))}
          </ul>
          <ApplyForm ctx={ctx} build={(fd) => addBranchOps(data.tree, node.id, fd)}>
            <div className="ts-form-row">
              <span className="ts-form-label">ELIF 추가 (비우면 ELSE)</span>
              <ConditionEditor name="when" context={data.condition} />
            </div>
            {node.kind === "inlineCond" && (
              <div className="ts-form-row">
                <label htmlFor="branch-text">첫 문장</label>
                <input id="branch-text" type="text" name="text" placeholder="선택" />
              </div>
            )}
            <div className="ts-form-actions">
              <button type="submit">가지 추가</button>
            </div>
          </ApplyForm>
        </>
      );

    default:
      return <p className="ts-muted">이 종류는 아직 여기서 고칠 것이 없다.</p>;
  }
}

/* ── 문서 수준 ───────────────────────────────────────────────────────────── */

function DocumentForms({ ctx, data }: { ctx: DocCtx; data: PanelData }) {
  const generalValue = data.generalDocumentId ?? data.suggestedGeneralId ?? "";
  const proposed = data.generalDocumentId === undefined && data.suggestedGeneralId !== undefined;
  const onGeneral = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const picked = String(new FormData(event.currentTarget).get("generalDocumentId") ?? "").trim();
    data.setGeneral(picked === "" ? undefined : picked);
  };
  return (
    <>
      <p className="ts-muted">본문에서 고칠 자리의 ✎ 를 누르면 여기에 그 자리의 폼이 실린다. 「적용」은 편집본에만 들어가고, 바의 「저장」 한 번에 반영된다.</p>

      <ApplyForm ctx={ctx} build={(fd) => titleOps(data.tree.id, fd)}>
        <div className="ts-form-row">
          <label htmlFor="doc-title">템플릿 이름</label>
          <input id="doc-title" type="text" name="title" defaultValue={data.documentTitle} />
        </div>
        <div className="ts-form-actions">
          <button type="submit">이름 적용</button>
        </div>
      </ApplyForm>

      {ctx.docKind === "special" && (
        <form onSubmit={onGeneral}>
          <div className="ts-form-row">
            <label htmlFor="doc-general">대응 보통약관</label>
            <span className="ts-form-control">
              <select id="doc-general" name="generalDocumentId" defaultValue={generalValue}>
                <option value="">— 해제 —</option>
                {data.generals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}({DOC_KIND_LABEL.general})
                  </option>
                ))}
              </select>
              {proposed && <span className="ts-badge proposed">제안값 — 적용하고 저장해야 확정</span>}
            </span>
          </div>
          <div className="ts-form-actions">
            <button type="submit">대응 보통약관 적용</button>
          </div>
        </form>
      )}

      <AddForm ctx={ctx} data={data} parentId={data.tree.id} mode="top" />

      <h3 className="ts-form-title">
        저장 검증{" "}
        <span className="ts-count">
          <b>{data.issues.filter((i) => i.severity !== "warning").length}</b> / 노드 {data.index.nodes.size}
        </span>
      </h3>
      {data.issues.length === 0 ? <p className="ts-ok">문제 없음.</p> : <DraftIssues ctx={ctx} issues={data.issues} />}

      {data.evalAvailable && (
        <>
          <h3 className="ts-form-title">사전평가 · 미리보기</h3>
          <p className="ts-muted">편집본을 담보 마스터 값으로 평가한다 — 거짓 가지가 톤다운된다.</p>
          <div className="ts-form-actions">
            <button type="button" onClick={data.toggleEval}>
              {data.evalRan ? "평가 결과 지우기" : "편집본 미리보기"}
            </button>
          </div>
        </>
      )}
    </>
  );
}

/**
 * 검증 목록 — 편집본의 오류 · 경고. 「고칠 자리로」는 그 노드를 우측 패널에 싣는다(화면을 떠나지 않는다).
 * 오류가 하나라도 있으면 저장은 서버가 거부한다 (서버가 최종 검증자).
 */
export function DraftIssues({ ctx, issues }: { ctx: Pick<DocCtx, "select">; issues: readonly Issue[] }) {
  return (
    <ul className="ts-issues" role="alert">
      {issues.map((issue, i) => {
        const severity: "error" | "warning" = issue.severity === "warning" ? "warning" : "error";
        const nodeId = issue.at.nodePath?.at(-1) ?? issue.at.articleId;
        return (
          <li key={i} className={severity === "warning" ? "ts-issue-warning" : undefined}>
            <SeverityGlyph severity={severity} />{" "}
            <span className="ts-issue-kind">
              [{severity} · {issue.kind}]
            </span>{" "}
            {issue.message}
            {severity === "warning" && <span className="ts-muted"> · 저장을 막지 않는 경고</span>}
            <div className="ts-issue-at">{formatCoordinate(issue.at)}</div>
            {nodeId && (
              <button type="button" className="ts-doc-pick" onClick={() => ctx.select({ node: nodeId })}>
                고칠 자리로
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ── 사전평가 (읽기 모드) ────────────────────────────────────────────────── */

function EvalLines({ ctx, data, index }: { ctx: DocCtx; data: PanelData; index: TreeIndex }) {
  const conds = [...index.nodes.values()].map((e) => e.node).filter((n): n is Node & { branches: (BlockBranch | InlineBranch)[] } => n.kind === "condBlock" || n.kind === "inlineCond");
  if (conds.length === 0) return <p className="ts-muted">조건식이 없는 템플릿이다 — 평가할 분기가 없다.</p>;
  return (
    <>
      {conds.map((cond) => {
        const taken = cond.branches.find((br) => data.branchEval?.get(br.id)?.state === "taken");
        return (
          <div key={cond.id} style={{ margin: "6px 0" }}>
            {cond.branches.map((br) => {
              const ev = data.branchEval?.get(br.id);
              const verdict = ev?.state === "taken" ? "참" : ev?.state === "notTaken" ? "거짓" : ev?.state === "undetermined" ? `미결 (${ev.reason ?? "문맥 부족"})` : ev?.state === "error" ? `오류 — ${ev.issue?.message ?? ""}` : "평가 안 됨";
              return (
                <p key={br.id} className="ts-doc-cond-head" title={chipText(br.when, "edit", ctx.refLabel).full}>
                  {chipText(br.when, "read", ctx.refLabel).text} · {verdict}
                </p>
              );
            })}
            <p className="ts-muted">채택 분기: {taken ? chipText(taken.when, "read", ctx.refLabel).text : "없음 (어느 가지도 타지 않았다)"}</p>
          </div>
        );
      })}
    </>
  );
}

function EvalPanel({ ctx, data }: { ctx: DocCtx; data: PanelData }) {
  return (
    <>
      <h3 className="ts-form-title">사전평가 · 미리보기</h3>
      {!data.evalAvailable ? (
        <div className="ts-empty">
          <p className="ts-empty-what">{data.evalNote ?? "이 템플릿은 사전평가 문맥을 만들 수 없다."}</p>
          <p className="ts-empty-example">사전평가는 담보약관에서 담보 마스터 값을 문맥으로 삼아 돈다.</p>
          <p className="ts-empty-action">
            <Link href="/products">상품 조립 미리보기로 →</Link>
          </p>
        </div>
      ) : (
        <>
          <p className="ts-muted">담보 마스터 값을 문맥으로 조건식을 평가한다. 실시간이 아니라 눌러서 돌린다.</p>
          {/* 패널의 주 행동은 텍스트 버튼을 유지한다 (§1.6 예외 ①). 실시간이 아니라 눌러서 돈다. */}
          <div className="ts-form-actions">
            {data.evalRan ? (
              <button type="button" onClick={data.toggleEval} title="평가 결과를 지우고 원래 조문으로 돌아간다">
                평가 결과 지우기
              </button>
            ) : (
              <button type="button" onClick={data.toggleEval} className="primary" title="담보 마스터 값을 문맥으로 조건식을 평가한다">
                미리보기
              </button>
            )}
          </div>
          {data.evalRan && (
            <>
              <EvalLines ctx={ctx} data={data} index={data.index} />
              <h3 className="ts-form-title">결과 조문</h3>
              {data.rendered}
            </>
          )}
        </>
      )}
    </>
  );
}

/* ── 패널 ────────────────────────────────────────────────────────────────── */

export function SidePanel({ ctx, data, confirm }: { ctx: DocCtx; data: PanelData; confirm?: ReactNode }) {
  if (confirm) return <aside className="ts-l3-side">{confirm}</aside>;
  if (ctx.mode === "read") {
    return (
      <aside className="ts-l3-side">
        <EvalPanel ctx={ctx} data={data} />
      </aside>
    );
  }
  const selected = ctx.selectedId !== undefined ? data.index.nodes.get(ctx.selectedId) : undefined;
  const branch = ctx.selectedId !== undefined ? data.index.branches.get(ctx.selectedId) : undefined;

  if (branch) {
    const owner = data.index.nodes.get(branch.ownerId);
    const inline = owner?.node.kind === "inlineCond";
    return (
      <aside className="ts-l3-side">
        <h3 className="ts-form-title">조건 가지</h3>
        <BranchForms ctx={ctx} data={data} branch={branch.branch} inline={inline} />
      </aside>
    );
  }

  if (!selected) {
    return (
      <aside className="ts-l3-side">
        <h3 className="ts-form-title">템플릿 전체</h3>
        <DocumentForms ctx={ctx} data={data} />
      </aside>
    );
  }

  const num = ctx.numbers.get(selected.node.id);
  const title = selected.node.kind === "article" ? `${num?.label ?? "조"}(${(selected.node as { title: string }).title})` : (num?.label ?? KIND_LABEL[selected.node.kind] ?? selected.node.kind);
  return (
    <aside className="ts-l3-side">
      <h3 className="ts-form-title">
        {title} <span className="ts-muted">{KIND_LABEL[selected.node.kind] ?? selected.node.kind}</span>
      </h3>
      <p>
        <button type="button" className="ts-doc-pick" onClick={() => ctx.select({})}>
          ← 템플릿 전체로
        </button>
      </p>
      {/* 인라인 자리는 본문에 아이콘이 없으므로 (§2 L3) 이동·복제·삭제를 여기서 준다. */}
      <div style={{ marginBottom: 8, overflow: "hidden" }}>
        <NodeControls ctx={ctx} nodeId={selected.node.id} what={title} />
      </div>
      <NodeForms ctx={ctx} data={data} node={selected.node} />
    </aside>
  );
}

function BranchForms({ ctx, data, branch, inline }: { ctx: DocCtx; data: PanelData; branch: BlockBranch | InlineBranch; inline: boolean }) {
  const ev = data.branchEval?.get(branch.id);
  return (
    <>
      <p>
        <button type="button" className="ts-doc-pick" onClick={() => ctx.select({})}>
          ← 템플릿 전체로
        </button>
      </p>
      <ApplyForm ctx={ctx} build={(fd) => whenOps(branch.id, fd)}>
        <div className="ts-form-row ts-form-full">
          <span className="ts-form-label">조건식</span>
          <ConditionEditor name="when" initial={branch.when} context={data.condition} />
        </div>
        <div className="ts-form-actions">
          <button type="submit">수정</button>
        </div>
      </ApplyForm>
      {ev && (
        <p className="ts-muted">
          사전평가: {ev.state === "taken" ? "참" : ev.state === "notTaken" ? "거짓" : ev.state === "undetermined" ? `미결 — ${ev.reason ?? ""}` : `오류 — ${ev.issue?.message ?? ""}`}
        </p>
      )}
      <AddForm ctx={ctx} data={data} parentId={branch.id} mode={inline ? "inline" : "block"} />
      <h3 className="ts-form-title">가지 삭제</h3>
      <IconButton
        danger
        label={`조건 가지 「${chipText(branch.when, "edit", ctx.refLabel).full}」 와 그 안의 내용을 삭제 — 저장하면 사라진다`}
        icon={<IconTrash />}
        onClick={() => {
          if (ctx.apply([{ type: "removeBranch", branchId: branch.id }])) ctx.select({});
        }}
      />
    </>
  );
}
