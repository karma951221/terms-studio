"use client";

/**
 * 약관 섹션 좌측 목차 — 템플릿의 **관 › 조** (기능/상품 §4 「보통약관」 목차(좌)).
 *
 * - 관은 제목만, 조는 노출여부 + 번호 + 제목. 번호는 **템플릿 번호**(끄기 전)다 — 순연된 번호는 오른쪽 미리보기에서 본다.
 * - 노출여부는 보통약관 탭의 편집 상태를 따른다 (기능/상품 §3.8): 읽기는 표시(✓ · 끔)만, 편집은 체크박스 — 누르면 초안에만
 *   쌓이고 저장 한 번에 나간다. 저장본과 달라진 조에 「변경」, 저장 거부는 그 줄 아래에.
 * - 끈 조는 취소선 · 흐리게(`.is-hidden-article`). 고른 조는 `aria-current` (주칠).
 * - 조 사본 (ADR-0079) — 사본이 있는 조에 빨간 점, 사본을 만든 뒤 템플릿의 그 조가 바뀌었으면 노란 점을 더한다(읽기 · 편집 모두,
 *   편집 중이면 초안을 따른다). 제목은 사본의 제목.
 * - 조 제목은 진짜 주소(`…&art=<조 id>`)를 가진 링크지만 누르면 **서버로 가지 않는다** — 고른 조만 바꾸고 주소는
 *   `replaceState` 로 맞춘다 (`selectArticleOnClick` · 2026-09-28 사용자 QA「목차를 누르면 새로고침된다」).
 */
import type { Id } from "@/domain/types";

import { generalArticlePath } from "../../lib";
import { useGeneralEdit } from "./GeneralEdit";
import { selectArticleOnClick } from "./tocNav";

/** 목차 한 묶음(관) — 번호 · 제목 표기는 서버가 템플릿 번호로 만들어 준다. */
export interface TocSection {
  key: string;
  /** 「제1관 목적 및 용어의 정의」 — 관 밖 조 묶음이면 없다. */
  label?: string;
  articles: {
    id: Id;
    /** 「제3조(지급제한)」 — 저장된 상태(사본이면 사본 제목)로. */
    label: string;
    /** 「제3조」 — 편집 중에는 이것과 초안의 제목(사본이면 사본 제목, 아니면 템플릿 제목)을 이어 붙인다. */
    number: string;
    /** 템플릿의 조 제목. */
    templateTitle: string;
    hidden: boolean;
    /** 지금 템플릿 조의 지문 — 사본의 지문과 다르면 「템플릿이 바뀜」(노랑). */
    templateHash: string;
  }[];
}

/** 조 하나의 사본 표시 — 초안(읽기면 저장본)의 사본과 지금 템플릿 지문으로. */
export function copyStateOf(copy: { templateHash: string } | undefined, templateHash: string): "copied" | "stale" | undefined {
  return copy ? (copy.templateHash === templateHash ? "copied" : "stale") : undefined;
}

/** 빨강(사본) · 노랑(템플릿이 바뀜) 점 — 목차 · 조 편집 패널 머리가 같이 쓴다. */
export function CopyDots({ state, label }: { state: "copied" | "stale" | undefined; label: string }) {
  if (!state) return null;
  return (
    <>
      <span className="ts-copy-dot" role="img" aria-label={`이 상품 사본 · ${label}`} title="이 상품 사본 — 템플릿과 다른 본문(템플릿을 따라가지 않는다)" />
      {state === "stale" && <span className="ts-copy-dot is-stale" role="img" aria-label={`템플릿이 바뀜 · ${label}`} title="템플릿이 바뀜 — 사본을 만든 뒤 템플릿의 이 조가 고쳐졌다. 편집에서 나란히 보고 고른다" />}
    </>
  );
}

export function GeneralToc({
  productId,
  sections,
  currentArticleId,
  onSelect,
}: {
  productId: Id;
  sections: readonly TocSection[];
  currentArticleId: Id | undefined;
  onSelect: (articleId: Id) => void;
}) {
  const edit = useGeneralEdit();
  if (sections.length === 0) return <p className="ts-muted">템플릿에 조가 하나도 없다.</p>;
  return (
    <nav className="ts-terms-toc" aria-label="보통약관 목차">
      {sections.map((s) => (
        <div key={s.key}>
          {s.label && <p className="ts-toc-section">{s.label}</p>}
          {s.articles.map((a) => {
            const href = generalArticlePath(productId, a.id);
            const hidden = edit ? edit.current.hidden.includes(a.id) : a.hidden;
            const errors = edit?.errors.articles.get(a.id) ?? [];
            const copy = edit?.current.copies[a.id];
            const label = copy ? `${a.number}(${copy.article.title})` : edit ? `${a.number}(${a.templateTitle})` : a.label;
            const state = edit ? copyStateOf(copy, a.templateHash) : undefined;
            return (
              <div key={a.id} id={`toc-${a.id}`} className={hidden ? "ts-toc-row is-hidden-article" : "ts-toc-row"}>
                {edit?.editing ? (
                  <input
                    type="checkbox"
                    aria-label={`노출 · ${label}`}
                    title={`${label} 를 이 상품의 보통약관에 ${hidden ? "다시 넣는다" : "넣지 않는다"} (저장하면 반영)`}
                    checked={!hidden}
                    aria-invalid={errors.length > 0 || undefined}
                    onChange={(e) => edit.dispatch({ type: "toggleArticle", articleId: a.id, shown: e.target.checked })}
                  />
                ) : (
                  <span className="ts-toc-mark" role="img" aria-label={hidden ? `노출 끔 · ${label}` : `노출 · ${label}`}>
                    {hidden ? "–" : "✓"}
                  </span>
                )}
                <a href={href} title={label} aria-current={a.id === currentArticleId ? "true" : undefined} onClick={(e) => selectArticleOnClick(e, href, () => onSelect(a.id))}>
                  {label}
                </a>
                <CopyDots state={state} label={label} />
                {edit?.changes.articles.has(a.id) && <span className="ts-badge ts-changed-mark">변경</span>}
                {errors.map((message, i) => (
                  <span key={i} className="ts-toc-error ts-error" role="alert">
                    {message}
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

