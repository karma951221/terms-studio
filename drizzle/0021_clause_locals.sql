-- 함수조항 내부 변수 (최종 결정 2 · 기능/함수조항 §3.7, 2026-09-30).
--
-- clauses.locals = 내부 변수 배열 `[{ name, expr }]` — 인자를 가공한 값에 붙인 이름, 본문은 `var.<이름>` 으로 읽는다.
-- 옛 행은 빈 목록(내부 변수 0개)을 받는다.
ALTER TABLE "clauses" ADD COLUMN "locals" jsonb DEFAULT '[]'::jsonb NOT NULL;
