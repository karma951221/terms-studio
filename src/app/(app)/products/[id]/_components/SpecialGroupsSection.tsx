"use client";

/**
 * 상품담보 탭의 「특약 그룹」 섹션 (기능/상품 §3.7 · §4.5 · ADR-0090) — 표들 아래.
 *
 * - 그룹 목록 하나: 기본 그룹(담보분류 — 이 상품에 그 담보분류의 특약 담보가 있는 것만)과 사용자 그룹이 순서대로 한 줄씩 —
 *   번호 · 그룹 제목 · 종류(「기본 — 담보분류 상해」 / 「사용자」) · 든 담보(칩). 빈 그룹은 「담보 없음 — 책자에 찍지 않는다」.
 * - 편집(탭의 편집 하나 = 저장 하나): ▲▼ 전체 순서 · 사용자 그룹 이름 입력 · 칩 ✕(빼면 기본 그룹으로) · 「담보 넣기」 select
 *   (특약으로 탑재된 담보 중 사용자 그룹에 들지 않은 것) · 🗑 그룹 빼기(든 담보는 기본 그룹으로) · 목록 끝 「+ 그룹」.
 *   기본 그룹은 이름 · 빼기가 없다 — 제목은 열거형 「담보분류」 값의 「그룹 제목」이다.
 * - 저장 거부(빈 이름 · 다른 그룹 제목과 같은 이름 …)는 그 그룹 줄 아래에 붙는다(이슈 `ownerId` = 그룹 열쇠).
 */
import { IconButton, IconClose, IconDown, IconPlus, IconTrash, IconUp } from "@/app/_components/icons";
import type { Code, Id } from "@/domain/types";

import { displayGroups, freeCoverages, groupCoverages, type CoveragesDraft, type CoveragesDraftAction, type DraftGroup, type GroupContext } from "./coveragesDraft";

/** 열거형 「담보분류」 값 하나 — 이름 · 「그룹 제목」 필드(비면 undefined). */
export interface CategoryInfo {
  code: Code;
  label: string;
  title?: string;
}

/** 그룹 제목 — 사용자 그룹 이름 · 담보분류 값의 「그룹 제목」. 비었으면 undefined. */
export function groupTitle(group: DraftGroup, categories: readonly CategoryInfo[]): string | undefined {
  if (group.kind === "user") return group.name.trim() || undefined;
  return categories.find((c) => c.code === group.code)?.title;
}

export function groupKindLabel(group: DraftGroup, categories: readonly CategoryInfo[]): string {
  return group.kind === "user" ? "사용자" : `기본 — 담보분류 ${categories.find((c) => c.code === group.code)?.label ?? group.code}`;
}

export function SpecialGroupsSection({ draft, ctx, categories, coverageName, errors, edit }: {
  draft: CoveragesDraft;
  ctx: GroupContext;
  categories: readonly CategoryInfo[];
  coverageName: (coverageId: Id) => string;
  errors: ReadonlyMap<string, string[]>;
  /** 편집 중일 때만. */
  edit?: { dispatch: (action: CoveragesDraftAction) => void };
}) {
  const groups = displayGroups(draft, ctx);
  const free = freeCoverages(draft);
  const cols = edit ? 5 : 4;
  return (
    <section className="ts-section ts-special-groups" aria-label="특약 그룹">
      <h2 className="ts-section-title">특약 그룹</h2>
      <table className="ts-table">
        <thead>
          <tr>
            <th className="col-code">순서</th>
            <th className="col-fixed-md">그룹 제목</th>
            <th className="col-fixed-md">종류</th>
            <th className="col-flex">든 담보</th>
            {edit && <th className="col-act">조작</th>}
          </tr>
        </thead>
        <tbody>
          {groups.map((g, i) => {
            const title = groupTitle(g, categories);
            const label = title ?? (g.kind === "user" ? "(이름 없음)" : "(그룹 제목 없음)");
            const members = groupCoverages(draft, ctx, g);
            const rowErrors = errors.get(g.key) ?? [];
            return (
              <GroupRows key={g.key} group={g} index={i} last={i === groups.length - 1} title={title} label={label} kind={groupKindLabel(g, categories)} members={members} free={free} coverageName={coverageName} errors={rowErrors} cols={cols} edit={edit} ctx={ctx} />
            );
          })}
          {groups.length === 0 && (
            <tr>
              <td colSpan={cols} className="ts-muted">
                아직 특약 담보가 없다 — 특약을 탑재하면 담보분류의 기본 그룹이 선다.
              </td>
            </tr>
          )}
        </tbody>
        {edit && (
          <tfoot>
            <tr className="ts-mount-add">
              <td colSpan={cols}>
                <button type="button" className="ts-linklike" onClick={() => edit.dispatch({ type: "addGroup", ctx })} aria-label="특약 그룹 추가">
                  <IconPlus /> 그룹
                </button>
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </section>
  );
}

function GroupRows({ group, index, last, title, label, kind, members, free, coverageName, errors, cols, edit, ctx }: {
  group: DraftGroup;
  index: number;
  last: boolean;
  title: string | undefined;
  label: string;
  kind: string;
  members: Id[];
  free: Id[];
  coverageName: (coverageId: Id) => string;
  errors: string[];
  cols: number;
  edit?: { dispatch: (action: CoveragesDraftAction) => void };
  ctx: GroupContext;
}) {
  const user = group.kind === "user";
  return (
    <>
      <tr data-group={group.key}>
        <td className="col-code">{index + 1}</td>
        <td className="col-fixed-md">
          {edit && user ? (
            <input
              type="text"
              value={group.name}
              placeholder="그룹 제목 — 예: 뇌 관련 특별약관"
              onChange={(e) => edit.dispatch({ type: "renameGroup", key: group.key, name: e.target.value })}
              aria-label={`그룹 이름 · ${index + 1}`}
              aria-invalid={errors.length > 0 ? true : undefined}
              style={{ width: 220 }}
            />
          ) : title !== undefined ? (
            title
          ) : (
            <span className={user ? "ts-muted" : "ts-form-error"} title={user ? undefined : "열거형 「담보분류」 값의 「그룹 제목」이 비었다 — 책자의 그룹 제목 자리에 오류가 난다"}>
              {label}
            </span>
          )}
        </td>
        <td className="col-fixed-md">{kind}</td>
        <td className="col-flex">
          <span style={{ display: "inline-flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
            {members.length === 0 && <span className="ts-muted">담보 없음 — 책자에 찍지 않는다</span>}
            {members.map((id) => (
              <span key={id} className="ts-badge">
                {coverageName(id)}
                {edit && user && <IconButton danger label={`그룹에서 빼기 · ${label} · ${coverageName(id)}`} icon={<IconClose />} onClick={() => edit.dispatch({ type: "leaveGroup", coverageId: id })} />}
              </span>
            ))}
            {edit && user && (
              <select
                value=""
                onChange={(e) => e.target.value && edit.dispatch({ type: "joinGroup", key: group.key, coverageId: e.target.value })}
                aria-label={`담보 넣기 · ${label}`}
                disabled={free.length === 0}
                style={{ maxWidth: 200 }}
              >
                <option value="">{free.length === 0 ? "넣을 담보 없음" : "+ 담보"}</option>
                {free.map((id) => (
                  <option key={id} value={id}>
                    {coverageName(id)}
                  </option>
                ))}
              </select>
            )}
          </span>
        </td>
        {edit && (
          <td className="col-act">
            <span style={{ display: "inline-flex", gap: 2, alignItems: "center" }}>
              <IconButton label={`위로 · ${label}`} icon={<IconUp />} disabled={index === 0} onClick={() => edit.dispatch({ type: "moveGroup", key: group.key, dir: -1, ctx })} />
              <IconButton label={`아래로 · ${label}`} icon={<IconDown />} disabled={last} onClick={() => edit.dispatch({ type: "moveGroup", key: group.key, dir: 1, ctx })} />
              {user && <IconButton danger label={`그룹 빼기 · ${label}`} icon={<IconTrash />} onClick={() => edit.dispatch({ type: "removeGroup", key: group.key })} />}
            </span>
          </td>
        )}
      </tr>
      {errors.length > 0 && (
        <tr className="ts-row-error">
          <td colSpan={cols}>
            {errors.map((m, i) => (
              <p key={i} className="ts-form-error" role="alert">
                {m}
              </p>
            ))}
          </td>
        </tr>
      )}
    </>
  );
}
