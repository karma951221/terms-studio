/**
 * 필드 상세의 본문 (기능/마스터 §4.3) — `/master/{폼키.필드키}` 화면이 경로 제목 줄 아래에 세운다. 서버 컴포넌트 · 비동기.
 * 2026-09-27 두 칸의 오른쪽 패널에서 별도 상세 화면으로 옮겼다 — 제목(h2)은 경로(`폼 › {폼} › {필드}`)가 대신한다.
 *
 * 둘 — **정체**(코드 ⧉ · 폼 → 폼 상세 · 레벨 · 타입 · 기본값 · 설명),
 * **값 노드**(값 노드 전부, 미입력 포함 · 20건 페이저 · 「입력 화면 →」).
 * 이 필드를 읽는 구분자 · 문면(사용처)은 두지 않는다 — 관계정보 메뉴 (디자인원칙 §11.2, 2026-10-01).
 * 데이터원은 `services.master` (기능/마스터 §4.3). 값 노드 페이저는 `?page=`.
 */
import Link from "next/link";

import { ENTITY_LABEL, FIELD_LABEL, LEVEL_LABEL } from "@/app/_lib/labels";
import type { EnumDef } from "@/domain/catalog/types";
import type { MasterFieldRef } from "@/domain/master";
import type { MasterService } from "@/services/master";

import { CopyButton } from "./CopyButton";
import { defaultValueText, fieldHref, formHref, nodeValueText, TypeText, type EnumLabels } from "./lib";

export async function FieldDetail({ field, page, master, enums }: { field: MasterFieldRef; page: number; master: MasterService; enums: readonly EnumDef[] }) {
  // 서비스가 page 를 마지막 페이지로 죄어 돌려준다 — 페이저는 요청값이 아니라 nodes.page 를 본다.
  const nodes = await master.valueNodes(field.path, page);
  const enumLabels: EnumLabels = new Map(enums.map((e) => [e.code, e.label] as const));
  const valueLabel = (enumCode: string, valueCode: string) => enums.find((e) => e.code === enumCode)?.values.find((v) => v.code === valueCode)?.label ?? valueCode;
  const pages = Math.max(1, Math.ceil(nodes.total / nodes.pageSize));

  return (
    <div className="ts-master-detail">
      <dl className="ts-master-ident">
        <dt>{FIELD_LABEL.code}</dt>
        <dd>
          <span className="ts-mono">{field.path}</span> <CopyButton text={field.path} />
        </dd>
        <dt>{ENTITY_LABEL.form}</dt>
        <dd>
          <Link href={formHref(field.form.key)}>{field.form.label}</Link> <span className="ts-badge">{LEVEL_LABEL[field.level]}</span>
        </dd>
        <dt>{FIELD_LABEL.valueType}</dt>
        <dd><TypeText type={field.field.type} enumLabels={enumLabels} /></dd>
        <dt>{FIELD_LABEL.defaultValue}</dt>
        <dd>{defaultValueText(field.field.defaultValue)}</dd>
        <dt>설명</dt>
        <dd>{field.field.description ?? <span className="ts-muted">(없음)</span>}</dd>
      </dl>

      <section className="ts-section">
        <h3 className="ts-master-section">
          값 노드{" "}
          <span className="ts-count">
            명시 값 <b>{nodes.entered}</b> · 미입력 <b>{nodes.notEntered}</b>
          </span>
        </h3>
        {nodes.total === 0 ? (
          <p className="ts-muted">아직 이 레벨의 노드가 없습니다</p>
        ) : (
          <>
            <table className="ts-table">
              <thead>
                <tr>
                  <th className="col-flex">노드</th>
                  <th className="col-fixed-md">{FIELD_LABEL.value}</th>
                  <th className="col-fixed-sm"></th>
                </tr>
              </thead>
              <tbody>
                {nodes.rows.map((row) => (
                  <tr key={`${row.ownerKind}:${row.ownerId}`}>
                    <td>{row.label}</td>
                    <td className={row.value === undefined ? "ts-muted" : undefined}>{nodeValueText(row.value, field.field.type, valueLabel)}</td>
                    <td className="col-fixed-sm"><Link href={row.href}>입력 화면 →</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pages > 1 ? (
              <p className="ts-pager">
                총 {nodes.total}건
                <span className="ts-pager-nav">
                  {nodes.page > 1 ? <Link href={fieldHref(field.path, nodes.page - 1)}>‹ 이전</Link> : <span className="ts-muted">‹ 이전</span>}
                  <span>
                    {nodes.page} / {pages}
                  </span>
                  {nodes.page < pages ? <Link href={fieldHref(field.path, nodes.page + 1)}>다음 ›</Link> : <span className="ts-muted">다음 ›</span>}
                </span>
              </p>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
