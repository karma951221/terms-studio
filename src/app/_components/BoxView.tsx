/**
 * 정적 마스터 박스 한 개의 읽기 표시 — 머리 띠 「박스 이름(코드)」 + 【제목】 + 줄 (최종 결정 9 · 기능/박스 §4).
 * 문면 편집기 · 공용조항 모델 · 상품 템플릿 원문이 박스 참조를 같은 모양으로 그린다. 내용은 박스 화면에서만 고친다.
 */
import Link from "next/link";

import type { Box } from "@/domain/document/box";
import type { Code } from "@/domain/types";

export function BoxView({ code, box, link = true }: { code: Code; box: Box | undefined; link?: boolean }) {
  if (!box) {
    return (
      <aside className="ts-doc-box" data-box={code}>
        <p className="ts-doc-box-title">【박스 {code}】</p>
        <p className="ts-doc-box-line ts-muted">{code} — 없는 박스다(깨진 참조).</p>
      </aside>
    );
  }
  return (
    <aside className="ts-doc-box" data-box={code} aria-label={`박스 ${box.name}`}>
      <p className="ts-doc-box-ref ts-muted">
        박스 · {link ? <Link href={`/boxes/${encodeURIComponent(code)}`}>{box.name}</Link> : box.name} <span className="ts-mono">({code})</span>
      </p>
      {box.title !== "" && <p className="ts-doc-box-title">【{box.title}】</p>}
      {box.lines.map((line, i) => (
        <p key={i} className="ts-doc-box-line">
          {line}
        </p>
      ))}
    </aside>
  );
}
