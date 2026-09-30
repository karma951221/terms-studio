import { AssemblyCheckLine } from "@/app/_components/AssemblyCheckLine";
import { Breadcrumb } from "@/app/_components/Breadcrumb";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { IssueList } from "@/app/_components/IssueList";
import { RenderedDoc, RenderedGroupView } from "@/app/_components/RenderedDoc";
import { ENTITY_LABEL, OMISSION_LABEL } from "@/app/_lib/labels";
import { formatDateTime } from "@/app/_lib/list";
import { currentActor, getServices } from "@/lib/services";

import { runPreviewAction } from "../../actions";
import { articleCount, excludedClauseLabel, omissionCounts, omissionPairLabel } from "../../lib";

export const dynamic = "force-dynamic";

/**
 * 조립 미리보기 — **저장된 산출본**을 보여 준다 (기능/조립산출 §3.6). 매 요청 조립하지 않는다.
 *
 * - 저장본 없음: 「실행」 버튼만. 실행하면 지금 입력으로 조립해 저장한다.
 * - 저장본 있음: 생성 시각 · 실행자 + 본문. 생성 이후 입력이 바뀌었으면(`stale`) 「오래된 결과」 배지 —
 *   결과는 지우지 않고 배지가 붙은 채 남긴다(기능/조립산출 §3.6). 「다시 실행」 만이 산출본을 바꾼다.
 * - 머리의 두 줄: 규모(먼저 읽히는 숫자는 전체 규모 — 디자인원칙 §9.6) · 조립 검사/내용 검토(디자인원칙 §9.2).
 * - 「조연결 판정」 절(기능/조립산출 §4.1): 조연결된 조마다 판정 배지 · 미합의 사유, 펼치면 항별 대조 표와 비교 제외 함수조항.
 *   생략된 조는 본문에서 사라지므로 근거는 여기서만 열린다.
 */
export default async function ProductPreviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const { error } = await searchParams;
  const services = getServices();
  await currentActor();
  const [product, record] = await Promise.all([services.product.getProduct(id), services.assembly.latest(id)]);

  if (!product) {
    return (
      <div>
        <Breadcrumb items={[{ label: ENTITY_LABEL.product, href: "/products" }, { label: id, href: `/products/${id}` }, { label: "미리보기" }]} />
        <p className="ts-error-banner">찾을 수 없습니다 — 상품</p>
      </div>
    );
  }

  const head = (
    <div className="ts-page-head">
      <Breadcrumb items={[{ label: ENTITY_LABEL.product, href: "/products" }, { label: product.name, href: `/products/${id}` }, { label: "미리보기" }]} />
    </div>
  );
  const runForm = (label: string, primary: boolean) => (
    <form action={runPreviewAction.bind(null, id)} style={{ display: "inline" }}>
      <button type="submit" className={primary ? "primary" : undefined}>
        {label}
      </button>
    </form>
  );

  if (!record) {
    return (
      <div>
        {head}
        <ErrorBanner message={error} />
        <p className="ts-muted">아직 실행하지 않았습니다 — 실행하면 지금 입력으로 조립해 저장합니다.</p>
        <div>{runForm("실행", true)}</div>
      </div>
    );
  }

  const booklet = record.booklet;
  const users = await services.auth.listUsers();
  const runner = (record.generatedBy && users.find((u) => u.id === record.generatedBy)?.name) ?? "—";

  const specialDocs = booklet.specials.flatMap((g) => g.docs);
  const generalArticles = articleCount(booklet.general);
  // 조연결 판정 절(기능/조립산출 §4.1)이 생기기 전에 저장된 산출본의 판정 기록에는 pairs · excludedClauseNodeIds 가 없다 — 입력이 안 바뀌면 stale 도 아니라서
  // 「다시 실행」 전까지는 근거 없는 행으로 그린다 (화면이 죽지 않게).
  const records = booklet.omitted.map((o) => ({ ...o, pairs: o.pairs ?? [], excludedClauseNodeIds: o.excludedClauseNodeIds ?? [] }));
  const counts = omissionCounts(records);
  // 비교 제외 함수조항의 이름 — 보통약관 템플릿 트리 + 함수조항 라벨 (판정 절에 그 노드가 있을 때만 읽는다)
  const needsClauseNames = records.some((o) => o.excludedClauseNodeIds.length > 0);
  const [generalTemplate, clauses] = needsClauseNames
    ? await Promise.all([product.generalDocumentId ? services.document.get(product.generalDocumentId) : undefined, services.clause.list()])
    : [undefined, []];
  const clauseLabelOf = (code: string) => clauses.find((c) => c.code === code)?.label;

  return (
    <div>
      <p className="ts-count">
        규모: 보통약관 {generalArticles}조 · 특약 {specialDocs.length}건 · 별표 {booklet.appendices.length}
        {records.length > 0 && <> · 생략 {counts.omitted}조</>}
      </p>
      <AssemblyCheckLine issues={booklet.issues} />
      {head}
      <ErrorBanner message={error} />
      {/* <form> 은 <p> 안에 못 선다 — div 로 (hydration 오류) */}
      <div className="ts-count" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "0 0 8px" }}>
        <span>
          {formatDateTime(record.generatedAt)} 기준 · {runner}
        </span>
        {record.stale && <span className="ts-badge warning">오래된 결과 — 생성 이후 입력이 바뀌었습니다</span>}
        {runForm("다시 실행", record.stale)}
      </div>
      {!booklet.complete && <p className="ts-error-banner">「완성본 아님」 — 아래 조립 검사 결과를 확인하세요.</p>}

      <section className="ts-section">
        <h2 className="ts-section-title">조립 검사 결과</h2>
        {booklet.issues.length === 0 ? <p className="ts-ok">오류 없음.</p> : <IssueList issues={booklet.issues} />}
      </section>

      {records.length > 0 && (
        <section className="ts-section">
          <h2 className="ts-section-title">
            조연결 판정{" "}
            <span className="ts-count">
              {records.length}건 · 생략 {counts.omitted} · 준용 {counts.applied} · 통째 {counts.full}
            </span>
          </h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {records.map((o, i) => (
              <li key={i} style={{ marginBottom: 6 }}>
                <details>
                  <summary style={{ cursor: "pointer" }}>
                    {o.productCoverageName} › {o.articleTitle}{" "}
                    <span className={o.reason ? "ts-badge warning" : "ts-badge"}>{OMISSION_LABEL[o.disposition]}</span>
                    {o.reason && <span className="ts-muted"> · {o.reason}</span>}
                  </summary>
                  <div style={{ margin: "6px 0 4px 16px" }}>
                    {o.pairs.length === 0 ? (
                      <p className="ts-muted">항 대조 없음 — 보통약관 조가 없거나 오류 마커가 있어 비교하지 않았습니다.</p>
                    ) : (
                      <table className="ts-table">
                        <thead>
                          <tr>
                            <th>담보 항</th>
                            <th>보통약관 항</th>
                            <th>대조</th>
                          </tr>
                        </thead>
                        <tbody>
                          {o.pairs.map((pair, j) => (
                            <tr key={j}>
                              <td>{pair.special === null ? <span className="ts-muted">— (담보 항 없음)</span> : omissionPairLabel(pair.special, pair.specialKind)}</td>
                              <td>{pair.general === null ? <span className="ts-muted">— (보통약관에 없는 항)</span> : omissionPairLabel(pair.general, pair.generalKind)}</td>
                              <td>{pair.matched ? "일치" : <span className="ts-badge warning">불일치</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {o.excludedClauseNodeIds.length > 0 && (
                      <p className="ts-count">비교 제외: {o.excludedClauseNodeIds.map((nodeId) => excludedClauseLabel(generalTemplate?.tree, nodeId, clauseLabelOf)).join(" · ")}</p>
                    )}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}

      <h2 className="ts-h2">
        보통약관 <span className="ts-count">{generalArticles}조</span>
      </h2>
      {booklet.general ? <RenderedDoc doc={booklet.general} /> : <p className="ts-muted">보통약관 템플릿이 없습니다.</p>}

      <h2 className="ts-h2">
        특약 그룹 <span className="ts-count">{specialDocs.length}건</span>
      </h2>
      {booklet.specials.map((g) => (
        <RenderedGroupView key={g.id} group={g} />
      ))}

      <h2 className="ts-h2">
        별표 <span className="ts-count">{booklet.appendices.length}건</span>
      </h2>
      <ul>
        {booklet.appendices.map((a) => (
          <li key={a.code}>
            【별표{a.number}({a.name})】
          </li>
        ))}
      </ul>

    </div>
  );
}
