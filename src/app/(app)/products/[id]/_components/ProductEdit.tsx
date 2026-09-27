"use client";

/**
 * 상품 상세의 편집 상태 — 헤더 조작(편집 · 더보기 / 취소 · 저장)과 기본정보 본문이 함께 쓴다
 * (와이어프레임 §20.2 「화면 전체의 저장 버튼 하나」).
 *
 * 서버 컴포넌트인 page.tsx 는 `ProductEditProvider` 로 본문을 감싸기만 한다. 본문(BasicTab)이 마운트되며
 * 제 begin · cancel · save · dirty 를 등록하고, 헤더의 `ProductHeadActions` 가 그것을 부른다. 저장이 끝나면
 * 여기서 읽기로 돌아가고 `router.refresh()` 로 서버 값을 다시 받는다.
 *
 * 편집 중 떠나는 조작 — ✕ 취소 · 하위 탭 링크(`ProductTabs`) · 경로 링크(`ProductPath`) — 은 고친 것이 있으면
 * EditShell 과 같은 `DiscardDialog`(「고친 내용을 버립니까?」)를 거친다 (디자인원칙 §1.7 · 점검 M21).
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { Breadcrumb } from "@/app/_components/Breadcrumb";
import { DiscardDialog } from "@/app/_components/EditShell";
import { MoreMenu, type MoreMenuItem } from "@/app/_components/MoreMenu";
import { ENTITY_LABEL } from "@/app/_lib/labels";

/**
 * 본문이 등록하는 손잡이. `save` 는 저장이 끝나 읽기로 돌아가도 되면 `"done"`, 입력을 유지해야 하면 `"stay"`.
 * `dirty` 는 지금 초안이 편집 시작과 달라졌는가 — 떠나는 조작의 「버립니까?」 판정에 쓴다.
 */
export interface ProductEditHandlers {
  begin(): void;
  cancel(): void;
  save(confirmed: boolean): Promise<"done" | "stay">;
  dirty(): boolean;
}

interface ProductEditContextValue {
  editing: boolean;
  pending: boolean;
  /** 이 탭에 편집할 것이 있는가 — 기본정보 탭만 (보통약관·특별약관의 편집 흐름 통합은 후속 범위). */
  canEdit: boolean;
  begin(): void;
  /** ✕ — 고친 것이 있으면 「버립니까?」 뒤에, 없으면 바로 읽기로. */
  cancel(): void;
  save(confirmed?: boolean): void;
  /** 이 편집 화면을 떠나는 조작(탭 링크 · 경로 링크) — 고친 것이 있으면 「버립니까?」 뒤에, 없으면 바로 `go`. */
  leave(go: () => void): void;
  register(handlers: ProductEditHandlers | null): void;
}

const ProductEditContext = createContext<ProductEditContextValue | null>(null);

export function useProductEdit(): ProductEditContextValue {
  const ctx = useContext(ProductEditContext);
  if (!ctx) throw new Error("useProductEdit 는 ProductEditProvider 안에서만 쓸 수 있습니다.");
  return ctx;
}

/**
 * 편집 중 떠나는 조작(✕ 취소 · 탭 링크 · 경로 링크)이 「고친 내용을 버립니까?」를 거치는가 (점검 M21 · 디자인원칙 §1.7).
 * EditShell 의 `leave` 와 같은 규칙 — 편집 중이고 고친 것이 있을 때만 묻는다.
 */
export function leaveNeedsConfirm({ editing, dirty }: { editing: boolean; dirty: boolean }): boolean {
  return editing && dirty;
}

export function ProductEditProvider({ canEdit, children }: { canEdit: boolean; children: ReactNode }) {
  const [editingState, setEditing] = useState(false);
  /** 「버립니까?」 확인 — 버리면 그 조작의 `go` 로. */
  const [discard, setDiscard] = useState<{ go: () => void }>();
  const [pending, startTransition] = useTransition();
  const handlers = useRef<ProductEditHandlers | null>(null);
  const router = useRouter();

  // 편집할 것이 없는 탭으로 옮겨 오면(탭은 URL 이라 이 Provider 는 남는다) 편집을 푼다 —
  // 헤더가 본문 없는 `[취소] [저장]` 로 남지 않게 (점검 M21).
  if (editingState && !canEdit) setEditing(false);
  const editing = editingState && canEdit;

  const register = useCallback((h: ProductEditHandlers | null) => {
    handlers.current = h;
  }, []);
  const begin = useCallback(() => {
    handlers.current?.begin();
    setEditing(true);
  }, []);
  const leave = useCallback(
    (go: () => void) => (leaveNeedsConfirm({ editing, dirty: handlers.current?.dirty() ?? false }) ? setDiscard({ go }) : go()),
    [editing],
  );
  const cancel = useCallback(
    () =>
      leave(() => {
        handlers.current?.cancel();
        setEditing(false);
      }),
    [leave],
  );
  const save = useCallback(
    (confirmed = false) => {
      const h = handlers.current;
      if (!h) return;
      startTransition(async () => {
        const outcome = await h.save(confirmed);
        if (outcome !== "done") return;
        setEditing(false);
        router.refresh();
      });
    },
    [router],
  );

  const value = useMemo<ProductEditContextValue>(
    () => ({ editing, pending, canEdit, begin, cancel, save, leave, register }),
    [editing, pending, canEdit, begin, cancel, save, leave, register],
  );
  return (
    <ProductEditContext.Provider value={value}>
      {children}
      {discard ? (
        <DiscardDialog
          onStay={() => setDiscard(undefined)}
          onDiscard={() => {
            const { go } = discard;
            setDiscard(undefined);
            go();
          }}
        />
      ) : null}
    </ProductEditContext.Provider>
  );
}

/**
 * 상품 상세의 경로 「상품 › {상품명}」 (디자인원칙 §1.7) — 편집 중 고친 것이 있으면 상위로 가는 링크가 「버립니까?」 확인을 거친다.
 */
export function ProductPath({ name }: { name: string }) {
  const { leave } = useProductEdit();
  return <Breadcrumb items={[{ label: ENTITY_LABEL.product, href: "/products" }, { label: name }]} guard={leave} />;
}

/**
 * 헤더 오른쪽의 조작 — 읽기: `[편집] [더보기 ▾]`, 편집: `[취소] [저장]` (같은 자리 · 같은 규격).
 * 편집이 없는 탭에서는 더보기만 선다.
 */
export function ProductHeadActions({ menu }: { menu: MoreMenuItem[] }) {
  const { editing, pending, canEdit, begin, cancel, save } = useProductEdit();
  if (editing) {
    return (
      <div className="ts-product-actions">
        <button type="button" disabled={pending} onClick={cancel}>
          취소
        </button>
        <button type="button" className="primary" disabled={pending} onClick={() => save()}>
          {pending ? "저장 중…" : "저장"}
        </button>
      </div>
    );
  }
  return (
    <div className="ts-product-actions">
      {canEdit && (
        <button type="button" onClick={begin}>
          편집
        </button>
      )}
      <MoreMenu items={menu} />
    </div>
  );
}
