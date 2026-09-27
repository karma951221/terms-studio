"use client";

/**
 * 목차의 체크박스 = **그 상품에서 이 조를 내보내는가** (기능/상품 §3.6 · §4.5 목차(좌)).
 *
 * 저장 버튼이 없다 — 켜고 끄는 즉시 서버 액션이 부르고, 액션이 `revalidatePath` 로 상세를 무효화해
 * 세 패널이 한꺼번에 다시 그려진다(가운데는 흐려지고, 오른쪽에서는 빠지고 번호가 순연된다).
 *
 * **실패는 말한다** (코덱스 리뷰 2026-09-15 Minor-2): 예전에는 `ActionOutcome` 을 버려서, 다른 창이
 * 템플릿을 해제한 뒤 체크하면 체크 상태만 슬며시 돌아가고 이유는 어디에도 없었다. 이유를 체크박스
 * 옆에 적고 `router.refresh()` 로 낡은 화면(그 사이 바뀐 템플릿)을 다시 읽는다.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { setArticleHiddenAction } from "../../actions";

export function ArticleVisibilityToggle({ productId, articleId, hidden, label }: { productId: string; articleId: string; hidden: boolean; label: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const router = useRouter();
  return (
    <>
      <input
        type="checkbox"
        aria-label={`노출 · ${label}`}
        title={`${label} 를 이 상품의 보통약관에 ${hidden ? "다시 넣는다" : "넣지 않는다"}`}
        checked={!hidden}
        disabled={pending}
        onChange={(e) => {
          const next = !e.target.checked;
          start(async () => {
            const outcome = await setArticleHiddenAction(productId, articleId, next);
            setError(outcome.ok ? undefined : (outcome.issues?.[0]?.message ?? "노출을 저장하지 못했습니다."));
            // 실패의 원인이 「그 사이 바뀐 템플릿」일 수 있다 — 성공 경로의 revalidate 가 없으니 여기서 다시 읽는다.
            if (!outcome.ok) router.refresh();
          });
        }}
      />
      {error && (
        <span className="ts-toc-error ts-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
