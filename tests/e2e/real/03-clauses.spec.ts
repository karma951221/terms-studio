import { test } from "../_lib/fixtures";
import { NO_COORD, login } from "./_lib/app";
import { ClauseAuthoringDriver } from "./_lib/driver";
import { ALL_GENERAL_ANCESTORS, BASE_CLAUSE_CODES, SEED } from "./_lib/seed";

/**
 * ★ 실물 재현(화면) ③ 공용조항 — 유형 · 이름 · 옵션 · 본문(글 · 슬롯 · 별표 참조 · 조 참조 · 옵션 자리 · 문장 안 조건). 모델명세 §4 · 메리츠_모델명세 §4.
 * 공용조항은 두 곳 이상이 되풀이하는 조 · 여러 항이다(2026-09-28) — 조 참조는 범위 셋: 보통약관 · 이 공용조항(「제1항에 따라」) · 사용처(「제1조(보험금의 지급사유)에서 정한」).
 * 조 참조 · 별표 참조의 대상이 있어야 하므로 보통약관 · 별표(바탕 DB) 뒤, 담보약관 템플릿 앞 (명세 §1 ⑦).
 * 보통약관이 쓰는 공용조항(C0001~C0100 — 조째 19 · 박스 81)은 바탕 DB 가 보통약관과 함께 시드로 넣었다 — 그 뒤 코드(C0101~)부터 친다.
 * 「박스」 공용조항은 생성 화면의 빈 박스에 제목 · 줄을 친다(줄 안 옵션 자리는 〔옵션명〕) — 원문의 박스는 모두 박스 공용조항이다(2026-09-28).
 * 준용규정(알파Plus)의 「갱신형이면」 조건은 조건 머리 줄의 담보속성 줄(있음 AND = 갱신형)로 친다 (2026-09-28 — 기능/문면 §3.3).
 * 준용규정(메리츠)의 조 참조는 메리츠 보통약관 조를 고른다 — 고르기 트리는 보통약관 두 벌을 다 보인다.
 */

const ancestors = ALL_GENERAL_ANCESTORS;

test.describe.serial("실물 재현(화면) ③ 공용조항", () => {
  for (const spec of SEED.clauses.filter((c) => !BASE_CLAUSE_CODES.has(c.code))) {
    test(`${spec.code} ${spec.label}`, NO_COORD, async ({ page, ev }) => {
      test.setTimeout(180_000);
      const driver = new ClauseAuthoringDriver(page, ancestors);
      await ev.action("실물화면#3.1", "관리자로 로그인한다", () => login(page));
      await ev.action("실물화면#3.2", `생성 화면 — 유형 ${{ inline: "문구", block: "항", box: "박스" }[spec.mode]} · 이름 「${spec.label}」`, () => driver.open(spec.mode, spec.label));
      if (spec.options.length > 0) await ev.action("실물화면#3.3", `옵션 ${spec.options.map((o) => o.label).join(" · ")}`, () => driver.options(spec.options));
      await ev.action("실물화면#3.4", "본문을 친다", () => driver.body(spec.mode, spec.body));
      await ev.action("실물화면#3.5", `저장 한 번 — ${spec.code} 로 만들어진다`, () => driver.save(spec.code));
    });
  }
});
