/**
 * 실물 재현 대조의 **알려진 차이** — 모델이 원문과 일부러 다르게 내는 자리 (QA/인수기준 「알려진 차이」 · 한 몸).
 *
 * 대조기(`src/domain/assembly/compare.ts`)를 조용히 완화하지 않는다 — 대신 원문 줄(파싱양식)에 이 목록을 적용해 **기대 줄**을 만들고,
 * 조립 결과를 그 기대 줄과 글자 그대로 대조한다. 목록에 없는 차이는 전부 불일치다.
 * 쓰는 곳: `real.test.ts`(시드 → 조립) · 화면 E2E(`tests/e2e/real/_lib/compare.ts` · `tests/e2e/_lib/terms.ts`).
 */

export interface KnownDifference {
  /** 상품 픽스처 폴더 — 알파Plus 는 뿌리 「」, 메리츠 「메리츠」. */
  dir: string;
  file: string;
  /** 조 헤딩 줄(파싱양식 `## 제N조(조 명)`)의 조 명. */
  article: string;
  /** 이 줄(그 조 안, 공백 무시로 비교) 뒤에 `lines` 를 넣는다. */
  after: string;
  lines: string[];
  /** 인수기준의 차이 이름 — 사람이 읽는다. */
  why: string;
}

export const KNOWN_DIFFERENCES: readonly KnownDifference[] = [
  {
    dir: "",
    file: "보통약관.md",
    article: "계약의 무효",
    after: "@ 보험료 납입이 면제된 경우 제1항의「이미 납입한 보험료」는 계약자가 실제로 납입한 보험료로 합니다.",
    lines: [
      "@ 회사는 제1항에서 정한 사항 이외에도 피보험자가 계약일부터 암보장개시일의 전일 이전에「암(유사암제외)」으로 진단확정되는 경우에는 계약을 무효로 하며 이미 납입한 보험료를 돌려드립니다. 다만, 회사의 고의 또는 과실로 계약이 무효로 된 경우와 회사가 승낙 전에 무효임을 알았거나 알 수 있었음에도 보험료를 반환하지 않은 경우에는 보험료를 납입한 날의 다음날부터 반환일까지의 기간에 대하여 회사는 보험계약대출이율을 연단위 복리로 계산한 금액을 더하여 돌려 드립니다.",
    ],
    why: "원문 누락(오타 가능) — 무효 문구(종들): 면책 사유(암·면책)가 있으면 암보장개시일 항",
  },
];

const squash = (s: string) => s.replace(/\s+/g, "");

/** 원문 줄 → 기대 줄 — 그 파일의 알려진 차이를 적용한다. 자리를 못 찾으면 던진다(목록이 원문과 어긋난 것). */
export function expectedLines(dir: string, file: string, source: readonly string[]): string[] {
  const out = [...source];
  for (const d of KNOWN_DIFFERENCES.filter((x) => x.dir === dir && x.file === file)) {
    const heading = out.findIndex((l) => /^##\s/.test(l) && squash(l).endsWith(`(${squash(d.article)})`));
    if (heading < 0) throw new Error(`알려진 차이 「${d.why}」: 조 「${d.article}」 없음`);
    const next = out.findIndex((l, i) => i > heading && /^##?\s/.test(l));
    const end = next < 0 ? out.length : next;
    const at = out.findIndex((l, i) => i > heading && i < end && squash(l) === squash(d.after));
    if (at < 0) throw new Error(`알려진 차이 「${d.why}」: 조 「${d.article}」 안에 기준 줄이 없다`);
    out.splice(at + 1, 0, ...d.lines);
  }
  return out;
}
