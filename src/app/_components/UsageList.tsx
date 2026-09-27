import Link from "next/link";

import { FIELD_LABEL, REFERENCE_VIA_LABEL } from "@/app/_lib/labels";
import { formatCoordinate } from "@/domain/coordinate";
import type { RefEdge } from "@/domain/refs";

import { coordinateHref } from "./coordinateHref";

export function UsageList({ usages, totalRefs, empty }: { usages: readonly RefEdge[]; totalRefs: number; empty: string }) {
  return (
    <div>
      <p className="ts-l2-side-title">
        {FIELD_LABEL.usage} <span className="ts-count"><b>{usages.length}</b> / 전체 참조 {totalRefs}</span>
      </p>
      {usages.length === 0 ? (
        <div className="ts-empty"><p className="ts-empty-what">{empty}</p></div>
      ) : (
        <table className="ts-table">
          <thead><tr><th className="col-fixed-md">형태</th><th className="col-flex">좌표</th></tr></thead>
          <tbody>{usages.map((item, index) => {
            const href = coordinateHref(item.at);
            const coordinate = formatCoordinate(item.at, { source: true });
            return <tr key={index}><td>{REFERENCE_VIA_LABEL[item.via]}</td><td>{href ? <Link href={href}>{coordinate}</Link> : coordinate}</td></tr>;
          })}</tbody>
        </table>
      )}
    </div>
  );
}
