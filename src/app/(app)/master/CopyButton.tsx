"use client";

/**
 * 코드 복사 버튼 — 클립보드로 보내고 잠깐 「복사했습니다」 (기능/마스터 §4.3 조작 ⧉).
 * 글리프는 그린다(IconCopy) — 문자 ⧉ 는 맑은 고딕에 없어 폴백 폰트로 어긋난다 (icons.tsx 머리말).
 */
import { useEffect, useState } from "react";

import { IconButton, IconCopy } from "@/app/_components/icons";

export function CopyButton({ text, label = "코드 복사" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // 클립보드 권한이 없으면(비보안 컨텍스트 등) 조용히 둔다 — 코드는 화면에 그대로 있다.
    }
  }

  return (
    <span className="ts-copy">
      <IconButton label={label} icon={<IconCopy />} onClick={copy} />
      {/* 라이브 영역은 늘 그려 두고 글자만 바꾼다 — hidden 을 켰다 끄면 보조기기가 못 읽는다. */}
      <span className="ts-copy-toast" role="status" aria-live="polite">
        {copied ? "복사했습니다" : ""}
      </span>
    </span>
  );
}
