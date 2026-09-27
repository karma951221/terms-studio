"use client";

/**
 * 공용조항 본문 구조 에디터 — 왼쪽 단.
 *
 * 기능/공용조항 §4 「상세」 편집(툴바 · 우클릭)의 두 규칙을 지킨다 —
 *  ① **툴바에는 구조를 만드는 도구만** 둔다 (항 · 호 · 목). 넣는 일은 툴바가 맡지 않는다.
 *  ② **넣는 자리와 고르는 자리를 붙인다** — 옵션은 오른쪽 패널에서 고르는 것이 아니라
 *     본문에서 **우클릭**해 그 자리에 넣는다. 왼쪽에서 오른쪽으로 손이 가지 않게.
 *
 * 조작은 서버로 나가지 않는다. 트리는 EditShell 이 들고 있다가 「저장」에 한 번 나간다.
 * inline(문구) 본문은 구조가 없으므로 툴바에 항·호·목이 서지 않는다 — 넣을 것만 남는다.
 */
import { useEffect, useState, type ReactNode } from "react";

import { IconButton, IconClose, IconDown, IconPlus, IconUp } from "@/app/_components/icons";
import {
  addItem,
  addParagraph,
  addSubitem,
  insertOptionSlot,
  isInlineBody,
  moveNode,
  randomIds,
  removeNode,
  setNodeText,
  textOf,
  type Block,
  type ClauseBody,
  type Inline,
  type ItemNode,
  type ParagraphNode,
  type SubitemNode,
} from "@/domain/clause";
import type { Id } from "@/domain/types";

export interface EditorOption {
  code: string;
  label: string;
  /** 선택지 수 — 2개 미만이면 본문에 넣을 수 없다(도메인 규칙). */
  valueCount: number;
}

interface MenuState {
  x: number;
  y: number;
  /** 옵션 자리를 넣을 대상 노드 — inline 본문이면 없다(본문 끝에 들어간다). */
  targetId?: Id;
}

/** 문구 줄 하나 — 텍스트 입력 + 그 줄의 조작. 우클릭하면 넣기 메뉴가 뜬다. */
function Line({
  node,
  depth,
  what,
  options,
  onText,
  onMenu,
  onMove,
  onRemove,
  children,
}: {
  node: ParagraphNode | ItemNode | SubitemNode;
  depth: 0 | 1 | 2;
  what: string;
  options: readonly EditorOption[];
  onText: (text: string) => void;
  onMenu: (state: MenuState) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  children?: ReactNode;
}) {
  const slots = node.children.filter((child) => child.kind === "optionSlot");
  return (
    <li className={`ts-be-line ts-be-depth-${depth}`}>
      <div className="ts-be-row">
        <input
          className="ts-field-direct"
          value={textOf(node.children)}
          placeholder={`${what} 문구`}
          aria-label={`${what} 문구`}
          onChange={(event) => onText(event.target.value)}
          onContextMenu={(event) => {
            event.preventDefault();
            onMenu({ x: event.clientX, y: event.clientY, targetId: node.id });
          }}
        />
        <span className="ts-be-actions">
          <IconButton icon={<IconUp />} label={`${what} 위로`} onClick={() => onMove(-1)} />
          <IconButton icon={<IconDown />} label={`${what} 아래로`} onClick={() => onMove(1)} />
          <IconButton icon={<IconClose />} label={`${what} 빼기`} onClick={onRemove} />
        </span>
      </div>
      {slots.length > 0 ? (
        <p className="ts-be-slots">
          {slots.map((slot) => (
            <span key={slot.id} className="ts-doc-ref">
              〔{options.find((option) => option.code === slot.optionCode)?.label ?? slot.optionCode}〕
            </span>
          ))}
        </p>
      ) : null}
      {children}
    </li>
  );
}

export function BodyEditor({
  body,
  options,
  onChange,
}: {
  body: ClauseBody;
  options: readonly EditorOption[];
  onChange: (body: ClauseBody) => void;
}) {
  const [menu, setMenu] = useState<MenuState>();
  const inline = isInlineBody(body);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(undefined);
    window.addEventListener("click", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", close);
    };
  }, [menu]);

  const blocks = inline ? [] : (body as Block[]);

  return (
    <div className="ts-be">
      <div className="ts-be-toolbar" role="toolbar" aria-label="본문 구조">
        {inline ? (
          <span className="ts-muted">문구는 문장 조각 하나다 — 항·호·목을 두지 않는다.</span>
        ) : (
          <>
            <button type="button" onClick={() => onChange(addParagraph(blocks, randomIds))}>
              <IconPlus /> 항
            </button>
            <span className="ts-muted">호·목은 각 줄 끝의 ＋에서 더한다</span>
          </>
        )}
        <span className="ts-be-toolbar-spacer" />
        <span className="ts-muted">본문에서 우클릭 → 옵션 넣기</span>
      </div>

      {inline ? (
        <InlineBody body={body as Inline[]} options={options} onChange={onChange} onMenu={setMenu} />
      ) : (
        <ol className="ts-be-list">
          {blocks.map((block) =>
            block.kind === "condBlock" ? (
              <li key={block.id} className="ts-be-line">
                <p className="ts-muted">조건 블록은 아직 이 에디터에서 못 고친다 — 저장된 대로 둔다.</p>
              </li>
            ) : (
              <Line
                key={block.id}
                node={block}
                depth={0}
                what="항"
                options={options}
                onText={(text) => onChange(setNodeText(blocks, block.id, text))}
                onMenu={setMenu}
                onMove={(delta) => onChange(moveNode(blocks, block.id, delta))}
                onRemove={() => onChange(removeNode(blocks, block.id))}
              >
                <ol className="ts-be-list">
                  {(block.items ?? []).map((item) => (
                    <Line
                      key={item.id}
                      node={item}
                      depth={1}
                      what="호"
                      options={options}
                      onText={(text) => onChange(setNodeText(blocks, item.id, text))}
                      onMenu={setMenu}
                      onMove={(delta) => onChange(moveNode(blocks, item.id, delta))}
                      onRemove={() => onChange(removeNode(blocks, item.id))}
                    >
                      <ol className="ts-be-list">
                        {(item.subitems ?? []).map((sub) => (
                          <Line
                            key={sub.id}
                            node={sub}
                            depth={2}
                            what="목"
                            options={options}
                            onText={(text) => onChange(setNodeText(blocks, sub.id, text))}
                            onMenu={setMenu}
                            onMove={(delta) => onChange(moveNode(blocks, sub.id, delta))}
                            onRemove={() => onChange(removeNode(blocks, sub.id))}
                          />
                        ))}
                        <li className="ts-be-add">
                          <button type="button" onClick={() => onChange(addSubitem(blocks, item.id, randomIds))}>
                            <IconPlus /> 목
                          </button>
                        </li>
                      </ol>
                    </Line>
                  ))}
                  <li className="ts-be-add">
                    <button type="button" onClick={() => onChange(addItem(blocks, block.id, randomIds))}>
                      <IconPlus /> 호
                    </button>
                  </li>
                </ol>
              </Line>
            ),
          )}
          {blocks.length === 0 ? (
            <li className="ts-be-add">
              <button type="button" onClick={() => onChange(addParagraph(blocks, randomIds))}>
                <IconPlus /> 첫 항 만들기
              </button>
            </li>
          ) : null}
        </ol>
      )}

      {menu ? (
        <InsertMenu
          menu={menu}
          options={options}
          onPick={(optionCode) => {
            onChange(insertOptionSlot(body, menu.targetId, optionCode, randomIds));
            setMenu(undefined);
          }}
        />
      ) : null}
    </div>
  );
}

/** 문구(inline) 본문 — 구조가 없으므로 텍스트 한 칸과 넣은 옵션 자리들만 보인다. */
function InlineBody({
  body,
  options,
  onChange,
  onMenu,
}: {
  body: Inline[];
  options: readonly EditorOption[];
  onChange: (body: ClauseBody) => void;
  onMenu: (state: MenuState) => void;
}) {
  const text = body.find((node) => node.kind === "text");
  const slots = body.filter((node) => node.kind === "optionSlot");
  return (
    <div className="ts-be-inline">
      <textarea
        className="ts-field-direct"
        rows={4}
        value={text && text.kind === "text" ? text.text : ""}
        placeholder="문장 조각 — 예: 보험금을 지급하지 않습니다"
        aria-label="문구"
        onChange={(event) => {
          if (text) {
            onChange(setNodeText(body, text.id, event.target.value));
            return;
          }
          onChange([{ id: randomIds(), kind: "text", text: event.target.value }, ...body]);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          onMenu({ x: event.clientX, y: event.clientY });
        }}
      />
      {slots.length > 0 ? (
        <p className="ts-be-slots">
          {slots.map((slot) => (
            <span key={slot.id} className="ts-doc-ref">
              〔{options.find((option) => option.code === slot.optionCode)?.label ?? slot.optionCode}〕
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

/**
 * 우클릭 넣기 메뉴 — 지금은 옵션 자리 하나만 넣는다.
 * 선언된 옵션이 없으면 빈 메뉴 대신 **어디서 만드는지**를 알려 준다 (빈 메뉴는 고장으로 읽힌다).
 */
function InsertMenu({
  menu,
  options,
  onPick,
}: {
  menu: MenuState;
  options: readonly EditorOption[];
  onPick: (optionCode: string) => void;
}) {
  return (
    <div className="ts-ctxmenu" style={{ left: menu.x, top: menu.y }} role="menu" onClick={(event) => event.stopPropagation()}>
      <p className="ts-ctxmenu-title">옵션 넣기</p>
      {options.length === 0 ? (
        <p className="ts-ctxmenu-empty">선언된 옵션이 없습니다. 오른쪽 「옵션」에서 먼저 만드세요.</p>
      ) : (
        options.map((option) => {
          // 고를 것이 하나뿐이면 고르는 자리가 아니다 — 넣을 수 없는 이유를 그 자리에 적는다.
          const blocked = option.valueCount < 2;
          return (
            <button
              key={option.code}
              type="button"
              role="menuitem"
              disabled={blocked}
              title={blocked ? "선택지가 2개 이상이어야 본문에 넣을 수 있습니다" : undefined}
              onClick={() => onPick(option.code)}
            >
              {option.label}
              {blocked ? <span className="ts-ctxmenu-why">선택지 {option.valueCount}개</span> : null}
            </button>
          );
        })
      )}
    </div>
  );
}
