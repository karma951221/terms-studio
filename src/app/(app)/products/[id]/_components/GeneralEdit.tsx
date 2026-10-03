"use client";

/**
 * 보통약관 탭의 편집 상태 — 읽기로 열고, 탭 첫 줄의 `편집`을 누르면 조 노출(목차 체크) · 조 사본(조 편집 패널) ·
 * 함수조항 옵션(조 편집 패널의 옵션 줄)을 고칠 수 있다. 고친 것은 **초안**(`generalDraft`)에만 쌓이고 `저장` 한 번이
 * `saveProductGeneralAction` 으로 최종 상태를 보낸다 (기능/상품 §3.8 · §3.10 · §4.6, ADR-0079).
 *
 * `ProductEditProvider` 에 제 begin · cancel · save · dirty 를 등록한다 — 기본정보 탭과 같은 손잡이라
 * 탭 링크 · 경로 링크 · 취소의 「고친 내용을 버립니까?」도 그대로 탄다. 목차 · 원문 패널은 `useGeneralEdit()` 로
 * 지금 보일 상태(`current` — 읽기는 저장본, 편집은 초안) · 변경 표시 · 저장 거부 이슈를 읽는다.
 * Provider 밖(특별약관 탭 · 단독 렌더)이면 `undefined` — 저장본 읽기다.
 */
import { createContext, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from "react";

import type { ArticleCopy, ClauseOptionOverride } from "@/domain/product";
import type { Id } from "@/domain/types";

import { saveProductGeneralAction } from "../../actions";
import { generalDraftChanges, generalDraftDirty, generalDraftReducer, initGeneralDraft, issuesByPlace, toGeneralSettings, type GeneralDraft, type GeneralDraftAction } from "./generalDraft";
import { useProductEdit } from "./ProductEdit";

export interface OverrideOptionValue {
  code: string;
  label: string;
}

export interface OverrideOption {
  code: string;
  label: string;
  values: OverrideOptionValue[];
}

/** 보통약관 문면의 함수조항 참조 자리 — page.tsx 가 `document.refs` 로 만든다. 고를 옵션 목록의 재료. */
export interface OverrideTarget {
  nodeId: string;
  clauseCode: string;
  /** 「제4조(보험금의 지급사유) › 함수조항 면책 보충(C0002)」 */
  label: string;
  options: OverrideOption[];
}

export interface GeneralEditValue {
  editing: boolean;
  /** 지금 보일 상태 — 읽기는 저장본, 편집은 초안. */
  current: GeneralDraft;
  /** 저장본과 달라진 조 · 함수조항 자리 (읽기면 비어 있다). */
  changes: { articles: ReadonlySet<Id>; nodes: ReadonlySet<Id> };
  /** 마지막 저장 거부의 이슈 — 고칠 자리별. */
  errors: ReturnType<typeof issuesByPlace>;
  /** 마지막 저장 거부의 한 줄 (탭 첫 줄 아래). */
  message: string | undefined;
  dispatch(action: GeneralDraftAction): void;
}

const NO_ERRORS: GeneralEditValue["errors"] = { articles: new Map(), nodes: new Map(), copies: [], other: [] };
const NO_CHANGES: GeneralEditValue["changes"] = { articles: new Set(), nodes: new Set() };

const NO_COPIES: readonly ArticleCopy[] = [];

export const GeneralEditContext = createContext<GeneralEditValue | undefined>(undefined);

export function useGeneralEdit(): GeneralEditValue | undefined {
  return useContext(GeneralEditContext);
}

export function GeneralEditProvider({
  productId,
  generalDocumentId,
  templateVersion,
  hiddenArticles,
  overrides,
  copies = NO_COPIES,
  children,
}: {
  productId: Id;
  generalDocumentId: Id;
  /** 화면이 받은 템플릿 판 — 저장하면 「기준 판」이 된다(그 사이 템플릿이 바뀌었으면 경고가 남는다). */
  templateVersion?: number;
  hiddenArticles: readonly Id[];
  overrides: readonly ClauseOptionOverride[];
  /** 저장된 조 사본 — 템플릿에 자리가 남은 것만 (page.tsx). */
  copies?: readonly ArticleCopy[];
  children: ReactNode;
}) {
  const { editing, register } = useProductEdit();
  const saved = useMemo(() => initGeneralDraft(hiddenArticles, overrides, copies), [hiddenArticles, overrides, copies]);
  const [draft, dispatch] = useReducer(generalDraftReducer, saved);
  const [errors, setErrors] = useState(NO_ERRORS);
  const [message, setMessage] = useState<string>();

  const clear = () => {
    setErrors(NO_ERRORS);
    setMessage(undefined);
  };
  const begin = () => {
    dispatch({ type: "reset", draft: saved });
    clear();
  };
  const save = async (): Promise<"done" | "stay"> => {
    try {
      const outcome = await saveProductGeneralAction(productId, toGeneralSettings(generalDocumentId, draft, templateVersion));
      if (outcome.ok) {
        clear();
        return "done";
      }
      const byPlace = issuesByPlace(outcome.issues);
      setErrors(byPlace);
      setMessage([outcome.message, ...byPlace.other].join(" "));
      return "stay";
    } catch {
      setMessage("저장하지 못했습니다. 고친 내용은 유지됩니다. 다시 시도해 주세요.");
      return "stay";
    }
  };
  // 매 렌더 등록 — 손잡이가 최신 초안을 닫아 두도록 (BasicTab 과 같은 방식)
  useEffect(() => {
    register({ begin, cancel: clear, save, dirty: () => generalDraftDirty(saved, draft) });
    return () => register(null);
  });

  const value: GeneralEditValue = {
    editing,
    current: editing ? draft : saved,
    changes: editing ? generalDraftChanges(saved, draft) : NO_CHANGES,
    errors: editing ? errors : NO_ERRORS,
    message: editing ? message : undefined,
    dispatch,
  };
  return <GeneralEditContext.Provider value={value}>{children}</GeneralEditContext.Provider>;
}
