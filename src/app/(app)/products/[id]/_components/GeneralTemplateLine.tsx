"use client";

/**
 * 보통약관 탭 첫 줄 — 「보통약관 템플릿」 이름 · 집계 · 편집/저장 (기능/상품 §4.6).
 *
 * - 템플릿은 쉽게 바뀌면 안 된다: 읽기에서는 이름을 글로만 보인다. 편집 중에만 작은 「템플릿 바꾸기…」가 서고,
 *   누르면 이 줄 아래에 고르기(콤보박스)가 열린다. 교체는 저장 한 번의 예외다 — 조 노출 · 오버라이드를 초기화하므로
 *   기존 확인 카드(`?confirm=template:<id>`)를 거쳐 그 자리에서 실행된다. 저장하지 않은 고친 것은 버린다고 미리 말하고,
 *   템플릿이 실제로 바뀌어 돌아오면 편집을 묻지 않고 끝낸다(`end` — 초안의 노드는 옛 템플릿 것이다).
 * - 템플릿이 없으면(미지정) 편집할 것이 없다 — 이 줄이 곧 고르기(잃을 것이 없으면 바로 지정)다.
 * - 오른쪽 끝은 집계 한 줄 + 이 탭의 편집 조작(`ProductEditButtons`) — 헤더가 아니라 탭 안이다 (2026-10-03 사용자 QA).
 * - 이 상품의 보통약관 설정을 마지막으로 저장한 뒤 템플릿이 고쳐졌으면(템플릿 판 > 기준 판) 줄 아래에 경고 한 줄 — 다음 저장에서 사라진다
 *   (ADR-0079). 새 조는 템플릿을 따라 저절로 들어오므로 알리기만 한다.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Combobox } from "@/app/_components/Combobox";
import type { Id } from "@/domain/types";

import { setProductGeneralDocumentAction } from "../../actions";
import { useGeneralEdit } from "./GeneralEdit";
import { ProductEditButtons, useProductEdit } from "./ProductEdit";

export function GeneralTemplateLine({
  productId,
  generalDocumentId,
  templateTitle,
  generals,
  summary,
  templateChanged = false,
}: {
  productId: Id;
  generalDocumentId: Id | undefined;
  templateTitle: string | undefined;
  generals: readonly { id: Id; title: string }[];
  /** 「N조 중 M 노출 · 사본 c · 오버라이드 k · 오류 e · 별표 b(자동)」 — 템플릿이 있을 때만. */
  summary?: ReactNode;
  /** 마지막 저장 뒤 템플릿이 바뀌었다 — 경고 한 줄. */
  templateChanged?: boolean;
}) {
  const { editing, end } = useProductEdit();
  const edit = useGeneralEdit();
  const [picking, setPicking] = useState(false);
  const [choice, setChoice] = useState(generalDocumentId ?? "");
  // 편집이 끝나면(저장 · 취소 · 탭 이동) 고르기도 닫는다 — 렌더 중 상태 맞추기
  if (picking && !editing) setPicking(false);
  // 템플릿이 바뀌어 돌아왔으면(교체 실행) 편집을 끝낸다 — 묻지 않는다: 고르기에서 버려진다고 이미 말했다
  const served = useRef(generalDocumentId);
  useEffect(() => {
    if (served.current === generalDocumentId) return;
    served.current = generalDocumentId;
    end();
  }, [generalDocumentId, end]);
  const action = setProductGeneralDocumentAction.bind(null, productId);
  const unsaved = edit ? edit.changes.articles.size + edit.changes.nodes.size : 0;
  const options = generals.map((g) => ({ value: g.id, label: g.title }));

  if (!generalDocumentId) {
    return (
      <form action={action} className="ts-terms-template">
        <label>
          <span>보통약관 템플릿</span>
          <Combobox name="generalDocumentId" value={choice} onChange={setChoice} placeholder="이름으로 찾기" options={options} />
        </label>
        <span className="ts-terms-template-end">
          <button type="submit" disabled={choice === ""}>
            템플릿 지정
          </button>
        </span>
      </form>
    );
  }

  return (
    <>
      <div className="ts-terms-template">
        <span className="ts-terms-template-label">보통약관 템플릿</span>
        <span className="ts-terms-template-name">{templateTitle ?? generalDocumentId}</span>
        {editing && !picking && (
          <button
            type="button"
            className="ts-terms-template-change"
            onClick={() => {
              setChoice(generalDocumentId);
              setPicking(true);
            }}
          >
            템플릿 바꾸기…
          </button>
        )}
        <span className="ts-terms-template-end">
          {summary && <span className="ts-count ts-terms-template-count">{summary}</span>}
          <ProductEditButtons />
        </span>
      </div>
      {picking && (
        // 교체는 확인 카드에서 실행된다 — 잃을 것이 있으면 액션이 `?confirm=template:<id>` 로 보낸다
        <form action={action} className="ts-terms-template ts-terms-template-pick">
          <label>
            <span>바꿀 템플릿</span>
            <Combobox name="generalDocumentId" value={choice} onChange={setChoice} placeholder="이름으로 찾기" options={[{ value: "", label: "미지정 (템플릿 해제)" }, ...options]} />
          </label>
          <button type="submit" disabled={choice === generalDocumentId}>
            바꾸기
          </button>
          <button type="button" onClick={() => setPicking(false)}>
            닫기
          </button>
          <span className="ts-muted">
            바꾸면 조 노출 · 옵션 오버라이드 · 조 사본이 초기화된다{unsaved > 0 ? ` — 저장하지 않은 변경 ${unsaved}건도 버려진다` : ""}.
          </span>
        </form>
      )}
      {templateChanged && (
        <p role="status" className="ts-warn ts-terms-template-warn">
          보통약관 템플릿이 바뀌었습니다 — 새로 추가된 조 등을 확인하세요
        </p>
      )}
      {edit?.message && (
        <p role="alert" className="ts-error-banner">
          {edit.message}
        </p>
      )}
    </>
  );
}
