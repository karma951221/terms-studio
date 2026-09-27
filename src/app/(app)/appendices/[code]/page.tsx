/**
 * 별표 상세 (L2) — 코드(불변) · 이름 · 설명, 그리고 사용처.
 *
 * 별표는 필드가 셋뿐이라 오래도록 상세 없이 목록에서 바로 고쳤다. 그러다 목록이 저 혼자
 * 입력칸 표가 되어 다른 마스터 목록과 다르게 보였다 — 2026-09-09, 고치는 자리를 여기로 옮겼다.
 */
import Link from "next/link";

import { Breadcrumb } from "@/app/_components/Breadcrumb";
import { coordinateHref } from "@/app/_components/coordinateHref";
import { ENTITY_LABEL } from "@/app/_lib/labels";
import { formatCoordinate } from "@/domain/coordinate";
import { refStats, usagesOf } from "@/domain/refs";
import { getServices } from "@/lib/services";

import { VIA_LABEL } from "../../relations/lib";
import { AppendixEditor } from "./AppendixEditor";

export const dynamic = "force-dynamic";

export default async function AppendixDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const services = getServices();
  const appendix = await services.document.getAppendix(code);
  if (!appendix) {
    return (
      <div>
        <Breadcrumb items={[{ label: ENTITY_LABEL.appendix, href: "/appendices" }, { label: code }]} />
        <p className="ts-error-banner">찾을 수 없습니다.</p>
      </div>
    );
  }

  const graph = await services.refs.graph();
  const usages = usagesOf(graph, { kind: "appendix", code });
  const totalRefs = refStats(graph).edges;
  const usage = (
    <div>
      <p className="ts-l2-side-title">
        사용처 <span className="ts-count"><b>{usages.length}</b> / 전체 참조 {totalRefs}</span>
      </p>
      {usages.length === 0 ? (
        <div className="ts-empty">
          <p className="ts-empty-what">아무 조문도 이 별표를 부르지 않는다 — 어느 책자에도 실리지 않는다.</p>
          <p className="ts-empty-action"><Link href="/documents?kind=general">약관 템플릿에서 쓰러 가기 →</Link></p>
        </div>
      ) : (
        <table className="ts-table">
          <thead><tr><th className="col-fixed-md">형태</th><th className="col-flex">좌표</th></tr></thead>
          <tbody>
            {usages.map((item, index) => {
              const href = coordinateHref(item.at);
              return (
                <tr key={index}>
                  <td>{VIA_LABEL[item.via]}</td>
                  <td>{href ? <Link href={href}>{formatCoordinate(item.at, { source: true })}</Link> : formatCoordinate(item.at, { source: true })}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );

  return <div><AppendixEditor appendix={appendix} usage={usage} usageCount={usages.length} /></div>;
}
