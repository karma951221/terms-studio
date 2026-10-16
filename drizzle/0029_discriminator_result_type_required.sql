-- 구분자 결과 타입 필수 (기능/구분자 §3.1, 2026-10-17). 미지정 기존분은 시드 스크립트가 migrate 전에 식의 추론 타입으로 채운다
-- (`src/db/backfill-result-types.ts` — 추론은 식 언어라 SQL 로 못 한다). 채우지 못한 행이 남으면 시드 스크립트가 먼저 멈춘다.
ALTER TABLE "discriminators" ALTER COLUMN "result_type" SET NOT NULL;
