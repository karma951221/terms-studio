/**
 * 박스 상세 (L2) — 코드(불변) · 이름 · 제목 · 줄, 그리고 사용처 (기능/박스 §4.3).
 */
import Link from "next/link";

import { Breadcrumb } from "@/app/_components/Breadcrumb";
import { coordinateHref } from "@/app/_components/coordinateHref";
import { ENTITY_LABEL } from "@/app/_lib/labels";
import { formatCoordinate } from "@/domain/coordinate";
import { refStats, usagesOf } from "@/domain/refs";
import { getServices } from "@/lib/services";

import { VIA_LABEL } from "../../relations/lib";
import { BoxEditor } from "./BoxEditor";

export const dynamic = "force-dynamic";

export default async function BoxDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const services = getServices();
  const box = await services.document.getBox(code);
  if (!box) {
    return (
      <div>
        <Breadcrumb items={[{ label: ENTITY_LABEL.box, href: "/boxes" }, { label: code }]} />
        <p className="ts-error-banner">찾을 수 없습니다.</p>
      </div>
    );
  }

  const graph = await services.refs.graph();
  const usages = usagesOf(graph, { kind: "box", code });
  const totalRefs = refStats(graph).edges;
  const usage = (
    <div>
      <p className="ts-l2-side-title">
        사용처 <span className="ts-count"><b>{usages.length}</b> / 전체 참조 {totalRefs}</span>
      </p>
      {usages.length === 0 ? (
        <div className="ts-empty">
          <p className="ts-empty-what">아무 조문도 이 박스를 놓지 않는다.</p>
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

  return <div><BoxEditor box={box} usage={usage} usageCount={usages.length} /></div>;
}
