/**
 * 폼 상세의 본문 (기능/마스터 §4.2) — `/master/{폼키}` 화면이 경로 제목 줄 아래에 세운다. 서버 컴포넌트.
 * 2026-09-27 두 칸의 오른쪽 패널에서 별도 상세 화면으로 옮겼다 — 제목(h2)은 경로(`폼 › {폼}`)가 대신하고 레벨 배지는 정체 목록의 한 줄로.
 *
 * 폼 정체(폼키 · 레벨 · 설명) + 필드 표(행 → 필드 상세) + 「서는 곳」 = 이 폼이 서는 노드 수
 * (세목은 이 폼을 세목유형으로 고른 선택지만).
 * 노드 수 링크는 그 레벨의 목록 화면 — 상품 · 세목은 상품, 담보 트리 세 레벨은 담보.
 */
import Link from "next/link";

import { FIELD_LABEL, LEVEL_LABEL } from "@/app/_lib/labels";
import { fieldsOfForm, type MasterForm } from "@/domain/master";

import { CopyButton } from "./CopyButton";
import { defaultValueText, fieldHref, TypeText, type EnumLabels } from "./lib";

export function FormDetail({ form, nodeCount, enumLabels }: { form: MasterForm; nodeCount: number; enumLabels: EnumLabels }) {
  const fields = fieldsOfForm(form);
  const levelLabel = LEVEL_LABEL[form.level];
  const list = form.level === "product" || form.level === "plan" ? { href: "/products", label: "상품 목록 →" } : { href: "/coverages", label: "담보 목록 →" };

  return (
    <div className="ts-master-detail">
      <dl className="ts-master-ident">
        <dt>{FIELD_LABEL.code}</dt>
        <dd>
          <span className="ts-mono">{form.key}</span> <CopyButton text={form.key} />
        </dd>
        <dt>{FIELD_LABEL.level}</dt>
        <dd><span className="ts-badge">{levelLabel}</span></dd>
        <dt>설명</dt>
        <dd>{form.description ?? <span className="ts-muted">(없음)</span>}</dd>
      </dl>

      <section className="ts-section">
        <p className="ts-master-subtitle">
          {FIELD_LABEL.field} <span className="ts-count"><b>{fields.length}</b></span>
        </p>
        {fields.length === 0 ? (
          <p className="ts-muted">필드 없음</p>
        ) : (
          <table className="ts-table">
            <thead>
              <tr>
                <th className="col-flex">표시명</th>
                <th className="col-fixed-md">{FIELD_LABEL.code}</th>
                <th className="col-fixed-md">{FIELD_LABEL.valueType}</th>
                <th className="col-fixed-sm">{FIELD_LABEL.defaultValue}</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((r) => (
                <tr key={r.path}>
                  <td><Link href={fieldHref(r.path)}>{r.field.label}</Link></td>
                  <td className="col-fixed-md ts-mono ts-master-nowrap"><Link href={fieldHref(r.path)}>{r.path}</Link></td>
                  <td className="col-fixed-md"><TypeText type={r.field.type} enumLabels={enumLabels} /></td>
                  <td className="col-fixed-sm">{defaultValueText(r.field.defaultValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="ts-section">
        <p className="ts-master-stand">
          <span className="ts-form-label">서는 곳</span>
          <span>
            {levelLabel} 노드 <b>{nodeCount}</b>
          </span>
          <Link href={list.href}>{list.label}</Link>
        </p>
      </section>
    </div>
  );
}
